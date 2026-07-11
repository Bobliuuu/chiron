#!/usr/bin/env python3
"""
erun_eval.py — End-to-end smoke + behavioral eval harness for E-skills.

Drives a real OpenCode session end-to-end by:
1. Spawning `opencode run --format json "<prompt>"` (prompt is positional)
2. Parsing NDJSON event stream for phase transitions, asks, and tool calls
3. Handling mid-session ask interruptions by reattaching with `--session <id>`
   and a follow-up prompt instructing best-effort assumption + recording
4. Producing trace.jsonl, report.json, and exit code 0 only when:
   - Every roadmap phase reached `verified`
   - No leftover [FORCED TODO] prompts at session end
   - Per-eval expectations grade above threshold (when --eval-set provided)
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional


SMOKE_DIR_RE = re.compile(r"^smoke-test-\d+$")


ASK_INTERVENTION_PROMPT = (
    "The skill called forced_todo ask. The user is unavailable for this run.\n"
    "Make a best-effort assumption that resolves the question, state the\n"
    "assumption explicitly in your next phase summary so it's visible in the\n"
    "trace, then continue acting on the current phase."
)


@dataclass
class PhaseTransition:
    timestamp: float
    phase_id: str
    from_status: str
    to_status: str


@dataclass
class AskEvent:
    timestamp: float
    phase_id: str
    question: str


@dataclass
class ToolCall:
    timestamp: float
    tool_name: str
    arguments: dict
    response_snippet: str


@dataclass
class RunState:
    """Accumulated state across all turns of one session (initial + followups)."""
    session_id: Optional[str] = None
    phases: list[dict] = field(default_factory=list)
    current_phase_id: Optional[str] = None
    awaiting_user_reply: bool = False
    pending_question: Optional[str] = None

    transitions: list[PhaseTransition] = field(default_factory=list)
    asks: list[AskEvent] = field(default_factory=list)
    tool_calls: list[ToolCall] = field(default_factory=list)

    steps_seen: int = 0
    ask_count: int = 0
    saw_step_finish_stop: bool = False  # last turn ended with reason=stop

    @property
    def all_phases_verified(self) -> bool:
        return bool(self.phases) and all(p.get("status") == "verified" for p in self.phases)

    @property
    def clean_termination(self) -> bool:
        """Session ended cleanly: all work done, not paused on ask, last step was stop."""
        return (
            self.all_phases_verified
            and not self.awaiting_user_reply
            and self.saw_step_finish_stop
        )


MAX_ASKS = 5


def parse_ft_footer(response: str) -> Optional[dict]:
    """Extract FT footer JSON from a forced_todo tool response."""
    if not response:
        return None
    start = response.find("<!--FT:")
    if start == -1:
        return None
    payload_start = start + len("<!--FT:")
    end = response.find("-->", payload_start)
    if end == -1:
        return None
    try:
        return json.loads(response[payload_start:end])
    except json.JSONDecodeError:
        return None


def update_state_from_ft(state: RunState, ft: dict, timestamp: float) -> None:
    """Apply an FT footer to RunState. Detects phase transitions by diffing
    the previous phases array against the new one."""
    prev_statuses = {p["id"]: p.get("status") for p in state.phases}

    if "current_phase_id" in ft:
        state.current_phase_id = ft["current_phase_id"]
    if "awaiting_user_reply" in ft:
        state.awaiting_user_reply = bool(ft["awaiting_user_reply"])
    if "pending_question" in ft:
        state.pending_question = ft.get("pending_question")

    new_phases = ft.get("phases")
    if isinstance(new_phases, list):
        for p in new_phases:
            pid = p.get("id")
            new_status = p.get("status")
            if pid is None or new_status is None:
                continue
            old_status = prev_statuses.get(pid)
            if old_status is None:
                state.transitions.append(PhaseTransition(
                    timestamp=timestamp, phase_id=pid,
                    from_status="(new)", to_status=new_status,
                ))
            elif old_status != new_status:
                state.transitions.append(PhaseTransition(
                    timestamp=timestamp, phase_id=pid,
                    from_status=old_status, to_status=new_status,
                ))
        state.phases = new_phases


def handle_event(state: RunState, event: dict) -> bool:
    """Process one NDJSON event. Returns True if the event signals an ask
    that needs script intervention via a follow-up turn."""
    event_type = event.get("type")
    timestamp = event.get("timestamp", 0)

    if event_type == "step_start":
        state.steps_seen += 1
        state.saw_step_finish_stop = False
        if state.session_id is None:
            sid = event.get("sessionID") or (isinstance(event.get("part"), dict) and event["part"].get("sessionID"))
            if sid:
                state.session_id = sid
        return False

    if event_type in ("tool_use", "tool_call"):
        part = event.get("part", {}) or {}
        tool_name = part.get("tool") or part.get("name") or ""
        args = part.get("input") if isinstance(part.get("input"), dict) else {}
        if not args:
            args = part.get("arguments") if isinstance(part.get("arguments"), dict) else {}

        state_info = part.get("state") or {}
        response = state_info.get("output", "") if isinstance(state_info, dict) else ""
        if not response:
            response = part.get("response", "") or ""

        state.tool_calls.append(ToolCall(
            timestamp=timestamp, tool_name=tool_name,
            arguments=args, response_snippet=response[:500],
        ))

        if tool_name == "forced_todo":
            ft = parse_ft_footer(response)
            if ft:
                update_state_from_ft(state, ft, timestamp)
                if ft.get("action") == "ask" and ft.get("awaiting_user_reply"):
                    state.ask_count += 1
                    state.asks.append(AskEvent(
                        timestamp=timestamp,
                        phase_id=ft.get("current_phase_id") or "(unknown)",
                        question=ft.get("pending_question") or "",
                    ))
                    return True
        return False

    if event_type == "step_finish":
        reason = (event.get("part", {}) or {}).get("reason", "")
        if reason == "stop":
            state.saw_step_finish_stop = True
        return False

    if event_type == "phase_transition":
        state.transitions.append(PhaseTransition(
            timestamp=timestamp,
            phase_id=event.get("phase_id", ""),
            from_status=event.get("from_status", ""),
            to_status=event.get("to_status", ""),
        ))
        return False

    return False


def run_one_turn(state: RunState, prompt: str, dir_path: Path,
                 timeout: int, session_id: Optional[str]) -> bool:
    """Run a single `opencode run` invocation, parsing events into state.
    Returns True if an ask intervention is needed before the next turn.

    `proc.communicate()` drains both stdout and stderr concurrently, so no
    pipe-buffer deadlock is possible. We capture stderr only to surface it
    when the run looks wrong — silent discard makes failures hard to debug.
    """
    cmd = [
        "timeout", str(timeout),
        "opencode", "run",
        "--format", "json",
        "--dir", str(dir_path),
    ]
    if session_id:
        cmd += ["--session", session_id]
    cmd.append(prompt)

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    stdout, stderr = proc.communicate(timeout=timeout + 30)
    rc = proc.returncode

    needs_ask_intervention = False
    parsed_events = 0
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        parsed_events += 1
        if handle_event(state, event):
            needs_ask_intervention = True

    # Surface stderr when something looks off:
    #   - non-zero return (`timeout` returns 124 on hit, opencode may exit non-zero on errors)
    #   - no events parsed at all (likely a launch failure or unparseable output)
    if rc != 0 or parsed_events == 0:
        diag = (stderr or "").strip()
        if diag:
            # Trim to keep the parent's stderr scannable.
            preview = diag if len(diag) <= 2000 else diag[:1000] + "\n...\n" + diag[-1000:]
            print(
                f"[erun_eval] opencode run exited rc={rc}, parsed_events={parsed_events}.\n"
                f"--- captured stderr ---\n{preview}\n--- end stderr ---",
                file=sys.stderr,
            )
        else:
            print(
                f"[erun_eval] opencode run exited rc={rc}, parsed_events={parsed_events}; "
                f"no stderr output.",
                file=sys.stderr,
            )

    return needs_ask_intervention


GRADER_AGENT_PATH = (
    Path(__file__).resolve().parent.parent / "agents" / "grader.md"
)
GRADER_TIMEOUT = 600  # seconds for the grader subagent run


def grade_with_subagent(eval_item: dict, run_dir: Path,
                        trace_path: Path, project_root: Path) -> Optional[dict]:
    """Hand outputs + trace to the grader subagent.

    Returns None when no expectations are provided. Otherwise spawns a separate
    `opencode run` whose prompt instructs the model to read agents/grader.md
    and write grading.json to <run_dir>/grading.json. We then read that file
    back and return its parsed contents.

    On any failure (subprocess error, missing grading.json, malformed JSON) we
    return a dict with `status` set to a failure code and `pass` False so the
    caller's exit-code branch can fail closed.
    """
    expectations = eval_item.get("expectations")
    if not expectations:
        return None

    grading_path = run_dir / "grading.json"
    # Pre-clean: a stale grading.json from a previous run would mask a
    # subagent that failed to write a fresh one.
    if grading_path.exists():
        grading_path.unlink()

    # The grader prompt mirrors the contract documented in agents/grader.md.
    # We pass absolute paths so the subagent doesn't need to know about its
    # own cwd. The model loads grader.md and follows its 8-step process.
    prompt = (
        f"You are running as the Grader subagent for an E-skill smoke evaluation. "
        f"First, use the Read tool to read the file at {GRADER_AGENT_PATH} and "
        f"follow its 8-step process exactly.\n\n"
        f"Inputs for this grading run:\n"
        f"- expectations: {json.dumps(expectations)}\n"
        f"- transcript_path: {trace_path}\n"
        f"- outputs_dir: {run_dir}\n\n"
        f"Write your grading JSON to exactly this path (overwrite if it exists): "
        f"{grading_path}\n\n"
        f"The JSON must include a top-level `summary.pass_rate` field and a "
        f"top-level `pass` boolean (true if every expectation passed, false "
        f"otherwise). Stop after writing the file."
    )

    cmd = [
        "timeout", str(GRADER_TIMEOUT),
        "opencode", "run",
        "--format", "json",
        "--dir", str(project_root),
        prompt,
    ]

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        _stdout, stderr = proc.communicate(timeout=GRADER_TIMEOUT + 30)
        rc = proc.returncode
    except subprocess.TimeoutExpired:
        proc.kill()
        return {
            "status": "subagent_timeout",
            "pass": False,
            "note": f"Grader subagent did not complete within {GRADER_TIMEOUT}s.",
        }
    except OSError as e:
        return {
            "status": "subagent_spawn_failed",
            "pass": False,
            "note": f"Could not spawn grader subagent: {e}",
        }

    if not grading_path.exists():
        diag = (stderr or "").strip()
        return {
            "status": "subagent_failed",
            "pass": False,
            "note": (
                f"Grader subagent exited rc={rc} but did not write {grading_path}. "
                f"stderr preview: {diag[:500]!r}"
            ),
        }

    try:
        grading = json.loads(grading_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        return {
            "status": "subagent_output_unparseable",
            "pass": False,
            "note": f"grading.json exists but could not be parsed: {e}",
        }

    # The agents/grader.md template emits per-expectation `passed` booleans and
    # `summary.pass_rate`, but no top-level `pass`. Derive it deterministically
    # so the parent's exit-code branch doesn't depend on the subagent
    # remembering to synthesize a field. Write the augmented dict back so the
    # on-disk artifact matches what the parent uses.
    if "pass" not in grading:
        expectations = grading.get("expectations") or []
        if expectations:
            grading["pass"] = all(bool(e.get("passed")) for e in expectations)
        else:
            # No expectations were graded; treat as no judgment available.
            # `pass=False` is fail-closed for the caller.
            grading["pass"] = False
        try:
            grading_path.write_text(json.dumps(grading, indent=2))
        except OSError:
            # Non-fatal: parent will still use the in-memory `pass` value.
            pass

    return grading


def write_trace(state: RunState, trace_path: Path) -> None:
    with open(trace_path, "w") as f:
        for t in state.transitions:
            f.write(json.dumps({
                "type": "phase_transition",
                "timestamp": t.timestamp,
                "phase_id": t.phase_id,
                "from_status": t.from_status,
                "to_status": t.to_status,
            }) + "\n")
        for ask in state.asks:
            f.write(json.dumps({
                "type": "ask",
                "timestamp": ask.timestamp,
                "phase_id": ask.phase_id,
                "question": ask.question,
            }) + "\n")
        for tc in state.tool_calls:
            f.write(json.dumps({
                "type": "tool_call",
                "timestamp": tc.timestamp,
                "tool_name": tc.tool_name,
                "arguments": tc.arguments,
                "response_snippet": tc.response_snippet,
            }) + "\n")


def run_eval_one(eval_item: dict, skill_path: Path, run_dir: Path,
                 timeout: int, project_root: Path) -> dict:
    """Run a single eval prompt end-to-end. Writes trace.jsonl + report.json
    into run_dir and returns the report dict.

    Note: run_dir is the working directory for the smoke run. It already
    contains .opencode/ (set up by copy_opencode_for_smoke). opencode runs
    in run_dir directly — do NOT append an extra "outputs" subdirectory here.
    """
    run_dir.mkdir(parents=True, exist_ok=True)

    state = RunState()
    eval_prompt = eval_item["prompt"]

    needs_ask = run_one_turn(state, eval_prompt, run_dir, timeout, session_id=None)

    # Ask intervention loop. Cap at MAX_ASKS to prevent runaway clarification.
    while needs_ask and state.session_id and state.ask_count < MAX_ASKS:
        needs_ask = run_one_turn(
            state, ASK_INTERVENTION_PROMPT, run_dir, timeout, state.session_id,
        )

    excessive_asks = state.ask_count > MAX_ASKS

    # Trace + grading.
    trace_path = run_dir / "trace.jsonl"
    write_trace(state, trace_path)

    grading = grade_with_subagent(
        eval_item, run_dir, trace_path, project_root,
    )

    # Verdicts.
    orchestration_pass = (
        state.clean_termination
        and not excessive_asks
    )
    if grading is None:
        # No expectations supplied — grading was skipped, not failed.
        grading_pass = True
        grading_summary = "skipped (no expectations)"
    elif grading.get("status", "").startswith("subagent_"):
        # Grader spawn / write / parse failed. Fail closed: silent
        # grader failure is exactly the regression mode this wiring
        # exists to surface.
        grading_pass = False
        grading_summary = f"grader failed: {grading.get('status')}"
    else:
        grading_pass = bool(grading.get("pass", False))
        grading_summary = "ran"

    overall_pass = orchestration_pass and grading_pass

    report = {
        "skill": str(skill_path),
        "eval_id": eval_item.get("id"),
        "eval_prompt": eval_prompt,
        "session_id": state.session_id,
        "overall_pass": overall_pass,
        "orchestration": {
            "passed": orchestration_pass,
            "all_phases_verified": state.all_phases_verified,
            "clean_termination": state.clean_termination,
            "saw_step_finish_stop": state.saw_step_finish_stop,
            "awaiting_user_reply": state.awaiting_user_reply,
            "ask_count": state.ask_count,
            "excessive_asks": excessive_asks,
            "steps_seen": state.steps_seen,
            "current_phase_id": state.current_phase_id,
            "phases": state.phases,
            "transitions_count": len(state.transitions),
        },
        "grading": {
            "summary": grading_summary,
            "passed": grading_pass,
            "result": grading,
        },
        "trace_path": str(trace_path),
        "outputs_dir": str(run_dir),
        "timestamp": datetime.now().isoformat(),
    }

    with open(run_dir / "report.json", "w") as f:
        json.dump(report, f, indent=2)
    return report


def load_eval_set(eval_set_path: Path) -> list[dict]:
    """Load an eval set JSON file. Accepts either skill-creator format
    ({skill_name, evals: [...]}) or a bare list of eval items."""
    data = json.loads(eval_set_path.read_text())
    if isinstance(data, dict) and "evals" in data:
        return data["evals"]
    if isinstance(data, list):
        return data
    raise ValueError(
        f"Unrecognized eval set format in {eval_set_path}. Expected "
        f"{{'evals': [...]}} or a top-level list."
    )


def find_opencode_project_root(start: Path) -> Optional[Path]:
    """Walk up from `start` looking for a directory containing `.opencode/`.

    Mirrors how OpenCode discovers project context from `--dir`. If no ancestor
    has `.opencode/`, OpenCode runs without project plugins/skills (silently),
    and `forced_todo` won't be available — the orchestration won't engage and
    every smoke run looks like a phase-stuck failure for opaque reasons.
    """
    current = start.resolve()
    for parent in [current, *current.parents]:
        if (parent / ".opencode").is_dir():
            return parent
    return None


def find_project_opencode_dir() -> Path:
    """Locate the project's .opencode/ directory.

    Walks up from this script's location looking for an ancestor that contains
    a `.opencode/` subdirectory. Resilient to script relocation: any restructure
    that keeps the script under `<project>/.opencode/...` continues to resolve.
    """
    project_root = find_opencode_project_root(Path(__file__).resolve().parent)
    if project_root is None:
        raise RuntimeError(
            f"No .opencode/ ancestor found above {Path(__file__).resolve()}"
        )
    return project_root / ".opencode"


def next_smoke_test_dir(skill_data_dir: Path) -> Path:
    """Return the next smoke-test-N directory under skill_data_dir.

    Scans for existing smoke-test-* dirs, picks N = max_existing + 1.
    Creates smoke-test-N/ and smoke-test-N/outputs/ directories.
    Returns the outputs/ directory (the actual working dir for the smoke run).
    """
    smoke_dirs = sorted([
        d for d in skill_data_dir.iterdir()
        if d.is_dir() and d.name.startswith("smoke-test-")
    ])
    if smoke_dirs:
        last_name = smoke_dirs[-1].name  # e.g. "smoke-test-003"
        try:
            next_num = int(last_name.split("-")[-1]) + 1
        except ValueError:
            next_num = 1
    else:
        next_num = 1

    smoke_dir = skill_data_dir / f"smoke-test-{next_num:03d}"
    outputs_dir = smoke_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    return outputs_dir


def copy_opencode_for_smoke(project_opencode_dir: Path, outputs_dir: Path,
                            skill_name: str) -> Path:
    """Copy .opencode/ into the smoke test outputs dir, scoped to the skill under test.

    Copies .opencode/skills/<skill_name>/, .opencode/plugins/, and .opencode/tools/
    to isolate the subprocess from the full project skill library while keeping
    the forced_todo plugin and tool available.
    Returns the copied .opencode/ path.
    """
    dest_opencode = outputs_dir / ".opencode"

    if dest_opencode.exists():
        shutil.rmtree(dest_opencode)

    dest_opencode.mkdir(parents=True)

    # Copy plugins/ (forced_todo.js orchestrator)
    src_plugins = project_opencode_dir / "plugins"
    if src_plugins.is_dir():
        shutil.copytree(src_plugins, dest_opencode / "plugins")

    # Copy tools/ (forced_todo tool implementation)
    src_tools = project_opencode_dir / "tools"
    if src_tools.is_dir():
        shutil.copytree(src_tools, dest_opencode / "tools")

    # Copy skills/<skill_name>/ only (not eskill-maker or other skills)
    dest_skills_dir = dest_opencode / "skills"
    dest_skills_dir.mkdir()

    src_skill_dir = project_opencode_dir / "skills" / skill_name
    if not src_skill_dir.is_dir():
        raise RuntimeError(
            f"Skill directory not found at {src_skill_dir}. "
            f"Make sure the skill has been drafted before running smoke."
        )

    shutil.copytree(src_skill_dir, dest_skills_dir / skill_name)

    return dest_opencode


def main():
    parser = argparse.ArgumentParser(
        description="Run end-to-end smoke + behavioral eval for an E-skill"
    )
    parser.add_argument("--skill", required=True,
                        help="Path to the skill directory under test")
    parser.add_argument("--workspace", required=True,
                        help="Skill data directory (e.g. eskilldata/<skill>/)")
    parser.add_argument("--timeout", type=int, default=600,
                        help="Max seconds per turn (default 600)")

    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--eval-prompt",
                     help="Single eval prompt to run end-to-end")
    src.add_argument("--eval-set",
                     help="Path to eval set JSON ({'evals': [...]}) or list")

    args = parser.parse_args()

    skill_path = Path(args.skill)
    if not (skill_path / "SKILL.md").exists():
        print(f"ERROR: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    skill_data_dir = Path(args.workspace)  # e.g. eskilldata/researcher/

    # Recursive-smoke guard: refuse to run when --workspace is itself inside a
    # smoke-test tree. Walks every part of the resolved path and rejects on
    # `smoke-test-<digits>`. Catches both leaf cases (`.../smoke-test-003/`) and
    # nested cases (`.../smoke-test-003/outputs/`) — the latter would otherwise
    # bypass a leaf-name check and produce nested smoke runs.
    resolved_workspace = skill_data_dir.resolve()
    for part in resolved_workspace.parts:
        if SMOKE_DIR_RE.match(part):
            raise SystemExit(
                f"--workspace {skill_data_dir} is inside a smoke-test directory "
                f"('{part}'); this would create a nested smoke run. "
                f"Pass the parent eskilldata/<skill>/ instead."
            )

    skill_data_dir.mkdir(parents=True, exist_ok=True)
    skill_name = skill_path.name

    # Locate the project's .opencode/ for the copy step.
    project_opencode_dir = find_project_opencode_dir()

    # Determine the next smoke-test dir (creates smoke-test-N/outputs/).
    # outputs_dir is the working directory for this smoke run.
    outputs_dir = next_smoke_test_dir(skill_data_dir)

    # Copy .opencode/ into outputs_dir, scoped to only the skill under test.
    # This isolates the subprocess from the full project skill library.
    copy_opencode_for_smoke(project_opencode_dir, outputs_dir, skill_name)

    # The outputs_dir now contains .opencode/ — opencode walking up from
    # outputs_dir finds it immediately, so project_root = outputs_dir.
    project_root = find_opencode_project_root(outputs_dir)

    if args.eval_prompt:
        eval_items = [{"id": 0, "prompt": args.eval_prompt, "expectations": []}]
    else:
        eval_items = load_eval_set(Path(args.eval_set))

    reports = []
    for item in eval_items:
        # run_dir = outputs_dir (no eval-N nesting); all outputs go directly
        # into the smoke-test directory alongside trace.jsonl/report.json.
        report = run_eval_one(item, skill_path, outputs_dir, args.timeout, project_root)
        reports.append(report)

        orch = report["orchestration"]
        verdict = "PASS" if report["overall_pass"] else "FAIL"
        smoke_dir_name = outputs_dir.parent.name
        print(
            f"[{verdict}] {smoke_dir_name}  "
            f"phases_verified={orch['all_phases_verified']}  "
            f"clean={orch['clean_termination']}  "
            f"asks={orch['ask_count']}  "
            f"grading={report['grading']['summary']}",
            file=sys.stderr,
        )

    # Aggregate report at skill_data_dir root.
    aggregate = {
        "skill": str(skill_path),
        "eval_count": len(reports),
        "passed": sum(1 for r in reports if r["overall_pass"]),
        "failed": sum(1 for r in reports if not r["overall_pass"]),
        "reports": [r["overall_pass"] for r in reports],
        "timestamp": datetime.now().isoformat(),
    }
    with open(skill_data_dir / "aggregate.json", "w") as f:
        json.dump(aggregate, f, indent=2)

    sys.exit(0 if aggregate["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
