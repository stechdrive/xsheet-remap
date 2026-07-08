from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .manifest import CspImportCut, CspImportManifest, ImportTrack, build_import_plan


STEP_OPEN_CLIP = "open_clip"
STEP_FOCUS_CSP = "focus_csp"
STEP_CHECK_CONTROL = "check_control"
STEP_MOVE_FIRST_TIMELINE = "move_first_timeline"
STEP_PREPARE_XDTS_IMPORT = "prepare_xdts_import"
STEP_IMPORT_SETUP_XDTS = "import_setup_xdts"
STEP_CREATE_TIMELINE = "create_timeline"
STEP_IMPORT_CUT_XDTS = "import_cut_xdts"
STEP_RENAME_TIMELINE = "rename_timeline"
STEP_MARK_IMPORT_END_SELECTED = "mark_import_end_selected"
STEP_MOVE_FIRST_TIMELINE_FOR_ASSETS = "move_first_timeline_for_assets"
STEP_DISABLE_TIMELINE_FOR_ASSETS = "disable_timeline_for_assets"
STEP_IMPORT_TRACK_ASSETS = "import_track_assets"
STEP_ENABLE_TIMELINE = "enable_timeline"
STEP_SAVE_AS_CLIP = "save_as_clip"
STEP_CLOSE_CLIP = "close_clip"


@dataclass(frozen=True)
class TrackImportBatch:
    track: ImportTrack
    items: tuple[dict[str, Any], ...]

    @property
    def track_id(self) -> str:
        return self.track.track_id

    @property
    def label(self) -> str:
        return f"素材登録: {track_display_name(self.track)} ({len(self.items)}件)"


@dataclass(frozen=True)
class ImportExecutionStep:
    kind: str
    label: str
    visible: bool = True
    cut: CspImportCut | None = None
    cut_index: int | None = None
    track: ImportTrack | None = None
    batch: TrackImportBatch | None = None
    path: Path | None = None
    phase: str | None = None

    @property
    def payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if self.path is not None:
            payload["path"] = str(self.path)
        if self.cut is not None:
            payload["cutNumber"] = self.cut.cut_number
            payload["cutId"] = self.cut.cut_id
        if self.track is not None:
            payload["trackId"] = self.track.track_id
        if self.batch is not None:
            payload["trackId"] = self.batch.track_id
            payload["count"] = len(self.batch.items)
        return payload


@dataclass(frozen=True)
class ImportExecutionPlan:
    steps: tuple[ImportExecutionStep, ...]
    track_batches: tuple[TrackImportBatch, ...]

    @property
    def visible_steps(self) -> tuple[ImportExecutionStep, ...]:
        return tuple(step for step in self.steps if step.visible)

    @property
    def progress_labels(self) -> list[str]:
        return [step.label for step in self.visible_steps]

    @property
    def import_count(self) -> int:
        return sum(len(batch.items) for batch in self.track_batches)


def build_import_execution_plan(
    manifest: CspImportManifest,
    *,
    clip_path: str | Path | None = None,
    save_as_path: str | Path | None = None,
    close_after_save: bool = False,
    import_limit: int | None = None,
) -> ImportExecutionPlan:
    track_batches = build_track_import_batches(manifest, import_limit=import_limit)
    steps: list[ImportExecutionStep] = []

    clip = _optional_path(clip_path)
    if clip is not None:
        steps.append(ImportExecutionStep(STEP_OPEN_CLIP, f"クリスタファイルを開く: {clip.name}", path=clip))

    steps.append(ImportExecutionStep(STEP_FOCUS_CSP, "クリスタを前面化"))
    steps.append(ImportExecutionStep(STEP_CHECK_CONTROL, "", visible=False, phase="after focus"))
    steps.append(ImportExecutionStep(STEP_MOVE_FIRST_TIMELINE, "最初のタイムラインへ移動"))
    steps.append(ImportExecutionStep(STEP_CHECK_CONTROL, "", visible=False, phase="before XDTS import"))
    steps.append(ImportExecutionStep(STEP_PREPARE_XDTS_IMPORT, "XDTS読み込み準備"))

    if manifest.setup is not None:
        steps.append(
            ImportExecutionStep(
                STEP_IMPORT_SETUP_XDTS,
                f"セットアップXDTS読み込み: {manifest.setup.xdts_path.name}",
                path=manifest.setup.xdts_path,
            )
        )

    for index, cut in enumerate(manifest.cuts):
        if index > 0:
            steps.append(ImportExecutionStep(STEP_CREATE_TIMELINE, f"新規タイムライン作成: {cut.timeline_name}", cut=cut, cut_index=index))
        steps.append(ImportExecutionStep(STEP_IMPORT_CUT_XDTS, f"XDTS読み込み: {cut.timeline_name}", cut=cut, cut_index=index, path=cut.xdts_path))
        steps.append(ImportExecutionStep(STEP_RENAME_TIMELINE, f"タイムライン名設定: {cut.timeline_name}", cut=cut, cut_index=index))

    steps.append(ImportExecutionStep(STEP_MARK_IMPORT_END_SELECTED, "", visible=False))

    if track_batches:
        steps.append(ImportExecutionStep(STEP_CHECK_CONTROL, "", visible=False, phase="before asset import"))
        steps.append(ImportExecutionStep(STEP_MOVE_FIRST_TIMELINE_FOR_ASSETS, "素材登録用に最初のタイムラインへ移動"))
        steps.append(ImportExecutionStep(STEP_DISABLE_TIMELINE_FOR_ASSETS, "素材登録用にタイムラインを無効化"))
        for batch in track_batches:
            steps.append(ImportExecutionStep(STEP_CHECK_CONTROL, "", visible=False, phase=f"before track {batch.track_id}"))
            steps.append(ImportExecutionStep(STEP_IMPORT_TRACK_ASSETS, batch.label, track=batch.track, batch=batch))
        steps.append(ImportExecutionStep(STEP_ENABLE_TIMELINE, "タイムラインを有効化"))

    save_as = _optional_path(save_as_path)
    if save_as is not None:
        steps.append(ImportExecutionStep(STEP_SAVE_AS_CLIP, f"別名保存: {save_as.name}", path=save_as))
        if close_after_save:
            steps.append(ImportExecutionStep(STEP_CLOSE_CLIP, "CLIPを閉じる"))

    return ImportExecutionPlan(tuple(steps), track_batches)


def build_track_import_batches(
    manifest: CspImportManifest,
    *,
    import_limit: int | None = None,
) -> tuple[TrackImportBatch, ...]:
    plan_items = build_import_plan(manifest)
    if import_limit is not None:
        plan_items = plan_items[:import_limit]

    tracks_by_id = {track.track_id: track for track in manifest.tracks}
    batches: list[TrackImportBatch] = []
    current_track_id: str | None = None
    current_items: list[dict[str, Any]] = []

    for item in plan_items:
        track_id = str(item["trackId"])
        if current_track_id is not None and track_id != current_track_id:
            _append_batch(batches, tracks_by_id, current_track_id, current_items)
            current_items = []
        current_track_id = track_id
        current_items.append(item)

    if current_track_id is not None:
        _append_batch(batches, tracks_by_id, current_track_id, current_items)

    return tuple(batches)


def track_display_name(track: ImportTrack) -> str:
    context = "/".join(part for part in track.target_folder_path if part.strip())
    if not context:
        context = track.stage_label or ""
    if context and context != track.xdts_track_name:
        return f"{context} / {track.xdts_track_name}"
    return track.xdts_track_name


def _append_batch(
    batches: list[TrackImportBatch],
    tracks_by_id: dict[str, ImportTrack],
    track_id: str,
    items: list[dict[str, Any]],
) -> None:
    track = tracks_by_id.get(track_id)
    if track is None or not items:
        return
    batches.append(TrackImportBatch(track, tuple(items)))


def _optional_path(value: str | Path | None) -> Path | None:
    if value is None:
        return None
    path_text = str(value).strip()
    if not path_text:
        return None
    return Path(path_text)
