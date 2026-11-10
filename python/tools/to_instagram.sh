#!/usr/bin/env bash
# Converte un video (es. export WebM dal browser) nel formato richiesto da Instagram/iPhone:
# MP4 H.264 yuv420p, AAC, faststart. Uso: ./to_instagram.sh input.webm [output.mp4]
set -euo pipefail
in="$1"; out="${2:-${1%.*}_instagram.mp4}"
has_audio=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$in" | head -1)
if [ -n "$has_audio" ]; then
  ffmpeg -y -i "$in" -c:v libx264 -profile:v high -preset slow -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -movflags +faststart "$out"
else
  ffmpeg -y -i "$in" -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v libx264 -profile:v high -preset slow -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 128k -movflags +faststart "$out"
fi
echo "→ $out"
