\set ON_ERROR_STOP on

-- The runtime proof owns a transaction and rolls every fixture mutation back.
-- Running it twice against the same database proves clean replay without any
-- estimate, number, price, message, or other business artifact surviving.
\ir agent-estimate-draft-runtime.sql
\ir agent-estimate-draft-runtime.sql
