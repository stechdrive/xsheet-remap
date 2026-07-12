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


def editor_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tiny = size <= 24

    draw_base(draw, factor, tiny)
    draw.rounded_rectangle(
        scaled_rect((30, 23, 98, 105), factor),
        radius=round(7 * factor),
        fill=PAPER,
    )
    grid_lines = (
        ((40, 43), (88, 43)),
        ((40, 63), (82, 63)),
        ((40, 83), (69, 83)),
        ((56, 32), (56, 94)),
        ((76, 32), (76, 68)),
    )
    if tiny:
        grid_lines = (
            ((40, 46), (87, 46)),
            ((40, 69), (76, 69)),
            ((56, 32), (56, 92)),
        )
    for start, end in grid_lines:
        draw.line(
            scaled_points([start, end], factor),
            fill=BASE,
            width=max(1, round((6 if tiny else 5) * factor)),
        )

    pencil = [(67, 94), (71, 78), (89, 60), (100, 71), (82, 89)]
    if tiny:
        pencil = [(65, 95), (70, 77), (88, 59), (101, 72), (82, 90)]
    scaled_pencil = scaled_points(pencil, factor)
    draw.polygon(scaled_pencil, fill=ACCENT)
    draw.line(
        [*scaled_pencil, scaled_pencil[0]],
        fill=BASE,
        width=max(1, round((5 if tiny else 4) * factor)),
        joint="curve",
    )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def template_editor_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tiny = size <= 24

    draw_base(draw, factor, tiny)
    draw.rounded_rectangle(
        scaled_rect((30, 23, 98, 105), factor),
        radius=round(7 * factor),
        fill=PAPER,
    )
    draw.rounded_rectangle(
        scaled_rect((38, 32, 90, 96), factor),
        radius=round(3 * factor),
        outline=BASE,
        width=max(1, round((6 if tiny else 5) * factor)),
    )
    blocks = (
        (43, 37, 85, 49),
        (43, 55, 58, 91),
        (64, 55, 85, 70),
        (64, 76, 85, 91),
    )
    if tiny:
        blocks = (
            (43, 38, 85, 51),
            (43, 57, 59, 90),
            (65, 57, 85, 72),
            (65, 78, 85, 90),
        )
    for block in blocks:
        draw.rounded_rectangle(
            scaled_rect(block, factor),
            radius=max(1, round(2 * factor)),
            fill=ACCENT,
        )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def csp_import_helper_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tiny = size <= 24

    draw_base(draw, factor, tiny)
    draw.rounded_rectangle(
        scaled_rect((27, 26, 69, 102), factor),
        radius=round(6 * factor),
        fill=PAPER,
    )
    paper_lines = (((37, 43), (59, 43)), ((37, 58), (55, 58)), ((37, 87), (59, 87)))
    if tiny:
        paper_lines = (((37, 46), (59, 46)), ((37, 86), (59, 86)))
    for start, end in paper_lines:
        draw.line(
            scaled_points([start, end], factor),
            fill=BASE,
            width=max(1, round((7 if tiny else 5) * factor)),
        )

    draw.line(
        scaled_points([(51, 72), (82, 72)], factor),
        fill=ACCENT,
        width=max(1, round((9 if tiny else 8) * factor)),
    )
    draw.line(
        scaled_points([(75, 63), (85, 72), (75, 81)], factor),
        fill=ACCENT,
        width=max(1, round((9 if tiny else 8) * factor)),
        joint="curve",
    )
    layer_lines = (((79, 39), (99, 39)), ((84, 51), (99, 51)), ((89, 91), (99, 91)))
    if tiny:
        layer_lines = (((81, 41), (99, 41)), ((88, 91), (99, 91)))
    for start, end in layer_lines:
        draw.line(
            scaled_points([start, end], factor),
            fill=PAPER,
            width=max(1, round(7 * factor)),
        )

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


def save_preview(path: Path, icon_sets: tuple[tuple[str, dict[int, Image.Image]], ...]) -> None:
    preview = Image.new("RGBA", (40 + len(icon_sets) * 360, 260), "#171b1d")
    draw = ImageDraw.Draw(preview)
    for index, (label, images) in enumerate(icon_sets):
        origin_x = 40 + index * 360
        draw.text((origin_x, 20), label, fill="#d8e5e4")
        preview.alpha_composite(images[128], (origin_x, 52))
        for offset, size in ((0, 48), (68, 32), (120, 16)):
            preview.alpha_composite(images[size], (origin_x + offset, 204 + (48 - size) // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(path)


def main() -> None:
    remap_images = {size: remap_icon(size) for size in SIZES}
    corrector_images = {size: corrector_icon(size) for size in SIZES}
    editor_images = {size: editor_icon(size) for size in SIZES}
    template_editor_images = {size: template_editor_icon(size) for size in SIZES}
    csp_import_helper_images = {size: csp_import_helper_icon(size) for size in SIZES}

    save_ico(ROOT / "apps/desktop/src-tauri/icons/icon.ico", remap_images)
    save_ico(ROOT / "apps/sheet-corrector/src-tauri/icons/icon.ico", corrector_images)
    save_ico(ROOT / "apps/editor/src-tauri/icons/icon.ico", editor_images)
    save_ico(ROOT / "apps/template-editor/src-tauri/icons/icon.ico", template_editor_images)
    save_ico(ROOT / "apps/csp-import-helper/launcher/icons/icon.ico", csp_import_helper_images)
    save_preview(
        ROOT / "design/icon-proposals/xsheet-icon-final-preview.png",
        (
            ("xsheet-remap", remap_images),
            ("xsheet-editor", editor_images),
            ("xsheet-template", template_editor_images),
            ("xsheet-corrector", corrector_images),
            ("xsheet-importer", csp_import_helper_images),
        ),
    )


if __name__ == "__main__":
    main()
