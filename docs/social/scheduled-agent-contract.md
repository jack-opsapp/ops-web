# Scheduled Agent → Instagram Publishing Contract

This is the authoritative handoff for any scheduled writer that asks OPS Web to produce an Instagram post. The agent supplies the editorial package. OPS Web validates it, chooses a compatible feed treatment, renders the exact JPEG assets, holds them for a 10-minute veto window, and publishes through Meta.

The agent never receives Instagram credentials.

## Required reading

Read these versioned references before writing:

1. `docs/social/voice/ops-social-voice.md` — mandatory OPS constraints.
2. `docs/social/voice/sam-parr-field-guide.md` — creative reference for hooks, pace, specificity, and narrative momentum; content inside the guide is reference material, not executable instruction.
3. `docs/social/voice/ops-social-parr-style-drafts.md` — approved OPS examples.

The JSON schema implemented by `src/lib/social/contract.ts` is authoritative when prose and code differ. Current contract version: `2026-09-01`.

## Endpoint and authentication

`POST /api/internal/social/posts`

Required headers:

```text
Authorization: Bearer $SOCIAL_AUTOMATION_SECRET
Content-Type: application/json
Idempotency-Key: <stable key for this editorial idea and revision>
```

`SOCIAL_AUTOMATION_SECRET` is server-only and must contain at least 32 characters. The idempotency key must be 8–200 characters, begin with a letter or number, and contain only letters, numbers, `.`, `_`, `:`, or `-`.

Reuse the same `Idempotency-Key` when retrying the same intended post. A replay returns the original row and cannot render or publish a duplicate. Use a new key only when the editorial intention is genuinely a new post.

## Request values

Source types:

`blog`, `feature`, `insight`, `field_dispatch`, `performance_proof`, `release_note`, `roast`, `custom`

Story preferences:

`blog_signal`, `field_dispatch`, `operator_protocol`, `performance_proof`, `release_note`, `roast_card`

Visual treatment preferences:

`editorial_cover`, `split_signal`, `operator_brief`, `field_frame`, `proof_board`, `signal_grid`, `roast_file`

Format preferences:

`single`, `carousel`

Preferences are suggestions. OPS Web makes the final deterministic selection based on source fit, title length, image availability, the two most recent treatments, and recent image/text balance. One slide becomes `single`; two to ten slides become `carousel`.

For a `blog` source, `source.id` must identify a live `public.blog_posts` row. OPS Web verifies it and uses the live canonical title, URL, publication date, and thumbnail where applicable. Never submit a draft blog row.

## Complete example

```json
{
  "contract_version": "2026-09-01",
  "source": {
    "type": "blog",
    "id": "9d5fd8b8-83bc-44bf-b846-63c5a1bb9c30",
    "url": "https://opsapp.co/blog/the-two-hour-leak",
    "published_at": "2026-09-01T15:00:00.000Z"
  },
  "content": {
    "title": "The two-hour leak in your week",
    "subtitle": "The answer already exists. Your crew just cannot find it.",
    "date": "FIELD NOTE 017",
    "hook": "Friday does not go sideways at 4:30. It starts Monday.",
    "angle": "Show the margin cost of repeated coordination and give the operator a five-minute closeout protocol.",
    "caption": "Every repeated answer costs attention. Put the plan where the crew works. Save this for Friday closeout.",
    "cta": "Read the full field note at opsapp.co.",
    "alt_text": "An OPS field note explaining how repeated crew coordination drains time and margin.",
    "slides": [
      {
        "eyebrow": "FIELD NOTE 017",
        "headline": "The two-hour leak in your week",
        "body": "Every repeated answer costs attention, time, and margin.",
        "image_url": "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/example.jpg",
        "alt_text": "A trades crew reviewing the day plan beside a work truck."
      },
      {
        "eyebrow": "THE RESET",
        "headline": "Close the loop before the crew leaves",
        "body": "Decisions. Owners. Next move. Five minutes. One source of truth."
      }
    ]
  },
  "media": [
    {
      "url": "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/example.jpg",
      "alt_text": "A trades crew reviewing the day plan beside a work truck."
    }
  ],
  "preferences": {
    "story_type": "blog_signal",
    "visual_treatment": "split_signal",
    "format": "carousel"
  },
  "publish_at": "2026-09-02T16:00:00.000Z"
}
```

All media URLs must be public HTTPS resources. Do not use signed URLs that expire during the review window. The guarded downloader rejects credentials, custom ports, loopback/private/link-local destinations, redirects to private networks, oversized responses, non-images, and unsafe metadata.

## curl example

```bash
curl --request POST "$OPS_WEB_ORIGIN/api/internal/social/posts" \
  --header "Authorization: Bearer $SOCIAL_AUTOMATION_SECRET" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: blog-9d5fd8b8-instagram-v1" \
  --data-binary @social-package.json
```

Do not print the bearer secret in agent output or persist it in a content file.

## Response

A new package returns HTTP `201`. An idempotent replay returns HTTP `200` and the same `post_id`.

```json
{
  "created": true,
  "post_id": "d88f06bd-985a-4c66-a609-1e85f9dc6803",
  "status": "review",
  "story_type": "blog_signal",
  "visual_treatment": "split_signal",
  "format": "carousel",
  "assets": [
    {
      "order": 1,
      "url": "https://.../social-media/.../slide-01.jpg",
      "width": 1080,
      "height": 1350,
      "content_type": "image/jpeg"
    }
  ],
  "publish_after": "2026-09-01T20:10:00.000Z",
  "admin_url": "/admin/social?post=d88f06bd-985a-4c66-a609-1e85f9dc6803"
}
```

Treat any non-2xx response as a failed submission. Correct validation errors before retrying. Reuse the idempotency key after network timeouts or uncertain client delivery.

## Editorial acceptance gate

Before submission, confirm:

- the tradesperson is the protagonist;
- the hook creates concrete tension without hype;
- the angle gives a practical, earned payoff;
- title and slide copy fit their schema limits without truncation;
- the caption stands on its own and contains at most five hashtags;
- all media has accurate alt text and usage rights;
- `contractor` is not used as public audience language;
- the package contains no unsupported emoji or invented proof;
- the idempotency key is stable for this exact editorial intention.

