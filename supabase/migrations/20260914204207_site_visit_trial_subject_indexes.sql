-- Cover the two subject foreign keys; client identity is already unique-indexed.
-- No rows, authority seals, grants, or activation state change.
begin;
set local lock_timeout='2s';
create index agent_site_visit_trial_bindings_actor_idx
 on private.agent_site_visit_trial_bindings(actor_user_id);
create index agent_site_visit_trial_bindings_company_idx
 on private.agent_site_visit_trial_bindings(company_id);
commit;
