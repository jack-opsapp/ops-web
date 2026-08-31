-- Cover every foreign-key lookup in the dormant day-closeout tables.
-- These indexes change no authority, data, schedule, or runtime behavior.

create index agent_day_closeout_routines_oauth_grant_id_idx
  on private.agent_day_closeout_routines (oauth_grant_id);
create index agent_day_closeout_routines_oauth_client_id_idx
  on private.agent_day_closeout_routines (oauth_client_id);

create index agent_day_closeout_runs_routine_id_idx
  on private.agent_day_closeout_runs (routine_id);
create index agent_day_closeout_runs_oauth_grant_id_idx
  on private.agent_day_closeout_runs (oauth_grant_id);
create index agent_day_closeout_runs_oauth_client_id_idx
  on private.agent_day_closeout_runs (oauth_client_id);

create index agent_day_closeout_routine_failures_routine_id_idx
  on private.agent_day_closeout_routine_failures (routine_id);
create index agent_day_closeout_routine_failures_oauth_grant_id_idx
  on private.agent_day_closeout_routine_failures (oauth_grant_id);
create index agent_day_closeout_routine_failures_oauth_client_id_idx
  on private.agent_day_closeout_routine_failures (oauth_client_id);
