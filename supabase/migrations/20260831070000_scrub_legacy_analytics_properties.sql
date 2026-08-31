begin;

-- Preserve the historical event and every safe dimension while removing raw
-- identifiers that predate the bounded analytics property contract.
with sanitized as (
  select
    event.id,
    coalesce((
      select jsonb_object_agg(property.key, property.value)
      from jsonb_each(event.properties) as property
      where public.analytics_properties_are_safe(
        jsonb_build_object(property.key, property.value)
      )
    ), '{}'::jsonb) as properties
  from public.analytics_events as event
  where not public.analytics_properties_are_safe(event.properties)
)
update public.analytics_events as event
set properties = sanitized.properties
from sanitized
where event.id = sanitized.id;

alter table public.analytics_events
  validate constraint analytics_events_properties_privacy_check;

comment on constraint analytics_events_properties_privacy_check
  on public.analytics_events is
  'Validated after unsafe legacy resource identifiers were removed without deleting event rows.';

commit;
