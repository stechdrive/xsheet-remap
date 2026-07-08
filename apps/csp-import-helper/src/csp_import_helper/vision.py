from __future__ import annotations

import asyncio
from dataclasses import dataclass
import os
from pathlib import Path
import re
import tempfile
import traceback
from typing import Any
import unicodedata


class VisionError(RuntimeError):
    pass


@dataclass(frozen=True)
class OcrLine:
    text: str
    left: int
    top: int
    right: int
    bottom: int

    @property
    def center_y(self) -> int:
        return round((self.top + self.bottom) / 2)


@dataclass(frozen=True)
class ImportStackMarker:
    kind: str
    line: OcrLine


_RAPIDOCR_ENGINE: Any | None = None
_PADDLEOCR_ENGINE: Any | None = None


def normalize_ocr_text(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", value.upper())


def normalize_csp_name_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(char.upper() for char in normalized if char.isalnum())


def csp_layer_row_key(value: str) -> str:
    """Return the comparable layer/folder name part from a CSP layer row.

    CSP animation folder rows are typically rendered as `A : 0` or `BG : 0`.
    OCR spacing varies, so comparison should ignore the timeline count after
    the colon while still keeping short names such as `A` distinct from `A1`.
    """

    head = re.split(r"[:：]", value, maxsplit=1)[0]
    return normalize_csp_name_text(head)


def find_csp_layer_row_lines(lines: list[OcrLine], layer_name: str) -> list[OcrLine]:
    target = normalize_csp_name_text(layer_name)
    if not target:
        return []
    return [line for line in lines if csp_layer_row_key(line.text) == target]


def find_import_stack_marker(lines: list[OcrLine], start_separator: str, end_separator: str) -> ImportStackMarker | None:
    targets = [
        ("start", normalize_ocr_text(start_separator)),
        ("end", normalize_ocr_text(end_separator)),
    ]
    for line in lines:
        normalized_line = normalize_ocr_text(line.text)
        if not normalized_line:
            continue
        exact_matches = [kind for kind, target in targets if target and target in normalized_line]
        if exact_matches:
            return ImportStackMarker(kind=exact_matches[0], line=line)
        if len(normalized_line) < 10:
            continue
        partial_matches = [kind for kind, target in targets if target and normalized_line in target]
        if len(partial_matches) == 1:
            return ImportStackMarker(kind=partial_matches[0], line=line)
    return None


def find_import_stack_anchor(lines: list[OcrLine], start_separator: str, end_separator: str) -> ImportStackMarker | None:
    marker = find_import_stack_marker(lines, start_separator, end_separator)
    if marker is not None:
        return marker
    for line in lines:
        normalized_line = normalize_ocr_text(line.text)
        if normalized_line.startswith("XSHE") and "=" in line.text:
            return ImportStackMarker(kind="fragment", line=line)
    return None


def recognize_image_text_lines(image: Any) -> list[OcrLine]:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        image.save(tmp_path)
        return asyncio.run(_recognize_file_text_lines(tmp_path))
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass


def recognize_csp_ui_text_lines(image: Any, *, scale: int = 4) -> list[OcrLine]:
    paddle_lines = _recognize_image_with_paddleocr(image, scale=scale)
    if paddle_lines:
        return paddle_lines
    rapid_lines = _recognize_image_with_rapidocr(image, scale=scale)
    if rapid_lines:
        return rapid_lines
    try:
        return recognize_image_text_lines(image)
    except VisionError:
        return []


def recognize_csp_layer_palette_text_lines(image: Any) -> list[OcrLine]:
    """Recognize CSP layer-palette text with preprocessing for tiny UI text.

    Windows OCR performs poorly on CSP's small low-contrast layer tree text when
    the palette screenshot is passed directly. Cropping to the row text area and
    upscaling improves marker and track-name recognition enough to use OCR as
    the primary signal while keeping the original-pixel coordinates.
    """

    paddle_lines = _recognize_csp_layer_palette_with_paddleocr(image)
    if paddle_lines:
        return paddle_lines

    rapid_lines = _recognize_csp_layer_palette_with_rapidocr(image)
    if rapid_lines:
        return rapid_lines

    variants: list[tuple[Any, int, int, float]] = [(image, 0, 0, 1.0)]
    width, height = image.size
    crop_left = min(35, max(0, width - 1))
    crop_top = min(70, max(0, height - 1))
    crop_right = max(crop_left + 1, width - 8)
    crop_bottom = height
    crop = image.crop((crop_left, crop_top, crop_right, crop_bottom))
    for scale in (3, 4, 5):
        resized = crop.resize((crop.width * scale, crop.height * scale), _resampling_lanczos())
        variants.append((resized, crop_left, crop_top, float(scale)))
        gray = _image_ops().grayscale(resized).convert("RGB")
        variants.append((gray, crop_left, crop_top, float(scale)))

    all_lines: list[OcrLine] = []
    for variant, offset_x, offset_y, scale in variants:
        try:
            lines = recognize_image_text_lines(variant)
        except VisionError:
            continue
        all_lines.extend(_transform_lines(lines, offset_x, offset_y, scale))
    return _merge_nearby_lines(all_lines)


def _recognize_csp_layer_palette_with_paddleocr(image: Any) -> list[OcrLine]:
    try:
        ocr = _paddleocr_engine()
    except VisionError as exc:
        _write_vision_debug("paddle_layer_init", exc)
        return []

    width, height = image.size
    crop_left = min(35, max(0, width - 1))
    crop_top = min(70, max(0, height - 1))
    crop_right = max(crop_left + 1, width - 8)
    crop = image.crop((crop_left, crop_top, crop_right, height))
    scale = 3
    variant = crop.resize((crop.width * scale, crop.height * scale), _resampling_lanczos())
    try:
        result = _predict_with_paddleocr(ocr, variant)
    except Exception as exc:
        _write_vision_debug("paddle_layer_predict", exc)
        return []
    return _merge_nearby_lines(_paddle_result_to_lines(result, offset_x=crop_left, offset_y=crop_top, scale=float(scale)))


def _recognize_csp_layer_palette_with_rapidocr(image: Any) -> list[OcrLine]:
    try:
        ocr = _rapidocr_engine()
    except VisionError:
        return []

    width, height = image.size
    crop_left = min(35, max(0, width - 1))
    crop_top = min(70, max(0, height - 1))
    crop_right = max(crop_left + 1, width - 8)
    crop = image.crop((crop_left, crop_top, crop_right, height))
    variants: list[tuple[Any, int, int, float]] = [
        (image, 0, 0, 1.0),
        (crop, crop_left, crop_top, 1.0),
    ]
    for scale in (2, 3):
        variants.append(
            (
                crop.resize((crop.width * scale, crop.height * scale), _resampling_lanczos()),
                crop_left,
                crop_top,
                float(scale),
            )
        )

    lines: list[OcrLine] = []
    for variant, offset_x, offset_y, scale in variants:
        try:
            result, _elapsed = ocr(variant)
        except Exception:
            continue
        if not result:
            continue
        for box, text, _confidence in result:
            points = [(round(point[0] / scale) + offset_x, round(point[1] / scale) + offset_y) for point in box]
            if not points:
                continue
            lines.append(
                OcrLine(
                    text=str(text),
                    left=min(point[0] for point in points),
                    top=min(point[1] for point in points),
                    right=max(point[0] for point in points),
                    bottom=max(point[1] for point in points),
                )
            )
    return _merge_nearby_lines(lines)


def _recognize_image_with_paddleocr(image: Any, *, scale: int) -> list[OcrLine]:
    try:
        ocr = _paddleocr_engine()
    except VisionError as exc:
        _write_vision_debug("paddle_ui_init", exc)
        return []
    variant = image.resize((image.width * scale, image.height * scale), _resampling_lanczos())
    try:
        result = _predict_with_paddleocr(ocr, variant)
    except Exception as exc:
        _write_vision_debug("paddle_ui_predict", exc)
        return []
    return _merge_nearby_lines(_paddle_result_to_lines(result, offset_x=0, offset_y=0, scale=float(scale)))


def _recognize_image_with_rapidocr(image: Any, *, scale: int) -> list[OcrLine]:
    try:
        ocr = _rapidocr_engine()
    except VisionError:
        return []
    variant = image.resize((image.width * scale, image.height * scale), _resampling_lanczos())
    try:
        result, _elapsed = ocr(variant)
    except Exception:
        return []
    lines: list[OcrLine] = []
    for box, text, _confidence in result or []:
        points = [(round(point[0] / scale), round(point[1] / scale)) for point in box]
        if not points:
            continue
        lines.append(
            OcrLine(
                text=str(text),
                left=min(point[0] for point in points),
                top=min(point[1] for point in points),
                right=max(point[0] for point in points),
                bottom=max(point[1] for point in points),
            )
        )
    return _merge_nearby_lines(lines)


async def _recognize_file_text_lines(path: Path) -> list[OcrLine]:
    try:
        from winrt.windows.globalization import Language
        from winrt.windows.graphics.imaging import BitmapDecoder
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.storage.streams import FileRandomAccessStream
    except ImportError as exc:
        raise VisionError("Windows OCR runtime is required for CSP layer palette recognition") from exc

    try:
        stream = await FileRandomAccessStream.open_async(str(path), 0)
        decoder = await BitmapDecoder.create_async(stream)
        bitmap = await decoder.get_software_bitmap_async()
        engine = OcrEngine.try_create_from_language(Language("en-US")) or OcrEngine.try_create_from_user_profile_languages()
        if engine is None:
            raise VisionError("Windows OCR engine is not available")
        result = await engine.recognize_async(bitmap)
    except Exception as exc:
        raise VisionError(f"Windows OCR failed: {exc}") from exc

    lines: list[OcrLine] = []
    for line in result.lines:
        boxes: list[tuple[int, int, int, int]] = []
        for word in line.words:
            rect = word.bounding_rect
            left = round(rect.x)
            top = round(rect.y)
            right = round(rect.x + rect.width)
            bottom = round(rect.y + rect.height)
            boxes.append((left, top, right, bottom))
        if not boxes:
            continue
        lines.append(
            OcrLine(
                text=line.text,
                left=min(item[0] for item in boxes),
                top=min(item[1] for item in boxes),
                right=max(item[2] for item in boxes),
                bottom=max(item[3] for item in boxes),
            )
        )
    return lines


def _transform_lines(lines: list[OcrLine], offset_x: int, offset_y: int, scale: float) -> list[OcrLine]:
    transformed: list[OcrLine] = []
    for line in lines:
        transformed.append(
            OcrLine(
                text=line.text,
                left=round(line.left / scale) + offset_x,
                top=round(line.top / scale) + offset_y,
                right=round(line.right / scale) + offset_x,
                bottom=round(line.bottom / scale) + offset_y,
            )
        )
    return transformed


def _merge_nearby_lines(lines: list[OcrLine]) -> list[OcrLine]:
    sorted_lines = sorted(lines, key=lambda line: (line.center_y, line.left, -len(normalize_csp_name_text(line.text))))
    merged: list[OcrLine] = []
    for line in sorted_lines:
        normalized = normalize_csp_name_text(line.text)
        if not normalized:
            continue
        existing_index = next(
            (
                index
                for index, existing in enumerate(merged)
                if abs(existing.center_y - line.center_y) <= 3
                and _horizontally_related(existing, line)
                and _same_text_family(normalize_csp_name_text(existing.text), normalized)
            ),
            None,
        )
        if existing_index is None:
            merged.append(line)
            continue
        existing = merged[existing_index]
        if len(normalized) > len(normalize_csp_name_text(existing.text)):
            merged[existing_index] = line
    return sorted(merged, key=lambda line: (line.top, line.left))


def _same_text_family(left: str, right: str) -> bool:
    if left == right:
        return True
    if len(left) >= 4 and left in right:
        return True
    if len(right) >= 4 and right in left:
        return True
    return False


def _horizontally_related(left: OcrLine, right: OcrLine) -> bool:
    overlap = min(left.right, right.right) - max(left.left, right.left)
    if overlap > 0:
        return True
    left_width = max(1, left.right - left.left)
    right_width = max(1, right.right - right.left)
    center_distance = abs((left.left + left.right) / 2 - (right.left + right.right) / 2)
    return center_distance <= max(30, min(left_width, right_width))


def _resampling_lanczos() -> Any:
    from PIL import Image

    return Image.Resampling.LANCZOS


def _image_ops() -> Any:
    from PIL import ImageOps

    return ImageOps


def _rapidocr_engine() -> Any:
    global _RAPIDOCR_ENGINE
    if _RAPIDOCR_ENGINE is not None:
        return _RAPIDOCR_ENGINE
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as exc:
        raise VisionError("RapidOCR runtime is not available") from exc
    _RAPIDOCR_ENGINE = RapidOCR()
    return _RAPIDOCR_ENGINE


def _paddleocr_engine() -> Any:
    global _PADDLEOCR_ENGINE
    if _PADDLEOCR_ENGINE is not None:
        return _PADDLEOCR_ENGINE
    try:
        # PaddleOCR 3.7.0 + PaddlePaddle 3.3.x can fail on Windows CPU when
        # oneDNN is enabled. The environment variable is the documented
        # runtime workaround and must be set before PaddleOCR creates models.
        os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "0")
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise VisionError("PaddleOCR runtime is not available") from exc
    try:
        _PADDLEOCR_ENGINE = PaddleOCR(
            lang="japan",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    except Exception as exc:
        raise VisionError(f"PaddleOCR initialization failed: {exc}") from exc
    return _PADDLEOCR_ENGINE


def _write_vision_debug(name: str, exc: BaseException) -> None:
    debug_dir = os.environ.get("XSHEET_CSP_OCR_DEBUG_DIR")
    if not debug_dir:
        return
    try:
        output_dir = Path(debug_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        debug_path = output_dir / "vision-errors.log"
        with debug_path.open("a", encoding="utf-8") as handle:
            handle.write(f"{name}: {type(exc).__name__}: {exc}\n")
            handle.write("".join(traceback.format_exception(exc)))
    except Exception:
        return


def _predict_with_paddleocr(ocr: Any, image: Any) -> Any:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        image.save(tmp_path)
        if hasattr(ocr, "predict"):
            return ocr.predict(str(tmp_path))
        return ocr.ocr(str(tmp_path))
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass


def _paddle_result_to_lines(result: Any, *, offset_x: int, offset_y: int, scale: float) -> list[OcrLine]:
    lines: list[OcrLine] = []
    pages = result if isinstance(result, list) else [result]
    for page in pages:
        page_dict = dict(page) if isinstance(page, dict) else page
        texts = _paddle_field(page_dict, "rec_texts") or []
        scores = _paddle_field(page_dict, "rec_scores") or []
        boxes = _paddle_field(page_dict, "rec_boxes")
        polys = _paddle_field(page_dict, "rec_polys") or _paddle_field(page_dict, "dt_polys") or []
        for index, text in enumerate(texts):
            score = float(scores[index]) if index < len(scores) else 1.0
            if score < 0.25:
                continue
            rect = None
            if boxes is not None and index < len(boxes):
                rect = _paddle_box_to_rect(boxes[index])
            if rect is None and index < len(polys):
                rect = _paddle_poly_to_rect(polys[index])
            if rect is None:
                continue
            left, top, right, bottom = rect
            lines.append(
                OcrLine(
                    text=str(text),
                    left=round(left / scale) + offset_x,
                    top=round(top / scale) + offset_y,
                    right=round(right / scale) + offset_x,
                    bottom=round(bottom / scale) + offset_y,
                )
            )
    return lines


def _paddle_field(page: Any, key: str) -> Any:
    if isinstance(page, dict):
        return page.get(key)
    try:
        return page[key]
    except Exception:
        return getattr(page, key, None)


def _paddle_box_to_rect(box: Any) -> tuple[float, float, float, float] | None:
    try:
        values = [float(item) for item in box]
    except Exception:
        return None
    if len(values) < 4:
        return None
    return values[0], values[1], values[2], values[3]


def _paddle_poly_to_rect(poly: Any) -> tuple[float, float, float, float] | None:
    points: list[tuple[float, float]] = []
    try:
        for point in poly:
            points.append((float(point[0]), float(point[1])))
    except Exception:
        return None
    if not points:
        return None
    return (
        min(point[0] for point in points),
        min(point[1] for point in points),
        max(point[0] for point in points),
        max(point[1] for point in points),
    )
