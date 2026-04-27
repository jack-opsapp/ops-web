# CALIBRATION — Execution Handoff Prompt

> **Purpose:** Paste-ready prompt for a **fresh** Claude Code session to execute the CALIBRATION implementation plan. Self-contained — assumes zero context from the sessions that wrote the plan.
>
> **Why a fresh session:** Planning and execution are different modes. A fresh agent truth-tests the plan by reading only what's written (not what the planner remembered). Clean context budget for the 40+ files execution will touch. Parallel to other terminals.

---

## Paste into new Claude Code terminal

```
Execute the CALIBRATION implementation plan at:
OPS-Web/docs/superpowers/plans/2026-04-23-calibration-implementation.md

That plan is self-contained. It has:
- Verified assumptions (§0) — 11 items resolved against the actual codebase
- File tree (§1.1 new files, §1.2 modifications, §1.3 dependency order)
- 40 tasks grouped A-O with copy-paste-ready code
- Dictionary files, SQL migrations, component code, service code, API routes — all written out
- Single-day rollout sequence (§3) — no bake window; OPS has one customer today

Your job: execute the plan task by task, in the dependency order §1.3
specifies. Commit after each task using the commit message shown in the task.

## Context you need

**Working directory:** /Users/jacksonsweet/Projects/OPS/OPS-Web

**Upstream docs (read before executing):**
- OPS-Web/docs/superpowers/specs/2026-04-23-calibration-design.md — the design spec
- OPS-Web/docs/superpowers/specs/2026-04-23-calibration-decisions.md — locked decisions from Phase 2 brainstorm
- OPS-Web/docs/superpowers/specs/2026-04-23-calibration-inventory.md — Phase 1 audit (for grounding)

**Project standards (non-negotiable):**
- /Users/jacksonsweet/.claude/CLAUDE.md — user-global standards
- /Users/jacksonsweet/Projects/OPS/CLAUDE.md — OPS Ltd. standards (perfection, no shortcuts, no TODOs)
- /Users/jacksonsweet/Projects/OPS/OPS-Web/CLAUDE.md — OPS-Web specific (tokens, fonts, z-index scale, notification rail pattern)
- /Users/jacksonsweet/Projects/OPS/OPS-Web/.interface-design/system.md — canonical design system v2

**Skills to load upfront, in order:**
1. animation-studio:animation-architect — motion gateway, required before any animation work
2. custom-skills:interface-design — every UI decision runs through system.md
3. frontend-design:frontend-design — component craft
4. animation-studio:data-visualization — count-ups, sparklines, progress rings
5. animation-studio:web-animations — framer-motion + CSS implementation
6. custom-skills:mobile-ux-design — tablet support (Jackson often on tablet in truck)
7. ops-copywriter:ops-copywriter — any copy must pass through this voice

Load them by invoking the Skill tool. Do not rely on generic animation /
UI patterns — the OPS voice is military-tactical minimalist, not SaaS generic.

**Supabase project:** ijeekuhbatykdomumfjx (OPS prod). MCP auth may need refresh.
When you hit the Supabase MCP for the first time, if it reports token expired,
ask Jackson to reconnect. Do not work around it by guessing schemas.

**Single-customer rollout context:**
OPS has one active customer today — Jackson's own company (CanPro Deck and
Rail). Ship to production same day. No feature-flag staging, no bake window,
no revert parachute. If anything breaks during browser verification (Group O),
fix it live. Dead code (Group N) deletes on ship day.

**Naming locked:**
- Destination: /calibration
- Sidebar icon: Radar (moves from /intel, which is removed from sidebar)
- Permission: email.configure_ai (reused; no new permission)
- Five tiles: INPUTS / CORPUS / CONFIG / ACTIVITY / MILESTONES
- Signature: radar-sweep in tile bottom-right corner (signature element — see task B1)

## Execution rules

1. **Commit after every task.** Use the exact commit message the task specifies.
2. **Do not skip browser verification.** Group O is not optional. Jackson validates
   live after the implementation work is done.
3. **If the plan has a gap, ASK.** Do not improvise. Do not invent schema. Do
   not guess column names. The plan is explicit; if something's missing, it's
   a planning gap and Jackson needs to know.
4. **Verify before writing destructive SQL.** Before running the migrations in
   Group L, read the actual admin_feature_overrides rows to confirm shape.
   The plan lists verified findings (V1-V11) — trust them, but confirm L1's
   existence check for users.preferences before applying L2.
5. **No emojis in code or commits.** OPS voice rejects decorative emoji.
6. **Animations must respect reduced motion.** Every animation's reduced-motion
   alternative is specified in the plan. If a component you write doesn't have
   one, stop and add it before moving on.
7. **Every user-facing string routes through useDictionary("calibration").**
   The plan's Group M defines the full en + es dictionaries.

## File collision warning

src/components/layouts/dashboard-layout.tsx (which renders the sidebar) may
be touched by other parallel sessions (notification rail group A, bug report
FAB, etc.). Before editing the sidebar for K4, pull main and rebase cleanly.
If there's a merge conflict on sidebar.tsx, resolve by adding the CALIBRATION
entry in the exact position the plan specifies — between /inbox and /estimates.

## User profile (Jackson Sweet)

- Solo engineer + trades contractor (runs CanPro Deck and Rail)
- Runs 8-9 parallel Claude terminals — will not read long status updates
- Prefers terse, point-form communication
- Asks clarifying questions rather than letting agents guess
- "Perfection is integral" — no shortcuts, no TODOs, no stubs
- Complexity is acceptable if it's correct; more code beats "simpler but wrong"

## Precision rules (project-wide, non-negotiable)

- Never guess data types, column names, API behavior. Read the code.
- If unsure, ask. Do not invent.
- When asked about behavior, read the file line by line — do not speculate.

## Start

Begin with Group L (migrations). L1 is a Supabase verification query —
after running it, report the result to Jackson before proceeding to L2.

From there, execute in §1.3 dependency order. Commit after each task.

Stop when Group O is complete and Jackson has validated each surface in
the browser.
```

---

## Notes for the orchestrator

**What the fresh agent has:**
- The full plan (ready to execute)
- The spec (for any visual / interaction clarification)
- The decisions doc (for rationale on locked choices)
- The design system (`.interface-design/system.md`) for all token references

**What the fresh agent should do if stuck:**
- Plan gap → ask Jackson
- Schema question → query Supabase MCP (re-auth if needed)
- Visual ambiguity → re-read the spec
- Decision ambiguity → re-read the decisions doc
- Voice / copy question → invoke ops-copywriter, re-read voice rules

**What the fresh agent should NOT do:**
- Invent structure / schema
- Skip commits to "batch later"
- Skip reduced-motion alternatives
- Hardcode hex values (everything routes through design system tokens)
- Rename files / directories the plan specifies
- Add emojis anywhere

**Open items for the orchestrator during execution:**
- If a regression surfaces mid-execution, it blocks further work. Fix it before proceeding.
- If Group O verification reveals a design gap, route back to the spec and update before fixing.
- If a new customer onboards mid-execution, the rollout assumptions change — stop and re-plan.

---

## After execution completes

- Confirm all 12 success criteria (plan §4) are met.
- Confirm no `ai_email_review` references remain:
  ```bash
  rg "ai_email_review" OPS-Web/src/
  ```
- Close out the planning trail: this handoff doc + the plan + the spec + the decisions + the inventory are the artifact set. They stay in `docs/superpowers/specs` and `docs/superpowers/plans` as the audit trail.

If something from this handoff is ambiguous, stop the fresh session and ask Jackson before guessing. The cost of asking is low; the cost of building the wrong thing is high.
