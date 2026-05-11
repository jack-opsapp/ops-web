-- product_bundle_items: child rows for a bundle product (kind='package').
-- bundle_pricing_mode: 'auto' rolls children up; 'override' uses a fixed price.

CREATE TABLE IF NOT EXISTS public.product_bundle_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bundle_product_id   uuid NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
  child_product_id    uuid NOT NULL REFERENCES public.products(id)  ON DELETE RESTRICT,
  quantity            numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  display_order       int     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz NULL,
  CONSTRAINT no_self_reference CHECK (bundle_product_id <> child_product_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_bundle  ON public.product_bundle_items (bundle_product_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pbi_child   ON public.product_bundle_items (child_product_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pbi_company ON public.product_bundle_items (company_id)        WHERE deleted_at IS NULL;

ALTER TABLE public.product_bundle_items ENABLE ROW LEVEL SECURITY;

-- Match existing OPS RLS convention (see products, product_materials):
-- simple company isolation at the DB layer; permission gating
-- (catalog.products.manage) lives in iOS/web permission_store before mutation.
CREATE POLICY company_isolation ON public.product_bundle_items
  FOR ALL
  USING (company_id = (SELECT private.get_user_company_id()))
  WITH CHECK (company_id = (SELECT private.get_user_company_id()));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS bundle_pricing_mode text NULL
    CHECK (bundle_pricing_mode IS NULL OR bundle_pricing_mode IN ('auto', 'override'));

COMMENT ON TABLE  public.product_bundle_items IS 'Child line items composing a bundle product. Bundle = products row with kind=package.';
COMMENT ON COLUMN public.products.bundle_pricing_mode IS 'NULL for non-bundles. auto = base_price computed from children; override = user-set base_price.';
