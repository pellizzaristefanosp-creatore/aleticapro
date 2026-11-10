"""Cinematica 2D da landmark MediaPipe — port fedele di js/biomech.js (tenere allineate le definizioni).

Ogni frame è un array (33, 4): x, y in pixel, z in pixel (scala larghezza), visibilità 0..1.
Tutte le misure sono proiezioni sul piano immagine.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

SIDE = {
    "L": dict(sh=11, el=13, wr=15, idx=19, hip=23, kn=25, an=27, heel=29, toe=31, ear=7, label="SX"),
    "R": dict(sh=12, el=14, wr=16, idx=20, hip=24, kn=26, an=28, heel=30, toe=32, ear=8, label="DX"),
}
BONES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24), (23, 25), (25, 27),
         (27, 29), (29, 31), (27, 31), (24, 26), (26, 28), (28, 30), (30, 32), (28, 32), (7, 11), (8, 12)]

# de Leva (1996): frazione di massa, posizione CoM dal prossimale
DE_LEVA = {
    "M": dict(head=0.0694, trunk=(0.4346, 0.4486), upperArm=(0.0271, 0.5772), forearm=(0.0162, 0.4574),
              hand=(0.0061, 0.79), thigh=(0.1416, 0.4095), shank=(0.0433, 0.4459), foot=(0.0137, 0.4415)),
    "F": dict(head=0.0668, trunk=(0.4257, 0.4964), upperArm=(0.0255, 0.5754), forearm=(0.0138, 0.4559),
              hand=(0.0056, 0.7474), thigh=(0.1478, 0.3612), shank=(0.0481, 0.4416), foot=(0.0129, 0.4014)),
}

HIGH, MED, LOW = "alta", "media", "bassa"
RANK = {LOW: 0, MED: 1, HIGH: 2}
BY_RANK = [LOW, MED, HIGH]


def edge_vis(P, W, H):
    """Landmark sul bordo/fuori inquadratura (es. testa tagliata): visibilità limitata a 0,5 (come js toPx)."""
    out = P.copy()
    edge = (P[:, 0] < 0.015 * W) | (P[:, 0] > 0.985 * W) | (P[:, 1] < 0.015 * H) | (P[:, 1] > 0.985 * H)
    out[edge, 3] = np.minimum(out[edge, 3], 0.5)
    return out


def conf_from_vis(*vs: float) -> str:
    m = min(vs)
    return HIGH if m >= 0.8 else MED if m >= 0.55 else LOW


def cap(c: str, mx: str) -> str:
    return BY_RANK[min(RANK[c], RANK[mx])]


def down(c: str) -> str:
    return BY_RANK[max(0, RANK[c] - 1)]


def p2(P, i):
    return P[i, :2]


def mid(a, b):
    return (a + b) / 2


def angle3(a, b, c) -> float:
    u, w = a - b, c - b
    d = np.linalg.norm(u) * np.linalg.norm(w)
    if d == 0:
        return float("nan")
    return math.degrees(math.acos(max(-1.0, min(1.0, float(u @ w) / d))))


@dataclass
class Frame:
    g: np.ndarray
    up: np.ndarray
    f: np.ndarray
    dir: int


def ref_frame(ground_rad: float = 0.0, direction: int = 1) -> Frame:
    g = np.array([math.cos(ground_rad), math.sin(ground_rad)])
    up = np.array([math.sin(ground_rad), -math.cos(ground_rad)])
    return Frame(g, up, g * direction, direction)


def from_vertical(v, F: Frame) -> float:
    return math.degrees(math.atan2(float(v @ F.f), float(v @ F.up)))


def from_down(v, F: Frame) -> float:
    return math.degrees(math.atan2(float(v @ F.f), -float(v @ F.up)))


@dataclass
class Metric:
    value: float
    conf: str
    unit: str = "°"
    label: str = ""
    hint: str = ""
    extra: dict = field(default_factory=dict)

    def fmt(self, show_low: bool = False, digits: int = 0) -> str:
        if self.value is None or (isinstance(self.value, float) and math.isnan(self.value)):
            return "—"
        if self.conf == LOW and not show_low:
            return "n.m."
        v = f"{abs(self.value):.{digits}f}"
        sign = "−" if self.value < 0 and self.unit == "°" else ""
        return f"{'~' if self.conf == LOW else ''}{sign}{v}{'°' if self.unit == '°' else ' ' + self.unit}"


def detect_view(P) -> dict:
    shW = abs(P[11, 0] - P[12, 0]); hipW = abs(P[23, 0] - P[24, 0])
    torso = np.linalg.norm(mid(p2(P, 11), p2(P, 12)) - mid(p2(P, 23), p2(P, 24))) or 1
    r = (shW + hipW) / 2 / torso
    earW = abs(P[7, 0] - P[8, 0])
    face = abs(P[0, 0] - (P[7, 0] + P[8, 0]) / 2) / max(earW, torso * 0.04)
    clamp = lambda v: max(0.0, min(1.0, v))
    sW = clamp((0.45 - r) / 0.25)
    face_ok = min(P[0, 3], P[7, 3], P[8, 3]) > 0.5
    sF = clamp((face - 0.3) / 0.7)
    score = 0.6 * sW + 0.4 * sF if face_ok else sW
    view = "sagittale" if score > 0.6 else "frontale" if score < 0.35 else "obliqua"
    return dict(view=view, ratio=float(r), face=float(face), score=float(score))


def near_side(P) -> str:
    zl = (P[23, 2] + P[25, 2] + P[27, 2] + P[11, 2]) / 4
    zr = (P[24, 2] + P[26, 2] + P[28, 2] + P[12, 2]) / 4
    vl = P[23, 3] + P[25, 3] + P[27, 3]; vr = P[24, 3] + P[26, 3] + P[28, 3]
    return "L" if zl + (vr - vl) * 20 < zr else "R"


def dir_from_face(P) -> int:
    return 1 if P[0, 0] >= (P[7, 0] + P[8, 0]) / 2 else -1


def center_of_mass(P, sex="M"):
    T = DE_LEVA.get(sex, DE_LEVA["M"])
    lerp = lambda a, b, t: a + (b - a) * t
    shM, hipM = mid(p2(P, 11), p2(P, 12)), mid(p2(P, 23), p2(P, 24))
    parts = [(mid(p2(P, 7), p2(P, 8)), T["head"], [7, 8]), (lerp(shM, hipM, T["trunk"][1]), T["trunk"][0], [11, 12, 23, 24])]
    for s in SIDE.values():
        parts += [
            (lerp(p2(P, s["sh"]), p2(P, s["el"]), T["upperArm"][1]), T["upperArm"][0], [s["sh"], s["el"]]),
            (lerp(p2(P, s["el"]), p2(P, s["wr"]), T["forearm"][1]), T["forearm"][0], [s["el"], s["wr"]]),
            (lerp(p2(P, s["wr"]), p2(P, s["idx"]), 0.5), T["hand"][0], [s["wr"]]),
            (lerp(p2(P, s["hip"]), p2(P, s["kn"]), T["thigh"][1]), T["thigh"][0], [s["hip"], s["kn"]]),
            (lerp(p2(P, s["kn"]), p2(P, s["an"]), T["shank"][1]), T["shank"][0], [s["kn"], s["an"]]),
            (lerp(p2(P, s["heel"]), p2(P, s["toe"]), T["foot"][1]), T["foot"][0], [s["heel"], s["toe"]]),
        ]
    m = sum(w for _, w, _ in parts)
    c = sum(p * w for p, w, _ in parts) / m
    used = {i for _, _, ids in parts for i in ids}
    return c, cap(conf_from_vis(*[P[i, 3] for i in used]), MED)


def foot_point(P, s, F: Frame):
    h, t = p2(P, s["heel"]), p2(P, s["toe"])
    hh, ht = -float(h @ F.up), -float(t @ F.up)
    if abs(hh - ht) < 4:
        return mid(h, t)
    return h if hh > ht else t


def leg_length(P, s) -> float:
    return float(np.linalg.norm(p2(P, s["hip"]) - p2(P, s["kn"])) + np.linalg.norm(p2(P, s["kn"]) - p2(P, s["an"])))


def sagittal(P, ground_rad=0.0, direction=1, near=None, sex="M", px_per_m=None) -> dict:
    F = ref_frame(ground_rad, direction)
    near = near or near_side(P)
    out: dict = {}
    shM, hipM = mid(p2(P, 11), p2(P, 12)), mid(p2(P, 23), p2(P, 24))
    tc = conf_from_vis(P[11, 3], P[12, 3], P[23, 3], P[24, 3])
    sn = SIDE[near]
    nc = conf_from_vis(P[sn["sh"], 3], P[sn["hip"], 3])
    if tc == LOW and nc != LOW:  # spalla/anca lontana inaffidabile → lato vicino
        shM, hipM, tc = p2(P, sn["sh"]), p2(P, sn["hip"]), cap(nc, MED)
    trunk = from_vertical(shM - hipM, F)
    out["trunk"] = Metric(trunk, tc, label="Tronco vs verticale", hint="+ = inclinato in avanti")
    out["trunkH"] = Metric(90 - abs(trunk), tc, label="Tronco vs orizzontale")
    ear = SIDE[near]["ear"]
    out["head"] = Metric(from_vertical(p2(P, ear) - shM, F) - trunk, cap(conf_from_vis(P[ear, 3]), tc),
                         label="Testa rispetto al tronco", hint="+ = testa avanti/flessa")
    for k, s in SIDE.items():
        far_clear = min(P[s["hip"], 3], P[s["kn"], 3], P[s["an"], 3]) >= 0.95
        adj = (lambda c: c) if (k == near or far_clear) else down
        hip, kn, an, heel, toe = (p2(P, s[n]) for n in ("hip", "kn", "an", "heel", "toe"))
        thigh = from_down(kn - hip, F)
        out[f"hip{k}"] = Metric(thigh + trunk, adj(cap(conf_from_vis(P[s["hip"], 3], P[s["kn"], 3]), tc)),
                                label=f"Anca {s['label']}", hint="+ flessione / − estensione")
        out[f"thigh{k}"] = Metric(thigh, adj(conf_from_vis(P[s["hip"], 3], P[s["kn"], 3])), label=f"Coscia {s['label']} vs verticale")
        out[f"knee{k}"] = Metric(180 - angle3(hip, kn, an), adj(conf_from_vis(P[s["hip"], 3], P[s["kn"], 3], P[s["an"], 3])),
                                 label=f"Ginocchio {s['label']} (flessione)")
        ank = 90 - angle3(kn, an, an + (toe - heel))
        out[f"ankle{k}"] = Metric(ank, cap(adj(conf_from_vis(P[s["kn"], 3], P[s["an"], 3], P[s["heel"], 3], P[s["toe"], 3])), MED),
                                  label=f"Caviglia {s['label']}", hint="+ dorsiflessione / − plantarflessione")
        out[f"tibia{k}"] = Metric(from_vertical(kn - an, F), adj(conf_from_vis(P[s["kn"], 3], P[s["an"], 3])),
                                  label=f"Tibia {s['label']} vs verticale", hint="+ = ginocchio davanti alla caviglia")
        out[f"elbow{k}"] = Metric(angle3(p2(P, s["sh"]), p2(P, s["el"]), p2(P, s["wr"])),
                                  adj(conf_from_vis(P[s["sh"], 3], P[s["el"], 3], P[s["wr"], 3])), label=f"Gomito {s['label']}")
    fps = {k: foot_point(P, s, F) for k, s in SIDE.items()}
    lowest = max(-float(fps["L"] @ F.up), -float(fps["R"] @ F.up))
    for k, s in SIDE.items():
        fp = fps[k]
        v = shM - fp
        airborne = lowest - (-float(fp @ F.up)) > 0.06 * (leg_length(P, s) or 100)
        c = LOW if airborne else cap(cap(conf_from_vis(P[s["heel"], 3], P[s["toe"], 3]), tc), MED)
        out[f"bodyLine{k}"] = Metric(math.degrees(math.atan2(float(v @ F.up), abs(float(v @ F.f)))), c,
                                     label=f"Linea corpo piede {s['label']} → spalle vs orizzontale",
                                     hint="piede non in appoggio: non interpretabile" if airborne else "piede in appoggio → centro spalle")
    com, com_conf = center_of_mass(P, sex)
    out["com"] = dict(xy=com, conf=com_conf)
    for k, s in SIDE.items():
        fp = foot_point(P, s, F)
        L = leg_length(P, s) or 1
        dx = float((fp - com) @ F.f)
        c = cap(com_conf if k == near else down(com_conf), conf_from_vis(P[s["heel"], 3], P[s["toe"], 3]))
        out[f"footCom{k}"] = Metric(dx / L * 100, c, "% arto", label=f"Piede {s['label']} – proiezione CoM",
                                    hint="+ = piede davanti alla proiezione del CoM",
                                    extra=dict(px=dx, m=(dx / px_per_m) if px_per_m else None, foot=fp))
    out["meta"] = dict(near=near, dir=direction, sh=shM, hip=hipM)
    return out


def frontal(P, ground_rad=0.0) -> dict:
    out: dict = {}
    c, s_ = math.cos(-ground_rad), math.sin(-ground_rad)
    rot = lambda v: np.array([v[0] * c - v[1] * s_, v[0] * s_ + v[1] * c])

    def tilt(a, b):
        v = rot(b - a)
        if v[0] < 0:
            v = -v
        return math.degrees(math.atan2(v[1], v[0]))

    lower = lambda a, b: "sx" if P[a, 1] > P[b, 1] else "dx"
    out["pelvis"] = Metric(abs(tilt(p2(P, 23), p2(P, 24))), conf_from_vis(P[23, 3], P[24, 3]), label="Obliquità bacino", hint=f"anca {lower(23, 24)} più bassa")
    out["shoulders"] = Metric(abs(tilt(p2(P, 11), p2(P, 12))), conf_from_vis(P[11, 3], P[12, 3]), label="Inclinazione spalle", hint=f"spalla {lower(11, 12)} più bassa")
    F = ref_frame(ground_rad, 1)
    shM, hipM = mid(p2(P, 11), p2(P, 12)), mid(p2(P, 23), p2(P, 24))
    lat = from_vertical(shM - hipM, F)
    out["trunkLat"] = Metric(abs(lat), conf_from_vis(P[11, 3], P[12, 3], P[23, 3], P[24, 3]), label="Tronco laterale",
                             hint="verso destra immagine" if lat >= 0 else "verso sinistra immagine")
    out["headTilt"] = Metric(abs(tilt(p2(P, 7), p2(P, 8))), conf_from_vis(P[7, 3], P[8, 3]), label="Inclinazione testa")
    hipW = float(np.linalg.norm(p2(P, 23) - p2(P, 24))) or 1
    for k, s in SIDE.items():
        hip, kn, an = p2(P, s["hip"]), p2(P, s["kn"]), p2(P, s["an"])
        inc = angle3(hip, kn, an)
        ha, hk, tm = an - hip, kn - hip, hipM - hip
        cross = ha[0] * hk[1] - ha[1] * hk[0]
        cross_mid = ha[0] * tm[1] - ha[1] * tm[0]
        valgus = np.sign(cross) == np.sign(cross_mid)
        other = SIDE["R" if k == "L" else "L"]
        swing = P[other["an"], 1] - P[s["an"], 1] > 0.08 * (leg_length(P, s) or 1)
        out[f"fppa{k}"] = Metric((1 if valgus else -1) * (180 - inc), LOW if swing else conf_from_vis(P[s["hip"], 3], P[s["kn"], 3], P[s["an"], 3]),
                                 label=f"FPPA ginocchio {s['label']}", hint="arto in volo: non interpretabile" if swing else "+ valgo / − varo (in appoggio)")
        side = np.sign(hip[0] - hipM[0]) or 1
        out[f"footMid{k}"] = Metric((an[0] - hipM[0]) * side / hipW * 100, conf_from_vis(P[s["an"], 3], P[23, 3], P[24, 3]), "% bacino",
                                    label=f"Caviglia {s['label']} – linea mediana", hint="< 0 = incrocia la linea mediana")
    return out


# ---------------- serie temporali ----------------

def fix_leg_swaps(frames: list) -> int:
    legL, legR = [23, 25, 27, 29, 31], [24, 26, 28, 30, 32]
    prev, swaps = None, 0
    for P in frames:
        if P is None:
            continue
        if prev is not None:
            keep = sum(np.linalg.norm(P[legL[i], :2] - prev[legL[i], :2]) + np.linalg.norm(P[legR[i], :2] - prev[legR[i], :2]) for i in range(1, 5))
            swap = sum(np.linalg.norm(P[legL[i], :2] - prev[legR[i], :2]) + np.linalg.norm(P[legR[i], :2] - prev[legL[i], :2]) for i in range(1, 5))
            if swap < keep * 0.6:
                P[legL + legR] = P[legR + legL]
                swaps += 1
        prev = P
    return swaps


def smooth(frames: list, win: int = 5) -> list:
    if win <= 1:
        return [None if P is None else P.copy() for P in frames]
    h = win // 2
    out = []
    for t, P in enumerate(frames):
        if P is None:
            out.append(None); continue
        acc = np.zeros((33, 3)); wsum = np.zeros((33, 1))
        for k in range(-h, h + 1):
            if 0 <= t + k < len(frames) and frames[t + k] is not None:
                Q = frames[t + k]
                w = np.maximum(0.05, Q[:, 3:4]) * (1 - abs(k) / (h + 1))
                acc += Q[:, :3] * w; wsum += w
        R = P.copy(); R[:, :3] = acc / wsum
        out.append(R)
    return out


def run_direction(frames) -> int:
    xs = [(P[23, 0] + P[24, 0]) / 2 for P in frames if P is not None]
    if len(xs) > 4 and abs(xs[-1] - xs[0]) > 20:
        return 1 if xs[-1] > xs[0] else -1
    f = next((P for P in frames if P is not None), None)
    return dir_from_face(f) if f is not None else 1


def detect_events(frames, ground_rad=0.0, direction=1) -> list:
    F = ref_frame(ground_rad, direction)
    valid = [P for P in frames if P is not None]
    if len(valid) < 6:
        return []
    L = np.mean([leg_length(P, SIDE["L"]) + leg_length(P, SIDE["R"]) for P in valid]) / 2 or 100
    events = []
    for k, s in SIDE.items():
        h = [None if P is None else -float(foot_point(P, s, F) @ F.up) for P in frames]
        xf = [None if P is None else float(foot_point(P, s, F) @ F.f) for P in frames]
        hv = sorted(v for v in h if v is not None)
        ground = hv[int(len(hv) * 0.95)]
        contact = []
        for t in range(len(frames)):
            if h[t] is None:
                contact.append(False); continue
            a = xf[t - 1] if t > 0 and xf[t - 1] is not None else xf[t]
            b = xf[t + 1] if t + 1 < len(xf) and xf[t + 1] is not None else xf[t]
            contact.append(ground - h[t] < 0.06 * L and abs((b - a) / 2) < 0.035 * L)
        for t in range(1, len(contact) - 1):
            if not contact[t] and contact[t - 1] and contact[t + 1]:
                contact[t] = True
        for t in range(1, len(contact) - 1):
            if contact[t] and not contact[t - 1] and not contact[t + 1]:
                contact[t] = False
        for t in range(1, len(contact)):
            if contact[t] and not contact[t - 1]:
                events.append(dict(frame=t, type="TD", foot=k, auto=True, conf=MED))
            if not contact[t] and contact[t - 1]:
                events.append(dict(frame=t, type="TO", foot=k, auto=True, conf=MED))
    return sorted(events, key=lambda e: e["frame"])


def step_times(events, fps) -> dict:
    ev = sorted([e for e in events if e["type"] in ("TD", "TO")], key=lambda e: e["frame"])
    res = dict(contacts=[], flights=[], resolution_ms=1000 / fps,
               conf=HIGH if fps >= 200 else MED if fps >= 100 else LOW)
    for i, e in enumerate(ev):
        if e["type"] == "TD":
            to = next((x for x in ev[i + 1:] if x["type"] == "TO" and x["foot"] == e["foot"]), None)
            if to:
                res["contacts"].append(dict(foot=e["foot"], td=e["frame"], to=to["frame"], ms=(to["frame"] - e["frame"]) * 1000 / fps))
        else:
            td = next((x for x in ev[i + 1:] if x["type"] == "TD" and x["foot"] != e["foot"]), None)
            if td:
                res["flights"].append(dict(to_frame=e["frame"], td_frame=td["frame"], ms=(td["frame"] - e["frame"]) * 1000 / fps))
    return res


def negative_step(frames, start, foot, ground_rad=0.0, direction=1) -> dict:
    F = ref_frame(ground_rad, direction)
    s = SIDE[foot]
    seq = [(t, float(foot_point(frames[t], s, F) @ F.f), leg_length(frames[t], s))
           for t in range(start, min(len(frames), start + 30)) if frames[t] is not None]
    if len(seq) < 4:
        return dict(status="non valutabile", conf=LOW)
    x0, L = seq[0][1], seq[0][2] or 100
    mn, mt = x0, seq[0][0]
    for t, x, _ in seq:
        if x < mn:
            mn, mt = x, t
        if x > x0 + 0.1 * L:
            break
    back = (x0 - mn) / L * 100
    if back > 5:
        return dict(status="presente", back_pct=back, frame=mt, conf=MED)
    if back > 2:
        return dict(status="movimento preparatorio / incerto", back_pct=back, frame=mt, conf=LOW)
    return dict(status="assente", back_pct=back, conf=MED)
