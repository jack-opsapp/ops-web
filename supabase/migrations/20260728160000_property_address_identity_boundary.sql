-- A locality is contextual metadata, never a job/property identity.
--
-- This migration is intentionally schema/behavior only. It does not rewrite
-- any existing opportunity, client, project, activity, or correspondence row.

create or replace function private.canonicalize_address_text(p_address text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'private'
as $function$
  with cleaned as (
    select btrim(
      regexp_replace(
        regexp_replace(lower(coalesce(p_address, '')), '[.,]', ' ', 'g'),
        '\s+',
        ' ',
        'g'
      )
    ) as value
  ),
  tokens as (
    select token, ordinality
      from cleaned,
      regexp_split_to_table(cleaned.value, '\s+')
        with ordinality as source(token, ordinality)
     where token <> ''
  )
  select coalesce(
    string_agg(
      case token
        when 'w' then 'west'
        when 'e' then 'east'
        when 'n' then 'north'
        when 's' then 'south'
        when 'nw' then 'northwest'
        when 'ne' then 'northeast'
        when 'sw' then 'southwest'
        when 'se' then 'southeast'
        when 'ave' then 'avenue'
        when 'av' then 'avenue'
        when 'st' then 'street'
        when 'str' then 'street'
        when 'rd' then 'road'
        when 'blvd' then 'boulevard'
        when 'boul' then 'boulevard'
        when 'dr' then 'drive'
        when 'cres' then 'crescent'
        when 'cr' then 'crescent'
        when 'hwy' then 'highway'
        when 'pl' then 'place'
        when 'ct' then 'court'
        when 'ln' then 'lane'
        when 'ter' then 'terrace'
        when 'pkwy' then 'parkway'
        when 'sq' then 'square'
        else token
      end,
      ' ' order by ordinality
    ),
    ''
  )
  from tokens;
$function$;

revoke all on function private.canonicalize_address_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.normalize_property_address(
  p_address text,
  p_include_unit boolean default true
) returns text
language plpgsql
immutable
set search_path to 'pg_catalog', 'private'
as $function$
declare
  v_raw text := btrim(coalesce(p_address, ''));
  v_property text;
  v_canonical text;
  v_base text;
  v_unit text;
  v_tokens text[];
  v_index integer;
  v_token text;
begin
  if v_raw = ''
    or v_raw ~* '^\s*(p\.?\s*o\.?\s+box|post office box)\y'
  then
    return '';
  end if;

  if v_raw ~* '^\s*(apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*[a-z0-9]+([-/][a-z0-9]+)*\s*[,;:-]?\s*.+$'
  then
    v_unit := lower(
      substring(
        v_raw from '^\s*(?:apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*([a-z0-9]+(?:[-/][a-z0-9]+)*)'
      )
    );
    v_property := regexp_replace(
      v_raw,
      '^\s*(apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*[a-z0-9]+([-/][a-z0-9]+)*\s*[,;:-]?\s*',
      '',
      'i'
    );
  elsif v_raw ~* '^\s*[a-z0-9]+\s*-\s*[0-9]+[a-z]?\s+.+$'
  then
    v_unit := lower(
      substring(v_raw from '^\s*([a-z0-9]+)\s*-\s*[0-9]+[a-z]?\s+')
    );
    v_property := regexp_replace(
      v_raw,
      '^\s*[a-z0-9]+\s*-\s*([0-9]+[a-z]?)\s+(.+)$',
      '\1 \2',
      'i'
    );
  elsif v_raw ~* '(^|[,\s]+)(apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*[a-z0-9]+([-/][a-z0-9]+)*\y'
  then
    v_unit := lower(
      substring(
        v_raw from '(?:^|[,\s]+)(?:apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*([a-z0-9]+(?:[-/][a-z0-9]+)*)'
      )
    );
    v_property := regexp_replace(
      v_raw,
      '(^|[,\s]+)(apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*[a-z0-9]+([-/][a-z0-9]+)*.*$',
      '',
      'i'
    );
  else
    v_property := v_raw;
  end if;

  v_canonical := private.canonicalize_address_text(v_property);
  if length(v_canonical) < 5 then
    return '';
  end if;

  if v_canonical ~ '^[0-9]+[a-z]?\s+(?=\S*[a-z])\S+' then
    v_tokens := regexp_split_to_array(v_canonical, '\s+');
    v_base := v_canonical;

    if v_tokens[2] = 'highway'
      and coalesce(v_tokens[3], '') ~ '^[a-z0-9-]+$'
    then
      v_base := array_to_string(v_tokens[1:3], ' ');
    elsif v_tokens[2] in ('range', 'township')
      and v_tokens[3] = 'road'
      and coalesce(v_tokens[4], '') ~ '^[a-z0-9-]+$'
    then
      v_base := array_to_string(v_tokens[1:4], ' ');
    else
      for v_index in 3..coalesce(array_length(v_tokens, 1), 0) loop
        v_token := v_tokens[v_index];
        if v_token in (
          'avenue', 'boulevard', 'court', 'crescent', 'drive', 'highway',
          'lane', 'parkway', 'place', 'road', 'square', 'street', 'terrace'
        ) then
          v_base := array_to_string(v_tokens[1:v_index], ' ');
          exit;
        end if;
      end loop;
    end if;
  elsif v_canonical ~ '^(rr|rural route)\s*[0-9]+\y.*\y(site|box|lot)\s*[a-z0-9-]+\y'
    or v_canonical ~ '^(site|box)\s*[a-z0-9-]+\y.*\y(rr|rural route)\s*[0-9]+\y'
    or v_canonical ~ '^lot\s+[a-z0-9-]+\y.*\y(concession|block|plan)\s+[a-z0-9-]+\y'
  then
    v_base := v_canonical;
  elsif v_canonical ~ '^(parcel|pid)\s+[a-z0-9][a-z0-9-]{4,}\y'
  then
    v_base := v_canonical;
  else
    return '';
  end if;

  if p_include_unit and nullif(v_unit, '') is not null then
    return v_base || ' unit ' || v_unit;
  end if;
  return v_base;
end;
$function$;

revoke all on function private.normalize_property_address(text, boolean)
  from public, anon, authenticated, service_role;

-- Compatibility name retained for existing conversion/preflight callers. Its
-- semantics are now explicitly property-qualified.
create or replace function private.normalize_address(p text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'private'
as $function$
  select private.normalize_property_address(p, true);
$function$;

revoke all on function private.normalize_address(text)
  from public, anon, authenticated, service_role;

-- Email conversion and every ordinary duplicate/preflight caller now share the
-- exact same qualification and unit identity.
create or replace function private.normalize_email_project_dedupe_address(
  p_address text
) returns text
language sql
immutable
set search_path to 'pg_catalog', 'private'
as $function$
  select private.normalize_property_address(p_address, true);
$function$;

revoke all on function private.normalize_email_project_dedupe_address(text)
  from public, anon, authenticated, service_role;

do $property_address_contract$
begin
  if private.normalize_property_address('Victoria') <> ''
    or private.normalize_property_address('Saanich Cedar Hill area') <> ''
    or private.normalize_property_address('Victoria, BC V8W 1P6') <> ''
    or private.normalize_property_address('PO Box 123, Victoria BC') <> ''
    or private.normalize_property_address('250 888 3674') <> ''
    or private.normalize_property_address('2026 07 28') <> ''
    or private.normalize_property_address('123 456') <> ''
  then
    raise exception 'locality entered property address identity';
  end if;

  if private.normalize_property_address('2745 Fernwood Rd, Victoria BC')
      is distinct from '2745 fernwood road'
    or private.normalize_property_address('Unit 2, 123 Main Street')
      is distinct from '123 main street unit 2'
    or private.normalize_property_address('123 Main St Apt 2')
      is not distinct from private.normalize_property_address('123 Main St Apt 3')
    or private.normalize_property_address('RR 2 Site 4 Box 19')
      is distinct from 'rr 2 site 4 box 19'
    or private.normalize_property_address('Lot 12 Concession 3')
      is distinct from 'lot 12 concession 3'
  then
    raise exception 'property address identity contract failed';
  end if;
end;
$property_address_contract$;
