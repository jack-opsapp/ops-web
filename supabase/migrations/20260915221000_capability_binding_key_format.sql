-- Capability bindings must carry a capability ref the OPS registry publishes.
--
-- `catalog_product_capability_bindings.capability_key` is the handle a runtime
-- uses to find its binding. The registry publishes hyphenated, versioned refs
-- (`deck-geometry/v1`, `dynamic-material-quantity/v1`); the Phase C fixtures
-- wrote `deck_geometry/v1`, which no consumer looking a capability up by ref
-- would ever match. The application contract now rejects an unregistered ref;
-- this constraint keeps the shape true for any other writer (SQL, an agent, a
-- future MCP tool).
--
-- Shape only: lowercase dot-free segments joined by single hyphens, then
-- `/v<major>`. The registry — not the database — owns which refs exist, so the
-- check stays a format guard and never needs a migration when a capability is
-- added. Zero rows exist in this table in production today, so VALIDATE is
-- instant and cannot fail on history.
begin;
set local lock_timeout = '5s';

alter table public.catalog_product_capability_bindings
  add constraint catalog_product_capability_bindings_key_format
  check (capability_key ~ '^[a-z0-9]+(-[a-z0-9]+)*/v[0-9]+$')
  not valid;

alter table public.catalog_product_capability_bindings
  validate constraint catalog_product_capability_bindings_key_format;

comment on constraint catalog_product_capability_bindings_key_format
  on public.catalog_product_capability_bindings is
  'capability_key is an OPS capability ref: hyphenated segments plus /v<major>, e.g. deck-geometry/v1. The registry in src/lib/ops-capabilities/registry.ts owns which refs exist.';

do $postflight$
begin
  if exists (
    select 1
      from public.catalog_product_capability_bindings binding
     where binding.capability_key !~ '^[a-z0-9]+(-[a-z0-9]+)*/v[0-9]+$'
  ) then
    raise exception 'capability_binding_key_format_unenforced' using errcode = '55000';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'catalog_product_capability_bindings_key_format'
       and conrelid = 'public.catalog_product_capability_bindings'::regclass
       and convalidated
  ) then
    raise exception 'capability_binding_key_format_missing' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
