#!/usr/bin/env python3
"""One-off generator for the tray icon assets (no external asset pipeline needed for v1).
Run manually with `python3 scripts/gen-icons.py` if you ever want to regenerate icons.
Requires Pillow (python3-pil) which happened to be available on the dev machine;
the generated PNGs are committed so this script is not a runtime dependency.
"""
from PIL import Image, ImageDraw

def make_icon(size, fg, path):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # simple magnifying glass glyph
    margin = size * 0.12
    lens_d = size * 0.58
    lens_box = [margin, margin, margin + lens_d, margin + lens_d]
    stroke = max(2, round(size * 0.09))
    d.ellipse(lens_box, outline=fg, width=stroke)
    handle_start = (margin + lens_d * 0.82, margin + lens_d * 0.82)
    handle_end = (size - margin * 0.4, size - margin * 0.4)
    d.line([handle_start, handle_end], fill=fg, width=stroke + 1)
    img.save(path)

# Dark glyph on transparent bg reads fine on GNOME's default dark top bar? Actually GNOME
# top bar is dark text/icons on translucent bg by default in light shell theme variants,
# but Ubuntu's Yaru shell theme uses light-on-dark. Use white glyph — matches Ubuntu default.
make_icon(32, (255, 255, 255, 255), "assets/tray-icon.png")
make_icon(64, (255, 255, 255, 255), "assets/tray-icon@2x.png")
# A colored version for window/app icon (not just tray) since a plain white glyph on
# transparent bg would be invisible in a taskbar/alt-tab context.
img = Image.new("RGBA", (256, 256), (30, 30, 46, 255))
d = ImageDraw.Draw(img)
margin = 256 * 0.16
lens_d = 256 * 0.5
lens_box = [margin, margin, margin + lens_d, margin + lens_d]
stroke = 18
d.ellipse(lens_box, outline=(255, 255, 255, 255), width=stroke)
d.line([(margin + lens_d * 0.8, margin + lens_d * 0.8), (256 - margin * 0.5, 256 - margin * 0.5)],
       fill=(255, 255, 255, 255), width=stroke + 2)
img.save("assets/app-icon.png")
print("icons written")
