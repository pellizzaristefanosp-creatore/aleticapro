"""Sintesi vocale italiana opzionale. Nessun audio inventato: se nessun motore è disponibile si restituisce None."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def engine() -> str | None:
    if shutil.which("piper") and os.environ.get("GASA_PIPER_MODEL") and Path(os.environ["GASA_PIPER_MODEL"]).exists():
        return "piper"
    if shutil.which("say"):
        return "say"
    if shutil.which("espeak-ng"):
        return "espeak-ng"
    return None


def synth(text: str, out_wav: Path, eng: str | None = None) -> bool:
    eng = eng or engine()
    if not eng:
        return False
    out_wav = Path(out_wav)
    try:
        if eng == "piper":
            # consigliata: voce maschile italiana "it_IT-riccardo-x_low" (modello .onnx scaricato a parte)
            subprocess.run(["piper", "--model", os.environ["GASA_PIPER_MODEL"], "--output_file", str(out_wav)],
                           input=text.encode(), check=True, capture_output=True)
        elif eng == "say":
            aiff = out_wav.with_suffix(".aiff")
            subprocess.run(["say", "-v", os.environ.get("GASA_SAY_VOICE", "Luca"), "-r", "185", "-o", str(aiff), text], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(aiff), "-ar", "48000", str(out_wav)], check=True)
        elif eng == "espeak-ng":
            subprocess.run(["espeak-ng", "-v", "it+m3", "-s", "165", "-w", str(out_wav), text], check=True)
        return out_wav.exists()
    except (subprocess.CalledProcessError, OSError):
        return False


def duration(wav: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0
