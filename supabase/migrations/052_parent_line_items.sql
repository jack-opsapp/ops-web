-- 052_parent_line_items.sql
-- Adds parent-child hierarchy to line_items for bundled scopes of work.
-- Parent line items (type=LABOR) represent bundled quotes.
-- Child line items (type=MATERIAL) are the cost breakdown underneath.

ALTER TABLE line_items
ADD COLUMN parent_line_item_id UUID REFERENCES line_items(id) ON DELETE CASCADE;

CREATE INDEX idx_line_items_parent ON line_items(parent_line_item_id)
WHERE parent_line_item_id IS NOT NULL;

COMMENT ON COLUMN line_items.parent_line_item_id IS
  'Self-referential FK for parent-child line item hierarchy. NULL = top-level or standalone item.';
