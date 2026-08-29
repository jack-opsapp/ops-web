-- ═══════════════════════════════════════════════════════════════════════════
-- Subject-preference learning (bug 4da75e71)
--
-- `agent_writing_profiles.subject_preferences` shipped with a reader
-- (`learnedNewThreadSubjectFromPreferences`) and no writer, so it was `{}` on
-- every row in production and new-lead outreach was drafted under a server
-- constant forever. This is the writer.
--
-- It is deliberately a small dedicated function rather than a change to the
-- outbound-learning apply path: subject evidence arrives on its own cadence and
-- must never be able to fail a body-learning transaction.
--
-- The stored shape is dictated by the reader, which is authoritative:
--   subject_preferences = {
--     "preferred_patterns": [
--       { "pattern": text, "count": int, "examples": [text],
--         "last_promoted_at": timestamptz }
--     ]
--   }
-- The reader ranks in stored order and requires count >= 3, so a subject has to
-- recur before it can speak for the operator.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.merge_agent_writing_profile_subject_preferences(
  p_company_id uuid,
  p_user_id uuid,
  p_profile_type text,
  p_subject text,
  p_context jsonb default '{}'::jsonb,
  p_is_thread_opening boolean default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  -- The reader's own token vocabulary. A pattern may only name these fields;
  -- anything else makes the pattern unusable at draft time.
  c_tokens constant text[] := array[
    'contact', 'company', 'address', 'project', 'email', 'number'
  ];
  -- Below three characters a value is not an identity, it is a coincidence:
  -- substituting it would shred unrelated words out of the subject.
  c_min_context_value constant integer := 3;
  c_max_patterns constant integer := 10;
  c_max_subject_length constant integer := 200;

  v_profile_type text;
  v_subject text;
  v_pattern text;
  v_token text;
  v_value text;
  v_now timestamptz := now();
  v_profile_id uuid;
  v_preferences jsonb;
  v_patterns jsonb;
  v_count integer;
  v_next jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null or p_user_id is null then
    raise exception 'invalid_subject_preference_merge' using errcode = '22023';
  end if;

  v_profile_type := coalesce(nullif(btrim(p_profile_type), ''), 'general');

  -- Mirror of `normalizeLearnedSubjectExample`: collapse whitespace, bound the
  -- length, and refuse anything a reply or forward prefix proves was not a
  -- thread-opening send. Kept in SQL so a subject reaching this function by any
  -- path is held to the same bar as one arriving through the service.
  v_subject := btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g'));

  if p_is_thread_opening is false
    or v_subject = ''
    or length(v_subject) > c_max_subject_length
    or v_subject ~* '^\s*re(\[[0-9]+\])?\s*:'
    or v_subject ~* '^\s*(fwd?|forwarded)\s*:'
  then
    return jsonb_build_object(
      'learned', false,
      'reason', 'not_thread_opening',
      'pattern', null,
      'count', null,
      'dry_run', coalesce(p_dry_run, false)
    );
  end if;

  -- De-identify: this lead's values become the reader's tokens, longest value
  -- first so a company name containing the contact name cannot be half-eaten.
  -- What is stored is a shape, never a customer's identity.
  v_pattern := v_subject;
  for v_token, v_value in
    select token, value
    from (
      select
        t as token,
        btrim(coalesce(p_context ->> t, '')) as value
      from unnest(c_tokens) as t
    ) candidates
    where length(candidates.value) >= c_min_context_value
    order by length(candidates.value) desc, candidates.token
  loop
    v_pattern := regexp_replace(
      v_pattern,
      regexp_replace(v_value, '[$()*+.?\[\\\]^{|}-]', '\\&', 'g'),
      '{' || v_token || '}',
      'gi'
    );
  end loop;

  v_pattern := btrim(regexp_replace(v_pattern, '\s+', ' ', 'g'));

  if v_pattern = '' or length(v_pattern) > c_max_subject_length then
    return jsonb_build_object(
      'learned', false,
      'reason', 'not_thread_opening',
      'pattern', null,
      'count', null,
      'dry_run', coalesce(p_dry_run, false)
    );
  end if;

  select p.id, coalesce(p.subject_preferences, '{}'::jsonb)
  into v_profile_id, v_preferences
  from public.agent_writing_profiles p
  where p.company_id = p_company_id
    and p.user_id = p_user_id
    and p.profile_type = v_profile_type
  for update;

  -- Learning enriches a voice that already exists. A profile conjured from a
  -- subject alone would claim a style it has never read a sentence of.
  if v_profile_id is null then
    return jsonb_build_object(
      'learned', false,
      'reason', 'profile_missing',
      'pattern', v_pattern,
      'count', null,
      'dry_run', coalesce(p_dry_run, false)
    );
  end if;

  v_patterns := coalesce(v_preferences -> 'preferred_patterns', '[]'::jsonb);
  if jsonb_typeof(v_patterns) <> 'array' then
    v_patterns := '[]'::jsonb;
  end if;

  select coalesce(
    max(
      case
        when entry ->> 'count' ~ '^[0-9]+$' then (entry ->> 'count')::integer
        else 0
      end
    ),
    0
  )
  into v_count
  from jsonb_array_elements(v_patterns) as entry
  where jsonb_typeof(entry) = 'object'
    and lower(coalesce(entry ->> 'pattern', '')) = lower(v_pattern);

  v_count := v_count + 1;

  with merged as (
    select jsonb_build_object(
      'pattern', v_pattern,
      'count', v_count,
      -- Examples are the de-identified pattern itself: the learner never
      -- retains a customer's subject line verbatim.
      'examples', jsonb_build_array(v_pattern),
      'last_promoted_at', v_now
    ) as entry
    union all
    select entry
    from jsonb_array_elements(v_patterns) as entry
    where jsonb_typeof(entry) = 'object'
      and btrim(coalesce(entry ->> 'pattern', '')) <> ''
      and lower(coalesce(entry ->> 'pattern', '')) <> lower(v_pattern)
  ),
  ranked as (
    select
      entry,
      row_number() over (
        order by
          (
            case
              when entry ->> 'count' ~ '^[0-9]+$'
                then (entry ->> 'count')::integer
              else 0
            end
          ) desc,
          coalesce(entry ->> 'last_promoted_at', '') desc
      ) as rank
    from merged
  )
  select coalesce(jsonb_agg(entry order by rank), '[]'::jsonb)
  into v_next
  from ranked
  where rank <= c_max_patterns;

  if coalesce(p_dry_run, false) then
    return jsonb_build_object(
      'learned', false,
      'reason', 'dry_run',
      'pattern', v_pattern,
      'count', v_count,
      'dry_run', true
    );
  end if;

  update public.agent_writing_profiles
  set subject_preferences = coalesce(v_preferences, '{}'::jsonb)
        || jsonb_build_object('preferred_patterns', v_next),
      updated_at = v_now
  where id = v_profile_id;

  return jsonb_build_object(
    'learned', true,
    'reason', 'merged',
    'pattern', v_pattern,
    'count', v_count,
    'dry_run', false
  );
end;
$function$;

revoke all on function public.merge_agent_writing_profile_subject_preferences(
  uuid, uuid, text, text, jsonb, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.merge_agent_writing_profile_subject_preferences(
  uuid, uuid, text, text, jsonb, boolean, boolean
) to service_role;

comment on function public.merge_agent_writing_profile_subject_preferences(
  uuid, uuid, text, text, jsonb, boolean, boolean
) is
  'Learns one thread-opening outbound subject into agent_writing_profiles.subject_preferences.preferred_patterns, de-identified against the lead context and capped at 10 patterns. Service role only (bug 4da75e71).';
