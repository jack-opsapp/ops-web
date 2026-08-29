-- Commit the production `public.vector` hotfix to source.
--
-- The learning apply function casts a stored embedding with
-- `(v_fact_json -> 'embedding')::text::<schema>.vector(1536)`. The shipped
-- source qualified that cast as `extensions.vector`, but the `vector` type
-- lives in `public` on this project, so every job carrying an embedding failed
-- on an unknown type. Production was hotfixed to `public.vector` and the queue
-- drained (34 completed, 0 pending), but the repo still carried the broken
-- qualification — a schema redeploy from source would have restored the
-- breakage.
--
-- This file re-sources the function so the repo matches production. It is the
-- body from 20260713205000_email_outbound_learning_queue.sql:1081-1892 with
-- exactly two intentional differences, both verified by diff:
--
--   1. the function name, which 20260713210000_phase_c_learning_signatures.sql
--      renamed to `apply_email_outbound_learning_legacy_internal` when it
--      wrapped this body with edit-learning promotion; and
--   2. the vector cast, `extensions.vector(1536)` -> `public.vector(1536)`.
--
-- Nothing else changes: not the signature, the return type, the search_path,
-- the lease and ownership checks, or any statement in the body. The public
-- `apply_email_outbound_learning` wrapper is untouched, and so is the grant
-- boundary re-stated below.

create or replace function public.apply_email_outbound_learning_legacy_internal(
  p_job_id uuid,
  p_lease_token uuid
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_job public.email_outbound_learning_queue;
  v_company_id uuid;
  v_sample jsonb;
  v_draft_outcome jsonb;
  v_profile_type text;
  v_profile public.agent_writing_profiles%rowtype;
  v_writing_receipt public.email_outbound_writing_samples%rowtype;
  v_old_count integer;
  v_new_count integer;
  v_greetings text[];
  v_closings text[];
  v_greeting text;
  v_closing text;
  v_vocab jsonb;
  v_punctuation jsonb;
  v_fact record;
  v_fact_json jsonb;
  v_memory public.agent_memories%rowtype;
  v_memory_id uuid;
  v_memory_effect text;
  v_edge record;
  v_edge_json jsonb;
  v_graph_id uuid;
  v_effective_follow_up_id uuid;
  v_effective_draft_id uuid;
  v_follow_up public.opportunity_follow_up_drafts%rowtype;
  v_draft public.ai_draft_history%rowtype;
  v_sent_at timestamptz;
begin
  -- Lock order for every application is queue, tenant connection, active user,
  -- per-user advisory lock, profile, facts by evidence key, edges by evidence key,
  -- draft history, then follow-up lifecycle row.
  select q.*
  into v_job
  from public.email_outbound_learning_queue q
  where q.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'outbound learning job does not exist';
  end if;

  -- A committed transaction followed by a lost HTTP response must never apply
  -- the effects a second time, even though the caller still has its old lease.
  if v_job.status = 'completed' then
    if v_job.completed_lease_token is distinct from p_lease_token then
      raise exception 'outbound learning application lost lease ownership';
    end if;
    if v_job.apply_full_body_learning is true and not exists (
      select 1
      from public.email_outbound_writing_samples r
      where r.queue_id = v_job.id
    ) then
      raise exception 'completed outbound learning job is missing its receipt';
    end if;
    return v_job;
  end if;

  if v_job.status <> 'leased'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at <= now()
  then
    raise exception 'outbound learning application lost lease ownership';
  end if;

  select c0.id
  into v_company_id
  from public.companies c0
  where c0.id::text = v_job.company_id
  for share;

  if v_company_id is null then
    raise exception 'outbound learning company no longer exists';
  end if;

  perform 1
  from public.email_connections c
  where c.id = v_job.connection_id
    and c.company_id = v_job.company_id
    and (
      c.type = 'company'
      or (
        c.type = 'individual'
        and nullif(btrim(c.user_id), '') = v_job.user_id
      )
    )
  for share;

  if not found then
    raise exception 'outbound learning connection ownership changed';
  end if;

  perform 1
  from public.users u
  where u.id::text = v_job.user_id
    and u.company_id::text = v_job.company_id
    and coalesce(u.is_active, true)
    and u.deleted_at is null
  for share;

  if not found then
    raise exception 'outbound learning user is no longer active in company';
  end if;

  if v_job.apply_learning is null
    or v_job.apply_full_body_learning is null
    or v_job.draft_outcome is null
    or v_job.draft_correction_facts is null
    or v_job.prepared_at is null
    or (
      v_job.apply_full_body_learning
      and (v_job.writing_sample is null or v_job.memory_extraction is null)
    )
  then
    raise exception 'outbound learning job has not been prepared';
  end if;

  v_draft_outcome := v_job.draft_outcome;

  if v_draft_outcome ->> 'finalVersion' is distinct from v_job.authored_body
    or v_draft_outcome ->> 'subject' is distinct from v_job.subject
  then
    raise exception 'outbound learning prepared outcome does not match sent message';
  end if;

  if v_job.apply_learning then
    perform pg_advisory_xact_lock(
      hashtextextended(v_job.company_id || ':' || v_job.user_id, 0)
    );

  if v_job.apply_full_body_learning then
  select r.*
  into v_writing_receipt
  from public.email_outbound_writing_samples r
  where r.queue_id = v_job.id
  for update;

  if v_writing_receipt.id is null then
    v_sample := v_job.writing_sample;
    v_profile_type := nullif(btrim(v_sample ->> 'profileType'), '');

    if v_profile_type is null
      or jsonb_typeof(v_sample -> 'formalityScore') is distinct from 'number'
      or jsonb_typeof(v_sample -> 'avgSentenceLength') is distinct from 'number'
    then
      raise exception 'prepared outbound learning writing sample is invalid';
    end if;

    insert into public.email_outbound_writing_samples (
      queue_id,
      company_id,
      connection_id,
      provider_message_id,
      user_id,
      profile_type,
      sample
    )
    values (
      v_job.id,
      v_job.company_id,
      v_job.connection_id,
      v_job.provider_message_id,
      v_job.user_id,
      v_profile_type,
      v_sample
    )
    returning * into v_writing_receipt;

    insert into public.agent_writing_profiles (
      company_id,
      user_id,
      profile_type,
      greeting_patterns,
      closing_patterns,
      vocabulary_preferences,
      tone_traits,
      emails_analyzed,
      updated_at
    )
    values (
      v_company_id,
      v_job.user_id,
      v_profile_type,
      '{}'::text[],
      '{}'::text[],
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      now()
    )
    on conflict (company_id, user_id, profile_type) do nothing;

    select p.*
    into v_profile
    from public.agent_writing_profiles p
    where p.company_id = v_company_id
      and p.user_id = v_job.user_id
      and p.profile_type = v_profile_type
    for update;

    if v_profile.id is null then
      raise exception 'outbound learning writing profile could not be locked';
    end if;

    v_old_count := greatest(0, coalesce(v_profile.emails_analyzed, 0));
    v_new_count := v_old_count + 1;
    v_greetings := coalesce(v_profile.greeting_patterns, '{}'::text[]);
    v_closings := coalesce(v_profile.closing_patterns, '{}'::text[]);
    v_greeting := nullif(btrim(v_sample ->> 'greeting'), '');
    v_closing := nullif(btrim(v_sample ->> 'closing'), '');

    if v_greeting is not null and not (v_greeting = any(v_greetings)) then
      v_greetings := array_append(v_greetings, v_greeting);
    end if;
    if cardinality(v_greetings) > 10 then
      v_greetings := v_greetings[1:10];
    end if;

    if v_closing is not null and not (v_closing = any(v_closings)) then
      v_closings := array_append(v_closings, v_closing);
    end if;
    if cardinality(v_closings) > 10 then
      v_closings := v_closings[1:10];
    end if;

    v_vocab := coalesce(v_profile.vocabulary_preferences, '{}'::jsonb);

    select coalesce(
      jsonb_object_agg(
        current_metric.key,
        to_jsonb(
          (
            coalesce(
              (v_vocab #>> array['punctuation_habits', current_metric.key])::numeric,
              current_metric.value::numeric
            ) * v_old_count
            + current_metric.value::numeric
          ) / v_new_count
        )
      ),
      '{}'::jsonb
    )
    into v_punctuation
    from jsonb_each_text(coalesce(v_sample -> 'punctuation', '{}'::jsonb))
      as current_metric(key, value);

    v_vocab := v_vocab || jsonb_build_object(
      'hedging_tendency',
        (
          coalesce(
            (v_vocab ->> 'hedging_tendency')::numeric,
            coalesce((v_sample ->> 'hedgingFrequency')::numeric, 0)
          ) * v_old_count
          + coalesce((v_sample ->> 'hedgingFrequency')::numeric, 0)
        ) / v_new_count,
      'punctuation_habits',
        coalesce(v_vocab -> 'punctuation_habits', '{}'::jsonb) || v_punctuation,
      'paragraph_structure', jsonb_build_object(
        'bulletFrequency',
          (
            coalesce(
              (v_vocab #>> '{paragraph_structure,bulletFrequency}')::numeric,
              coalesce((v_sample #>> '{paragraphStructure,bulletFrequency}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{paragraphStructure,bulletFrequency}')::numeric, 0)
          ) / v_new_count,
        'avgParagraphLines',
          (
            coalesce(
              (v_vocab #>> '{paragraph_structure,avgParagraphLines}')::numeric,
              coalesce((v_sample #>> '{paragraphStructure,avgParagraphLines}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{paragraphStructure,avgParagraphLines}')::numeric, 0)
          ) / v_new_count,
        'prefersBullets',
          coalesce((v_sample #>> '{paragraphStructure,prefersBullets}')::boolean, false)
          or coalesce((v_vocab #>> '{paragraph_structure,prefersBullets}')::boolean, false)
      ),
      'vocabulary_complexity', jsonb_build_object(
        'avgWordLength',
          (
            coalesce(
              (v_vocab #>> '{vocabulary_complexity,avgWordLength}')::numeric,
              coalesce((v_sample #>> '{vocabularyComplexity,avgWordLength}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{vocabularyComplexity,avgWordLength}')::numeric, 0)
          ) / v_new_count,
        'uniqueWordRatio',
          (
            coalesce(
              (v_vocab #>> '{vocabulary_complexity,uniqueWordRatio}')::numeric,
              coalesce((v_sample #>> '{vocabularyComplexity,uniqueWordRatio}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{vocabularyComplexity,uniqueWordRatio}')::numeric, 0)
          ) / v_new_count,
        'usesTradeJargon',
          coalesce((v_sample #>> '{vocabularyComplexity,usesTradeJargon}')::boolean, false)
          or coalesce((v_vocab #>> '{vocabulary_complexity,usesTradeJargon}')::boolean, false)
      ),
      'engagement_style', jsonb_build_object(
        'questionsPerEmail',
          (
            coalesce(
              (v_vocab #>> '{engagement_style,questionsPerEmail}')::numeric,
              coalesce((v_sample #>> '{engagementStyle,questionsPerEmail}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{engagementStyle,questionsPerEmail}')::numeric, 0)
          ) / v_new_count,
        'directAddressFreq',
          (
            coalesce(
              (v_vocab #>> '{engagement_style,directAddressFreq}')::numeric,
              coalesce((v_sample #>> '{engagementStyle,directAddressFreq}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{engagementStyle,directAddressFreq}')::numeric, 0)
          ) / v_new_count,
        'firstPersonFreq',
          (
            coalesce(
              (v_vocab #>> '{engagement_style,firstPersonFreq}')::numeric,
              coalesce((v_sample #>> '{engagementStyle,firstPersonFreq}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{engagementStyle,firstPersonFreq}')::numeric, 0)
          ) / v_new_count
      ),
      'email_length', jsonb_build_object(
        'avgWordCount',
          (
            coalesce(
              (v_vocab #>> '{email_length,avgWordCount}')::numeric,
              coalesce((v_sample #>> '{emailLength,wordCount}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{emailLength,wordCount}')::numeric, 0)
          ) / v_new_count,
        'lengthDistribution', jsonb_build_object(
          'short',
            coalesce((v_vocab #>> '{email_length,lengthDistribution,short}')::integer, 0)
            + case when v_sample #>> '{emailLength,category}' = 'short' then 1 else 0 end,
          'medium',
            coalesce((v_vocab #>> '{email_length,lengthDistribution,medium}')::integer, 0)
            + case when v_sample #>> '{emailLength,category}' = 'medium' then 1 else 0 end,
          'long',
            coalesce((v_vocab #>> '{email_length,lengthDistribution,long}')::integer, 0)
            + case when v_sample #>> '{emailLength,category}' = 'long' then 1 else 0 end
        )
      ),
      'last_outbound_learning_queue_id', v_job.id
    );

    update public.agent_writing_profiles p
    set formality_score = (
          coalesce(p.formality_score, (v_sample ->> 'formalityScore')::numeric)
            * v_old_count
          + (v_sample ->> 'formalityScore')::numeric
        ) / v_new_count,
        avg_sentence_length = (
          coalesce(p.avg_sentence_length, (v_sample ->> 'avgSentenceLength')::numeric)
            * v_old_count
          + (v_sample ->> 'avgSentenceLength')::numeric
        ) / v_new_count,
        greeting_patterns = v_greetings,
        closing_patterns = v_closings,
        vocabulary_preferences = v_vocab,
        emails_analyzed = v_new_count,
        updated_at = now()
    where p.id = v_profile.id;

    update public.email_outbound_writing_samples r
    set profile_id = v_profile.id
    where r.id = v_writing_receipt.id
    returning * into v_writing_receipt;
  end if;
  end if;

  -- A provider-sync job can complete before the send route attaches its draft
  -- provenance. In that race the immutable writing receipt already exists, but
  -- a later preparation can contain new human-correction facts. Evidence has
  -- its own provider/evidence-key receipts, so always evaluate it here while
  -- still applying every individual effect at most once.
  for v_fact in
      select prepared_fact.value
      from (
        select fact.value
        from jsonb_array_elements(
          coalesce(v_job.memory_extraction -> 'facts', '[]'::jsonb)
        ) as fact(value)
        union all
        select correction.value
        from jsonb_array_elements(v_job.draft_correction_facts) as correction(value)
      ) as prepared_fact
      order by prepared_fact.value ->> 'evidenceKey'
    loop
      v_fact_json := v_fact.value;

      if nullif(btrim(v_fact_json ->> 'evidenceKey'), '') is null
        or length(v_fact_json ->> 'evidenceKey') > 200
        or nullif(btrim(v_fact_json ->> 'type'), '') is null
        or nullif(btrim(v_fact_json ->> 'category'), '') is null
        or nullif(btrim(v_fact_json ->> 'content'), '') is null
        or jsonb_typeof(v_fact_json -> 'confidence') is distinct from 'number'
      then
        raise exception 'prepared outbound learning fact is invalid';
      end if;

      if v_fact_json ? 'embedding'
        and jsonb_typeof(v_fact_json -> 'embedding') not in ('array', 'null')
      then
        raise exception 'prepared outbound learning fact embedding is invalid';
      end if;
      if jsonb_typeof(v_fact_json -> 'embedding') = 'array'
        and jsonb_array_length(v_fact_json -> 'embedding') <> 1536
      then
        raise exception 'prepared outbound learning fact embedding must have 1536 dimensions';
      end if;

      if exists (
        select 1
        from public.email_outbound_memory_evidence e
        where e.company_id = v_job.company_id
          and e.connection_id = v_job.connection_id
          and e.provider_message_id = v_job.provider_message_id
          and e.evidence_kind = 'fact'
          and e.evidence_key = v_fact_json ->> 'evidenceKey'
      ) then
        continue;
      end if;

      select m.*
      into v_memory
      from public.agent_memories m
      where m.company_id = v_company_id
        and m.user_id is not distinct from v_job.user_id
        and m.category = v_fact_json ->> 'category'
        and lower(regexp_replace(btrim(m.content), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(
              btrim(v_fact_json ->> 'content'),
              '[[:space:]]+',
              ' ',
              'g'
            ))
      order by m.id
      limit 1
      for update;

      if v_memory.id is not null then
        update public.agent_memories m
        set confidence = least(
              1.0,
              greatest(coalesce(m.confidence, 0.5), (v_fact_json ->> 'confidence')::numeric)
                + 0.05
            ),
            access_count = coalesce(m.access_count, 0) + 1,
            last_accessed_at = now(),
            updated_at = now()
        where m.id = v_memory.id
        returning m.id into v_memory_id;
        v_memory_effect := 'reinforced';
      else
        insert into public.agent_memories (
          company_id,
          user_id,
          memory_type,
          category,
          content,
          embedding,
          confidence,
          source,
          source_id,
          last_accessed_at,
          access_count,
          updated_at
        )
        values (
          v_company_id,
          v_job.user_id,
          v_fact_json ->> 'type',
          v_fact_json ->> 'category',
          v_fact_json ->> 'content',
          case
            when jsonb_typeof(v_fact_json -> 'embedding') = 'array'
              then (v_fact_json -> 'embedding')::text::public.vector(1536)
            else null
          end,
          greatest(0.0, least(1.0, (v_fact_json ->> 'confidence')::numeric)),
          case
            when v_fact_json ->> 'category' = 'correction' then 'draft_edit'
            else 'email'
          end,
          v_job.provider_message_id,
          now(),
          1,
          now()
        )
        returning id into v_memory_id;
        v_memory_effect := 'inserted';
      end if;

      insert into public.email_outbound_memory_evidence (
        queue_id,
        writing_sample_id,
        company_id,
        connection_id,
        provider_message_id,
        user_id,
        evidence_kind,
        evidence_key,
        effect,
        memory_id
      )
      values (
        v_job.id,
        v_writing_receipt.id,
        v_job.company_id,
        v_job.connection_id,
        v_job.provider_message_id,
        v_job.user_id,
        'fact',
        v_fact_json ->> 'evidenceKey',
        v_memory_effect,
        v_memory_id
      );
  end loop;

  for v_edge in
      select edge.value
      from jsonb_array_elements(
        coalesce(v_job.memory_extraction -> 'edges', '[]'::jsonb)
      ) as edge(value)
      order by edge.value ->> 'evidenceKey'
    loop
      v_edge_json := v_edge.value;

      if nullif(btrim(v_edge_json ->> 'evidenceKey'), '') is null
        or length(v_edge_json ->> 'evidenceKey') > 200
        or nullif(btrim(v_edge_json ->> 'subjectType'), '') is null
        or nullif(btrim(v_edge_json ->> 'subjectId'), '') is null
        or nullif(btrim(v_edge_json ->> 'predicate'), '') is null
        or nullif(btrim(v_edge_json ->> 'objectType'), '') is null
        or nullif(btrim(v_edge_json ->> 'objectId'), '') is null
      then
        raise exception 'prepared outbound learning edge is invalid';
      end if;

      if exists (
        select 1
        from public.email_outbound_memory_evidence e
        where e.company_id = v_job.company_id
          and e.connection_id = v_job.connection_id
          and e.provider_message_id = v_job.provider_message_id
          and e.evidence_kind = 'edge'
          and e.evidence_key = v_edge_json ->> 'evidenceKey'
      ) then
        continue;
      end if;

      insert into public.agent_knowledge_graph as existing_graph (
        company_id,
        subject_type,
        subject_id,
        predicate,
        object_type,
        object_id,
        properties,
        confidence,
        valid_from,
        updated_at
      )
      values (
        v_company_id,
        v_edge_json ->> 'subjectType',
        v_edge_json ->> 'subjectId',
        v_edge_json ->> 'predicate',
        v_edge_json ->> 'objectType',
        v_edge_json ->> 'objectId',
        coalesce(v_edge_json -> 'properties', '{}'::jsonb),
        0.8,
        coalesce(v_job.occurred_at, now()),
        now()
      )
      on conflict (
        company_id,
        subject_type,
        subject_id,
        predicate,
        object_type,
        object_id
      )
      do update set
        properties = coalesce(existing_graph.properties, '{}'::jsonb)
          || excluded.properties,
        confidence = greatest(
          coalesce(existing_graph.confidence, 0.0),
          excluded.confidence
        ),
        valid_to = null,
        updated_at = now()
      returning id into v_graph_id;

      insert into public.email_outbound_memory_evidence (
        queue_id,
        writing_sample_id,
        company_id,
        connection_id,
        provider_message_id,
        user_id,
        evidence_kind,
        evidence_key,
        effect,
        knowledge_graph_id
      )
      values (
        v_job.id,
        v_writing_receipt.id,
        v_job.company_id,
        v_job.connection_id,
        v_job.provider_message_id,
        v_job.user_id,
        'edge',
        v_edge_json ->> 'evidenceKey',
        'upserted',
        v_graph_id
      );
  end loop;

  update public.email_outbound_learning_queue q
  set applied_at = coalesce(q.applied_at, now()),
      updated_at = now()
  where q.id = v_job.id
  returning * into v_job;
  end if;

  v_effective_follow_up_id := v_job.follow_up_draft_id;
  v_effective_draft_id := v_job.draft_history_id;
  v_sent_at := coalesce(v_job.occurred_at, now());

  if v_effective_draft_id is not null then
    select d.*
    into v_draft
    from public.ai_draft_history d
    where d.id = v_effective_draft_id
    for update;

    if v_draft.id is null
      or v_draft.company_id <> v_company_id
      or v_draft.user_id::text <> v_job.user_id
      or (
        v_draft.connection_id is not null
        and v_draft.connection_id <> v_job.connection_id
      )
      or (
        v_job.opportunity_id is not null
        and v_draft.opportunity_id is not null
        and v_draft.opportunity_id <> v_job.opportunity_id
      )
      or (
        v_job.provider_thread_id is not null
        and v_draft.thread_id is not null
        and v_draft.thread_id <> v_job.provider_thread_id
      )
    then
      raise exception 'outbound learning draft history provenance changed';
    end if;

    if v_draft.status not in ('drafted', 'auto_drafted', 'sent', 'sent_from_mailbox') then
      raise exception 'outbound learning draft history is not eligible for sent outcome';
    end if;

    if v_draft.status in ('sent', 'sent_from_mailbox')
      and v_draft.final_version is not null
      and btrim(v_draft.final_version) <> btrim(v_job.authored_body)
    then
      raise exception 'outbound learning draft history was sent with another body';
    end if;

    if v_draft.sent_provider_message_id is not null
      and v_draft.sent_provider_message_id <> v_job.provider_message_id
    then
      raise exception 'outbound learning draft history was sent as another provider message';
    end if;

    if (
      v_draft.status = 'sent_from_mailbox'
      and v_job.draft_delivery_channel <> 'mailbox'
    ) or (
      v_draft.status = 'sent'
      and v_job.draft_delivery_channel <> 'ops_send'
    ) then
      raise exception 'outbound learning draft history delivery channel changed';
    end if;

    update public.ai_draft_history d
    set connection_id = coalesce(d.connection_id, v_job.connection_id),
        opportunity_id = coalesce(d.opportunity_id, v_job.opportunity_id),
        thread_id = coalesce(d.thread_id, v_job.provider_thread_id),
        final_version = v_draft_outcome ->> 'finalVersion',
        edit_distance = (v_draft_outcome ->> 'editDistance')::integer,
        changes_made = v_draft_outcome -> 'changesMade',
        status = case
          when v_job.draft_delivery_channel = 'mailbox' then 'sent_from_mailbox'
          else 'sent'
        end,
        sent_provider_message_id = coalesce(d.sent_provider_message_id, v_job.provider_message_id),
        sent_without_changes = (v_draft_outcome ->> 'sentWithoutChanges')::boolean,
        sent_at = coalesce(d.sent_at, v_sent_at),
        edited_at = case
          when (v_draft_outcome ->> 'edited')::boolean
            then coalesce(d.edited_at, v_sent_at)
          else d.edited_at
        end,
        subject_source = case
          when (v_draft_outcome ->> 'subjectEdited')::boolean
            then 'operator'
          else d.subject_source
        end,
        subject = v_draft_outcome ->> 'subject'
    where d.id = v_effective_draft_id;
  end if;

  if v_effective_follow_up_id is not null then
    select f.*
    into v_follow_up
    from public.opportunity_follow_up_drafts f
    where f.id = v_effective_follow_up_id
    for update;

    if v_follow_up.id is null
      or v_follow_up.company_id <> v_company_id
      or (
        v_follow_up.connection_id is not null
        and v_follow_up.connection_id <> v_job.connection_id
      )
      or (
        v_job.opportunity_id is not null
        and v_follow_up.opportunity_id <> v_job.opportunity_id
      )
      or (
        v_job.provider_thread_id is not null
        and v_follow_up.provider_thread_id is not null
        and v_follow_up.provider_thread_id <> v_job.provider_thread_id
      )
      or v_follow_up.ai_draft_history_id is distinct from v_effective_draft_id
    then
      raise exception 'outbound learning follow-up draft provenance changed';
    end if;

    if v_follow_up.status not in ('drafted', 'sent') then
      raise exception 'outbound learning follow-up draft is not eligible for sent outcome';
    end if;

    if v_follow_up.status = 'sent'
      and v_follow_up.final_sent_body is not null
      and btrim(v_follow_up.final_sent_body) <> btrim(v_job.authored_body)
    then
      raise exception 'outbound learning follow-up draft was sent with another body';
    end if;

    update public.opportunity_follow_up_drafts f
    set connection_id = coalesce(f.connection_id, v_job.connection_id),
        provider_thread_id = coalesce(f.provider_thread_id, v_job.provider_thread_id),
        ai_draft_history_id = coalesce(f.ai_draft_history_id, v_effective_draft_id),
        subject = coalesce(v_job.subject, f.subject),
        final_sent_body = v_job.authored_body,
        status = 'sent',
        edited_by = v_job.user_id::uuid,
        edited_at = case
          when btrim(coalesce(f.current_body, f.original_body)) <> btrim(v_job.authored_body)
            or (
              v_job.subject is not null
              and v_job.subject is distinct from f.subject
            )
            then coalesce(f.edited_at, v_sent_at)
          else f.edited_at
        end,
        sent_at = coalesce(f.sent_at, v_sent_at),
        updated_at = now()
    where f.id = v_effective_follow_up_id;
  end if;

  update public.email_outbound_learning_queue q
  set draft_history_id = coalesce(q.draft_history_id, v_effective_draft_id),
      follow_up_draft_id = coalesce(q.follow_up_draft_id, v_effective_follow_up_id),
      status = 'completed',
      applied_at = coalesce(q.applied_at, now()),
      completed_at = now(),
      completed_lease_token = p_lease_token,
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now()
  where q.id = v_job.id
    and q.status = 'leased'
    and q.lease_token = p_lease_token
    and q.lease_expires_at > now()
  returning * into v_job;

  if v_job.id is null then
    raise exception 'outbound learning application lost lease ownership';
  end if;

  return v_job;
end;
$$;

revoke all on function public.apply_email_outbound_learning_legacy_internal(
  uuid, uuid
) from public, anon, authenticated, service_role;
