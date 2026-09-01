# Phase C lead-reply evaluation boundary

This directory provides deterministic, offline mechanics evidence only. It
proves that the fixture matrix, two-context runner, no-reply checks,
conservative clause permissions, and comparison accounting behave as designed.
Its candidate adapters may be local deterministic functions, so the returned
object has no measured-mode field and always owns the literal
`releaseGatePassed: false`, even when `qualityChecksPassed` is true.

There is deliberately no caller-selectable measured mode and no exported factory
that can promote arbitrary functions into trusted model paths. A future
production-only measured runner must be a separate boundary. It must call the
real whole-history and shared-memory paths, bind externally captured
model/revision/request provenance, and run only after deployment and production
shadow authorization. Until then, production reply quality is unmeasured.

Before any candidate is awaited, the runner exact-snapshots and deeply freezes
the complete fixture oracle, conversation, participant directory, and both
contexts. It also compiles the fixture-owned complete-clause permissions and
captures both path callable identities and the optional clock in that same
pre-await step. Accessors, proxies, symbols, extra fields, sparse arrays, and
non-plain records are rejected. Candidate adapters receive only the selected
immutable context plus ordinary runtime conversation facts. They never receive
fixture IDs, expected dispositions, expected claims, the expected recipient,
forbidden phrases, scoring limits, clause permissions, or variation exceptions.
Recipient selection must be derived from ordered turns and the deliberately
varied, sometimes ambiguous participant directory.

The deterministic scorer is intentionally conservative and is not a claim of
general language understanding. Every non-empty candidate clause must exactly
match a complete fixture-owned permission compiled before candidate execution.
Evidence-backed permissions must carry source IDs present in the selected
context and the immutable conversation. The only non-evidentiary permissions
are fixture-owned neutral questions and first-reply greetings. Unknown clauses,
refutations, extra timing, work, material, appointment, or commitment language
fail closed. This is a mechanics oracle; production reply quality remains
unmeasured until a separately trusted measured-model boundary exists.
