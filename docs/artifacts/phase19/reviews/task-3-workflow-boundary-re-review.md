# OPS MCP INVISIBLE OFFICE - P19-4 — boundary re-review

Verdict: PASS within the requested scope. Spec compliance: PASS for the reviewed fixes. Code quality: PASS. The remaining 2 P1 / 1 P2 findings are closed; 0 findings reopened. The earlier UUID repair remains verified.

Reviewed workflow migration SHA-256: `da904857f8bd7db78d900e0f38a70158f1b503c2d6aa0f1a0b0f7074d220465a`.

- **Invalid scheduling sources:** the task/calendar selections now admit malformed ranges independently of the overlap filter and explicitly reject partial/nonfinite dates before civil-time conversion. Reversed assigned task/calendar regressions pass. I additionally isolated each source and verified partial task start date, nonfinite task start/end, missing task civil time, and nonfinite calendar start/end. Every case independently returned not-ready with source-invalid evidence; another conflicting source could not mask these assertions.
- **Unlinked reads:** the shared SQL authorization requires `pipeline.view=all` when no opportunity/project linkage exists. Permanent regressions deny both form and source reads to the assigned-only actor, allow the all-scope actor, and deny company substitution. This restores the prior unlinked access boundary.
- **Historical cancellation:** new-appointment bounds are excluded for cancellation, historical empty/NULL assignment arrays are preserved, crew display aggregation returns an array, and readback compares nullable JSON safely. Actual prepare/commit tests preserve 600-minute duration and empty crew. NULL crew cancellation commits and replays without changing NULL into an empty array. Current proposal schemas accept these historical cancellation shapes while retaining new-booking validation.
- **Additional template-read alignment:** the SQL read gate matches the registry's pipeline/projects/settings permission alternatives. An independent regression denied template discovery after removing the available alternatives and accepted it when the assigned pipeline-read alternative was restored.

## Independent execution evidence

Ran the current combined disposable PostgreSQL fixture with scratch logs and an isolated socket/port. Result: exit 0; 19 permanent PASS groups plus 2 additional independent groups. Parsed all 21 freshly exported PostgreSQL proposals/receipts using the current Zod schemas under Node 22: 21 accepted, 0 failures. The server shut down through the runner's cleanup trap.

Evidence directory: `/private/tmp/p19-boundary-rereview-a92r3mnj/`.

- `logs/workflow-tests.log`: permanent and independent assertions.
- `logs/workflow-outputs.jsonl`: actual PostgreSQL output.
- `schema-results.json`: individual schema parse results.
- `extra.sql`: isolated partial/nonfinite/civil-time variants and template-role test.
- `run.sh`: current fixture adapted only for scratch logs, isolated port, and additional read-only review tests over synthetic data.

No source edits, production access, broad new audit, device build, or subagents. This closes the specified SQL findings; it does not establish whole-feature acceptance or close separate phone/approval/UI findings owned by other reviews.
