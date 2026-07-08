from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SIZES = (16, 24, 32, 48, 64, 128, 256)
SCALE = 4

BASE = "#214854"
RIM = "#7fb8c7"
PAPER = "#f2f7f1"
ACCENT = "#66d2af"


def scaled_rect(values: tuple[float, float, float, float], factor: float) -> tuple[int, int, int, int]:
    return tuple(round(value * factor) for value in values)


def scaled_points(points: list[tuple[float, float]], factor: float) -> list[tuple[int, int]]:
    return [(round(x * factor), round(y * factor)) for x, y in points]


def draw_base(draw: ImageDraw.ImageDraw, factor: float, tiny: bool) -> None:
    if tiny:
        draw.rounded_rectangle(scaled_rect((6, 6, 122, 122), factor), radius=round(28 * factor), fill=BASE)
        draw.rounded_rectangle(
            scaled_rect((14, 14, 114, 114), factor),
            radius=round(22 * factor),
            outline=RIM,
            width=max(1, round(9 * factor)),
        )
    else:
        draw.rounded_rectangle(scaled_rect((8, 8, 120, 120), factor), radius=round(26 * factor), fill=BASE)
        draw.rounded_rectangle(
            scaled_rect((14, 14, 114, 114), factor),
            radius=round(21 * factor),
            outline=RIM,
            width=max(1, round(7 * factor)),
        )


def remap_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tiny = size <= 24

    draw_base(draw, factor, tiny)
    if tiny:
        draw.rounded_rectangle(scaled_rect((40, 25, 88, 103), factor), radius=round(8 * factor), fill=PAPER)
        draw.rounded_rectangle(scaled_rect((66, 34, 79, 94), factor), radius=round(4 * factor), fill=ACCENT)
        for y in (48, 80):
            draw.line(
                scaled_points([(52, y), (62, y)], factor),
                fill=BASE,
                width=max(1, round(8 * factor)),
            )
    else:
        draw.rounded_rectangle(scaled_rect((42, 24, 86, 104), factor), radius=round(7 * factor), fill=PAPER)
        draw.rounded_rectangle(scaled_rect((65, 32, 78, 96), factor), radius=round(4 * factor), fill=ACCENT)
        for y in (43, 64, 85):
            draw.line(
                scaled_points([(51, y), (62, y)], factor),
                fill=BASE,
                width=max(1, round(6 * factor)),
            )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def corrector_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tiny = size <= 24

    draw_base(draw, factor, tiny)
    if tiny:
        paper = [(43, 31), (87, 37), (81, 96), (37, 88)]
        handle_radius = 10
        outline_width = 5
    else:
        paper = [(42, 29), (88, 36), (82, 97), (36, 89)]
        handle_radius = 10
        outline_width = 5

    draw.polygon(scaled_points(paper, factor), fill=PAPER)
    draw.line(
        scaled_points([*paper, paper[0]], factor),
        fill=BASE,
        width=max(1, round(outline_width * factor)),
        joint="curve",
    )
    radius = round(handle_radius * factor)
    for x, y in scaled_points(paper, factor):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=ACCENT)

    return image.resize((size, size), Image.Resampling.LANCZOS)


def png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def save_ico(path: Path, images: dict[int, Image.Image]) -> None:
    entries: list[tuple[int, bytes]] = [(size, png_bytes(images[size])) for size in SIZES]
    header_size = 6 + 16 * len(entries)
    offset = header_size
    directory = bytearray()
    payload = bytearray()
    for size, data in entries:
        width = 0 if size >= 256 else size
        height = 0 if size >= 256 else size
        directory.extend(struct.pack("<BBBBHHII", width, height, 0, 0, 1, 32, len(data), offset))
        payload.extend(data)
        offset += len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(entries)) + directory + payload)


def save_preview(path: Path, remap: dict[int, Image.Image], corrector: dict[int, Image.Image]) -> None:
    preview = Image.new("RGBA", (760, 260), "#171b1d")
    draw = ImageDraw.Draw(preview)
    draw.text((40, 20), "xsheet-remap", fill="#d8e5e4")
    draw.text((410, 20), "xsheet-corrector", fill="#d8e5e4")
    preview.alpha_composite(remap[128], (40, 52))
    preview.alpha_composite(corrector[128], (410, 52))
    for x, size in ((40, 48), (108, 32), (160, 16)):
        preview.alpha_composite(remap[size], (x, 204 + (48 - size) // 2))
    for x, size in ((410, 48), (478, 32), (530, 16)):
        preview.alpha_composite(corrector[size], (x, 204 + (48 - size) // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(path)


def main() -> None:
    remap_images = {size: remap_icon(size) for size in SIZES}
    corrector_images = {size: corrector_icon(size) for size in SIZES}

    save_ico(ROOT / "apps/desktop/src-tauri/icons/icon.ico", remap_images)
    save_ico(ROOT / "apps/sheet-corrector/src-tauri/icons/icon.ico", corrector_images)
    save_preview(ROOT / "design/icon-proposals/xsheet-icon-final-preview.png", remap_images, corrector_images)


if __name__ == "__main__":
    main()
