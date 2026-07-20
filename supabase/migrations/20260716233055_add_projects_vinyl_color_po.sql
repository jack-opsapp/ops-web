-- VINYL ORDERS board: ordered color and supplier PO on the project marker.
-- Additive and nullable for compatibility with every shipped client.

ALTER TABLE projects
  ADD COLUMN vinyl_color text NULL,
  ADD COLUMN vinyl_po text NULL;
