-- =================================================================
-- Migration 076: Backfill email_threads from activities
--
-- Context
-- -------
-- Migration 071 introduced `email_threads` as the Inbox v2 source-of-truth
-- per-thread state table, and sync-engine.ts step 7.5 upserts into it on
-- every new inbound/outbound email. But the table was NOT backfilled for
-- historical activity rows that predate the rebuild — so every existing
-- OPS customer opens /inbox to an empty list even though their `activities`
-- table is full of real email messages.
--
-- This migration performs that backfill directly in SQL. It is:
--   - Real-emails-only (email_message_id IS NOT NULL AND <> ''). Synthetic
--     "Pipeline import:" activity rows are excluded — they are not real
--     Gmail/M365 threads and do not belong in the inbox.
--   - Direction-correct (derived from `from_email = connection.email`,
--     because the `activities.direction` column is unreliable for
--     imported data).
--   - Connection-matched (picks the connection whose email appears in the
--     thread's messages; falls back to the company's oldest sync-enabled
--     connection for multi-connection / ambiguous cases).
--   - Label-seeded (AWAITING_REPLY when latest message is inbound and
--     contains a question pattern, HAS_ATTACHMENT when any message carried
--     one). Matches the live `evaluateLabelsFromMessages` heuristic in
--     email-thread-service.ts so rail filters work immediately.
--   - Idempotent (ON CONFLICT (connection_id, provider_thread_id) DO
--     NOTHING). Safe to replay if the live backfill admin endpoint re-runs
--     it against the same company later.
--
-- Category is intentionally left as 'OTHER' with confidence 0 and
-- classifier_version='backfill-v1'. The upsert path already treats rows
-- with confidence <0.6 as "needs classify" on next inbound, so threads
-- will get real Phase C categorization without a blocking OpenAI run
-- during this migration.
-- =================================================================

WITH email_msgs AS (
  SELECT
    a.id,
    a.company_id,
    a.email_thread_id AS provider_thread_id,
    a.email_message_id,
    a.subject,
    a.from_email,
    a.to_emails,
    a.cc_emails,
    a.body_text,
    a.content,
    a.has_attachments,
    a.is_read,
    a.created_at,
    a.opportunity_id,
    a.client_id
  FROM public.activities a
  WHERE a.type = 'email'
    AND a.email_thread_id IS NOT NULL
    AND a.email_thread_id <> ''
    AND a.email_message_id IS NOT NULL
    AND a.email_message_id <> ''
),
-- Row-numbered for DISTINCT-ON-like access without repeating the filter
msgs_ranked AS (
  SELECT
    m.*,
    row_number() OVER (PARTITION BY m.company_id, m.provider_thread_id ORDER BY m.created_at DESC) AS rn_desc,
    row_number() OVER (PARTITION BY m.company_id, m.provider_thread_id ORDER BY m.created_at ASC)  AS rn_asc
  FROM email_msgs m
),
latest_msg AS (
  SELECT * FROM msgs_ranked WHERE rn_desc = 1
),
first_subject AS (
  -- Earliest non-empty subject across the thread
  SELECT DISTINCT ON (company_id, provider_thread_id)
    company_id, provider_thread_id, subject
  FROM msgs_ranked
  WHERE subject IS NOT NULL AND subject <> ''
  ORDER BY company_id, provider_thread_id, rn_asc
),
thread_stats AS (
  -- One row per thread with aggregated stats. Direction is derived below
  -- using the connection email, so we don't aggregate `direction` here.
  SELECT
    m.company_id,
    m.provider_thread_id,
    count(*)                                                     AS message_count,
    min(m.created_at)                                            AS first_message_at,
    max(m.created_at)                                            AS last_message_at,
    bool_or(COALESCE(m.has_attachments, false))                  AS any_has_attachment,
    (array_agg(m.opportunity_id ORDER BY m.created_at DESC) FILTER (WHERE m.opportunity_id IS NOT NULL))[1] AS opportunity_id,
    (array_agg(m.client_id      ORDER BY m.created_at DESC) FILTER (WHERE m.client_id      IS NOT NULL))[1] AS client_id
  FROM msgs_ranked m
  GROUP BY m.company_id, m.provider_thread_id
),
thread_participants AS (
  -- Union of from + to + cc addresses across all messages, deduped + lowercased
  SELECT
    m.company_id,
    m.provider_thread_id,
    array_agg(DISTINCT trim(lower(addr))) FILTER (
      WHERE addr IS NOT NULL AND trim(addr) <> ''
    ) AS participants
  FROM msgs_ranked m
  CROSS JOIN LATERAL unnest(
    array_append(COALESCE(m.to_emails, ARRAY[]::text[]), m.from_email)
    || COALESCE(m.cc_emails, ARRAY[]::text[])
  ) AS addr
  GROUP BY m.company_id, m.provider_thread_id
),
connection_pick AS (
  -- Decide the owning connection for each thread. A real Gmail thread ID is
  -- mailbox-local so there is typically exactly one match per company.
  -- Match preference:
  --   1. The connection whose email appears as the sender of at least one
  --      message in the thread (user sent at some point — same connection).
  --   2. The connection whose email appears in a to/cc field (thread landed
  --      in that mailbox).
  --   3. Fallback: oldest sync-enabled connection for the company.
  SELECT
    ts.company_id,
    ts.provider_thread_id,
    COALESCE(
      (
        SELECT ec.id
        FROM public.email_connections ec
        WHERE ec.company_id::text = ts.company_id::text
          AND ec.sync_enabled = true
          AND EXISTS (
            SELECT 1 FROM msgs_ranked m
            WHERE m.company_id = ts.company_id
              AND m.provider_thread_id = ts.provider_thread_id
              AND lower(m.from_email) = lower(ec.email)
          )
        ORDER BY ec.created_at ASC
        LIMIT 1
      ),
      (
        SELECT ec.id
        FROM public.email_connections ec
        WHERE ec.company_id::text = ts.company_id::text
          AND ec.sync_enabled = true
          AND EXISTS (
            SELECT 1 FROM msgs_ranked m
            WHERE m.company_id = ts.company_id
              AND m.provider_thread_id = ts.provider_thread_id
              AND (
                lower(ec.email) = ANY(SELECT lower(t) FROM unnest(COALESCE(m.to_emails, ARRAY[]::text[])) t)
                OR lower(ec.email) = ANY(SELECT lower(t) FROM unnest(COALESCE(m.cc_emails, ARRAY[]::text[])) t)
              )
          )
        ORDER BY ec.created_at ASC
        LIMIT 1
      ),
      (
        SELECT ec.id
        FROM public.email_connections ec
        WHERE ec.company_id::text = ts.company_id::text
          AND ec.sync_enabled = true
        ORDER BY ec.created_at ASC
        LIMIT 1
      )
    ) AS connection_id
  FROM thread_stats ts
),
thread_final AS (
  SELECT
    ts.company_id,
    cp.connection_id,
    ts.provider_thread_id,
    -- Derive direction from: is the latest message's sender the owning
    -- mailbox? If yes → outbound. Else → inbound.
    CASE
      WHEN lower(l.from_email) = lower(ec.email) THEN 'outbound'
      ELSE 'inbound'
    END AS latest_direction_derived,
    l.from_email AS latest_sender_email,
    COALESCE(
      NULLIF(trim(l.from_email), ''),
      split_part(l.from_email, '@', 1),
      'Unknown'
    )::text AS latest_sender_raw,
    l.body_text,
    l.content,
    fs.subject AS first_subject,
    ts.message_count,
    ts.first_message_at,
    ts.last_message_at,
    ts.any_has_attachment,
    ts.opportunity_id,
    ts.client_id,
    tp.participants,
    l.is_read AS latest_is_read
  FROM thread_stats ts
  JOIN latest_msg l           ON l.company_id = ts.company_id AND l.provider_thread_id = ts.provider_thread_id
  JOIN connection_pick cp     ON cp.company_id = ts.company_id AND cp.provider_thread_id = ts.provider_thread_id
  LEFT JOIN first_subject fs  ON fs.company_id = ts.company_id AND fs.provider_thread_id = ts.provider_thread_id
  LEFT JOIN thread_participants tp ON tp.company_id = ts.company_id AND tp.provider_thread_id = ts.provider_thread_id
  LEFT JOIN public.email_connections ec ON ec.id = cp.connection_id
  WHERE cp.connection_id IS NOT NULL
)
INSERT INTO public.email_threads (
  company_id,
  connection_id,
  provider_thread_id,
  primary_category,
  category_confidence,
  category_classifier_version,
  category_manually_set,
  labels,
  subject,
  participants,
  first_message_at,
  last_message_at,
  message_count,
  unread_count,
  latest_direction,
  latest_sender_email,
  latest_sender_name,
  latest_snippet,
  opportunity_id,
  client_id,
  priority_score
)
SELECT
  tf.company_id,
  tf.connection_id,
  tf.provider_thread_id,
  'OTHER',
  0.00,
  'backfill-v1',
  false,
  -- Label heuristic mirrors evaluateLabelsFromMessages in
  -- email-thread-service.ts so backfilled threads land in the correct
  -- rail immediately.
  (
    CASE
      WHEN tf.latest_direction_derived = 'inbound' AND (
        position('?' in COALESCE(tf.body_text, tf.content, '')) > 0
        OR COALESCE(tf.body_text, tf.content, '') ~* '(can you|could you|please|let me know|any chance|when|what time|confirm|awaiting|looking forward)'
      )
      THEN ARRAY['AWAITING_REPLY']::text[]
      ELSE ARRAY[]::text[]
    END
    ||
    CASE WHEN tf.any_has_attachment THEN ARRAY['HAS_ATTACHMENT']::text[] ELSE ARRAY[]::text[] END
  ) AS labels,
  COALESCE(NULLIF(tf.first_subject, ''), '(no subject)'),
  COALESCE(tf.participants, ARRAY[]::text[]),
  tf.first_message_at,
  tf.last_message_at,
  tf.message_count,
  -- Unread count: only count latest inbound if not yet read. Historical
  -- read state across the whole thread is not reliable (is_read in
  -- activities was populated differently across eras), so we stay
  -- conservative and only mark the head message.
  CASE
    WHEN tf.latest_direction_derived = 'inbound' AND NOT COALESCE(tf.latest_is_read, false) THEN 1
    ELSE 0
  END AS unread_count,
  tf.latest_direction_derived,
  tf.latest_sender_email,
  split_part(tf.latest_sender_email, '@', 1),
  left(COALESCE(NULLIF(tf.body_text, ''), NULLIF(tf.content, ''), ''), 400),
  tf.opportunity_id,
  tf.client_id,
  0.00
FROM thread_final tf
ON CONFLICT (connection_id, provider_thread_id) DO NOTHING;
