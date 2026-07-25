from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SIZES = (16, 24, 32, 48, 64, 128, 256)
SCALE = 4
COMPACT_MAX_SIZE = 32

BASE = "#214854"
RIM = "#7fb8c7"
PAPER = "#f2f7f1"
REMAP_ACCENT = "#66d2af"
EDITOR_ACCENT = "#f2bd5c"
TEMPLATE_ACCENT = "#a98ce8"
CORRECTOR_ACCENT = "#f0806b"
IMPORTER_ACCENT = "#59bde8"


def scaled_rect(values: tuple[float, float, float, float], factor: float) -> tuple[int, int, int, int]:
    return tuple(round(value * factor) for value in values)


def scaled_points(points: list[tuple[float, float]], factor: float) -> list[tuple[int, int]]:
    return [(round(x * factor), round(y * factor)) for x, y in points]


def draw_base(draw: ImageDraw.ImageDraw, factor: float, compact: bool) -> None:
    if compact:
        draw.rounded_rectangle(scaled_rect((4, 4, 124, 124), factor), radius=round(27 * factor), fill=BASE)
        return

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
    compact = size <= COMPACT_MAX_SIZE

    draw_base(draw, factor, compact)
    if compact:
        for column in ((20, 20, 49, 108), (79, 20, 108, 108)):
            draw.rounded_rectangle(
                scaled_rect(column, factor),
                radius=round(7 * factor),
                fill=PAPER,
            )
        mapping_arrow = [
            (25, 64),
            (42, 47),
            (42, 55),
            (86, 55),
            (86, 47),
            (103, 64),
            (86, 81),
            (86, 73),
            (42, 73),
            (42, 81),
        ]
        draw.polygon(scaled_points(mapping_arrow, factor), fill=REMAP_ACCENT)
    else:
        draw.rounded_rectangle(scaled_rect((42, 24, 86, 104), factor), radius=round(7 * factor), fill=PAPER)
        draw.rounded_rectangle(
            scaled_rect((65, 32, 78, 96), factor),
            radius=round(4 * factor),
            fill=REMAP_ACCENT,
        )
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
    compact = size <= COMPACT_MAX_SIZE

    draw_base(draw, factor, compact)
    if compact:
        paper = [(29, 25), (103, 36), (94, 105), (20, 92)]
        handle_radius = 9
        outline_width = 7
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
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=CORRECTOR_ACCENT)

    return image.resize((size, size), Image.Resampling.LANCZOS)


def editor_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    compact = size <= COMPACT_MAX_SIZE

    draw_base(draw, factor, compact)
    if compact:
        pencil = [(24, 101), (34, 68), (83, 19), (110, 46), (61, 95)]
        draw.polygon(scaled_points(pencil, factor), fill=EDITOR_ACCENT)
        draw.polygon(
            scaled_points([(24, 101), (34, 68), (61, 95)], factor),
            fill=PAPER,
        )
        draw.polygon(
            scaled_points([(24, 101), (31, 78), (47, 94)], factor),
            fill=BASE,
        )
        draw.line(
            scaled_points([(83, 19), (110, 46)], factor),
            fill=PAPER,
            width=max(1, round(7 * factor)),
        )
    else:
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
        for start, end in grid_lines:
            draw.line(
                scaled_points([start, end], factor),
                fill=BASE,
                width=max(1, round(5 * factor)),
            )

        pencil = [(67, 94), (71, 78), (89, 60), (100, 71), (82, 89)]
        scaled_pencil = scaled_points(pencil, factor)
        draw.polygon(scaled_pencil, fill=EDITOR_ACCENT)
        draw.line(
            [*scaled_pencil, scaled_pencil[0]],
            fill=BASE,
            width=max(1, round(4 * factor)),
            joint="curve",
        )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def template_editor_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    compact = size <= COMPACT_MAX_SIZE

    draw_base(draw, factor, compact)
    if compact:
        blocks = (
            ((20, 20, 108, 49), TEMPLATE_ACCENT),
            ((20, 57, 51, 108), PAPER),
            ((59, 57, 108, 79), TEMPLATE_ACCENT),
            ((59, 87, 108, 108), PAPER),
        )
        for block, color in blocks:
            draw.rounded_rectangle(
                scaled_rect(block, factor),
                radius=max(1, round(5 * factor)),
                fill=color,
            )
    else:
        draw.rounded_rectangle(
            scaled_rect((30, 23, 98, 105), factor),
            radius=round(7 * factor),
            fill=PAPER,
        )
        draw.rounded_rectangle(
            scaled_rect((38, 32, 90, 96), factor),
            radius=round(3 * factor),
            outline=BASE,
            width=max(1, round(5 * factor)),
        )
        blocks = (
            (43, 37, 85, 49),
            (43, 55, 58, 91),
            (64, 55, 85, 70),
            (64, 76, 85, 91),
        )
        for block in blocks:
            draw.rounded_rectangle(
                scaled_rect(block, factor),
                radius=max(1, round(2 * factor)),
                fill=TEMPLATE_ACCENT,
            )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def csp_import_helper_icon(size: int) -> Image.Image:
    canvas = size * SCALE
    factor = canvas / 128
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    compact = size <= COMPACT_MAX_SIZE

    draw_base(draw, factor, compact)
    if compact:
        arrow = [
            (53, 19),
            (75, 19),
            (75, 64),
            (92, 64),
            (64, 93),
            (36, 64),
            (53, 64),
        ]
        draw.polygon(scaled_points(arrow, factor), fill=IMPORTER_ACCENT)
        draw.line(
            scaled_points([(24, 78), (24, 105), (104, 105), (104, 78)], factor),
            fill=PAPER,
            width=max(1, round(10 * factor)),
            joint="curve",
        )
    else:
        draw.rounded_rectangle(
            scaled_rect((27, 26, 69, 102), factor),
            radius=round(6 * factor),
            fill=PAPER,
        )
        paper_lines = (((37, 43), (59, 43)), ((37, 58), (55, 58)), ((37, 87), (59, 87)))
        for start, end in paper_lines:
            draw.line(
                scaled_points([start, end], factor),
                fill=BASE,
                width=max(1, round(5 * factor)),
            )

        draw.line(
            scaled_points([(51, 72), (82, 72)], factor),
            fill=IMPORTER_ACCENT,
            width=max(1, round(8 * factor)),
        )
        draw.line(
            scaled_points([(75, 63), (85, 72), (75, 81)], factor),
            fill=IMPORTER_ACCENT,
            width=max(1, round(8 * factor)),
            joint="curve",
        )
        layer_lines = (((79, 39), (99, 39)), ((84, 51), (99, 51)), ((89, 91), (99, 91)))
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


def validate_icon_sets(icon_sets: tuple[tuple[str, dict[int, Image.Image]], ...]) -> None:
    for label, images in icon_sets:
        if tuple(images) != SIZES:
            raise ValueError(f"{label} sizes do not match the ICO contract: {tuple(images)}")
        for size, image in images.items():
            if image.mode != "RGBA" or image.size != (size, size):
                raise ValueError(f"{label} has an invalid {size}px image: {image.mode} {image.size}")

    for size in SIZES:
        rendered = [png_bytes(images[size]) for _, images in icon_sets]
        if len(set(rendered)) != len(rendered):
            raise ValueError(f"Two app icons are identical at {size}px")


def save_preview(path: Path, icon_sets: tuple[tuple[str, dict[int, Image.Image]], ...]) -> None:
    preview = Image.new("RGBA", (40 + len(icon_sets) * 360, 284), "#171b1d")
    draw = ImageDraw.Draw(preview)
    for index, (label, images) in enumerate(icon_sets):
        origin_x = 40 + index * 360
        draw.text((origin_x, 20), label, fill="#d8e5e4")
        preview.alpha_composite(images[128], (origin_x, 52))
        for offset, size in ((0, 48), (68, 32), (120, 24), (172, 16)):
            slot_x = origin_x + offset
            draw.rounded_rectangle(
                (slot_x, 204, slot_x + 48, 252),
                radius=8,
                fill="#252b2e",
            )
            preview.alpha_composite(
                images[size],
                (slot_x + (48 - size) // 2, 204 + (48 - size) // 2),
            )
            draw.text((slot_x + 16, 260), str(size), fill="#8fa2a4")
    path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(path)


def main() -> None:
    remap_images = {size: remap_icon(size) for size in SIZES}
    corrector_images = {size: corrector_icon(size) for size in SIZES}
    editor_images = {size: editor_icon(size) for size in SIZES}
    template_editor_images = {size: template_editor_icon(size) for size in SIZES}
    csp_import_helper_images = {size: csp_import_helper_icon(size) for size in SIZES}
    icon_sets = (
        ("xsheet-remap", remap_images),
        ("xsheet-editor", editor_images),
        ("xsheet-template", template_editor_images),
        ("xsheet-corrector", corrector_images),
        ("xsheet-importer", csp_import_helper_images),
    )
    validate_icon_sets(icon_sets)

    save_ico(ROOT / "apps/desktop/src-tauri/icons/icon.ico", remap_images)
    save_ico(ROOT / "apps/sheet-corrector/src-tauri/icons/icon.ico", corrector_images)
    save_ico(ROOT / "apps/editor/src-tauri/icons/icon.ico", editor_images)
    save_ico(ROOT / "apps/template-editor/src-tauri/icons/icon.ico", template_editor_images)
    save_ico(ROOT / "apps/csp-import-helper/launcher/icons/icon.ico", csp_import_helper_images)
    save_preview(
        ROOT / "design/icon-proposals/xsheet-icon-final-preview.png",
        icon_sets,
    )


if __name__ == "__main__":
    main()
