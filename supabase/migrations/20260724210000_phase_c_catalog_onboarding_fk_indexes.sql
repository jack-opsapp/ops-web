begin;

create index if not exists catalog_inventory_import_rows_committed_event
  on public.catalog_inventory_import_rows(committed_event_id)
  where committed_event_id is not null;

create index if not exists catalog_inventory_import_rows_committed_stock_unit
  on public.catalog_inventory_import_rows(committed_stock_unit_id)
  where committed_stock_unit_id is not null;

create index if not exists catalog_inventory_import_rows_matched_variant
  on public.catalog_inventory_import_rows(matched_variant_id)
  where matched_variant_id is not null;

create index if not exists catalog_inventory_imports_operator
  on public.catalog_inventory_imports(operator_id);

create index if not exists catalog_product_capability_bindings_product
  on public.catalog_product_capability_bindings(product_id);

create index if not exists catalog_setup_verification_items_resolved_by
  on public.catalog_setup_verification_items(resolved_by)
  where resolved_by is not null;

create index if not exists catalog_supplier_cost_profiles_variant
  on public.catalog_supplier_cost_profiles(catalog_variant_id);

create index if not exists product_material_quantity_rules_material
  on public.product_material_quantity_rules(product_material_id);

commit;
