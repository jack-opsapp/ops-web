# PUBLIC API — P2-3 hosted guest booking flow: proof

Date: 2026-09-02. Branch `feat/public-api-booking-p2`. Design authority:
`ops-software-bible/specs/2026-09-02-public-api-availability-and-guest-booking-design.md`
(§7, invariants I11–I16) and its parent P1 identity design. Built in the P1
hosted shell. The four booking routes landed in P2-2 while this was in flight;
the page is written against their shipped shapes and stubbed at the network
layer for the tests and screenshots, as P1-4 did for sign-in.

## What was verified

| Check | Result |
|---|---|
| Playwright smoke `tests/e2e/customer-booking.spec.ts` (chromium, broker stubbed) | 13 / 13 |
| Playwright smoke `tests/e2e/customer-signin.spec.ts` — regression after the shared changes | 12 / 12 |
| Vitest `tests/unit/customer/*` (booking format, booking API, theme, sign-in format, code input) | 93 / 93 |
| `tsc --noEmit` over the whole project | clean |
| ESLint on every new and touched file | clean |
| Design-system scan (hex literals, `rgb()`, `[Npx]` arbitraries, inline styles) | 0 findings |
| Token census — fonts / type / radius / height / spacing | every value a named token (below) |
| Accent discipline, measured in the live DOM | the CTA is the only accent user on the page |
| Text contrast, measured in the live DOM | every string ≥ 9.66:1 on the hosted canvas |
| Console + page errors across all 10 capture scenarios | 0 (one expected 404 in the booking-off capture) |

## The design decisions behind the screens

- **Absence, not explanation.** A day with nothing open has no chip, and there
  is no control anywhere that exists to say "unavailable". Booking turned off
  and a genuinely sold-out horizon render the identical page, which is also
  what keeps the surface enumeration-safe.
- **Selecting is free; holding is deliberate.** Tapping around the grid costs
  no network call. Only CONTINUE takes a hold, because a visitor gets three at
  a time (I13) and browsing must not burn them.
- **The day opens itself, the time never does.** The soonest open day is
  selected on arrival so real times are on screen immediately; the time is the
  actual decision and is never pre-picked.
- **The hold is quiet and honest.** Mono metadata, no ticking animation, no
  colour until the last minute, and no live region — a screen reader
  announcing a number every second would be unusable. It exists so nobody is
  surprised, not to hurry anyone.
- **Expiry loses the time, never the typing.** Both "your hold ran out" and
  "someone took that time" return to step one with name, email and phone
  intact, each with its own sentence.
- **Two endings that read differently.** `instant` states the appointment and
  what happens next. `request` says plainly that the business still has to
  confirm and that the time is not held until they do — carried by the words
  and by an attention tag, never by colour alone.
- **The account is offered once**, as a quiet line under a hairline after the
  booking is already real. Never a wall, never a step.
- **Times are the business's clock, always.** Rendered in the policy timezone
  with the zone named once (`MDT` in English, `hora de Denver` in Spanish —
  `short` degrades to a bare `GMT-6` there, which tells a homeowner nothing).

## Token census (every class used on the surface)

- Fonts: `font-cakemono` (always with `font-light`), `font-mohave`, `font-mono`. Nothing else.
- Type: `text-cake-display` (22), `text-cake-button` (14), `text-body` (16), `text-body-sm` (14), `text-data-lg` (20), `text-data-sm` (13), `text-micro` (11). No sub-11px.
- Radius: bare `rounded` (5px controls), `rounded-panel` (10), `rounded-chip` (4), `rounded-bar` (2). No `rounded-btn` (a 0px no-op in this repo).
- Sizing: `h-control-40` / `h-control-36`; bars and skeletons on the spacing scale.
- Spacing: `gap-0.5|1|2|3`, `px-0.5|1.5|2`, `py-1`, `pt-1.5`, `mt-1` — 4/8px grid only.
- Colour: none in the components. Every surface, text and border resolves through a `.cs-*` class bound to a `--portal-*` custom property, so a company's own theme owns the page.

## Motion

CSS only, reusing the two keyframes the sign-in flow already ships:
`cs-step-enter` for a step change (Transition beat) and the terminal state
(Achievement — a stamp, not a parade), `cs-fade-enter` for the time grid when
the day changes (Discovery). One easing token, `--ease-smooth`. Reduced motion
collapses every one of them to the existing opacity-only fallback. No
animation library was added.

## Accessibility change that reaches the sign-in page too

The hosted primary CTA is outlined at rest with its label in the company's
accent (DESIGN.md §9). Measured on the live page, the `portal_branding`
default accent `#417394` gave the CTA label **3.87:1** on the hosted canvas —
below WCAG AA (4.5:1) for 14px text, on the one button that moves a visitor
forward. The OPS accent passes at 6.16:1; the database default does not, and
most companies still carry the default.

`hosted-theme.ts` now measures the accent against the canvas it is drawn on
and emits `--portal-cta-label`: the accent when it clears AA, the text token
when it does not. The outline and the hover fill still carry the company's
colour, so the identity is unchanged — only the resting label is. Measured
after: **16.91:1**.

This also changes the resting CTA on `/c/<handle>/signin`, whose P1-4
screenshots predate it. `signin-cta-after-mobile.png` here is the current
look; the P1-4 folder's shots were left as that task's own record.
The change is its own commit and can be reverted alone if the older look is
preferred.

## Read against the routes P2-2 shipped

Checked line by line against `src/app/api/customer/booking/*/route.ts` after
they landed:

- **Availability** returns `{ mode, timezone, durationMinutes, slots: [{ startAt, ref }] }`.
  The descriptor is an opaque HMAC (design §4.4), so the page can never read a
  time out of it and takes each `startAt` beside it. `readSlot` accepts `ref`
  (shipped) or `slot` / `descriptor` / `token`, and drops any entry it cannot
  draw — a payload mismatch degrades to an honest "no open times" instead of a
  broken grid.
- **`mode` is used, not assumed.** With it, step one promises the truth before
  the visitor commits ("… {company} confirms it after"). Without it the page
  stays neutral, and a unit test asserts every pre-commit string is true under
  both modes.
- **404 means "there is nothing here."** The route answers 404 both for an
  unknown handle and for a business that has not turned booking on, so the
  page renders one neutral not-found body for both and offers no retry — the
  URL never confirms which is which.
- **Every hold refusal is one 409.** Booking off, an inactive integration, a
  closed slot and a hold cap all return `slot_no_longer_available`, so the page
  treats them alike: "That time was just taken. Pick another — your details
  are saved," then refreshes the list.
- **`not_confirmable` is not a code error.** It means the intent can no longer
  be booked, so it returns the visitor to step one like an expired hold rather
  than telling them their code was wrong.
- **`scheduledAt` outranks the page's own pick** for the ending, since it is
  what actually landed on the calendar; it is null in `request` mode (I14).

## Screenshots

Captured by `capture.mjs` against the local dev server with
`/api/customer/booking/*` stubbed. The fixture publishes ten open days between
2027-09-07 and 2027-09-20, five times on the first day, in `America/Denver`.

- `booking-01-time-{mobile,desktop}.png` — step 1
- `booking-02-details-{mobile,desktop}.png` — step 2, hold counting down
- `booking-03-code-{mobile,desktop}.png` — step 3
- `booking-04-confirmed-{mobile,desktop}.png` — **instant ending**
- `booking-0{1,2,3}-*-request-{mobile,desktop}.png` — the same three steps for a request-mode business
- `booking-04-submitted-request-{mobile,desktop}.png` — **request ending**
- `booking-05-sold-out-mobile.png` — nothing open (also what `mode: off` looks like)
- `booking-06-hold-expiring-mobile.png` — the countdown inside its last minute
- `booking-07-hold-expired-mobile.png` — released, back on step one, details kept
- `booking-08-more-days-mobile.png` — the day disclosure opened
- `booking-09-time-mobile-es.png` — Spanish via `Accept-Language`
- `booking-10-booking-off-mobile.png` — booking switched off (identical to an unknown link)
- `signin-cta-after-mobile.png` — the sign-in CTA after the contrast change

The bottom-left circular button in the screenshots is the Next.js dev overlay,
not part of the page.

## Reproduce

```bash
npm run dev -- -p 3691
E2E_PORT=3691 npx playwright test tests/e2e/customer-booking.spec.ts --project=chromium --workers=1
OUT=$PWD/docs/artifacts/customer-booking-p2-3 node docs/artifacts/customer-booking-p2-3/capture.mjs
node docs/artifacts/customer-booking-p2-3/audit.mjs   # box model + contrast, printed
```
