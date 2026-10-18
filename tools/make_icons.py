"""Bikin ikon gembok pixel-art (16x16, diperbesar tanpa blur). Jalankan: python3 tools/make_icons.py"""
from PIL import Image
import os

GRID = [
    "................",
    ".....######.....",
    "....#mmmmmm#....",
    "...#mm####mm#...",
    "...#m#....#m#...",
    "...#m#....#m#...",
    "...#m#....#m#...",
    ".##############.",
    ".#hooooooooooo#.",
    ".#oooooooooooo#.",
    ".#ooooo##ooooo#.",
    ".#oooo####oooo#.",
    ".#ooooo##ooooo#.",
    ".#ooooo##ooooo#.",
    ".#oooooooooooo#.",
    ".##############.",
]
PAL = {".": (0, 0, 0, 0), "#": (17, 17, 17, 255), "o": (255, 210, 63, 255),
       "h": (255, 243, 176, 255), "m": (207, 207, 221, 255)}

OPEN = list(GRID)
OPEN[1] = ".......######..."
OPEN[2] = "......#mmmmmm#.."
OPEN[3] = ".....#mm####mm#."
OPEN[4] = ".....#m#....#m#."
OPEN[5] = ".....#m#........"
OPEN[6] = ".....#m#........"
open_img = Image.new("RGBA", (16, 16))
for y, row in enumerate(OPEN):
    for x, ch in enumerate(row[:16]):
        open_img.putpixel((x, y), PAL[ch])

base = Image.new("RGBA", (16, 16))
for y, row in enumerate(GRID):
    for x, ch in enumerate(row[:16]):
        base.putpixel((x, y), PAL[ch])

out = os.path.join(os.path.dirname(__file__), "..", "icons")
for size in (16, 32, 48, 128):
    base.resize((size, size), Image.NEAREST).save(os.path.join(out, f"icon{size}.png"))
open_img.resize((128, 128), Image.NEAREST).save(os.path.join(out, "open128.png"))
print("ok")
