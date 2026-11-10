"""Reel Instagram 9:16 guidato dall'analisi: storyboard, narrazione, motion graphics, sottotitoli, export."""
from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import biomech as B
from . import gfx as G
from . import tts
from .analysis import Analysis

OW, OH = 1080, 1920
FPS = 30
VID_Y, VID_H = 250, 1180  # area video
CAPTION_Y = VID_Y + VID_H + 30


# ---------------------------------------------------------------- keyframe

@dataclass
class Keys:
    td1: int | None = None
    to_before: int | None = None
    to1: int | None = None
    td2: int | None = None
    to2: int | None = None
    start: int | None = None
    ext_frame: int | None = None
    ext_leg: str | None = None
    td1_foot: str | None = None
    td2_foot: str | None = None
    notes: list = field(default_factory=list)


def keyframes(A: Analysis) -> Keys:
    K = Keys()
    ev = sorted(A.events, key=lambda e: e["frame"])
    tds = [e for e in ev if e["type"] == "TD"]
    st = next((e for e in ev if e["type"] == "START"), None)
    K.start = st["frame"] if st else None
    if tds:
        K.td1, K.td1_foot = tds[0]["frame"], tds[0]["foot"]
        prev = [e for e in ev if e["type"] == "TO" and e["frame"] < K.td1]
        K.to_before = prev[-1]["frame"] if prev else None
        to1 = next((e for e in ev if e["type"] == "TO" and e["frame"] > K.td1 and e["foot"] == K.td1_foot), None)
        K.to1 = to1["frame"] if to1 else None
        td2 = next((e for e in tds[1:] if e["foot"] != K.td1_foot), None)
        if td2:
            K.td2, K.td2_foot = td2["frame"], td2["foot"]
            to2 = next((e for e in ev if e["type"] == "TO" and e["frame"] > K.td2 and e["foot"] == K.td2_foot), None)
            K.to2 = to2["frame"] if to2 else None
    if K.to1 is not None:
        K.ext_frame, K.ext_leg = K.to1, K.td1_foot
    elif K.to_before is not None:
        K.ext_frame = K.to_before
        K.ext_leg = next(e["foot"] for e in ev if e["frame"] == K.to_before and e["type"] == "TO")
    else:
        # nessun evento: fotogramma di massima estensione del ginocchio dell'arto vicino (stima)
        best, bf = 1e9, None
        for j, P in enumerate(A.px):
            if P is None:
                continue
            M = A.metrics(A.start + j)
            v = M[f"knee{A.near}"].value
            if v < best:
                best, bf = v, A.start + j
        K.ext_frame, K.ext_leg = bf, A.near
        K.notes.append("Eventi non identificati: fotogramma di estensione scelto come minima flessione del ginocchio (stima).")
    return K


def extension_sequence(A: Analysis, K: Keys) -> dict:
    """Momento di massima estensione di anca, ginocchio e caviglia durante l'appoggio dell'arto propulsivo."""
    k = K.ext_leg
    if K.td1 is not None and K.to1 is not None and K.ext_leg == K.td1_foot:
        a, b = K.td1, K.to1
    else:
        a, b = max(A.start, K.ext_frame - int(A.fps * 0.15)), K.ext_frame
    res = {}
    for name, key, sign in (("anca", f"hip{k}", 1), ("ginocchio", f"knee{k}", 1), ("caviglia", f"ankle{k}", 1)):
        best = None
        for i in range(a, b + 1):
            M = A.metrics(i)
            if not M:
                continue
            m = M[key]
            if best is None or m.value * sign < best[1] * sign:
                best = (i, m.value, m.conf)
        if best:
            res[name] = dict(frame=best[0], value=best[1], conf=best[2])
    frames = [res[n]["frame"] for n in ("anca", "ginocchio", "caviglia") if n in res]
    confs = [res[n]["conf"] for n in res]
    if len(frames) == 3 and B.LOW not in confs:
        if frames[0] <= frames[1] <= frames[2] and frames[2] - frames[0] >= 1:
            res["sequenza"] = "prossimo-distale (anca → ginocchio → caviglia)"
        elif max(frames) - min(frames) <= 1:
            res["sequenza"] = "pressoché simultanea (entro 1 fotogramma)"
        else:
            res["sequenza"] = "non prossimo-distale"
    else:
        res["sequenza"] = "non determinabile con affidabilità"
    res["intervallo"] = (a, b)
    return res


# ---------------------------------------------------------------- frame source

class Source:
    def __init__(self, A: Analysis, max_w=1920):
        self.A = A
        cap = cv2.VideoCapture(A.video)
        cap.set(cv2.CAP_PROP_POS_FRAMES, A.start)
        self.scale = min(1.0, max_w / A.W)
        self.frames = []
        for _ in range(len(A.px)):
            ok, fr = cap.read()
            if not ok:
                break
            if self.scale < 1:
                fr = cv2.resize(fr, None, fx=self.scale, fy=self.scale, interpolation=cv2.INTER_AREA)
            self.frames.append(fr)
        cap.release()
        # traccia morbida del centro dell'atleta per la camera virtuale
        cs, hs = [], []
        for P in A.px:
            if P is None:
                cs.append(None); hs.append(None); continue
            v = P[P[:, 3] > 0.3][:, :2]
            v = v if len(v) else P[:, :2]
            cs.append(((v[:, 0].min() + v[:, 0].max()) / 2, (v[:, 1].min() + v[:, 1].max()) / 2))
            hs.append(v[:, 1].max() - v[:, 1].min())
        last_c = next((c for c in cs if c), (A.W / 2, A.H / 2)); last_h = next((h for h in hs if h), A.H / 2)
        for i in range(len(cs)):
            cs[i] = cs[i] or last_c; hs[i] = hs[i] or last_h; last_c, last_h = cs[i], hs[i]
        c = np.array(cs); h = np.array(hs)
        k = 9
        ker = np.ones(k) / k
        pad = lambda x: np.pad(x, (k // 2, k // 2), mode="edge")
        self.cx = np.convolve(pad(c[:, 0]), ker, "valid")
        self.cy = np.convolve(pad(c[:, 1]), ker, "valid")
        self.h = float(np.median(h))

    def get(self, i: int):
        j = int(np.clip(i - self.A.start, 0, len(self.frames) - 1))
        return self.frames[j], j

    def cam_follow(self, i: int, fill=0.62):
        j = int(np.clip(i - self.A.start, 0, len(self.cx) - 1))
        k = VID_H * fill / max(self.h, 1)
        k = max(k, OW / self.A.W)  # almeno a larghezza piena
        return Cam(self.cx[j], self.cy[j], k)


@dataclass
class Cam:
    cx: float
    cy: float
    k: float

    def lerp(self, o: "Cam", t: float) -> "Cam":
        return Cam(self.cx + (o.cx - self.cx) * t, self.cy + (o.cy - self.cy) * t, self.k * (o.k / self.k) ** t)

    def M(self, src_scale=1.0):
        k = self.k / src_scale
        return np.float32([[k, 0, OW / 2 - self.cx * self.k], [0, k, VID_H / 2 - self.cy * self.k]])

    def map(self, p):
        return ((p[0] - self.cx) * self.k + OW / 2, (p[1] - self.cy) * self.k + VID_H / 2 + VID_Y)


# ---------------------------------------------------------------- composizione

class Composer:
    def __init__(self, A: Analysis, src: Source, title: str):
        self.A, self.src, self.title = A, src, title
        self.frames_out = 0

    def base(self, i: int, cam: Cam, dim=0.0):
        img = np.zeros((OH, OW, 3), np.uint8)
        img[:] = G.BG
        fr, _ = self.src.get(i)
        vid = cv2.warpAffine(fr, cam.M(self.src.scale), (OW, VID_H), flags=cv2.INTER_LINEAR, borderValue=G.BG)
        if dim:
            vid = cv2.addWeighted(vid, 1 - dim, np.zeros_like(vid), dim, 0)
        img[VID_Y:VID_Y + VID_H] = vid
        # sfumature di raccordo
        for y in range(40):
            a = 1 - y / 40
            img[VID_Y + y] = (img[VID_Y + y] * (1 - a) + np.array(G.BG) * a).astype(np.uint8)
            yy = VID_Y + VID_H - 1 - y
            img[yy] = (img[yy] * (1 - a) + np.array(G.BG) * a).astype(np.uint8)
        return img

    def chrome(self, T: G.TextLayer, chapter: str, i: int, speed: str):
        T.rect((60, 92, 66, 182), G.BLUE, radius=2)
        T.text((86, 100), "GASA", 46, G.BLUE, "black")
        T.text((86 + G.font(46, "black").getlength("GASA "), 100), "BIOMECHANICS", 46, G.WHITE, "black")
        T.text((88, 158), chapter, 26, (201, 210, 221), "bold")
        if speed:
            T.text((60, OH - 70), f"F {i}  ·  {i / self.A.fps:.3f} s  ·  {speed}", 24, G.GREY, "semibold")
        T.text((OW - 60, OH - 70), "ANALYZE. UNDERSTAND. PERFORM.", 24, G.WHITE, "bold", anchor="ra")

    def subtitle(self, T: G.TextLayer, text: str | None, alpha=1.0):
        if not text:
            return
        lines = G.wrap(text, 40, OW - 160)[:3]
        y0 = OH - 150 - 56 * len(lines)
        T.rect((60, y0 - 24, OW - 60, OH - 130), G.BG, alpha * 0.82, 20)
        for n, l in enumerate(lines):
            T.text((OW / 2, y0 + n * 56), l, 40, G.WHITE, "bold", anchor="ma", alpha=alpha)


# ---------------------------------------------------------------- overlay anatomici

def draw_skeleton(img, P, cam: Cam, near: str, alpha=1.0, view="sagittale"):
    far = set(B.SIDE["R" if near == "L" else "L"].values()) if view == "sagittale" else set()
    for a, b in B.BONES:
        if min(P[a, 3], P[b, 3]) < 0.3:
            continue
        isfar = a in far or b in far
        G.line(img, cam.map(P[a]), cam.map(P[b]), (255, 255, 255), 2 if isfar else 3, alpha * (0.35 if isfar else 0.8))
    for i in list(range(11, 17)) + list(range(23, 33)):
        if P[i, 3] < 0.3:
            continue
        G.joint(img, cam.map(P[i]), (160, 120, 40) if i in far else G.BLUE, 4 if i in far else 6, glow=False)


def ext(a, b, k):
    return (b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k)


def angle_overlay(img, T, A: Analysis, i: int, cam: Cam, kind: str, leg: str, prog: float, label_side=1):
    """Disegna l'angolo richiesto con animazione (punto → segmenti → arco → valore)."""
    P = A.frame_at(i)
    if P is None:
        return
    M = A.metrics(i, "sagittale")
    s = B.SIDE[leg]
    m_ = lambda idx: cam.map(P[idx])
    shM = cam.map(M["meta"]["sh"]); hipM = cam.map(M["meta"]["hip"])
    F = B.ref_frame(A.ground_rad, A.direction)
    up = F.up
    p1, p2, p3 = G.ease(prog / 0.25), G.ease((prog - 0.2) / 0.35), G.ease((prog - 0.5) / 0.3)
    if kind == "hip":
        v, a, c, metric, name = m_(s["hip"]), ext(shM, m_(s["hip"]), 0.5), m_(s["kn"]), M[f"hip{leg}"], f"ANCA {s['label']}"
        G.dashed(img, v, a, G.WHITE, 2, progress=p2)
    elif kind == "knee":
        v, a, c, metric, name = m_(s["kn"]), ext(m_(s["hip"]), m_(s["kn"]), 0.5), m_(s["an"]), M[f"knee{leg}"], f"GINOCCHIO {s['label']}"
        G.dashed(img, v, a, G.WHITE, 2, progress=p2)
    elif kind == "ankle":
        heel, toe = m_(s["heel"]), m_(s["toe"])
        v, a = m_(s["an"]), m_(s["kn"])
        c = (v[0] + toe[0] - heel[0], v[1] + toe[1] - heel[1])
        metric, name = M[f"ankle{leg}"], f"CAVIGLIA {s['label']}"
        G.glow_line(img, heel, toe, G.CONF[metric.conf], 4, progress=p2)
        G.dashed(img, v, c, G.WHITE, 2, progress=p2)
    elif kind == "tibia":
        v, c = m_(s["an"]), m_(s["kn"])
        L = math.dist(v, c)
        a = (v[0] + up[0] * L * 1.1, v[1] + up[1] * L * 1.1)
        metric, name = M[f"tibia{leg}"], f"TIBIA {s['label']} / VERTICALE"
        G.dashed(img, v, a, G.YELLOW, 3, progress=p2)
    elif kind == "trunk":
        v, c = hipM, shM
        L = math.dist(v, c)
        a = (v[0] + up[0] * L, v[1] + up[1] * L)
        metric, name = M["trunk"], "TRONCO / VERTICALE"
        G.dashed(img, v, a, G.WHITE, 2, progress=p2)
    elif kind == "head":
        ear = m_(s["ear"])
        v, a, c, metric, name = shM, ext(hipM, shM, 0.4), ear, M["head"], "TESTA / TRONCO"
        G.dashed(img, v, a, G.WHITE, 2, progress=p2)
    else:
        return
    col = G.CONF[metric.conf]
    G.joint(img, v, col, 9 * (0.6 + 0.4 * p1), glow=True)
    if p2 > 0:
        G.glow_line(img, v, c, col, 5, progress=p2)
    measurable = metric.conf != B.LOW
    r = max(30, min(90, math.dist(v, c) * 0.45))
    if p3 > 0 and measurable:
        G.arc(img, a, v, c, col, r=r, progress=p3)
    if p3 > 0.6:
        alpha = G.ease((p3 - 0.6) / 0.4)
        a1 = math.atan2(a[1] - v[1], a[0] - v[0]); a2 = math.atan2(c[1] - v[1], c[0] - v[0])
        d = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        bis = a1 + d / 2
        lx = v[0] + math.cos(bis) * (r + 120) * 1.0
        ly = v[1] + math.sin(bis) * (r + 70)
        lx = min(max(lx, 200), OW - 200); ly = min(max(ly, VID_Y + 60), VID_Y + VID_H - 60)
        val = metric.value
        if kind == "ankle":
            txt = f"{abs(val):.0f}°" if measurable else "n.m."
            sub = f"{name} · {'DORSIFL.' if val >= 0 else 'PLANTARFL.'}" if measurable else f"{name} · NON MISURABILE"
        else:
            txt = f"{val:.0f}°" if measurable else "n.m."
            sub = name if measurable else f"{name} · NON MISURABILE"
        G.line(img, v, (lx, ly), col, 2, alpha * 0.8)
        T.pill((lx, ly), txt, 54, col, f"{sub} · conf. {metric.conf}", alpha)
    return metric


def com_overlay(img, T, A, i, cam: Cam, leg: str, prog: float):
    P = A.frame_at(i)
    M = A.metrics(i, "sagittale")
    com, conf = M["com"]["xy"], M["com"]["conf"]
    F = B.ref_frame(A.ground_rad, A.direction)
    fp = M[f"footCom{leg}"]
    foot = fp.extra["foot"]
    h = float((foot - com) @ (-F.up))
    proj = com - F.up * h
    col = G.CONF[conf]
    p1, p2 = G.ease(prog / 0.4), G.ease((prog - 0.4) / 0.4)
    c_ = cam.map(com)
    G.joint(img, c_, col, 10, glow=True)
    G.dashed(img, c_, cam.map(proj), col, 3, dash=10, gap=8, progress=p1)
    if p2 > 0:
        G.joint(img, cam.map(foot), G.YELLOW, 8)
        g = F.g
        fx = proj + g * float((foot - proj) @ g)
        G.line(img, cam.map(proj), cam.map(proj + (fx - proj) * p2), G.CONF[fp.conf], 5)
    if p2 > 0.8:
        a = G.ease((p2 - 0.8) / 0.2)
        if fp.conf != B.LOW:
            txt = f"{'davanti' if fp.value >= 0 else 'dietro'} {abs(fp.value):.0f}% arto"
        else:
            txt = "distanza non misurabile"
        mp = cam.map(proj)
        T.pill((min(max(mp[0], 260), OW - 260), min(mp[1] + 90, VID_Y + VID_H - 60)), txt, 44, G.CONF[fp.conf], f"PIEDE {B.SIDE[leg]['label']} vs CoM stimato · conf. {fp.conf}", a)
    T.text((c_[0] + 22, c_[1] - 44), "CoM stimato", 26, col, "bold")


# ---------------------------------------------------------------- narrazione e storyboard

def fmtv(m: B.Metric, unit="°"):
    return f"{m.value:.0f}{unit}" if m.conf != B.LOW else "non misurabile"


def build_story(A: Analysis, K: Keys, cfg: dict) -> list:
    """Restituisce le scene con durata, testo narrato e parametri. Il testo descrive SOLO ciò che è misurato."""
    seq = extension_sequence(A, K)
    scenes = []
    leg = K.ext_leg or A.near
    legname = "sinistro" if leg == "L" else "destro"
    s0 = A.start
    s1 = A.start + len(A.px) - 1
    Mx = A.metrics(K.ext_frame)

    scenes.append(dict(kind="hook", dur=2.5, frame=K.ext_frame, chapter="01 · HOOK",
                       title=cfg.get("hook", "TRIPLA ESTENSIONE: C'È DAVVERO?"),
                       say="Tripla estensione: c'è davvero? Analizziamo i primi passi."))
    # primo movimento
    ns_txt = ""
    if K.start is not None:
        ns = B.negative_step(A.px, K.start - A.start, cfg.get("negative_step_foot", leg), A.ground_rad, A.direction)
        ns_txt = {"presente": " Il piede arretra prima della spinta: negative step presente, non per forza un errore.",
                  "assente": " Nessun arretramento del piede prima della spinta.",
                  }.get(ns["status"], " Il primo movimento del piede non è valutabile da questa ripresa.")
    end_play = K.td1 or min(s1, s0 + int(A.fps * 1.0))
    scenes.append(dict(kind="play", dur=None, a=K.start or s0, b=end_play, slow=1.0, chapter="02 · PRIMO MOVIMENTO",
                       say="Partenza a velocità reale." + ns_txt))
    scenes.append(dict(kind="play", dur=None, a=max(s0, (K.ext_frame or s0) - int(A.fps * 0.35)), b=K.ext_frame, slow=4.0,
                       chapter="02 · PRIMO MOVIMENTO", say="Rallentiamo verso il distacco."))
    # tripla estensione
    parts = []
    for kind, nome in (("hip", "anca"), ("knee", "ginocchio"), ("ankle", "caviglia")):
        m = Mx[f"{kind}{leg}"]
        if kind == "hip":
            line = (f"Anca: {abs(m.value):.0f} gradi di {'estensione' if m.value < 0 else 'flessione'} rispetto al tronco."
                    if m.conf != B.LOW else "Anca: centro articolare poco visibile, nessun valore affidabile.")
        elif kind == "knee":
            line = (f"Ginocchio: ancora flesso di {m.value:.0f} gradi, estensione incompleta."
                    if m.conf != B.LOW and m.value > 8 else
                    f"Ginocchio: quasi esteso, {m.value:.0f} gradi di flessione." if m.conf != B.LOW else
                    "Ginocchio: misura non affidabile qui.")
        else:
            line = (f"Caviglia: {abs(m.value):.0f} gradi di {'plantarflessione' if m.value < 0 else 'dorsiflessione'}. Il piede è una stima: confidenza {m.conf}."
                    if m.conf != B.LOW else "Caviglia: piede non ricostruibile, solo lettura qualitativa.")
        parts.append(dict(kind=kind, say=line))
    seq_say = f"Massime estensioni: sequenza {seq['sequenza']}."
    scenes.append(dict(kind="joints", frame=K.ext_frame, leg=leg, parts=parts, dur=None, chapter="03 · TRIPLA ESTENSIONE",
                       say_intro="Fermo immagine al distacco.", say_outro=seq_say, seq=seq))
    # tibia e primo appoggio
    if K.td1 is not None:
        M1 = A.metrics(K.td1)
        tl = M1[f"tibia{K.td1_foot}"]
        other = "R" if K.td1_foot == "L" else "L"
        to_ = M1[f"tibia{other}"]
        fc = M1[f"footCom{K.td1_foot}"]
        say = (f"Primo appoggio: in giallo la verticale, in azzurro la tibia, a {fmtv(tl)}"
               f"{', ginocchio davanti alla caviglia' if tl.conf != B.LOW and tl.value > 0 else ''}. "
               f"La tibia che avanza: {fmtv(to_)}.")
        com_say = ("Piede " + ("davanti" if fc.value >= 0 else "dietro") + f" alla proiezione stimata del centro di massa: {abs(fc.value):.0f} per cento dell'arto. Una stima, non una forza."
                   if fc.conf != B.LOW else "Piede e centro di massa: stima poco affidabile, nessun numero.")
        scenes.append(dict(kind="tibia", frame=K.td1, leg=K.td1_foot, other=other, dur=None, chapter="04 · TIBIA E PRIMO APPOGGIO", say=say))
        scenes.append(dict(kind="com", frame=K.td1, leg=K.td1_foot, dur=None, chapter="04 · PIEDE E CENTRO DI MASSA", say=com_say))
        tr, hd = M1["trunk"], M1["head"]
        scenes.append(dict(kind="trunk", frame=K.td1, leg=A.near, dur=None, chapter="05 · TRONCO E TESTA",
                           say=f"Tronco a {fmtv(tr)} dalla verticale. "
                               f"Testa {'in linea con il tronco' if hd.conf != B.LOW and abs(hd.value) < 15 else (('flessa' if hd.value > 0 else 'estesa') + ' rispetto al tronco') if hd.conf != B.LOW else 'non misurabile'}."))
    # secondo passo
    if K.td1 is not None and K.td2 is not None:
        M1, M2 = A.metrics(K.td1), A.metrics(K.td2)
        d = M2["trunk"].value - M1["trunk"].value
        st = B.step_times(A.events, A.fps)
        scenes.append(dict(kind="compare", a=K.td1, b=K.td2, fa=K.td1_foot, fb=K.td2_foot, dur=None, chapter="06 · PRIMO vs SECONDO PASSO", times=st,
                           say=f"Secondo passo, sincronizzato sul touchdown: tronco da {fmtv(M1['trunk'])} a {fmtv(M2['trunk'])}"
                               f"{', si raddrizza' if d < -2 and M1['trunk'].conf != B.LOW else ''}."
                               + (f" A {A.fps:.0f} fps i tempi hanno ±{1000 / A.fps:.0f} millisecondi." if st["contacts"] else "")))
    # conclusioni
    concl = cfg.get("conclusioni") or auto_conclusions(A, K, seq)
    scenes.append(dict(kind="conclusion", dur=8.0, items=concl, chapter="07 · CONCLUSIONI",
                       say="Tre osservazioni: cosa vediamo, cosa valutare, cosa serve misurare meglio."))
    scenes.append(dict(kind="end", dur=2.5, chapter="", say="GASA Biomechanics."))
    return scenes


def auto_conclusions(A: Analysis, K: Keys, seq: dict) -> list:
    out = []
    if K.td1 is not None and K.td2 is not None:
        t1, t2 = A.metrics(K.td1)["trunk"], A.metrics(K.td2)["trunk"]
        if B.LOW not in (t1.conf, t2.conf):
            trend = "si raddrizza" if t2.value < t1.value - 2 else "resta simile" if abs(t2.value - t1.value) <= 2 else "aumenta l'inclinazione"
            out.append(dict(tag="osservato", text=f"il tronco {trend} dal primo ({t1.value:.0f}°) al secondo appoggio ({t2.value:.0f}°)."))
    if not out and seq.get("sequenza") and "non determinabile" not in seq["sequenza"]:
        out.append(dict(tag="osservato", text=f"sequenza delle estensioni {seq['sequenza']}."))
    if not out:
        out.append(dict(tag="osservato", text="tracking stabile dei segmenti principali nei primi passi."))
    improv = None
    if K.td1 is not None:
        fc = A.metrics(K.td1)[f"footCom{K.td1_foot}"]
        if fc.conf != B.LOW and fc.value > 15:
            improv = dict(tag="da valutare", text=f"primo appoggio nettamente davanti alla proiezione stimata del CoM ({fc.value:.0f}% arto): verificare con riprese a più alto frame rate prima di correggere.")
    out.append(improv or dict(tag="da valutare", text="nessuna correzione è giustificata con certezza dai soli dati video 2D."))
    out.append(dict(tag="servono altre misure", text=f"tempi di contatto e forze: a {A.fps:.0f} fps l'errore è ±{1000 / A.fps:.0f} ms per evento; servono 120-240 fps o pedane di forza."))
    return out


# ---------------------------------------------------------------- rendering

def render_reel(A: Analysis, out_dir: Path, cfg: dict | None = None, log=print) -> dict:
    cfg = cfg or {}
    out_dir.mkdir(parents=True, exist_ok=True)
    K = keyframes(A)
    scenes = build_story(A, K, cfg)
    src = Source(A)
    C = Composer(A, src, cfg.get("title", "SPRINT PERFORMANCE ANALYSIS"))
    eng = tts.engine() if cfg.get("voice", True) else None
    audio_dir = out_dir / "voice"; audio_dir.mkdir(exist_ok=True)

    # 1) narrazione: durata minima di ogni battuta (TTS reale se disponibile, altrimenti stima 14 car/s)
    def say_len(text, key):
        if not text:
            return 0.0, None
        if eng:
            wav = audio_dir / f"{key}.wav"
            if tts.synth(text, wav, eng):
                return tts.duration(wav) + 0.35, wav
        return max(1.5, len(text) / 16.5) + 0.25, None  # stima ritmo parlato italiano

    timeline, cues, voice = [], [], []
    t = 0.0
    for n, sc in enumerate(scenes):
        if sc["kind"] == "joints":
            segs = [("intro", sc["say_intro"])] + [(p["kind"], p["say"]) for p in sc["parts"]] + [("outro", sc["say_outro"])]
            sub = []
            for key, text in segs:
                d, wav = say_len(text, f"s{n}_{key}")
                sub.append(dict(key=key, t0=t, dur=max(d, 2.4 if key in ("hip", "knee", "ankle") else 1.5), text=text))
                if wav:
                    voice.append((t, wav))
                cues.append((t, t + sub[-1]["dur"], text))
                t += sub[-1]["dur"]
            sc["sub"] = sub
            sc["t0"] = sub[0]["t0"]; sc["dur"] = t - sc["t0"]
            continue
        d, wav = say_len(sc.get("say"), f"s{n}")
        if sc["kind"] == "play":
            nat = (sc["b"] - sc["a"] + 1) / A.fps * sc["slow"]
            d = max(d, nat)
        dur = max(sc.get("dur") or 0, d)
        sc["t0"], sc["dur"] = t, dur
        if wav:
            voice.append((t, wav))
        if sc.get("say"):
            cues.append((t, t + dur, sc["say"]))
        t += dur
    total = t
    log(f"  durata Reel: {total:.1f} s, {len(scenes)} scene, voce: {eng or 'non disponibile (video senza narrazione)'}")

    # 2) video
    silent = out_dir / "_video.mp4"
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{OW}x{OH}", "-r", str(FPS),
                           "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", str(silent)],
                          stdin=subprocess.PIPE)
    nframes = int(math.ceil(total * FPS))
    storyboard = []
    for sc in scenes:
        storyboard.append(dict(scena=sc["chapter"] or "END", tipo=sc["kind"], inizio_s=round(sc["t0"], 2), durata_s=round(sc["dur"], 2),
                               fotogramma=sc.get("frame"), intervallo=[sc.get("a"), sc.get("b")] if sc["kind"] in ("play", "compare") else None))
    for fo in range(nframes):
        tt = fo / FPS
        sc = next((s for s in scenes if s["t0"] <= tt < s["t0"] + s["dur"]), scenes[-1])
        img = render_scene(C, A, K, sc, tt - sc["t0"], tt, cues)
        ff.stdin.write(img.tobytes())
        if fo % 150 == 0:
            log(f"  render {fo}/{nframes}")
    ff.stdin.close(); ff.wait()
    if ff.returncode:
        raise RuntimeError("ffmpeg: encoding video fallito")

    # 3) audio (voce reale o traccia silenziosa) + mux
    final = out_dir / "GASA_reel_1080x1920.mp4"
    if voice:
        inputs, filt = [], []
        for n, (t0, wav) in enumerate(voice):
            inputs += ["-i", str(wav)]
            filt.append(f"[{n + 1}:a]adelay={int(t0 * 1000)}|{int(t0 * 1000)},aformat=channel_layouts=stereo[a{n}]")
        mix = "".join(f"[a{n}]" for n in range(len(voice))) + f"amix=inputs={len(voice)}:normalize=0,apad[aout]"
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(silent)] + inputs + ["-filter_complex", ";".join(filt) + ";" + mix,
               "-map", "0:v", "-map", "[aout]", "-shortest"]
    else:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v", "-map", "1:a", "-shortest"]
    subprocess.run(cmd + ["-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(final)], check=True)
    light = out_dir / "GASA_reel_720x1280_iphone.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(final), "-vf", "scale=720:1280:flags=lanczos", "-c:v", "libx264", "-profile:v", "high",
                    "-preset", "slow", "-crf", "24", "-maxrate", "3M", "-bufsize", "6M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart", str(light)], check=True)
    silent.unlink(missing_ok=True)

    # 4) sottotitoli, script, storyboard
    srt = []
    for n, (a, b, text) in enumerate(cues, 1):
        ts = lambda x: f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int((x % 1) * 1000):03d}"
        srt.append(f"{n}\n{ts(a)} --> {ts(b)}\n{text}\n")
    (out_dir / "sottotitoli.srt").write_text("\n".join(srt))
    script = ["# Script narrativo — GASA Biomechanics", "",
              f"Voce: {'sintetizzata con ' + eng if voice else 'NON presente nel video (nessun motore TTS disponibile): testo da registrare o sintetizzare'}", "",
              "| Inizio | Fine | Scena | Testo narrato | Animazione |", "|---|---|---|---|---|"]
    anim = {"hook": "freeze sul distacco, zoom lento, titolo", "play": "riproduzione (rallentata se indicato) con camera che segue l'atleta",
            "joints": "rallenty → freeze → zoom sull'articolazione → punto luminoso → segmenti → arco → valore", "tibia": "verticale tratteggiata + tibia + arco",
            "com": "CoM stimato, proiezione verticale, distanza dal piede", "trunk": "verticale + segmento bacino-spalle + testa",
            "compare": "split screen sincronizzato sui touchdown + tabella", "conclusion": "tre schede: osservato / da valutare / servono misure", "end": "logo e claim"}
    for sc in scenes:
        txt = " ".join(p["text"] for p in sc["sub"]) if sc["kind"] == "joints" else sc.get("say", "")
        script.append(f"| {sc['t0']:.2f} | {sc['t0'] + sc['dur']:.2f} | {sc['chapter'] or 'END'} | {txt} | {anim[sc['kind']]} |")
    (out_dir / "script.md").write_text("\n".join(script) + "\n")
    (out_dir / "storyboard.json").write_text(json.dumps(dict(durata_s=round(total, 2), keyframes=K.__dict__, scene=storyboard,
                                                             sequenza_estensione=extension_sequence(A, K)), indent=2, ensure_ascii=False, default=str))
    return dict(final=str(final), light=str(light), duration=total, voice=bool(voice))


def render_scene(C: Composer, A: Analysis, K: Keys, sc: dict, lt: float, tt: float, cues) -> np.ndarray:
    img = _render_scene(C, A, K, sc, lt, tt, cues)
    return img


def _clip(img):
    """Le grafiche anatomiche non devono invadere header e area testi."""
    img[:VID_Y] = G.BG
    img[VID_Y + VID_H:] = G.BG
    return img


def _render_scene(C: Composer, A: Analysis, K: Keys, sc: dict, lt: float, tt: float, cues) -> np.ndarray:
    T = G.TextLayer()
    kind = sc["kind"]
    cur_i = None
    sub_text = next((c[2] for c in cues if c[0] <= tt < c[1]), None)
    speed = "VELOCITÀ REALE"
    if kind == "hook":
        i = sc["frame"]
        cam = C.src.cam_follow(i, 0.55).lerp(C.src.cam_follow(i, 0.75), G.ease(lt / sc["dur"]))
        img = C.base(i, cam, dim=0.25)
        P = A.frame_at(i)
        if P is not None:
            draw_skeleton(img, P, cam, A.near, G.ease(lt / 0.8), A.view)
            for j in (B.SIDE[K.ext_leg or A.near][n] for n in ("hip", "kn", "an")):
                G.joint(img, cam.map(P[j]), G.BLUE, 11, glow=True)
        a = G.ease(lt / 0.6)
        for n, l in enumerate(G.wrap(sc["title"], 84, OW - 140, "black")):
            T.text((70, VID_Y + 80 + n * 96), l, 84, G.WHITE if n else G.BLUE, "black", alpha=a)
        speed = "FERMO IMMAGINE"
    elif kind == "play":
        span = sc["b"] - sc["a"]
        i = sc["a"] + min(span, int(lt / sc["slow"] * A.fps))
        cur_i = i
        cam = C.src.cam_follow(i)
        img = C.base(i, cam)
        P = A.frame_at(i)
        if P is not None:
            draw_skeleton(img, P, cam, A.near, 0.9, A.view)
        ev = next((e for e in A.events if e["frame"] == i), None)
        if ev:
            lab = {"TD": "TOUCHDOWN", "TO": "TOE-OFF", "START": "INIZIO"}[ev["type"]] + (f" {B.SIDE[ev['foot']]['label']}" if ev.get("foot") else "")
            T.pill((OW / 2, VID_Y + 60), lab, 40, G.YELLOW if ev["type"] == "TO" else G.BLUE)
        speed = "VELOCITÀ REALE" if sc["slow"] == 1 else f"RALLENTATO {sc['slow']:.0f}×"
    elif kind == "joints":
        i = sc["frame"]
        leg = sc["leg"]
        P = A.frame_at(i)
        cur = next((s for s in sc["sub"] if s["t0"] <= tt < s["t0"] + s["dur"]), sc["sub"][-1])
        wide = C.src.cam_follow(i, 0.62)
        target = {"hip": B.SIDE[leg]["hip"], "knee": B.SIDE[leg]["kn"], "ankle": B.SIDE[leg]["an"]}.get(cur["key"])
        if target is not None and P is not None:
            zc = Cam(P[target, 0], P[target, 1], wide.k * 1.9)
            lt2 = tt - cur["t0"]
            zin = G.ease(lt2 / 0.7)
            zout = G.ease((lt2 - (cur["dur"] - 0.5)) / 0.5) if cur["key"] == "ankle" else 0
            cam = wide.lerp(zc, zin * (1 - zout))
            img = C.base(i, cam, dim=0.15)
            draw_skeleton(img, P, cam, A.near, 0.45, "sagittale")
            angle_overlay(img, T, A, i, cam, cur["key"], leg, min(1.0, lt2 / 1.6))
            name = {"hip": "ANCA", "knee": "GINOCCHIO", "ankle": "CAVIGLIA"}[cur["key"]]
            T.text((70, VID_Y + 40), name, 64, G.BLUE, "black", alpha=G.ease(lt2 / 0.4))
        else:
            img = C.base(i, wide, dim=0.15)
            if P is not None:
                draw_skeleton(img, P, wide, A.near, 0.8, "sagittale")
                if cur["key"] == "outro":
                    for kk in ("hip", "knee", "ankle"):
                        angle_overlay(img, T, A, i, wide, kk, leg, 1.0)
                    seq = sc["seq"]
                    y = CAPTION_Y + 10
                    T.text((70, y), "SEQUENZA DELLE MASSIME ESTENSIONI", 26, G.GREY, "bold")
                    for n, nm in enumerate(("anca", "ginocchio", "caviglia")):
                        if nm in seq:
                            r = seq[nm]
                            T.text((70 + n * 320, y + 44), f"{nm.upper()}  F {r['frame']}", 34, G.CONF[r["conf"]], "xbold")
        speed = "FERMO IMMAGINE"
    elif kind in ("tibia", "com", "trunk"):
        i = sc["frame"]
        P = A.frame_at(i)
        wide = C.src.cam_follow(i, 0.62)
        if kind == "tibia" and P is not None:
            s = B.SIDE[sc["leg"]]
            zc = Cam((P[s["kn"], 0] + P[s["an"], 0]) / 2, (P[s["kn"], 1] + P[s["an"], 1]) / 2, wide.k * 1.5)
            cam = wide.lerp(zc, G.ease(lt / 0.8))
        else:
            cam = wide
        img = C.base(i, cam, dim=0.15)
        if P is not None:
            draw_skeleton(img, P, cam, A.near, 0.5, "sagittale")
            if kind == "tibia":
                angle_overlay(img, T, A, i, cam, "tibia", sc["leg"], min(1, lt / 1.8))
                if lt > 2.2:
                    angle_overlay(img, T, A, i, cam, "tibia", sc["other"], min(1, (lt - 2.2) / 1.8))
                T.text((70, VID_Y + 40), "TIBIA · PRIMO APPOGGIO", 52, G.BLUE, "black")
            elif kind == "com":
                com_overlay(img, T, A, i, cam, sc["leg"], min(1, lt / 2.4))
                T.text((70, VID_Y + 40), "PIEDE vs CENTRO DI MASSA", 52, G.BLUE, "black")
            else:
                angle_overlay(img, T, A, i, cam, "trunk", sc["leg"], min(1, lt / 1.8))
                if lt > 2.0:
                    angle_overlay(img, T, A, i, cam, "head", sc["leg"], min(1, (lt - 2.0) / 1.6))
                T.text((70, VID_Y + 40), "TRONCO E TESTA", 52, G.BLUE, "black")
        ev = next((e for e in A.events if e["frame"] == i), None)
        if ev:
            T.pill((70, VID_Y + 130), "TOUCHDOWN " + B.SIDE[ev["foot"]]["label"], 30, G.BLUE, anchor="lm")
        speed = "FERMO IMMAGINE"
    elif kind == "compare":
        img = np.zeros((OH, OW, 3), np.uint8); img[:] = G.BG
        prog = min(1, lt / 1.5)
        for n, (i, foot) in enumerate(((sc["a"], sc["fa"]), (sc["b"], sc["fb"]))):
            P = A.frame_at(i)
            cam0 = C.src.cam_follow(i, 0.7)
            cam = Cam(cam0.cx, cam0.cy, cam0.k * 0.62)
            fr, _ = C.src.get(i)
            half = cv2.warpAffine(fr, np.float32([[cam.k / C.src.scale, 0, OW / 4 - cam.cx * cam.k], [0, cam.k / C.src.scale, 420 - cam.cy * cam.k]]),
                                  (OW // 2, 840), borderValue=G.BG)
            sub = np.zeros((OH, OW, 3), np.uint8)
            x0 = n * OW // 2
            img[VID_Y:VID_Y + 840, x0:x0 + OW // 2] = half
            if P is not None:
                mp_ = lambda p: ((p[0] - cam.cx) * cam.k + OW / 4 + x0, (p[1] - cam.cy) * cam.k + 420 + VID_Y)
                s = B.SIDE[foot]
                for a, b in B.BONES:
                    if min(P[a, 3], P[b, 3]) > 0.3:
                        G.line(img, mp_(P[a]), mp_(P[b]), G.WHITE, 2, 0.6)
                M = A.metrics(i)
                G.glow_line(img, mp_(P[s["an"]]), mp_(P[s["kn"]]), G.CONF[M[f"tibia{foot}"].conf], 4, progress=prog)
                hm = B.mid(P[23, :2], P[24, :2]); sm = B.mid(P[11, :2], P[12, :2])
                G.glow_line(img, mp_(hm), mp_(sm), G.CONF[M["trunk"].conf], 4, progress=prog)
            T.text((x0 + 30, VID_Y + 20), ("FIRST STEP" if n == 0 else "SECOND STEP"), 38, G.BLUE, "black")
            T.text((x0 + 30, VID_Y + 66), f"TOUCHDOWN {B.SIDE[foot]['label']} · F {i}", 24, G.GREY, "bold")
        cv2.line(img, (OW // 2, VID_Y), (OW // 2, VID_Y + 840), G.BLUE, 2, cv2.LINE_AA)
        Ma, Mb = A.metrics(sc["a"]), A.metrics(sc["b"])
        rows = [("Tronco vs verticale", Ma["trunk"], Mb["trunk"]),
                ("Tibia d'appoggio", Ma[f"tibia{sc['fa']}"], Mb[f"tibia{sc['fb']}"]),
                ("Ginocchio d'appoggio", Ma[f"knee{sc['fa']}"], Mb[f"knee{sc['fb']}"]),
                ("Piede vs CoM (% arto)", Ma[f"footCom{sc['fa']}"], Mb[f"footCom{sc['fb']}"])]
        st = sc["times"]
        y = VID_Y + 880
        T.text((70, y), "MISURA", 24, G.GREY, "bold"); T.text((640, y), "1°", 24, G.GREY, "bold", anchor="ra"); T.text((880, y), "2°", 24, G.GREY, "bold", anchor="ra")
        for n, (lab, a, b) in enumerate(rows):
            al = G.ease((lt - 0.5 - n * 0.35) / 0.4)
            yy = y + 50 + n * 64
            T.text((70, yy), lab, 34, G.WHITE, "bold", alpha=al)
            T.text((640, yy), a.fmt(), 40, G.CONF[a.conf], "xbold", anchor="ra", alpha=al)
            T.text((880, yy), b.fmt(), 40, G.CONF[b.conf], "xbold", anchor="ra", alpha=al)
        yy = y + 50 + len(rows) * 64
        if st["contacts"]:
            c = st["contacts"]
            T.text((70, yy), f"Contatto (±{st['resolution_ms']:.0f} ms)", 34, G.WHITE, "bold")
            for n, cc in enumerate(c[:2]):
                T.text((640 + n * 240, yy), f"{cc['ms']:.0f} ms" if st["conf"] != B.LOW else f"~{cc['ms']:.0f} ms", 40, G.CONF[st["conf"]], "xbold", anchor="ra")
        speed = "SINCRONIZZATO SUL TOUCHDOWN"
    elif kind == "conclusion":
        img = np.zeros((OH, OW, 3), np.uint8); img[:] = G.BG
        cols = {"osservato": G.BLUE, "da valutare": G.YELLOW, "servono altre misure": G.WHITE}
        T.text((70, VID_Y + 30), "TRE OSSERVAZIONI", 64, G.WHITE, "black")
        for n, it in enumerate(sc["items"][:3]):
            al = G.ease((lt - 0.4 - n * 0.6) / 0.5)
            y = VID_Y + 160 + n * 330
            col = cols.get(it["tag"], G.BLUE)
            T.rect((60, y, OW - 60, y + 290), (49, 33, 21), al * 0.95, 26)
            T.rect((60, y, 72, y + 290), col, al, 4)
            T.text((100, y + 30), it["tag"].upper(), 30, col, "xbold", alpha=al)
            for m, l in enumerate(G.wrap(it["text"], 40, OW - 220)[:4]):
                T.text((100, y + 90 + m * 50), l, 40, G.WHITE, "bold", alpha=al)
        sub_text = None
        speed = ""
    else:  # end
        img = np.zeros((OH, OW, 3), np.uint8); img[:] = G.BG
        a = G.ease(lt / 0.8)
        T.text((OW / 2, OH / 2 - 120), "GASA", 150, G.BLUE, "black", anchor="mm", alpha=a)
        T.text((OW / 2, OH / 2 + 10), "BIOMECHANICS", 74, G.WHITE, "black", anchor="mm", alpha=a)
        T.text((OW / 2, OH / 2 + 130), "ANALYZE. UNDERSTAND. PERFORM.", 40, (201, 210, 221), "bold", anchor="mm", alpha=G.ease((lt - 0.5) / 0.8))
        return T.render(img)
    if kind not in ("compare", "conclusion"):
        _clip(img)
    i_show = cur_i if cur_i is not None else (sc.get("frame") or sc.get("a") or A.start)
    C.chrome(T, sc["chapter"], i_show, speed)
    C.subtitle(T, sub_text)
    return T.render(img)
