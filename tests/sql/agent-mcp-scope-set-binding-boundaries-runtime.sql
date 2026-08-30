\set ON_ERROR_STOP on
\set agent_mcp_scope_set_binding_post_repair 1

-- Re-run every behavioral boundary after the additive repair. Each included
-- fixture owns its transaction and rolls back its rows before the next one.
\ir agent-customer-context-runtime.sql
\ir agent-task-reads-runtime.sql
\ir agent-artifact-reads-runtime.sql
\ir agent-site-visit-reads-runtime.sql
\ir agent-deck-design-geometry-runtime.sql
\ir agent-mcp-evidence-runtime.sql
\ir agent-sales-document-reads-runtime.sql
\ir agent-expense-reads-runtime.sql
\ir agent-company-context-runtime.sql
\ir agent-catalog-reads-runtime.sql
\ir agent-team-members-runtime.sql
\ir agent-team-availability-runtime.sql
\ir agent-payment-reads-runtime.sql
\ir agent-purchase-order-reads-runtime.sql
\ir agent-integration-health-runtime.sql
\ir agent-work-queue-reads-runtime.sql
\ir agent-operational-overview-runtime.sql

\unset agent_mcp_scope_set_binding_post_repair
