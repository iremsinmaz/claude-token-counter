#!/usr/bin/env python3
# Eklenti simgelerini üretir: extension/icons/icon-<boyut>.png
# Kullanım: python3 scripts/simge-uret.py   (Pillow gerekir)
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
SIZES = [16, 32, 48, 128, 512]
S = 1024  # büyük çizip küçültmek kenarları yumuşatır

BG = (38, 38, 36)
TRACK = (82, 80, 74)
FILL = (217, 119, 87)
NEEDLE = (245, 244, 239)

START, SWEEP, LEVEL = 135, 270, 0.62  # kadran altta açık, %62 dolu


def draw():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)

    m, w = int(S * 0.17), int(S * 0.12)
    box = [m, m + int(S * 0.04), S - m, S - m + int(S * 0.04)]
    d.arc(box, START, START + SWEEP, fill=TRACK, width=w)
    end = START + SWEEP * LEVEL
    d.arc(box, START, end, fill=FILL, width=w)
    # arc uçlarını yuvarlat
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    r = (box[2] - box[0]) / 2 - w / 2
    for ang, col in ((START, FILL), (end, FILL), (START + SWEEP, TRACK)):
        x, y = cx + r * math.cos(math.radians(ang)), cy + r * math.sin(math.radians(ang))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)

    # ibre
    nr = r * 0.62
    nx, ny = cx + nr * math.cos(math.radians(end)), cy + nr * math.sin(math.radians(end))
    d.line([cx, cy, nx, ny], fill=NEEDLE, width=int(S * 0.07))
    d.ellipse([nx - S * 0.035, ny - S * 0.035, nx + S * 0.035, ny + S * 0.035], fill=NEEDLE)
    d.ellipse([cx - S * 0.075, cy - S * 0.075, cx + S * 0.075, cy + S * 0.075], fill=NEEDLE)
    return img


OUT.mkdir(parents=True, exist_ok=True)
big = draw()
for size in SIZES:
    big.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png")
    print(OUT / f"icon-{size}.png")
