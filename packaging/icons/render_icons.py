"""Redraw the plated brand icons from one geometry definition.

Manual developer tool. It is not a build step, not a CI job, and nothing
imports it — the outputs below are committed, and this exists so that changing
the mark is one command instead of hand-work in an image editor.

It draws with Pillow, already a runtime dependency, so regenerating the icons
needs no SVG rasteriser and no extra package.

    python packaging/icons/render_icons.py

Overwrites:
    extension/icons/icon16.png, icon32.png, icon48.png, icon128.png
    packaging/azimut.ico

The geometry mirrors frontend/src/components/Logo.svelte and
frontend/public/favicon.svg. Move all three together.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

# --- geometry, in the favicon's -2..26 viewBox units ------------------------
VIEW_MIN, VIEW_SPAN = -2.0, 28.0
PLATE_RADIUS = 6.2
PLATE = (0x14, 0x17, 0x1B, 0xFF)
INK = (0xDF, 0xE3, 0xE8, 0xFF)
AMBER = (0xE8, 0xA3, 0x3D, 0xFF)  # tracks --accent in frontend/src/app.css

# The arrow as drawn in Logo.svelte, scaled about the centre to sit in the
# plate: unscaled it leaves too much dead margin at icon sizes.
ARROW_SCALE = 1.18
TIP = (12.0, 1.8)
WAIST = (12.0, 16.4)
BASE_W = (5.8, 21.4)
BASE_E = (18.2, 21.4)

PNG_SIZES = (16, 32, 48, 128)
ICO_SIZES = (16, 24, 32, 48, 128, 256)
SUPERSAMPLE = 8

ROOT = Path(__file__).resolve().parents[2]
EXTENSION_ICONS = ROOT / "extension" / "icons"
ICO_PATH = ROOT / "packaging" / "azimut.ico"


def _scaled(point: tuple[float, float]) -> tuple[float, float]:
    x, y = point
    return (12.0 + (x - 12.0) * ARROW_SCALE, 12.0 + (y - 12.0) * ARROW_SCALE)


def _draw(size: int) -> Image.Image:
    """Draw the plated mark at `size`, oversampled then reduced for clean edges."""
    n = size * SUPERSAMPLE
    scale = n / VIEW_SPAN

    def px(point: tuple[float, float]) -> tuple[float, float]:
        x, y = _scaled(point)
        return ((x - VIEW_MIN) * scale, (y - VIEW_MIN) * scale)

    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        (0, 0, n - 1, n - 1), radius=PLATE_RADIUS * scale, fill=PLATE
    )
    draw.polygon([px(TIP), px(BASE_W), px(WAIST)], fill=INK)
    draw.polygon([px(TIP), px(BASE_E), px(WAIST)], fill=AMBER)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    EXTENSION_ICONS.mkdir(parents=True, exist_ok=True)
    for size in PNG_SIZES:
        target = EXTENSION_ICONS / f"icon{size}.png"
        _draw(size).save(target)
        print(f"wrote {target.relative_to(ROOT)}")

    # Pillow builds the multi-size .ico by reducing the largest image itself,
    # so hand it the biggest one we draw.
    largest = max(ICO_SIZES)
    _draw(largest).save(
        ICO_PATH, format="ICO", sizes=[(s, s) for s in ICO_SIZES]
    )
    print(f"wrote {ICO_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
