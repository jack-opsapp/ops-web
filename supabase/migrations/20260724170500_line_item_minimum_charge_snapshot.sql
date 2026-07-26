begin;

alter table public.line_items
  add column if not exists minimum_charge_snapshot numeric(14, 2)
    check (minimum_charge_snapshot is null or minimum_charge_snapshot >= 0);

alter table public.line_items
  drop column line_total;

alter table public.line_items
  add column line_total numeric generated always as (
    round(
      greatest(
        quantity * unit_price * (1 - coalesce(discount_percent, 0) / 100),
        coalesce(minimum_charge_snapshot, 0)
      ),
      2
    )
  ) stored;

comment on column public.line_items.minimum_charge_snapshot is
  'Product minimum charge captured when the line is configured; later Product edits do not alter the signed line.';

commit;
