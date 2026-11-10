"""Primitive grafiche GASA per il rendering offline (OpenCV per linee antialiasing, Pillow per il testo)."""
from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONTS = Path(__file__).resolve().parents[1] / "assets/fonts"
# BGR
BG = (20, 13, 8)
BLUE = (255, 200, 0)
WHITE = (255, 255, 255)
YELLOW = (71, 212, 255)
RED = (85, 70, 255)
GREY = (168, 151, 138)
CONF = {"alta": BLUE, "media": YELLOW, "bassa": GREY}


def rgb(c):
    return (c[2], c[1], c[0])


@lru_cache(maxsize=64)
def font(size: int, weight: str = "bold"):
    f = {"semibold": "Inter-SemiBold.otf", "bold": "Inter-Bold.otf", "xbold": "InterDisplay-ExtraBold.otf", "black": "InterDisplay-Black.otf"}[weight]
    return ImageFont.truetype(str(FONTS / f), size)


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def P(p):
    return (int(round(p[0] * 16)), int(round(p[1] * 16)))


def line(img, a, b, color, w=3, alpha=1.0):
    if alpha >= 1:
        cv2.line(img, P(a), P(b), color, max(1, int(w)), cv2.LINE_AA, 4)
    else:
        H, W = img.shape[:2]
        x0, y0 = max(0, int(min(a[0], b[0]) - w - 2)), max(0, int(min(a[1], b[1]) - w - 2))
        x1, y1 = min(W, int(max(a[0], b[0]) + w + 3)), min(H, int(max(a[1], b[1]) + w + 3))
        if x1 <= x0 or y1 <= y0:
            return
        roi = img[y0:y1, x0:x1]
        ov = roi.copy()
        cv2.line(ov, P((a[0] - x0, a[1] - y0)), P((b[0] - x0, b[1] - y0)), color, max(1, int(w)), cv2.LINE_AA, 4)
        cv2.addWeighted(ov, alpha, roi, 1 - alpha, 0, roi)


def dashed(img, a, b, color, w=2, dash=14, gap=10, progress=1.0):
    a, b = np.asarray(a, float), np.asarray(b, float)
    L = np.linalg.norm(b - a)
    if L < 1:
        return
    d = (b - a) / L
    t = 0.0
    while t < L * progress:
        e = min(t + dash, L * progress)
        line(img, a + d * t, a + d * e, color, w)
        t += dash + gap


def _roi_glow(img, x0, y0, x1, y1, draw, sigma, gain):
    """Applica un bagliore solo nella regione interessata (molto più veloce del frame intero)."""
    pad = int(sigma * 4) + 2
    H, W = img.shape[:2]
    x0, y0 = max(0, int(x0) - pad), max(0, int(y0) - pad)
    x1, y1 = min(W, int(x1) + pad), min(H, int(y1) + pad)
    if x1 <= x0 or y1 <= y0:
        return
    layer = np.zeros((y1 - y0, x1 - x0, 3), img.dtype)
    draw(layer, (x0, y0))
    layer = cv2.GaussianBlur(layer, (0, 0), sigma)
    roi = img[y0:y1, x0:x1]
    cv2.add(roi, (layer * gain).astype(img.dtype), roi)


def glow_line(img, a, b, color, w=4, progress=1.0):
    a, b = np.asarray(a, float), np.asarray(b, float)
    b = a + (b - a) * progress
    def dr(layer, o):
        cv2.line(layer, P((a[0] - o[0], a[1] - o[1])), P((b[0] - o[0], b[1] - o[1])), color, int(w * 3), cv2.LINE_AA, 4)
    _roi_glow(img, min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]), dr, w * 1.6, 0.8)
    line(img, a, b, color, w)


def joint(img, p, color=BLUE, r=7, glow=True, scale=1.0):
    r = r * scale
    if r < 0.5:
        return
    if glow:
        R = r * 2.6
        def dr(layer, o):
            cv2.circle(layer, P((p[0] - o[0], p[1] - o[1])), int(R * 16), color, -1, cv2.LINE_AA, 4)
        _roi_glow(img, p[0] - R, p[1] - R, p[0] + R, p[1] + R, dr, r * 1.4, 0.9)
    cv2.circle(img, P(p), int(r * 16), WHITE, -1, cv2.LINE_AA, 4)
    cv2.circle(img, P(p), int(r * 16), color, max(2, int(r * 0.45)), cv2.LINE_AA, 4)


def arc(img, a, b, c, color, r=60, progress=1.0, fill_alpha=0.22, w=3):
    """Arco dell'angolo in b fra i raggi b→a e b→c (progress 0..1 per l'animazione)."""
    a1 = math.degrees(math.atan2(a[1] - b[1], a[0] - b[0]))
    a2 = math.degrees(math.atan2(c[1] - b[1], c[0] - b[0]))
    d = (a2 - a1 + 180) % 360 - 180
    end = a1 + d * progress
    H, W = img.shape[:2]
    x0, y0, x1, y1 = max(0, int(b[0] - r - 3)), max(0, int(b[1] - r - 3)), min(W, int(b[0] + r + 4)), min(H, int(b[1] + r + 4))
    if x1 > x0 and y1 > y0:
        roi = img[y0:y1, x0:x1]
        ov = roi.copy()
        cv2.ellipse(ov, P((b[0] - x0, b[1] - y0)), (int(r * 16), int(r * 16)), 0, a1, end, color, -1, cv2.LINE_AA, 4)
        cv2.addWeighted(ov, fill_alpha, roi, 1 - fill_alpha, 0, roi)
    cv2.ellipse(img, P(b), (int(r * 16), int(r * 16)), 0, a1, end, color, w, cv2.LINE_AA, 4)
    mid = math.radians(a1 + d / 2)
    return (b[0] + math.cos(mid) * r, b[1] + math.sin(mid) * r)


class TextLayer:
    """Accumula testi e li disegna in un solo passaggio con Pillow (antialiasing di qualità)."""

    def __init__(self):
        self.ops = []

    def text(self, xy, s, size=40, color=WHITE, weight="bold", anchor="la", alpha=1.0, shadow=True):
        self.ops.append(("text", xy, s, size, color, weight, anchor, alpha, shadow))

    def pill(self, xy, s, size=40, color=BLUE, sub=None, alpha=1.0, anchor="mm"):
        self.ops.append(("pill", xy, s, size, color, sub, alpha, anchor))

    def rect(self, box, fill, alpha=1.0, radius=18, outline=None, width=2):
        self.ops.append(("rect", box, fill, alpha, radius, outline, width))

    def render(self, img):
        if not self.ops:
            return img
        base = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).convert("RGBA")
        over = Image.new("RGBA", base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(over)
        for op in self.ops:
            if op[0] == "rect":
                _, box, fill, alpha, radius, outline, width = op
                d.rounded_rectangle(box, radius, fill=rgb(fill) + (int(255 * alpha),),
                                    outline=(rgb(outline) + (int(255 * alpha),)) if outline else None, width=width)
            elif op[0] == "text":
                _, xy, s, size, color, weight, anchor, alpha, shadow = op
                f = font(size, weight)
                if shadow:
                    d.text((xy[0] + 2, xy[1] + 3), s, font=f, fill=(0, 0, 0, int(160 * alpha)), anchor=anchor)
                d.text(xy, s, font=f, fill=rgb(color) + (int(255 * alpha),), anchor=anchor)
            elif op[0] == "pill":
                _, xy, s, size, color, sub, alpha, anchor = op
                f = font(size, "xbold")
                fs = font(int(size * 0.42), "bold")
                w1 = d.textlength(s, font=f)
                w2 = d.textlength(sub, font=fs) if sub else 0
                W = max(w1, w2) + size * 0.8
                H = size * (1.75 if sub else 1.3)
                x0, y0 = xy[0] - W / 2, xy[1] - H / 2
                if anchor == "lm":
                    x0 = xy[0]
                elif anchor == "rm":
                    x0 = xy[0] - W
                d.rounded_rectangle((x0, y0, x0 + W, y0 + H), int(size * 0.28), fill=(8, 13, 20, int(225 * alpha)),
                                    outline=rgb(color) + (int(255 * alpha),), width=max(2, size // 16))
                cy = y0 + (size * 0.62 if sub else H / 2)
                d.text((x0 + W / 2, cy), s, font=f, fill=rgb(color) + (int(255 * alpha),), anchor="mm")
                if sub:
                    d.text((x0 + W / 2, y0 + H - size * 0.38), sub, font=fs, fill=(201, 210, 221, int(255 * alpha)), anchor="mm")
        base.alpha_composite(over)
        return cv2.cvtColor(np.array(base.convert("RGB")), cv2.COLOR_RGB2BGR)


def wrap(s: str, size: int, max_w: int, weight="bold") -> list[str]:
    f = font(size, weight)
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if f.getlength(t) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines
