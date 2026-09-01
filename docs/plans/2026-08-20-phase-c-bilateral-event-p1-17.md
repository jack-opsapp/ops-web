# P1-17 bilateral appointment consumption and notification delivery

## Outcome

Turn P1-16's immutable bilateral-event envelope into one auditable, server-owned OPS appointment while keeping every uncertain case in review. Route iOS crew notifications through the authenticated dispatcher so the notification rail remains durable and quiet hours affect only push.

## Constraints

- Build on P1-16 commits through `8c86394e`; do not edit its clean worktree.
- Do not apply a production migration, mutate customer rows, push, deploy, or release.
- The unscheduled-task tray is excluded.
- OPS remains the calendar source of truth. Provider calendars are one-way mirrors.
- Existing Apple/Outlook iCalendar, iOS EventKit, and Google queue infrastructure are reused; arbitrary provider events never mutate leads.

## Implementation sequence

1. Pin focused tests for the handoff consumer, atomic migration contract, provider payload metadata, authenticated crew dispatch, and quiet-hours channel split.
2. Add a service-role-only leased consumer for `phase_c_bilateral_event_handoffs`.
   - Revalidate tenant, opportunity, owner, live permission, operator/customer identities, timezone, location, future bounds, cancellation, and conflicts under the same database transaction that creates the appointment.
   - Store the appointment as a booked `site_visits` row because it is the only lead-attached OPS appointment model already rendered by both schedules and mirrored to every supported provider path.
   - Add nullable appointment metadata so calls, meetings, work appointments, and site visits retain their correct title, kind, location, attendee evidence, and handoff identity without breaking installed clients.
   - Create the lead activity and qualifying-stage nudge in the atomic RPC; rely on the existing site-visit trigger for Google synchronization.
3. Drain the handoff queue after the existing Phase C intelligence worker.
   - Retry leased work with bounded backoff.
   - Read back the exact handoff and appointment before acknowledging.
   - Create one durable rail item for booked or review outcomes; quiet hours suppress only its push.
4. Extend Google and iCalendar payload builders to prefer the canonical appointment metadata while preserving legacy site-visit output.
5. Extend `/api/notifications/dispatch` with proof-only task/project crew events. The route calls the existing narrow authenticated RPCs to preserve their rail rows, then applies canonical preferences and quiet hours before push. iOS sends only the anchor IDs to this route and no longer calls the retired arbitrary-copy `/send` endpoint for those lifecycle events.
6. Run focused tests and static checks, commit web/backend work atomically, then update the Software Bible with explicit local/unapplied status and commit it separately.

## Verification targets

- One confirmed proposal/counterproposal creates one exact booked appointment.
- Handoff retries and duplicate correspondence return the same appointment.
- Missing permission, owner/attendee identity, timezone, location, and schedule conflicts become review outcomes with no appointment.
- Cancelled handoffs and stale leases cannot book.
- A notification failure leaves the terminal handoff retryable without recreating the appointment.
- Google payload/readback uses the canonical title/location and existing retry queue; Apple/Outlook feeds expose the same appointment metadata.
- Crew dispatch writes/retains the rail row, applies channel preferences, and drops only push during quiet hours.
