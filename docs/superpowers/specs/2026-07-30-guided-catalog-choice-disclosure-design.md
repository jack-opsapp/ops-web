# Guided Catalog Choice Disclosure

## Outcome

Guided Catalog Setup reads as one full-height conversation. Phase C's current
question and answer choices live together in the transcript; the floating
composer only contains message entry, SEND, and price-sheet upload. Long answer
choices never create a second scroll region or hide behind the composer.

## Layout options considered

### 1. Hierarchical — choices inside composer

```text
[ assistant question ]

┌ composer ──────────────────────────┐
│ choice / choice / choice           │
│ answer                         SEND│
└────────────────────────────────────┘
```

Rejected. It makes the composer own the content and recreates the clipping
failure.

### 2. Dashboard — choices in a separate card

```text
[ assistant question ]  [ choices card ]

┌ answer                         SEND┐
└────────────────────────────────────┘
```

Rejected. It breaks the conversational reading order and does not translate to
narrow screens.

### 3. Flow-focused — choices attached to the assistant turn

```text
[ PHASE C ]
[ question ]
[ helper ]
[ OPTIONS · 3  hide ]
  [ choice one ]
  [ choice two ]
  [ choice three ]

        ┌ floating answer        SEND┐
        └ upload price sheet ────────┘
[ start over ] [ another method ] [ back ]
```

Selected. The question, context, and choices remain one readable exchange.
Choices expand to their natural height inside the transcript and can be
collapsed without hiding the question.

### 4. Hybrid — modal choice picker

```text
[ assistant question ]
[ choose an option ]

        ┌ floating answer        SEND┐
        └────────────────────────────┘
```

Rejected. It removes choices from transcript history and adds an unnecessary
mode change.

## Visual treatment

- Choice copy is Mohave body-small, sentence case, left aligned.
- Each choice is a quiet, full-width row using OPS input/hover/active surface
  tokens, the chip radius, and glass hairlines.
- The disclosure control is JetBrains Mono micro text with a 16px chevron.
- The composer stays at the dense desktop tier. SEND uses the familiar 16px
  paper-airplane icon with its label and a deliberate 12px minimum right inset.
- Start over, use another method, and back to catalog remain outside the
  composer, left aligned as individual frosted-glass chips.

## Interaction and accessibility

- Choice panels start expanded so every current option is discoverable.
- The disclosure button exposes `aria-expanded` and `aria-controls`.
- Collapsing removes only the option rows. The Phase C label, question, and
  helper remain in the transcript.
- The transcript remains the only vertical scroll owner and receives the
  measured bottom spacer for the floating composer and footer.
- Expanding or collapsing repositions only the transcript itself.
- Motion is a restrained opacity/position reveal on the OPS easing curve.
  Reduced motion removes position movement and uses the reduced duration.
- Keyboard focus remains visible on every option, disclosure, composer action,
  and footer chip.

## Scope

Presentation and transcript scrolling only. Phase C prompts, capabilities,
company knowledge, sessions, catalog generation, database behavior, and live
data remain unchanged.
