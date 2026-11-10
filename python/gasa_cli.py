#!/usr/bin/env python3
"""GASA Biomechanics — CLI.

  python python/gasa_cli.py analyze VIDEO --start 9.1 --end 10.1 -o out/
  python python/gasa_cli.py reel    VIDEO --config python/config.example.json -o out/

Il file di configurazione (JSON) permette di fissare intervallo, eventi verificati a mano
(consigliato), calibrazione del terreno e della scala, testi delle conclusioni.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gasa.analysis import analyze, save_outputs  # noqa: E402
from gasa.reel import render_reel  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["analyze", "reel"])
    ap.add_argument("video")
    ap.add_argument("-o", "--out", default="out")
    ap.add_argument("--config", help="JSON con parametri ed eventi verificati")
    ap.add_argument("--start", type=float, help="inizio intervallo (s)")
    ap.add_argument("--end", type=float, help="fine intervallo (s)")
    ap.add_argument("--fps", type=float, help="forza il frame rate (es. slow-motion con metadati errati)")
    ap.add_argument("--model", choices=["full", "lite"], default=None)
    ap.add_argument("--no-voice", action="store_true")
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text()) if a.config else {}
    out = Path(a.out)
    A = analyze(a.video, start_s=a.start if a.start is not None else cfg.get("start_s", 0.0),
                end_s=a.end if a.end is not None else cfg.get("end_s"), model=a.model or cfg.get("model", "full"),
                smooth_win=cfg.get("smooth", 5), sex=cfg.get("com_model", "M"), view=cfg.get("view"),
                direction=cfg.get("direction"), ground_deg=cfg.get("ground_deg", 0.0), px_per_m=cfg.get("px_per_m"),
                events_override=cfg.get("events"), fps=a.fps or cfg.get("fps"))
    rep = save_outputs(A, out)
    q = rep["qualita"]
    print(f"Analisi: {q['con_atleta']}/{q['fotogrammi']} fotogrammi con atleta · vista {q['vista_stimata']} · {len(A.events)} eventi")
    print(f"  → {out / 'report.md'}, {out / 'angoli.csv'}, {out / 'report.json'}")
    if a.cmd == "reel":
        if a.no_voice:
            cfg["voice"] = False
        r = render_reel(A, out, cfg)
        print(f"Reel: {r['final']} ({r['duration']:.1f} s, voce: {'sì' if r['voice'] else 'no'})")
        print(f"      {r['light']}")


if __name__ == "__main__":
    main()
