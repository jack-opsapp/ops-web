# Phase C Durable Conversation Implementation Plan

## Goal

Replace the transient guided questionnaire presentation with a persistent,
recoverable conversation while preserving the existing Phase C interview,
review, and guarded commit behavior.

## Work

1. Add failing component tests for optimistic acknowledgement, working state,
   readable message typography, restored transcript, and retrying the original
   answer without duplication.
2. Add failing service and schema tests for initial conversation seeding,
   existing-session normalization, and atomic transcript advancement.
3. Add an additive Supabase migration for the JSONB conversation field, update
   generated database types, and document the field in the OPS Software Bible.
4. Add shared conversation schemas and deterministic message construction.
5. Update session creation/resume and turn persistence so transcript changes
   share the session version guard.
6. Recompose the interview UI as a scrollable transcript and tokenized composer,
   with integrated upload, explicit activity, inline retry, keyboard behavior,
   reduced motion, and localized English/Spanish copy.
7. Run focused unit tests, type checking, linting, production build, design
   token audit, and browser verification at desktop and constrained viewport
   sizes.
8. Apply the additive migration, deploy the verified build, abandon only the
   exact active Canpro setup session using version guards, and confirm a fresh
   setup opens at the first prompt.
9. Trace the Phase C runtime prompt, live catalog snapshot, session sources, and
   supplier adapter activation; report exactly what knowledge Canpro receives.

## Safety

- The migration is additive and old application code ignores the new column.
- Session updates remain scoped by session, company, operator, and expected
  version.
- Restarting guided setup abandons the setup session only; it does not modify
  the live catalog.
- The catalog commit path is unchanged.
