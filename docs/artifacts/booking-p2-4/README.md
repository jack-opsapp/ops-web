# PUBLIC API P2-4 — staff booking settings + request handling

Proof shots, 2026-09-02, driven against the real dev server on this branch
(`feat/public-api-booking-p2`) signed in as PETE at MAVERICK PROJECTS LTD.

**What is real:** the settings shell and its section gate, the section itself,
the pipeline deal window, the lead's next-steps strip, and the decision dialog
— all shipped code, rendered by the app.

**What is stubbed:** the two P2-4 reads (`GET /api/settings/booking` and
`GET /api/opportunities/[id]/booking-request`) are fulfilled from fixtures at
the network boundary, because `public.site_visit_booking_policies` and
`private.guest_booking_intents` land with the P2-1 migration, which is not
applied to production yet. The routes themselves are covered by the contract
tests in `tests/unit/api/`. Live end-to-end proof is P2-5's scope.

| Shot | What it shows |
|---|---|
| `01-settings-mode-off` | The one control, three states, each saying what it means. Nothing else is rendered while booking is off — no hours, no limits, no assignment. |
| `02-settings-request-mode` | Choosing a mode reveals the terms. |
| `03-settings-week-grid` | The business's week as a week: seven rows, closed days as an em dash, one action to open a day. |
| `04-settings-limits` | Visit length leads on its own line; the three fences beneath it. |
| `05-settings-assignment` | Who new bookings go to, and the reassurance the customer never sees who. |
| `06-settings-overlap-refused` | A rule the table would refuse, named in the commit bar beside the change — not a thousand pixels above it. |
| `07-settings-hidden-no-integration` | The section is absent entirely for a company whose website is not connected to OPS. |
| `08-lead-requested-slot` | The lead's one visit entry reads `REQUESTED —` where a real appointment would read `BOOKED —`. Nothing is on a calendar yet (I14). |
| `09-lead-requested-chip` | The chip: outlined rather than filled, because the visit has been asked for, not made. |
| `10-lead-decision-dialog` / `10b-lead-decision-panel` | What the operator is deciding: the time asked for, who asked, what they told the website, and what accepting will book. |
| `11-lead-decision-moved` | Moving the time says so, and restates what acceptance will book. |
| `12-lead-decision-decline-armed` | Declining takes two moves and says what it does not do. |

Note: `<input type="time">` renders in the browser's own locale (12-hour on a
US machine). That is the platform's behaviour, shared with the staff booking
modal — every OPS-rendered time in these shots is 24-hour.
