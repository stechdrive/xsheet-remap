from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import json
from pathlib import Path
import re
import sys
from typing import Any


@dataclass
class PsdNode:
    name: str
    path: tuple[str, ...]
    is_group: bool
    visible: bool
    children: list["PsdNode"] = field(default_factory=list)

    def walk(self) -> list["PsdNode"]:
        result = [self]
        for child in self.children:
            result.extend(child.walk())
        return result


@dataclass
class ExpectedTrack:
    section: str
    track: str
    cels: set[str] = field(default_factory=set)


@dataclass
class ExpectedPsdImport:
    start_separator: str
    end_separator: str
    stack_names: list[str]
    tracks: dict[tuple[str, str], ExpectedTrack]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect CSP PSD export against a csp-import.xci manifest.")
    parser.add_argument("--psd", required=True, help="PSD path exported from CSP")
    parser.add_argument("--manifest", required=True, help="csp-import.xci path")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--dump-tree", action="store_true", help="Include the PSD layer tree in JSON output")
    parser.add_argument("--allow-nested-import-stack", action="store_true")
    args = parser.parse_args(argv)

    try:
        root = load_psd_tree(Path(args.psd))
        expected = load_expected_import(Path(args.manifest))
        report = inspect_psd_import(
            root,
            expected,
            allow_nested_import_stack=args.allow_nested_import_stack,
            include_tree=args.dump_tree,
        )
    except Exception as exc:
        report = {"ok": False, "errors": [str(exc)], "warnings": [], "summary": {}}

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text_report(report)
    return 0 if report.get("ok") else 1


def load_psd_tree(psd_path: Path) -> PsdNode:
    try:
        from psd_tools import PSDImage
    except ImportError as exc:
        raise RuntimeError("psd-tools is required. Run tools/csp-import-helper/export-psd-diagnostic.ps1.") from exc

    if not psd_path.is_file():
        raise FileNotFoundError(f"PSD not found: {psd_path}")
    psd = PSDImage.open(psd_path)
    return PsdNode("__ROOT__", (), True, True, [_layer_to_node(layer, ()) for layer in psd])


def _layer_to_node(layer: Any, parent_path: tuple[str, ...]) -> PsdNode:
    name = str(getattr(layer, "name", "") or "")
    path = (*parent_path, name)
    is_group = bool(layer.is_group()) if hasattr(layer, "is_group") else False
    visible = bool(getattr(layer, "visible", True))
    children = [_layer_to_node(child, path) for child in layer] if is_group else []
    return PsdNode(name, path, is_group, visible, children)


def load_expected_import(manifest_path: Path) -> ExpectedPsdImport:
    manifest_path = manifest_path.expanduser().resolve()
    raw = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    base_dir = manifest_path.parent
    asset_root = (base_dir / str(raw.get("assetRoot", ".."))).resolve()
    setup = raw.get("setup") if isinstance(raw.get("setup"), dict) else None
    cuts = raw.get("cuts")
    if not isinstance(cuts, list) or not cuts:
        raise ValueError("manifest cuts must be a non-empty array")
    first_cut = cuts[0]
    if setup:
        stack_xdts_path = (base_dir / str(setup.get("xdts", ""))).resolve()
    else:
        stack_xdts_path = (base_dir / str(first_cut.get("files", {}).get("xdts", ""))).resolve()
    stack_names = load_xdts_track_names(stack_xdts_path)

    first_import_stack = first_cut.get("importStack", {}) if isinstance(first_cut, dict) else {}
    start_separator = str(first_import_stack.get("startSeparator", "===== XSHEET IMPORT START ====="))
    end_separator = str(first_import_stack.get("endSeparator", "===== XSHEET IMPORT END ====="))
    tracks: dict[tuple[str, str], ExpectedTrack] = {}

    for cut in cuts:
        cut_tracks = cut.get("tracks", []) if isinstance(cut, dict) else []
        if not isinstance(cut_tracks, list):
            continue
        for track in cut_tracks:
            if not isinstance(track, dict):
                continue
            cels = track.get("cels", [])
            if not isinstance(cels, list) or not cels:
                continue
            section = expected_section_name(track)
            track_name = str(track.get("xdtsTrackName", "")).strip()
            if not section or not track_name:
                continue
            expected_track = tracks.setdefault((section_key(section), name_key(track_name)), ExpectedTrack(section, track_name))
            for cel in cels:
                if not isinstance(cel, dict):
                    continue
                cel_name = str(cel.get("cspCellName", "")).strip()
                material = cel.get("material")
                asset_path = str(material.get("path", "")).strip() if isinstance(material, dict) else ""
                if cel_name:
                    expected_track.cels.add(cel_name)
                elif asset_path:
                    expected_track.cels.add(Path(asset_root / asset_path).stem)

    return ExpectedPsdImport(start_separator, end_separator, stack_names, tracks)


def expected_section_name(track: dict[str, Any]) -> str:
    target_folder_path = track.get("targetFolderPath", [])
    if isinstance(target_folder_path, list):
        for part in reversed(target_folder_path):
            if isinstance(part, str) and part.strip():
                return part.strip()
    stage_label = track.get("stageLabel")
    if isinstance(stage_label, str) and stage_label.strip():
        return stage_label.strip()
    return ""


def load_xdts_track_names(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8-sig")
    json_start = text.find("{")
    if json_start < 0:
        raise ValueError(f"XDTS JSON payload not found: {path}")
    raw = json.loads(text[json_start:])
    for table in raw.get("timeTables", []):
        for header in table.get("timeTableHeaders", []):
            names = header.get("names")
            if isinstance(names, list):
                return [str(name) for name in names]
    return []


def inspect_psd_import(
    root: PsdNode,
    expected: ExpectedPsdImport,
    *,
    allow_nested_import_stack: bool,
    include_tree: bool,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    stack = find_import_stack(root, expected.start_separator, expected.end_separator)
    if stack is None:
        return {
            "ok": False,
            "errors": [f"IMPORT stack range was not found: {expected.start_separator} / {expected.end_separator}"],
            "warnings": warnings,
            "summary": {},
            **({"tree": node_to_json(root)} if include_tree else {}),
        }

    parent, start_index, end_index, sequence = stack
    if parent.path and not allow_nested_import_stack:
        errors.append(f"IMPORT stack is not top-level: {'/'.join(parent.path)}")

    section_tracks = parse_import_sections(sequence, expected)
    found_cels = 0
    missing_cels = 0

    for expected_track in expected.tracks.values():
        section = section_tracks.get(section_key(expected_track.section))
        if section is None:
            errors.append(f"missing process section: {expected_track.section}")
            missing_cels += len(expected_track.cels)
            continue
        track_nodes = section.get(name_key(expected_track.track), [])
        if not track_nodes:
            errors.append(f"missing animation folder: {expected_track.section}/{expected_track.track}")
            missing_cels += len(expected_track.cels)
            continue
        for cel in sorted(expected_track.cels):
            if any(descendant_name_matches(node, cel) for node in track_nodes):
                found_cels += 1
                continue
            misplaced = find_cel_in_sections(section_tracks, cel)
            if misplaced:
                errors.append(
                    f"misplaced cel: {expected_track.section}/{expected_track.track}/{cel} "
                    f"found at {', '.join(misplaced[:4])}"
                )
            else:
                errors.append(f"missing cel: {expected_track.section}/{expected_track.track}/{cel}")
            missing_cels += 1

    summary = {
        "importStackParent": "/".join(parent.path) if parent.path else "<top-level>",
        "startIndex": start_index,
        "endIndex": end_index,
        "expectedTracks": len(expected.tracks),
        "expectedCels": sum(len(track.cels) for track in expected.tracks.values()),
        "foundCels": found_cels,
        "missingCels": missing_cels,
        "sections": sorted(track.section for track in expected.tracks.values()),
    }
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "summary": summary,
        **({"tree": node_to_json(root)} if include_tree else {}),
    }


def find_import_stack(
    root: PsdNode,
    start_separator: str,
    end_separator: str,
) -> tuple[PsdNode, int, int, list[PsdNode]] | None:
    for parent in root.walk():
        if not parent.children:
            continue
        start_indices = [index for index, child in enumerate(parent.children) if name_matches(child.name, start_separator)]
        end_indices = [index for index, child in enumerate(parent.children) if name_matches(child.name, end_separator)]
        for start_index in start_indices:
            for end_index in end_indices:
                if start_index == end_index:
                    continue
                step = 1 if end_index > start_index else -1
                sequence = parent.children[start_index + step:end_index:step]
                return parent, start_index, end_index, sequence
    return None


def parse_import_sections(
    sequence: list[PsdNode],
    expected: ExpectedPsdImport,
) -> dict[str, dict[str, list[PsdNode]]]:
    expected_sections = {section_key(track.section) for track in expected.tracks.values()}
    sections: dict[str, dict[str, list[PsdNode]]] = {}
    current_section: str | None = None
    for node in sequence:
        label = separator_label(node.name)
        label_key = section_key(label)
        if looks_like_separator(node.name) or label_key in expected_sections:
            current_section = label_key
            sections.setdefault(current_section, {})
            add_child_tracks(sections[current_section], node.children)
            continue
        if current_section is None:
            continue
        sections.setdefault(current_section, {}).setdefault(name_key(node.name), []).append(node)
    return sections


def add_child_tracks(section: dict[str, list[PsdNode]], children: list[PsdNode]) -> None:
    for child in children:
        section.setdefault(name_key(child.name), []).append(child)


def find_cel_in_sections(section_tracks: dict[str, dict[str, list[PsdNode]]], cel: str) -> list[str]:
    found: list[str] = []
    for section, tracks in section_tracks.items():
        for track, nodes in tracks.items():
            for node in nodes:
                if descendant_name_matches(node, cel):
                    found.append(f"{section}/{track}")
                    break
    return found


def descendant_name_matches(node: PsdNode, expected: str) -> bool:
    return any(cel_name_matches(candidate.name, expected) for candidate in node.walk())


def node_to_json(node: PsdNode) -> dict[str, Any]:
    return {
        "name": node.name,
        "path": list(node.path),
        "group": node.is_group,
        "visible": node.visible,
        "children": [node_to_json(child) for child in node.children],
    }


def print_text_report(report: dict[str, Any]) -> None:
    print("PSD import inspection:", "OK" if report.get("ok") else "FAILED")
    summary = report.get("summary") or {}
    if summary:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    for warning in report.get("warnings", []):
        print(f"WARNING: {warning}")
    for error in report.get("errors", []):
        print(f"ERROR: {error}")


def name_matches(actual: str, expected: str) -> bool:
    return name_key(actual) == name_key(expected) or section_key(actual) == section_key(expected)


def cel_name_matches(actual: str, expected: str) -> bool:
    actual_name = Path(normalize_name(actual)).stem
    expected_name = Path(normalize_name(expected)).stem
    if actual_name == expected_name:
        return True
    return bool(re.match(rf"^{re.escape(expected_name)}(?:\s+\d+| copy.*)?$", actual_name, re.IGNORECASE))


def looks_like_separator(name: str) -> bool:
    stripped = normalize_name(name)
    return stripped.startswith("=") and stripped.endswith("=")


def separator_label(name: str) -> str:
    value = normalize_name(name)
    value = re.sub(r"^[=\s]+", "", value)
    value = re.sub(r"[=\s]+$", "", value)
    return normalize_name(value)


def section_key(name: str) -> str:
    value = separator_label(name).casefold()
    value = value.replace("xsheet ", "")
    return re.sub(r"\s+", "", value)


def name_key(name: str) -> str:
    return normalize_name(name).casefold()


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip())


if __name__ == "__main__":
    raise SystemExit(main())
