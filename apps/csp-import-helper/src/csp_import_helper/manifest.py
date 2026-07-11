from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
import json
import re
from typing import Any


class ManifestError(ValueError):
    pass


SUPPORTED_TRACK_KINDS = {
    "cell",
    "stack-guide",
    "camera-note",
    "memo",
    "separator",
}


@dataclass(frozen=True)
class CelBinding:
    csp_cell_name: str
    asset_path: Path
    first_frame: int | None


@dataclass(frozen=True)
class ImportTrack:
    track_id: str
    kind: str
    xdts_track_name: str
    stack_order: int
    stage_id: str | None
    stage_label: str | None
    target_folder_path: tuple[str, ...]
    cels: tuple[CelBinding, ...]
    visible_row_index: int | None = None

    @property
    def imports_assets(self) -> bool:
        return self.kind != "separator" and len(self.cels) > 0


@dataclass(frozen=True)
class ImportStack:
    enabled: bool
    start_separator: str
    end_separator: str


@dataclass(frozen=True)
class CspImportSetup:
    xdts_path: Path
    purpose: str


@dataclass(frozen=True)
class CspImportCut:
    cut_id: str
    order: int
    scene: str | None
    cut_number: str
    display_name: str
    timeline_name: str
    duration_frames: int
    fps: int
    xdts_path: Path
    operation_log_path: Path
    import_stack: ImportStack
    tracks: tuple[ImportTrack, ...]

    @property
    def importable_tracks(self) -> tuple[ImportTrack, ...]:
        return tuple(track for track in self.tracks if track.imports_assets)


@dataclass(frozen=True)
class CspImportManifest:
    path: Path
    schema_version: int
    asset_root: Path
    output_clip_file_name: str | None
    operation_log_path: Path
    setup: CspImportSetup | None
    cuts: tuple[CspImportCut, ...]

    @property
    def primary_cut(self) -> CspImportCut:
        if not self.cuts:
            raise ManifestError("manifest cuts must not be empty")
        return self.cuts[0]

    @property
    def xdts_path(self) -> Path:
        return self.primary_cut.xdts_path

    @property
    def stack_reference_xdts_path(self) -> Path:
        return self.setup.xdts_path if self.setup else self.primary_cut.xdts_path

    @property
    def assets_root(self) -> Path:
        return self.asset_root

    @property
    def import_stack(self) -> ImportStack:
        return self.primary_cut.import_stack

    @property
    def tracks(self) -> tuple[ImportTrack, ...]:
        return _merge_import_tracks(self.cuts, strict=False)

    @property
    def importable_tracks(self) -> tuple[ImportTrack, ...]:
        return tuple(track for track in self.tracks if track.imports_assets)


def load_manifest(path: str | Path) -> CspImportManifest:
    manifest_path = Path(path).expanduser().resolve()
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise ManifestError(f"manifest not found: {manifest_path}") from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(f"manifest is not valid JSON: {manifest_path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ManifestError("manifest root must be an object")

    schema_version = _required_int(raw, "schemaVersion")
    if schema_version != 3:
        raise ManifestError(f"unsupported schemaVersion: {schema_version}")

    base_dir = manifest_path.parent
    asset_root = _resolve_path(base_dir, _required_str(raw, "assetRoot"))
    cuts_raw = raw.get("cuts")
    if not isinstance(cuts_raw, list) or not cuts_raw:
        raise ManifestError("cuts must be a non-empty array")

    cuts = tuple(sorted(
        (_parse_cut(item, base_dir, asset_root, index) for index, item in enumerate(cuts_raw)),
        key=lambda cut: (cut.order, cut.cut_id),
    ))
    _validate_unique_cut_identities(cuts)
    setup = _parse_setup(raw.get("setup"), base_dir)

    return CspImportManifest(
        path=manifest_path,
        schema_version=schema_version,
        asset_root=asset_root,
        output_clip_file_name=_optional_nullable_str(raw, "outputClipFileName"),
        operation_log_path=base_dir / "csp-import-job-log.json",
        setup=setup,
        cuts=cuts,
    )


def validate_manifest_files(manifest: CspImportManifest) -> list[str]:
    errors: list[str] = []
    if not manifest.assets_root.exists():
        errors.append(f"assetRoot not found: {manifest.assets_root}")
    if manifest.setup and not manifest.setup.xdts_path.is_file():
        errors.append(f"setup XDTS not found: {manifest.setup.xdts_path}")
    for cut in manifest.cuts:
        if not cut.xdts_path.is_file():
            errors.append(f"XDTS not found for {cut.cut_number}: {cut.xdts_path}")
        for track in cut.importable_tracks:
            for cel in track.cels:
                if not cel.asset_path.is_file():
                    errors.append(f"asset not found for {cut.cut_number}/{track.track_id}/{cel.csp_cell_name}: {cel.asset_path}")
                elif cel.asset_path.stem != cel.csp_cell_name:
                    errors.append(
                        "manifest asset file stem must match cspCellName "
                        f"for {cut.cut_number}/{track.track_id}/{cel.csp_cell_name}: {cel.asset_path.name}"
                    )
    errors.extend(_asset_conflict_errors(manifest.cuts))
    return errors


def build_import_plan(manifest: CspImportManifest) -> list[dict[str, Any]]:
    plan: list[dict[str, Any]] = []
    for track in sorted(_merge_import_tracks(manifest.cuts, strict=True), key=lambda item: (item.stack_order, item.track_id)):
        if not track.imports_assets:
            continue
        for cel in track.cels:
            plan.append(
                {
                    "trackId": track.track_id,
                    "kind": track.kind,
                    "xdtsTrackName": track.xdts_track_name,
                    "stackOrder": track.stack_order,
                    "stageId": track.stage_id,
                    "stageLabel": track.stage_label,
                    "targetFolderPath": list(track.target_folder_path),
                    "cspCellName": cel.csp_cell_name,
                    "assetPath": str(cel.asset_path),
                    "firstFrame": cel.first_frame,
                }
            )
    return plan


def _parse_cut(raw: Any, base_dir: Path, asset_root: Path, index: int) -> CspImportCut:
    if not isinstance(raw, dict):
        raise ManifestError(f"cuts[{index}] must be an object")

    files = _required_object(raw, "files")
    cut_number = _required_str(raw, "cutNumber")
    xdts_path = _resolve_path(base_dir, _required_str(files, "xdts"))
    operation_log = _resolve_path(base_dir, _optional_str(files, "operationLog", f"{cut_number}-csp-import-log.json"))

    import_stack_raw = _optional_object(raw, "importStack")
    import_stack = ImportStack(
        enabled=bool(import_stack_raw.get("enabled", True)),
        start_separator=str(import_stack_raw.get("startSeparator", "===== XSHEET IMPORT START =====")),
        end_separator=str(import_stack_raw.get("endSeparator", "===== XSHEET IMPORT END =====")),
    )

    tracks_raw = raw.get("tracks")
    if not isinstance(tracks_raw, list):
        raise ManifestError(f"cuts[{index}].tracks must be an array")
    tracks = tuple(_parse_track(item, asset_root, index, track_index) for track_index, item in enumerate(tracks_raw))

    return CspImportCut(
        cut_id=_required_str(raw, "cutId"),
        order=_required_int(raw, "order"),
        scene=_optional_nullable_str(raw, "scene"),
        cut_number=cut_number,
        display_name=_optional_str(raw, "displayName", cut_number),
        timeline_name=_required_str(raw, "timelineName"),
        duration_frames=_required_int(raw, "durationFrames"),
        fps=_required_int(raw, "fps"),
        xdts_path=xdts_path,
        operation_log_path=operation_log,
        import_stack=import_stack,
        tracks=tracks,
    )


def _validate_unique_cut_identities(cuts: tuple[CspImportCut, ...]) -> None:
    cut_ids: set[str] = set()
    timeline_names: set[str] = set()
    for cut in cuts:
        cut_id = cut.cut_id.casefold()
        if cut_id in cut_ids:
            raise ManifestError(f"duplicate cutId: {cut.cut_id}")
        cut_ids.add(cut_id)
        timeline_name = cut.timeline_name.casefold()
        if timeline_name in timeline_names:
            raise ManifestError(f"duplicate timelineName: {cut.timeline_name}")
        timeline_names.add(timeline_name)


def _parse_setup(raw: Any, base_dir: Path) -> CspImportSetup | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ManifestError("setup must be an object")
    return CspImportSetup(
        xdts_path=_resolve_path(base_dir, _required_str(raw, "xdts")),
        purpose=_required_str(raw, "purpose"),
    )


def _parse_track(raw: Any, assets_root: Path, cut_index: int, index: int) -> ImportTrack:
    if not isinstance(raw, dict):
        raise ManifestError(f"cuts[{cut_index}].tracks[{index}] must be an object")

    kind = _required_str(raw, "kind")
    if kind not in SUPPORTED_TRACK_KINDS:
        raise ManifestError(f"cuts[{cut_index}].tracks[{index}].kind is unsupported: {kind}")

    cels_raw = raw.get("cels", [])
    if cels_raw is None:
        cels_raw = []
    if not isinstance(cels_raw, list):
        raise ManifestError(f"cuts[{cut_index}].tracks[{index}].cels must be an array")

    cels = tuple(_parse_cel(item, assets_root, cut_index, index, cel_index) for cel_index, item in enumerate(cels_raw))

    target_path_raw = raw.get("targetFolderPath", [])
    if not isinstance(target_path_raw, list) or not all(isinstance(item, str) for item in target_path_raw):
        raise ManifestError(f"cuts[{cut_index}].tracks[{index}].targetFolderPath must be a string array")

    return ImportTrack(
        track_id=_required_str(raw, "trackId"),
        kind=kind,
        xdts_track_name=_required_str(raw, "xdtsTrackName"),
        stack_order=int(raw.get("stackOrder", index)),
        stage_id=_optional_nullable_str(raw, "stageId"),
        stage_label=_optional_nullable_str(raw, "stageLabel"),
        target_folder_path=tuple(target_path_raw),
        cels=cels,
        visible_row_index=_parse_visible_row_index(raw, cut_index, index),
    )


def _parse_visible_row_index(raw: dict[str, Any], cut_index: int, index: int) -> int | None:
    hints = raw.get("automationHints")
    if hints is None:
        return None
    if not isinstance(hints, dict):
        raise ManifestError(f"cuts[{cut_index}].tracks[{index}].automationHints must be an object")
    value = hints.get("visibleRowIndex")
    if value is None:
        return None
    if not isinstance(value, int) or value < 0:
        raise ManifestError(f"cuts[{cut_index}].tracks[{index}].automationHints.visibleRowIndex must be a non-negative integer")
    return value


def _parse_cel(raw: Any, assets_root: Path, cut_index: int, track_index: int, cel_index: int) -> CelBinding:
    if not isinstance(raw, dict):
        raise ManifestError(f"cuts[{cut_index}].tracks[{track_index}].cels[{cel_index}] must be an object")
    asset_path = _resolve_path(assets_root, _required_str(raw, "assetPath"))
    first_frame = raw.get("firstFrame")
    if first_frame is not None and not isinstance(first_frame, int):
        raise ManifestError(f"cuts[{cut_index}].tracks[{track_index}].cels[{cel_index}].firstFrame must be an integer")
    return CelBinding(
        csp_cell_name=_required_str(raw, "cspCellName"),
        asset_path=asset_path,
        first_frame=first_frame,
    )


def _merge_import_tracks(cuts: tuple[CspImportCut, ...], *, strict: bool) -> tuple[ImportTrack, ...]:
    merged: dict[str, ImportTrack] = {}
    cel_paths_by_key: dict[tuple[str, str], Path] = {}

    for cut in cuts:
        for track in cut.importable_tracks:
            existing = merged.get(track.track_id)
            cels = list(existing.cels if existing else ())
            cel_names = {cel.csp_cell_name for cel in cels}
            for cel in track.cels:
                key = (track.track_id, cel.csp_cell_name)
                previous_path = cel_paths_by_key.get(key)
                if previous_path is not None and previous_path != cel.asset_path:
                    if strict:
                        raise ManifestError(
                            "same track/cspCellName points to multiple assets: "
                            f"{track.track_id}/{cel.csp_cell_name}: {previous_path} / {cel.asset_path}"
                        )
                    continue
                cel_paths_by_key[key] = cel.asset_path
                if cel.csp_cell_name not in cel_names:
                    cels.append(cel)
                    cel_names.add(cel.csp_cell_name)

            if existing is None:
                merged[track.track_id] = replace(track, cels=tuple(cels))
                continue
            merged[track.track_id] = replace(existing, cels=tuple(cels), stack_order=min(existing.stack_order, track.stack_order))

    return tuple(merged.values())


def _asset_conflict_errors(cuts: tuple[CspImportCut, ...]) -> list[str]:
    errors: list[str] = []
    paths_by_key: dict[tuple[str, str], Path] = {}
    for cut in cuts:
        for track in cut.importable_tracks:
            for cel in track.cels:
                key = (track.track_id, cel.csp_cell_name)
                previous_path = paths_by_key.get(key)
                if previous_path is not None and previous_path != cel.asset_path:
                    errors.append(
                        "same track/cspCellName points to multiple assets "
                        f"for {track.track_id}/{cel.csp_cell_name}: {previous_path} / {cel.asset_path}"
                    )
                paths_by_key[key] = cel.asset_path
    return errors


def _resolve_path(base_dir: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (base_dir / path).resolve()


def _required_object(raw: dict[str, Any], key: str) -> dict[str, Any]:
    value = raw.get(key)
    if not isinstance(value, dict):
        raise ManifestError(f"{key} must be an object")
    return value


def _optional_object(raw: dict[str, Any], key: str) -> dict[str, Any]:
    value = raw.get(key, {})
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ManifestError(f"{key} must be an object")
    return value


def _required_str(raw: dict[str, Any], key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or value == "":
        raise ManifestError(f"{key} must be a non-empty string")
    return value


def _optional_str(raw: dict[str, Any], key: str, default: str) -> str:
    value = raw.get(key, default)
    if not isinstance(value, str) or value == "":
        raise ManifestError(f"{key} must be a non-empty string")
    return value


def _optional_nullable_str(raw: dict[str, Any], key: str) -> str | None:
    value = raw.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ManifestError(f"{key} must be a string")
    return value


def _required_int(raw: dict[str, Any], key: str) -> int:
    value = raw.get(key)
    if not isinstance(value, int):
        raise ManifestError(f"{key} must be an integer")
    return value


def _natural_key(value: str) -> tuple[Any, ...]:
    parts = re.split(r"(\d+)", value.casefold())
    return tuple(int(part) if part.isdigit() else part for part in parts)
