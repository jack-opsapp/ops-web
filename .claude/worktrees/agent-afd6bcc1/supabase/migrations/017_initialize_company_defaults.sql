-- 017: Create initialize_company_defaults function
--
-- Idempotent function that seeds default task types, inventory units,
-- and company settings for a newly created company.
-- Called from both web (Next.js) and iOS (Swift SDK) via .rpc().

CREATE OR REPLACE FUNCTION initialize_company_defaults(p_company_id UUID)
RETURNS void AS $$
BEGIN
  -- Task Types (skip if any already exist for this company)
  IF NOT EXISTS (SELECT 1 FROM task_types WHERE company_id = p_company_id AND deleted_at IS NULL) THEN
    INSERT INTO task_types (company_id, display, color, is_default, display_order) VALUES
      (p_company_id, 'Quote',        '#B5A381', true, 0),
      (p_company_id, 'Installation', '#8195B5', true, 1),
      (p_company_id, 'Repair',       '#B58289', true, 2),
      (p_company_id, 'Inspection',   '#9DB582', true, 3),
      (p_company_id, 'Consultation', '#A182B5', true, 4),
      (p_company_id, 'Follow-up',    '#C4A868', true, 5);
  END IF;

  -- Inventory Units (skip if any already exist)
  IF NOT EXISTS (SELECT 1 FROM inventory_units WHERE company_id = p_company_id AND deleted_at IS NULL) THEN
    INSERT INTO inventory_units (company_id, display, is_default, sort_order) VALUES
      (p_company_id, 'ea',     true, 0),
      (p_company_id, 'box',    true, 1),
      (p_company_id, 'ft',     true, 2),
      (p_company_id, 'm',      true, 3),
      (p_company_id, 'kg',     true, 4),
      (p_company_id, 'lb',     true, 5),
      (p_company_id, 'gal',    true, 6),
      (p_company_id, 'L',      true, 7),
      (p_company_id, 'roll',   true, 8),
      (p_company_id, 'sheet',  true, 9),
      (p_company_id, 'bag',    true, 10),
      (p_company_id, 'pallet', true, 11);
  END IF;

  -- Company Settings (company_id is TEXT in this table, so cast UUID)
  INSERT INTO company_settings (company_id)
  VALUES (p_company_id::TEXT)
  ON CONFLICT (company_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
