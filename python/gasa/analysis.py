"""Analisi video: pose estimation fotogramma per fotogramma, controllo qualità, metriche, eventi, report."""
from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import biomech as B

ROOT = Path(__file__).resolve().parents[2]
MODELS = {"full": ROOT / "models/pose_landmarker_full.task", "lite": ROOT / "models/pose_landmarker_lite.task"}


def probe(path: str) -> dict:
    """Metadati reali del file (ffprobe): fps, risoluzione, durata, rotazione."""
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:stream_side_data=rotation",
                          "-of", "json", path], capture_output=True, text=True, check=True)
    s = json.loads(out.stdout)["streams"][0]
    num, den = map(int, s["r_frame_rate"].split("/"))
    anum, aden = map(int, s.get("avg_frame_rate", "0/1").split("/"))
    rot = 0
    for sd in s.get("side_data_list", []) or []:
        rot = int(sd.get("rotation", 0))
    return dict(width=s["width"], height=s["height"], fps=num / den, avg_fps=(anum / aden) if aden else None,
                nb_frames=int(s.get("nb_frames", 0) or 0), duration=float(s.get("duration", 0) or 0), rotation=rot)


@dataclass
class Analysis:
    video: str
    fps: float
    W: int
    H: int
    start: int
    raw: list
    px: list = field(default_factory=list)
    view: str = "sagittale"
    near: str = "L"
    direction: int = 1
    ground_rad: float = 0.0
    px_per_m: float | None = None
    sex: str = "M"
    swaps: int = 0
    events: list = field(default_factory=list)
    quality: dict = field(default_factory=dict)
    view_forced: bool = False

    def frame_at(self, i: int):
        return self.px[i - self.start] if 0 <= i - self.start < len(self.px) else None

    def metrics(self, i: int, view: str | None = None):
        P = self.frame_at(i)
        if P is None:
            return None
        v = view or self.view
        if v == "frontale":
            return B.frontal(P, self.ground_rad)
        M = B.sagittal(P, self.ground_rad, self.direction, self.near, self.sex, self.px_per_m)
        if self.quality.get("vista_stimata") == "obliqua" and not self.view_forced:
            # prospettiva obliqua: angoli sagittali distorti → un livello di confidenza in meno
            for m in M.values():
                if isinstance(m, B.Metric):
                    m.conf = B.down(m.conf)
            M["com"]["conf"] = B.down(M["com"]["conf"])
        return M


def run_pose(video: str, start_s: float = 0, end_s: float | None = None, model: str = "full", fps: float | None = None, log=print):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    info = probe(video)
    fps = fps or info["fps"]
    cap = cv2.VideoCapture(video)
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    start = int(round(start_s * fps))
    end = int(round(end_s * fps)) if end_s else None
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODELS[model])),
                                        running_mode=vision.RunningMode.VIDEO, num_poses=1,
                                        min_pose_detection_confidence=0.5, min_tracking_confidence=0.5)
    lm = vision.PoseLandmarker.create_from_options(opts)
    raw, i = [], start
    try:
        while True:
            if end is not None and i > end:
                break
            ok, fr = cap.read()
            if not ok:
                break
            res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)),
                                      int((i - start) * 1000 / fps) + 1)
            if res.pose_landmarks:
                raw.append(B.edge_vis(np.array([[p.x * W, p.y * H, p.z * W, p.visibility] for p in res.pose_landmarks[0]], dtype=float), W, H))
            else:
                raw.append(None)
            i += 1
            if (i - start) % 30 == 0:
                log(f"  pose: {i - start} fotogrammi")
    finally:
        lm.close()
        cap.release()
    return info, fps, W, H, start, raw


def analyze(video: str, start_s=0.0, end_s=None, model="full", smooth_win=5, sex="M", view=None,
            direction=None, ground_deg=0.0, px_per_m=None, events_override=None, fps=None, log=print) -> Analysis:
    info, fps, W, H, start, raw = run_pose(video, start_s, end_s, model, fps, log)
    px = [None if P is None else P.copy() for P in raw]
    swaps = B.fix_leg_swaps(px)
    px = B.smooth(px, smooth_win)
    valid = [P for P in px if P is not None]
    if not valid:
        raise RuntimeError("Nessun atleta rilevato nell'intervallo indicato")
    views = [B.detect_view(P)["view"] for P in valid]
    cnt = {v: views.count(v) for v in ("sagittale", "frontale", "obliqua")}
    seq_view = view or ("frontale" if cnt["frontale"] > cnt["sagittale"] + cnt["obliqua"] else
                        "obliqua" if cnt["obliqua"] > cnt["sagittale"] else "sagittale")
    nears = [B.near_side(P) for P in valid]
    A = Analysis(video, fps, W, H, start, raw, px, "sagittale" if seq_view == "obliqua" else seq_view,
                 "L" if nears.count("L") >= len(nears) / 2 else "R",
                 direction or B.run_direction(px), math.radians(ground_deg), px_per_m, sex, swaps)
    A.view_forced = bool(view)
    vis = np.array([P[:, 3] for P in valid])
    A.quality = dict(
        fotogrammi=len(px), con_atleta=len(valid), copertura=len(valid) / len(px),
        vista_stimata=seq_view, voti_vista=cnt, scambi_sx_dx=swaps,
        visibilita_media={name: float(vis[:, i].mean()) for name, i in
                          [("anca", 23), ("ginocchio", 25), ("caviglia", 27), ("tallone", 29), ("avampiede", 31), ("spalla", 11), ("orecchio", 7)]},
        video=info,
        affidabilita_2d=("buona" if seq_view == "sagittale" and len(valid) / len(px) > 0.9 else
                         "ridotta (vista obliqua: angoli sagittali distorti)" if seq_view == "obliqua" else "da verificare"),
    )
    if events_override:
        A.events = [dict(e, auto=False, conf=e.get("conf", B.HIGH)) for e in events_override]
    elif A.view == "sagittale":
        ev = B.detect_events(px, A.ground_rad, A.direction)
        A.events = [dict(e, frame=e["frame"] + start) for e in ev]
    return A


def report(A: Analysis) -> dict:
    keys_at = {}
    for e in A.events:
        M = A.metrics(e["frame"])
        if not M:
            continue
        keys_at[f'{e["type"]}{e.get("foot") or ""}@{e["frame"]}'] = {
            k: dict(valore=round(m.value, 1), unita=m.unit, confidenza=m.conf, etichetta=m.label)
            for k, m in M.items() if isinstance(m, B.Metric) and m.value is not None and not math.isnan(m.value)}
    st = B.step_times(A.events, A.fps)
    return dict(
        progetto="GASA BIOMECHANICS — SPRINT PERFORMANCE ANALYSIS",
        video=A.video, fps=A.fps, risoluzione=f"{A.W}x{A.H}", intervallo_frame=[A.start, A.start + len(A.px) - 1],
        vista=A.view, lato_vicino=A.near, direzione="destra" if A.direction > 0 else "sinistra",
        terreno_deg=round(math.degrees(A.ground_rad), 2), scala_px_m=A.px_per_m, qualita=A.quality,
        eventi=[dict(e, tempo_s=round(e["frame"] / A.fps, 4)) for e in A.events],
        metriche_agli_eventi=keys_at, tempi=st,
        limiti=[
            "Misure 2D proiettate sul piano immagine; errore crescente se il gesto non è parallelo al piano della camera.",
            "Centri articolari stimati da rete neurale (MediaPipe Pose), non da marker: landmark del piede approssimati.",
            "CoM stimato con modello segmentale de Leva (1996) sui landmark 2D: stima, non misura.",
            "Nessuna inferenza di forze, impulsi, rigidità o rischio d'infortunio dalla sola cinematica.",
            f"Risoluzione temporale ±{1000 / A.fps:.1f} ms per evento a {A.fps:.0f} fps.",
        ],
    )


def save_outputs(A: Analysis, out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    lm = [None if P is None else np.round(P, 2).tolist() for P in A.raw]
    (out / "landmarks_raw.json").write_text(json.dumps(dict(fps=A.fps, W=A.W, H=A.H, start=A.start, frames=lm)))
    rows, keys = [], None
    for j in range(len(A.px)):
        i = A.start + j
        M = A.metrics(i)
        if M is None:
            rows.append([i, f"{i / A.fps:.4f}"]); continue
        ms = {k: m for k, m in M.items() if isinstance(m, B.Metric)}
        if keys is None:
            keys = list(ms)
        rows.append([i, f"{i / A.fps:.4f}"] + sum(([f"{ms[k].value:.2f}", ms[k].conf] for k in keys), []))
    hdr = ["frame", "time_s"] + sum(([k, f"{k}_conf"] for k in (keys or [])), [])
    (out / "angoli.csv").write_text("\n".join(",".join(map(str, r)) for r in [hdr] + rows))
    rep = report(A)
    (out / "report.json").write_text(json.dumps(rep, indent=2, ensure_ascii=False, default=float))
    (out / "report.md").write_text(report_md(rep))
    return rep


def report_md(r: dict) -> str:
    q = r["qualita"]
    L = [f"# {r['progetto']}", "", "## Filmato", "",
         f"- File: `{Path(r['video']).name}`", f"- Risoluzione: {r['risoluzione']} · frame rate: {r['fps']:.2f} fps · durata: {q['video']['duration']:.2f} s",
         f"- Intervallo analizzato: frame {r['intervallo_frame'][0]}–{r['intervallo_frame'][1]}",
         f"- Vista stimata: **{q['vista_stimata']}** (voti {q['voti_vista']}) · lato vicino: {r['lato_vicino']} · direzione: {r['direzione']}",
         f"- Atleta rilevato in {q['con_atleta']}/{q['fotogrammi']} fotogrammi · scambi sx/dx corretti: {q['scambi_sx_dx']}",
         f"- Affidabilità misure 2D: {q['affidabilita_2d']}",
         "- Visibilità media landmark: " + ", ".join(f"{k} {v:.2f}" for k, v in q["visibilita_media"].items()), "",
         "## Eventi", "", "| Evento | Piede | Frame | Tempo (s) | Origine | Confidenza |", "|---|---|---|---|---|---|"]
    for e in r["eventi"]:
        L.append(f"| {e['type']} | {e.get('foot') or '-'} | {e['frame']} | {e['tempo_s']} | {'automatico' if e.get('auto') else 'manuale'} | {e['conf']} |")
    L += ["", "## Angoli agli eventi", ""]
    for name, ms in r["metriche_agli_eventi"].items():
        L += [f"### {name}", "", "| Misura | Valore | Confidenza |", "|---|---|---|"]
        for m in ms.values():
            L.append(f"| {m['etichetta']} | {'non misurabile' if m['confidenza'] == 'bassa' else f'{m['valore']} {m['unita']}'} | {m['confidenza']} |")
        L.append("")
    t = r["tempi"]
    L += ["## Tempi di contatto e volo", ""]
    L += [f"- Contatto {c['foot']} (F {c['td']}→{c['to']}): {c['ms']:.0f} ms" for c in t["contacts"]]
    L += [f"- Volo (F {c['to_frame']}→{c['td_frame']}): {c['ms']:.0f} ms" for c in t["flights"]]
    L += [f"- Confidenza: {t['conf']} (±{t['resolution_ms']:.1f} ms per evento)", "", "## Limiti", ""] + [f"- {x}" for x in r["limiti"]]
    return "\n".join(L) + "\n"
