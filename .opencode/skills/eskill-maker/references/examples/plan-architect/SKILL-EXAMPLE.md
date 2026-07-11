---
name: plan-architect
description: Create detailed implementation plans for features, refactors, or system changes. Use when users ask how to build, implement, plan, refactor, or architect something — even without saying "plan" directly (e.g., "I need to add X", "how should I approach Y", "help me restructure this", "refactor the auth system"). Includes research, alternatives analysis, and execution steps.
evolved: true
---

# Plan Architect

An Evolved Skill for creating comprehensive implementation plans covering research, alternatives analysis, decision making, and detailed execution steps.

## CRITICAL RULE: Stop after every `forced_todo` call

After any `forced_todo` call, **end your turn immediately**. No further tool calls. No further text.

## FIRST STEP: Declare your roadmap

Call `forced_todo` with action `roadmap`, naming the phases you'll run. Pick a subset that matches the user's request. Phase ids MUST match the headings below exactly (e.g. "Confirm Understanding").

```
forced_todo roadmap \
  --skill_name "plan-architect" \
  --phases ["Confirm Understanding", "Research", ...]
```

Examples:
- "Full implementation plan for OAuth" → all five phases.
- "Just help me understand the approach" → ["Confirm Understanding", "Research", "Present Options and Get Decisions"].
- "I already know what I want, just write the plan" → ["Write the Implementation Plan"].
- "Review my existing plan" → ["Review and Iterate"].

Then stop. The orchestrator sends the next instruction.

## How phases run

For each phase the orchestrator picks for you:

1. You receive a `[FORCED TODO] Act on phase: X` prompt with the phase content (and a recap of what earlier phases established).
2. You do the work.
3. You call `forced_todo progress --summary "<what you did>"` and stop.
4. If the phase needs verification (s.phase / m.phase), the orchestrator sends a verify prompt. Run the check (re-read or spawn a subagent), fix any gaps, then call `forced_todo progress --summary "<final summary, including fixes>"` and stop.
5. The orchestrator advances to the next phase.

Summaries should cover what's relevant to the phase: decisions made, facts established, artifacts produced, open items handed forward. 1–4 short bullets.

## Asking the user a question

Any time you need clarification, write the question text in your reply and call:

```
forced_todo ask --question "<the question text>"
```

Stop. The user will reply. On the next turn, continue acting on the current phase using their answer, then call `forced_todo progress` when done.

---

## Phase 1: Confirm Understanding
<!-- n.phase: confirm -->

Before doing anything else, **confirm your understanding** of the user's intent. This prevents wasted research effort on the wrong target.

Ask (or confirm):
1. **What** is being built/changed? (Be specific - not "auth" but "OAuth 2.0 with Google and GitHub")
2. **Why** does it need to be built? (Business value or problem solved)
3. **Where** in the codebase does this belong?
4. **When** does it need to be complete?
5. **Who** will maintain it?

If any of these are unclear, ask. Don't assume. A 2-minute clarifying conversation saves 2 hours of wasted planning.

## Phase 2: Research
<!-- m.phase: research -->

**Do extensive research before writing the plan.** This is what separates a good plan from a generic template.

Use all available research tools in parallel:
- **Web search** (`websearch`) for best practices, tooling landscape, comparisons
- **Code search** (`codesearch`) for framework docs, API patterns, library comparisons
- **Web fetch** (`webfetch`) for official documentation

Research areas:
- **Language/framework**: What are the standard tools and libraries? What does the community recommend?
- **Existing patterns**: How does the codebase solve similar problems? Don't invent when you can inherit.
- **Alternatives**: What other approaches exist? What are their tradeoffs?
- **Risks**: What could go wrong? What edge cases exist?

**For every significant decision** (library choice, architecture pattern, etc.), create a cost-benefit analysis:

```
Option A: [Name]
- Benefits: ...
- Costs: ...
- Risks: ...
- Decision: [Why you chose this]

Option B: [Name]
- ...
```

## Phase 3: Present Options and Get Decisions
<!-- m.phase: options -->

Before writing the implementation document, present options and get user input on:

1. **Scope**: Minimal viable version vs comprehensive solution?
2. **Architecture**: Reuse existing code/pipes or build new pipeline?
3. **Technology**: Stick with known tools or try something new?
4. **Integration**: How does this interact with existing systems?
5. **Constraints**: Budget, timeline, compatibility, performance requirements?
6. **Must-haves vs nice-to-haves**: What's critical vs optional?

**Present options with tradeoffs. Let the user decide.** Don't make unilateral decisions on things that affect their workflow.

If the user says "you decide" or "whatever you think is best", make the decision yourself but explain your reasoning.

## Phase 4: Write the Implementation Plan
<!-- s.phase: write -->

Structure the plan exactly as follows:

```markdown
# [Feature Name] Implementation Plan

## Overview
- What this implements (1-2 sentences)
- Status: [Planned | In Progress | Complete]
- Target completion: [Date or "TBD"]

## Context/Background
- Why this is needed (business problem or technical debt)
- Current state vs target state
- How this fits into the larger system

## Research Findings

### Options Considered

#### Option: [Name]
**Description:** [What it is]
**Benefits:** [Why it's good]
**Costs:** [Complexity, learning curve, dependencies]
**Risks:** [What could go wrong]
**Decision:** [Chosen or pending]

### Decision Made
- **Chosen approach:** [Name]
- **Rationale:** [Why this over alternatives]

### Risks Identified
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | [H/M/L] | [H/M/L] | [How to reduce] |

## Implementation Phases

### Phase 1: [Name] (Est: X days)
**Goal:** [What this phase achieves]

#### Step 1.1: [Description]
**Files:** `path/to/file1.ts`, `path/to/file2.ts`
**Actions:**
- [Specific action item]
- [Specific action item]

```typescript
// Key code for this step
const example = "code snippet";
```

#### Step 1.2: [Description]
...

### Phase 2: [Name] (Est: X days)
...

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/auth/oauth.ts` | Create | OAuth 2.0 flow handling |
| `src/db/schema.sql` | Modify | Add users oauth columns |

## Verification Checklist

### Functional
- [ ] [Test case 1]
- [ ] [Test case 2]

### Edge Cases
- [ ] [What happens on timeout?]
- [ ] [What happens with invalid tokens?]

### Integration
- [ ] [Does it work with existing auth?]
- [ ] [Does it preserve existing sessions?]

## Open Questions

- [ ] [Not yet decided - needs followup]
- [ ] [Blocked by X - waiting on decision]

## Appendix: Relevant Documentation

- [Link to framework docs]
- [Link to similar implementation]
```

## Phase 5: Review and Iterate
<!-- m.phase: review -->

After presenting the draft:
1. Ask if the **scope** is right (did you include too much or too little?)
2. Check if any **steps are unclear** (would another developer know what to do?)
3. Verify the **implementation order** makes sense (dependencies first?)
4. Confirm **file locations** match codebase structure

## Writing Style Guidelines

### Be Specific (This Matters)

**Bad:** "Add error handling"
**Good:** "Add try-catch around the database query in `getUser()` at `src/db.ts:42`. On error, log the full error with stack trace and return `null`. The calling code at `src/handlers/user.ts:15` already handles null returns."

**Bad:** "Update the API"
**Good:** "Replace `GET /api/users` at `src/routes/users.ts:23-31` with a new endpoint that accepts `?include_orgs=true` parameter. Return the same shape but with `organizations` array nested when flag is set."

### Code Examples

Include concrete code for:
- New interfaces/types (complete, not snippets)
- Key function implementations
- Event handlers with exact behavior
- Integration points with surrounding context

### File References

Always reference files with line numbers:
- `apps/cli/src/index.ts:127` - entry point where context is set up
- `packages/core/src/provider.ts` - imports and type definitions
- `tests/unit/auth.test.ts:45` - existing test pattern to follow

### Decision Logging

Document WHY decisions were made, not just what. Future you will thank present you.

```
**Decision:** Use event emitter pattern for token updates
**Rationale:** Other parts of the codebase (logging, metrics) already use this pattern,
making it consistent. Callbacks would require each consumer to manage subscription lifecycle.
```

## Common Patterns

See `references/common-patterns.md` for detailed guidance on:
- Token tracking implementation
- TUI implementation
- Database migrations
- API changes
- Adding authentication
- Building CLIs

## Integration with Existing Code

**Always start from existing code.** Before writing new implementation:
1. Find similar patterns in the codebase
2. Read the relevant files thoroughly
3. Understand the interfaces and contracts
4. Build on top of existing abstractions

**Don't duplicate logic.** If something exists, extend it rather than copy it.

## Output Format

Create the implementation plan as a markdown file:
- `docs/implementation/[feature-name]-implement.md` for project docs
- Or a location specified by the user

File naming: `[feature-name]-implement.md`
Examples: `TUI-implement.md`, `token-track-implement.md`, `oauth-refactor-implement.md`

## When to Push Back

The skill should trigger liberally, but push back on plans when:
- **Request is too vague** to even begin research - ask for clarification first
- **Scope is enormous** - suggest breaking into multiple implementation plans
- **Already has a good plan** - if the user clearly already thought this through, just help refine

In general: it's better to ask one clarifying question than to produce a useless 50-page plan for the wrong thing.