#!/usr/bin/env python3
r"""
Lint an E-skill for mechanical contract compliance.

Checks cover:
- Frontmatter validity (merged from quick_validate.py)
- Contract §7.1 mechanical checks:
  - Folder name matches frontmatter `name`
  - SKILL.md has at least one `##` heading
  - Every named phase (`Phase N: ...`) has exactly one marker comment
  - Every marker label matches `[^\s>]+` (no spaces, no `>`)
  - Phase ids (post-stripPrefix) are unique
  - Duplicate labels flagged for s.phase/m.phase markers
  - No marker before first `##`
  - No `Phase N:`-style heading inside fenced code blocks
  - No verification content inside s.phase/m.phase act bodies (P2 guard)

Severity levels:
- error  — fails lint (exit 1)
- info   — advisory, doesn't fail lint
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Optional

import yaml


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from SKILL.md content. Returns (frontmatter_dict, body)."""
    lines = content.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("No YAML frontmatter found (missing opening ---)")

    end_idx = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = i
            break

    if end_idx is None:
        raise ValueError("No YAML frontmatter found (missing closing ---)")

    frontmatter_text = "\n".join(lines[1:end_idx])
    body = "\n".join(lines[end_idx + 1:])

    try:
        frontmatter = yaml.safe_load(frontmatter_text)
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML in frontmatter: {e}")

    if not isinstance(frontmatter, dict):
        raise ValueError("Frontmatter must be a YAML dictionary")

    return frontmatter, body


ALLOWED_FRONTMATTER_KEYS = {
    "name", "description", "license", "allowed-tools",
    "metadata", "compatibility", "evolved",
}


def check_frontmatter(frontmatter: dict) -> list[str]:
    """Check frontmatter validity. Returns list of error messages.

    Merged from quick_validate.py: required fields, name kebab-case, name
    length, description angle brackets, description length, compatibility
    type/length, allowed-keys whitelist (catches typos like `descrption:`).
    """
    errors = []

    # Whitelist check — catches typos and rogue keys
    unexpected = set(frontmatter.keys()) - ALLOWED_FRONTMATTER_KEYS
    if unexpected:
        errors.append(
            f"Unexpected frontmatter key(s): {', '.join(sorted(unexpected))}. "
            f"Allowed: {', '.join(sorted(ALLOWED_FRONTMATTER_KEYS))}"
        )

    # Required fields
    if "name" not in frontmatter:
        errors.append("Missing 'name' in frontmatter")
    if "description" not in frontmatter:
        errors.append("Missing 'description' in frontmatter")

    name = frontmatter.get("name", "")
    if name:
        if not isinstance(name, str):
            errors.append(f"Name must be a string, got {type(name).__name__}")
        name = name.strip()
        if name:
            if not re.match(r"^[a-z0-9-]+$", name):
                errors.append(f"Name '{name}' should be kebab-case (lowercase letters, digits, and hyphens only)")
            if name.startswith("-") or name.endswith("-") or "--" in name:
                errors.append(f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens")
            if len(name) > 64:
                errors.append(f"Name is too long ({len(name)} characters). Maximum is 64 characters.")

    description = frontmatter.get("description", "")
    if description:
        if not isinstance(description, str):
            errors.append(f"Description must be a string, got {type(description).__name__}")
        description = description.strip()
        if description:
            if "<" in description or ">" in description:
                errors.append("Description cannot contain angle brackets (< or >)")
            if len(description) > 1024:
                errors.append(f"Description is too long ({len(description)} characters). Maximum is 1024 characters.")

    compatibility = frontmatter.get("compatibility", "")
    if compatibility:
        if not isinstance(compatibility, str):
            errors.append(f"Compatibility must be a string, got {type(compatibility).__name__}")
        elif len(compatibility) > 500:
            errors.append(f"Compatibility is too long ({len(compatibility)} characters). Maximum is 500 characters.")

    return errors


def strip_phase_prefix(heading: str) -> str:
    """Strip leading 'Phase N:' prefix from a heading.

    Mirrors forced_todo.js stripPhasePrefix (case-insensitive).
    """
    pattern = r"^Phase\s+\d+\s*[:.\-]\s*"
    return re.sub(pattern, "", heading, flags=re.IGNORECASE).strip()


_PHASE_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")
_NAMED_PHASE_RE = re.compile(r"^Phase\s+\d+\b", re.IGNORECASE)

# Signals that verify criteria leaked into an act-phase body (P2 guard).
# Inline phrases the observed leaks use, plus `###`+ sub-headings that open a
# verification section inside the phase.
_VERIFY_LEAK_INLINE_RE = re.compile(
    r"\bself[- ]?(check|verify|verification)\b|\bif verification surfaces\b",
    re.IGNORECASE,
)
_VERIFY_LEAK_HEADING_RE = re.compile(
    r"^#{3,}\s+(self[- ]?check|self[- ]?verif\w*|verification|verify)\b",
    re.IGNORECASE,
)


def is_phase_heading(line: str) -> bool:
    """Match the runtime parser exactly: any line starting with `## ` is a phase boundary.

    See forced_todo.js:73. The runtime makes no distinction between `## Phase N: ...`
    and `## Some Other Heading` — both open phases. This lint mirrors that.
    """
    return bool(_PHASE_HEADING_RE.match(line))


def extract_heading_text(line: str) -> str:
    """Extract the heading text from a `## ...` line, mirroring the runtime regex."""
    m = _PHASE_HEADING_RE.match(line)
    return m.group(1).strip() if m else ""


def is_named_phase(raw_heading: str) -> bool:
    """True if the heading is `Phase N: ...` style (versus a documentation heading).

    Used to decide whether a missing marker is a hard error (named phase, model
    expected to invoke it) or tolerated (documentation heading the runtime parses
    as a phantom phase but the model never references in `roadmap`).
    """
    return bool(_NAMED_PHASE_RE.match(raw_heading))


def check_skill_mechanics(skill_path: Path, frontmatter: dict, body: str) -> tuple[list[str], list[str]]:
    """Check contract §7.1 mechanical rules. Returns (errors, infos).

    errors  — fail lint
    infos   — advisory (e.g., phantom phases) that don't fail lint
    """
    errors: list[str] = []
    infos: list[str] = []

    # Rule 1: Folder name matches frontmatter name
    folder_name = skill_path.name
    frontmatter_name = frontmatter.get("name", "")
    if frontmatter_name and folder_name != frontmatter_name:
        errors.append(f"Folder name '{folder_name}' does not match frontmatter name '{frontmatter_name}'")

    # Parse phases from body
    phases = parse_phases(body)

    # Rule 2: SKILL.md has at least one `##` heading
    if len(phases) == 0:
        errors.append("SKILL.md has no ## headings (at least one required)")

    # Rule: Phase ids unique
    phase_ids = [p["id"] for p in phases]
    seen_ids = set()
    for pid in phase_ids:
        if pid in seen_ids:
            errors.append(f"Duplicate phase id: '{pid}'")
        seen_ids.add(pid)

    # Rule: Every phase has exactly one marker.
    # Hard error only for named phases (`Phase N: ...`) — those are intended to be
    # invoked by the model via `roadmap`. Other `##` headings are documentation that
    # the runtime parses as phantom phases but the model never references; missing
    # markers there are tolerated. Surfaced as a separate "info" message so the
    # author knows phantoms exist.
    for phase in phases:
        markers = phase.get("markers", [])
        raw_heading = phase.get("raw_heading", phase["id"])
        if len(markers) == 0:
            if is_named_phase(raw_heading):
                errors.append(f"Phase '{phase['id']}' has no marker comment")
            else:
                infos.append(
                    f"'## {raw_heading}' is parsed as a phantom phase by the runtime "
                    f"(no marker, defaults to s.phase). Tolerable if the model never includes "
                    f"it in `roadmap`; otherwise add a marker or convert to '### {raw_heading}'."
                )
        elif len(markers) > 1:
            errors.append(f"Phase '{phase['id']}' has {len(markers)} markers (expected 1)")

    # Rule: Every marker label matches [^\s>]+ (no spaces, no >)
    label_errors = []
    for phase in phases:
        for marker in phase.get("markers", []):
            label = marker.get("label", "")
            if label and not re.match(r"^[^\s>]+$", label):
                label_errors.append(f"Phase '{phase['id']}': invalid marker label '{label}' (no spaces or > allowed)")
    errors.extend(label_errors)

    # Rule: Duplicate labels for s.phase/m.phase markers (warning, not error)
    label_to_phases: dict[str, list[str]] = {}
    for phase in phases:
        for marker in phase.get("markers", []):
            if marker.get("type") in ("s", "m"):
                label = marker.get("label", "")
                if label:
                    if label not in label_to_phases:
                        label_to_phases[label] = []
                    label_to_phases[label].append(phase["id"])

    duplicates = {label: phases for label, phases in label_to_phases.items() if len(phases) > 1}
    for label, phase_list in duplicates.items():
        errors.append(f"Duplicate label '{label}' used by phases: {', '.join(phase_list)} (warn: may be intentional)")

    # Rule: Marker before first `##` heading is silently ignored by the runtime.
    # Preamble = everything before the first `##` (matching the runtime parser).
    lines = body.split("\n")
    preamble_end = None
    in_fence_for_preamble = False
    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            in_fence_for_preamble = not in_fence_for_preamble
            continue
        if not in_fence_for_preamble and is_phase_heading(line):
            preamble_end = i
            break
    if preamble_end is not None and preamble_end > 0:
        preamble = "\n".join(lines[:preamble_end])
        marker_in_preamble = re.search(r"<!--\s*[nsm]\.phase\b", preamble)
        if marker_in_preamble:
            errors.append(
                f"Marker comment found before the first '##' heading: "
                f"'{marker_in_preamble.group()}' (silently ignored by the runtime)"
            )

    # Rule: a Phase-N-style `##` heading inside a fenced code block is almost
    # certainly a misplaced phase boundary (the runtime correctly ignores `##`
    # inside fences, so the phase wouldn't be parsed). Plain `## Other` inside
    # fences is usually intentional template/example content — no warning.
    in_code_fence = False
    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            in_code_fence = not in_code_fence
            continue
        if in_code_fence and is_phase_heading(line):
            heading = extract_heading_text(line)
            if is_named_phase(heading):
                errors.append(
                    f"'## {heading}' inside fenced code block (line {i + 1}): "
                    f"runtime treats this as content, not a phase boundary"
                )

    # Rule: Override files non-empty if present, AND surface missing files as
    # INFO. Per the contract, missing override files are tolerable (runtime
    # falls back to phase content as the rubric). But labeling a phase and then
    # not writing its rubric is almost always an authoring oversight — surface
    # it as an INFO so reviewers and the lint phase's own self-verify catch it
    # mechanically, without making it an ERROR (which would be over-strict).
    verifications_dir = skill_path / "verifications"
    for phase in phases:
        for marker in phase.get("markers", []):
            label = marker.get("label", "")
            mtype = marker.get("type", "")
            if not label:
                continue
            verify_file = verifications_dir / f"{label.lower()}.md"
            if verify_file.exists():
                content = verify_file.read_text().strip()
                if not content:
                    errors.append(f"Override file '{verify_file.name}' is empty (will fall through to fallback)")
            elif mtype in ("s", "m"):
                infos.append(
                    f"Phase '{phase['id']}' has '{mtype}.phase: {label}' marker but "
                    f"no verifications/{label.lower()}.md file. Runtime will fall back "
                    f"to phase-content as the rubric, but you almost certainly meant to "
                    f"write a focused rubric file here."
                )
            # n.phase markers with labels intentionally don't get a rubric file
            # at runtime (no verify round-trip exists), so missing is fine.

    # Rule (INFO): m-heavy marker mix. Each m.phase costs 2 extra LLM turns at
    # runtime (one a whole subagent session); a skill where most phases are m is
    # usually over-verifying. Advisory only — some skills are legitimately
    # judgment-heavy throughout.
    marked = [m for p in phases for m in p.get("markers", [])]
    m_count = sum(1 for m in marked if m.get("type") == "m")
    if len(marked) >= 3 and m_count > len(marked) / 2:
        infos.append(
            f"{m_count} of {len(marked)} marked phases are m.phase (subagent verify, "
            f"+2 LLM turns each). Check the marker budget: reserve m.phase for "
            f"judgment-heavy / authorship-bias phases; prefer s.phase or n.phase "
            f"where the output is mechanically checkable."
        )

    # Rule: verification content must not appear inside s.phase/m.phase act
    # bodies. The verify criteria live in verifications/<label>.md (or fall back
    # to phase content) and arrive via the runtime's verify prompt. A self-check
    # block inside the act body makes the model verify during act and then treat
    # the real verify turn as redundant — it writes prose instead of calling
    # forced_todo progress, and the phase stalls (P1/P2).
    marker_types_by_id = {
        p["id"]: {m.get("type") for m in p.get("markers", [])} for p in phases
    }
    leak_fence = False
    leak_phase_id = None
    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            leak_fence = not leak_fence
            continue
        if leak_fence:
            continue
        if is_phase_heading(line):
            leak_phase_id = strip_phase_prefix(extract_heading_text(line))
            continue
        if leak_phase_id is None:
            continue
        if not marker_types_by_id.get(leak_phase_id, set()) & {"s", "m"}:
            continue
        if re.search(r"<!--\s*[nsm]\.phase\b", line):
            continue  # the marker comment itself is fine
        leak = _VERIFY_LEAK_HEADING_RE.search(line) or _VERIFY_LEAK_INLINE_RE.search(line)
        if leak:
            errors.append(
                f"Phase '{leak_phase_id}' act body contains verification content "
                f"(line {i + 1}: '{line.strip()[:60]}'). Verify criteria belong in "
                f"verifications/<label>.md — the runtime delivers them in the verify "
                f"prompt. A self-check in the act body makes the real verify turn "
                f"look redundant and stalls the phase."
            )

    return errors, infos


def parse_phases(body: str) -> list[dict]:
    """Parse phases from SKILL.md body. Mirrors forced_todo.js parseSkillPhases.

    Every `## ` heading outside a fenced code block is a phase boundary — same
    rule the runtime uses. Phase id = heading text after `stripPhasePrefix`.
    """
    phases = []
    lines = body.split("\n")
    current_phase = None
    in_code_fence = False

    for line in lines:
        # Track code fences
        if line.strip().startswith("```"):
            in_code_fence = not in_code_fence
            if current_phase is not None:
                current_phase["content_lines"].append(line)
            continue

        # Check for phase heading (outside fences only)
        if not in_code_fence and is_phase_heading(line):
            # Save previous phase
            if current_phase is not None:
                finalize_phase(current_phase)
                phases.append(current_phase)

            # Start new phase
            heading = extract_heading_text(line)
            phase_id = strip_phase_prefix(heading)
            current_phase = {
                "id": phase_id,
                "raw_heading": heading,
                "markers": [],
                "content_lines": [line]
            }
        elif current_phase is not None:
            current_phase["content_lines"].append(line)

            # Look for markers (only outside fences)
            if not in_code_fence:
                marker_match = re.search(r"<!--\s*([nsm])\.phase\b(?:\s*:\s*([^\s>]+))?\s*-->", line)
                if marker_match:
                    current_phase["markers"].append({
                        "type": marker_match.group(1),
                        "label": marker_match.group(2) or ""
                    })
        elif not in_code_fence:
            # Before first phase - track for potential preamble marker warning
            pass

    # Finalize last phase
    if current_phase is not None:
        finalize_phase(current_phase)
        phases.append(current_phase)

    return phases


def finalize_phase(phase: dict) -> None:
    """Clean up phase content - trim whitespace, extract markers."""
    content = "\n".join(phase["content_lines"])
    phase["content"] = content.strip()


_DESCRIPTION_VERBATIM_RE = re.compile(
    r"^##\s+Description\s+\(verbatim\)\s*$", re.MULTILINE | re.IGNORECASE
)
_NEXT_H2_RE = re.compile(r"^##\s+", re.MULTILINE)


def extract_source_description(source_extract_path: Path) -> tuple[Optional[str], Optional[str]]:
    """Pull the verbatim description from a source-extract.md file.

    Returns (description, error). If the heading is missing or the section is
    empty, returns (None, error_message).
    """
    if not source_extract_path.exists():
        return None, f"--source-extract path does not exist: {source_extract_path}"
    try:
        text = source_extract_path.read_text()
    except OSError as e:
        return None, f"Could not read source-extract: {e}"

    m = _DESCRIPTION_VERBATIM_RE.search(text)
    if not m:
        return None, (
            f"source-extract.md has no '## Description (verbatim)' heading. "
            f"The conversion-guide §1 format requires this exact heading."
        )

    section_start = m.end()
    next_h2 = _NEXT_H2_RE.search(text, pos=section_start)
    section_end = next_h2.start() if next_h2 else len(text)
    section = text[section_start:section_end].strip()

    if not section:
        return None, "source-extract.md '## Description (verbatim)' section is empty"

    return section, None


def check_description_inheritance(
    new_description: str, source_extract_path: Path
) -> list[str]:
    """If --source-extract is provided, enforce verbatim description inheritance.

    Mismatch is an error: conversions that re-author the description regress
    triggering on phrases the source had been tuned against (conversion-guide §6).
    """
    source_desc, err = extract_source_description(source_extract_path)
    if err:
        return [err]
    if not isinstance(new_description, str):
        return [f"Frontmatter description is not a string; cannot compare against source"]
    if new_description.strip() != source_desc.strip():
        return [
            "Description mismatch: new SKILL.md frontmatter description does not "
            "equal source-extract.md '## Description (verbatim)' byte-for-byte. "
            "Conversions must inherit the source description verbatim "
            "(see conversion-guide.md §6).\n"
            f"  source-extract: {source_desc.strip()[:200]!r}\n"
            f"  new SKILL.md:   {new_description.strip()[:200]!r}"
        ]
    return []


def lint_skill(skill_path: Path, source_extract: Optional[Path] = None) -> tuple[int, list[str], list[str]]:
    """
    Lint a skill directory. Returns (exit_code, errors, infos).

    Exit code 0 means no errors. Infos are advisory and don't fail lint.

    If `source_extract` is given, also enforce description inheritance against
    that source-extract.md file (used during normal-skill → E-skill conversion).
    """
    skill_path = Path(skill_path)
    errors: list[str] = []
    infos: list[str] = []

    # Check SKILL.md exists
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return 1, [f"SKILL.md not found at {skill_path}"], []

    # Read and parse
    try:
        content = skill_md.read_text()
        frontmatter, body = parse_frontmatter(content)
    except ValueError as e:
        return 1, [str(e)], []

    # Run checks
    errors.extend(check_frontmatter(frontmatter))
    mech_errors, mech_infos = check_skill_mechanics(skill_path, frontmatter, body)
    errors.extend(mech_errors)
    infos.extend(mech_infos)

    if source_extract is not None:
        errors.extend(
            check_description_inheritance(
                frontmatter.get("description", ""), Path(source_extract)
            )
        )

    return (1 if errors else 0), errors, infos


def main():
    parser = argparse.ArgumentParser(
        description="Lint an E-skill for mechanical contract compliance"
    )
    parser.add_argument(
        "skill_path",
        help="Path to the skill directory (must contain SKILL.md)"
    )
    parser.add_argument(
        "--source-extract",
        default=None,
        help="Path to source-extract.md for conversion description-inheritance check. "
             "When provided, lint also fails if the new SKILL.md frontmatter "
             "description does not byte-for-byte equal the source-extract's "
             "'## Description (verbatim)' field.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output as JSON"
    )
    args = parser.parse_args()

    skill_path = Path(args.skill_path)
    source_extract = Path(args.source_extract) if args.source_extract else None
    exit_code, errors, infos = lint_skill(skill_path, source_extract=source_extract)

    if args.json:
        import json
        print(json.dumps({"errors": errors, "infos": infos}, indent=2))
    else:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        for info in infos:
            print(f"INFO:  {info}", file=sys.stderr)
        if not errors:
            suffix = f" ({len(infos)} info)" if infos else ""
            print(f"Lint passed — no errors found.{suffix}", file=sys.stderr)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()