import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationDirectory).find((name) =>
  name.endsWith("_cron_workload_controls.sql")
);
const source = migrationName
  ? readFileSync(join(migrationDirectory, migrationName), "utf8").toLowerCase()
  : "";

describe("cron workload controls migration", () => {
  it("stores private fenced leases and persistent circuit state", () => {
    expect(source).toContain("create table private.cron_workload_controls");
    expect(source).toContain("workload_key text primary key");
    expect(source).toContain("lease_owner_token uuid");
    expect(source).toContain("lease_fence bigint not null default 0");
    expect(source).toContain("lease_expires_at timestamptz");
    expect(source).toContain("consecutive_failures integer not null default 0");
    expect(source).toContain("circuit_open_until timestamptz");
    expect(source).toContain("cursor_value text");
    expect(source).toContain(
      "alter table private.cron_workload_controls enable row level security"
    );
    expect(source).toContain(
      "revoke all on table private.cron_workload_controls"
    );
  });

  it("atomically fences a per-workload row and the global heavy-workload row", () => {
    const acquire = source.slice(
      source.indexOf(
        "create or replace function private.acquire_cron_workload_lease_internal"
      ),
      source.indexOf(
        "create or replace function private.complete_cron_workload_lease_internal"
      )
    );

    expect(acquire).toContain("'__global_heavy__'");
    expect(acquire.match(/for update nowait/g)).toHaveLength(2);
    expect(acquire).toContain("when lock_not_available then");
    expect(acquire).toContain("v_global.lease_expires_at > v_acquired_at");
    expect(acquire).toContain("v_lane.lease_expires_at > v_acquired_at");
    expect(acquire).toContain("v_global.circuit_open_until > v_acquired_at");
    expect(acquire).toContain("v_lane.circuit_open_until > v_acquired_at");
    expect(acquire).toContain("lease_fence = lease_fence + 1");
    expect(acquire).toContain("'global_fence_token'");
    expect(acquire).toContain("'fence_token'");

    const globalLock = acquire.indexOf(
      "where control.workload_key = v_global_key"
    );
    const laneLock = acquire.indexOf(
      "where control.workload_key = p_workload_key"
    );
    expect(globalLock).toBeGreaterThan(-1);
    expect(laneLock).toBeGreaterThan(globalLock);
  });

  it("completes only exact lane and global fences and persists pressure circuits", () => {
    const complete = source.slice(
      source.indexOf(
        "create or replace function private.complete_cron_workload_lease_internal"
      ),
      source.indexOf(
        "create or replace function private.renew_cron_workload_lease_internal"
      )
    );

    expect(complete).toContain(
      "v_lane.lease_owner_token is distinct from p_owner_token"
    );
    expect(complete).toContain(
      "v_lane.lease_fence is distinct from p_fence_token"
    );
    expect(complete).toContain(
      "v_global.lease_owner_token is distinct from p_owner_token"
    );
    expect(complete).toContain(
      "v_global.lease_fence is distinct from p_global_fence_token"
    );
    expect(complete).not.toContain(
      "v_lane.lease_expires_at <= v_completed_at"
    );
    expect(complete).not.toContain(
      "v_global.lease_expires_at <= v_completed_at"
    );
    expect(complete).toContain("if p_database_pressure then");
    expect(complete).toContain(
      "circuit_open_until = v_completed_at + make_interval"
    );
    expect(complete).toContain("consecutive_failures = 0");
    expect(complete).toContain("lease_owner_token = null");
    expect(complete).toContain("return false");
    expect(complete).toContain("return true");
  });

  it("grows repeated pressure circuits exponentially with jitter and a hard cap", () => {
    const complete = source.slice(
      source.indexOf(
        "create or replace function private.complete_cron_workload_lease_internal"
      ),
      source.indexOf(
        "create or replace function private.renew_cron_workload_lease_internal"
      )
    );

    expect(complete).toContain(
      "v_failure_count := v_lane.consecutive_failures + 1"
    );
    expect(complete).toContain("power(2::numeric");
    expect(complete).toContain("random()");
    expect(complete).toMatch(/least\(\s*3600/);
    expect(complete).toContain("greatest(30");
    expect(complete).toContain("v_circuit_delay_seconds");
  });

  it("breaks the global pressure streak when a non-database failure proves connectivity", () => {
    const complete = source.slice(
      source.indexOf(
        "create or replace function private.complete_cron_workload_lease_internal"
      ),
      source.indexOf(
        "create or replace function private.renew_cron_workload_lease_internal"
      )
    );
    const ordinaryFailure = complete.slice(
      complete.indexOf(
        "a provider/business failure proves the database was reachable"
      ),
      complete.indexOf("return true;", complete.indexOf("else"))
    );

    expect(ordinaryFailure).toContain("consecutive_failures = 0");
    expect(ordinaryFailure).not.toContain("else consecutive_failures");
  });

  it("exposes only service-role acquisition, renewal, and completion", () => {
    for (const functionName of [
      "acquire_cron_workload_lease_as_system",
      "renew_cron_workload_lease_as_system",
      "complete_cron_workload_lease_as_system",
    ]) {
      expect(source).toContain(`revoke all on function public.${functionName}`);
      expect(source).toContain(
        `grant execute on function public.${functionName}`
      );
    }
    expect(source).toContain("request.jwt.claims");
    expect(source).toContain("<> 'service_role'");
    expect(source).toContain("security definer");
    expect(source).toContain("set search_path = pg_catalog, pg_temp");
    expect(source).toContain(
      "revoke all on function private.acquire_cron_workload_lease_internal"
    );
    expect(source).toContain(
      "revoke all on function private.complete_cron_workload_lease_internal"
    );
    expect(source).toContain(
      "revoke all on function private.renew_cron_workload_lease_internal"
    );
  });

  it("fence-binds the service-role-only compare-and-swap cursor", () => {
    expect(source).toContain(
      "create or replace function public.read_cron_workload_cursor_as_system"
    );
    expect(source).toContain(
      "create or replace function public.advance_cron_workload_cursor_as_system"
    );
    expect(source).toContain(
      "cursor_value is not distinct from p_expected_cursor"
    );
    expect(source).toContain("lane.lease_owner_token = p_owner_token");
    expect(source).toContain("lane.lease_fence = p_fence_token");
    expect(source).toContain(
      "global_control.lease_fence = p_global_fence_token"
    );
    expect(source).toContain("lease_expires_at > clock_timestamp()");
    expect(source).toContain("set cursor_value = p_next_cursor");
    for (const functionName of [
      "read_cron_workload_cursor_as_system",
      "advance_cron_workload_cursor_as_system",
    ]) {
      expect(source).toContain(`revoke all on function public.${functionName}`);
      expect(source).toContain(
        `grant execute on function public.${functionName}`
      );
    }
  });

  it("computes PMF marker-four totals inside Postgres without returning spend rows", () => {
    const markerFourStart = source.indexOf(
      "create or replace function public.pmf_marker_4_totals_as_system"
    );
    const markerFourEnd = source.indexOf(
      "revoke all on function public.pmf_marker_4_totals_as_system"
    );
    const markerFour = source.slice(markerFourStart, markerFourEnd);

    expect(markerFourStart).toBeGreaterThan(-1);
    expect(markerFour).toContain("request.jwt.claims");
    expect(markerFour).toContain("<> 'service_role'");
    expect(markerFour).toContain(
      "coalesce(sum(spend.spend_cents), 0)"
    );
    expect(markerFour).toContain("count(*)");
    expect(markerFour).toContain("where first_paid_at is not null");
    expect(markerFour).toContain("'spend_cents'");
    expect(markerFour).toContain("'attributed_paid'");
    expect(markerFour).not.toContain("returns setof");
    expect(source).toContain(
      "grant execute on function public.pmf_marker_4_totals_as_system"
    );
  });

  it("provides service-role-only bounded maintenance mutations", () => {
    for (const functionName of [
      "expire_agent_actions_batch_as_system",
      "expire_grace_period_companies_batch_as_system",
      "cleanup_pmf_threshold_snapshots_batch_as_system",
    ]) {
      const definitionStart = source.indexOf(
        `create or replace function public.${functionName}`
      );
      const definitionEnd = source.indexOf(
        `revoke all on function public.${functionName}`
      );
      const definition = source.slice(definitionStart, definitionEnd);

      expect(definitionStart, functionName).toBeGreaterThan(-1);
      expect(definition, functionName).toContain("request.jwt.claims");
      expect(definition, functionName).toContain("<> 'service_role'");
      expect(definition, functionName).toContain("for update");
      expect(definition, functionName).toContain("skip locked");
      expect(definition, functionName).toContain("limit p_batch_size");
      expect(definition, functionName).toContain("return v_updated_count");
      expect(source).toContain(
        `grant execute on function public.${functionName}`
      );
    }

    expect(source).toContain("update public.agent_actions");
    expect(source).toContain("update public.companies");
    expect(source).toContain("delete from public.pmf_threshold_snapshots");
  });

  it("runs every database-scheduled workload through the same global lease and circuit", () => {
    const controlledStart = source.indexOf(
      "create or replace function private.run_scheduled_cron_workload_controlled"
    );
    const controlledEnd = source.indexOf(
      "create or replace function private.run_fire_due_task_reminders_controlled"
    );
    const controlled = source.slice(controlledStart, controlledEnd);

    expect(controlledStart).toBeGreaterThan(-1);
    expect(controlled).toContain(
      "private.acquire_cron_workload_lease_internal"
    );
    expect(controlled).toContain(
      "private.complete_cron_workload_lease_internal"
    );
    expect(controlled).toContain(
      "private.is_cron_database_pressure_error"
    );
    expect(controlled).toContain("execute format('select %s()'");
    expect(controlled).toContain("p_command_name not in");
    expect(controlled).toContain("set_config(");
    expect(controlled).toContain("'statement_timeout'");
    expect(controlled).toContain("p_lease_seconds - 30");
    expect(controlled).toContain("when query_canceled then");
    expect(controlled).toMatch(/'completed',\s*false/);
    expect(controlled).toMatch(/'error_sqlstate',\s*v_sqlstate/);
    expect(controlled).not.toMatch(
      /private\.complete_cron_workload_lease_internal[\s\S]*?\n\s*raise;\s*\n/
    );

    for (const wrapper of [
      "private.run_fire_due_task_reminders_controlled",
      "private.run_spec_board_snapshot_controlled",
      "private.run_identity_linkage_metrics_controlled",
      "private.run_expense_envelope_sweep_controlled",
      "private.run_prune_cron_history_controlled",
    ]) {
      expect(source).toContain(`create or replace function ${wrapper}`);
      expect(source).toContain(`revoke all on function ${wrapper}`);
    }
  });

  it("captures and unschedules every exact toctou race hold job", () => {
    const capture = source.indexOf(
      "insert into private.retired_cron_job_history_targets"
    );
    const unschedule = source.indexOf("perform cron.unschedule");

    expect(source).toContain(
      "create table private.retired_cron_job_history_targets"
    );
    expect(source).toContain(
      "where scheduled_job.jobname = 'toctou_race_hold_job'"
    );
    expect(source).toContain("for retired_job in");
    expect(unschedule).toBeGreaterThan(capture);
    expect(source).not.toContain("cron.unschedule('toctou_race_hold_job')");
  });

  it("provides opt-in bounded lock-light history cleanup without running it during migration", () => {
    const cleanupStart = source.indexOf(
      "create or replace function public.cleanup_retired_cron_job_history_as_system"
    );
    const cleanupEnd = source.indexOf(
      "revoke all on function public.cleanup_retired_cron_job_history_as_system"
    );
    const cleanup = source.slice(cleanupStart, cleanupEnd);

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanup).toContain("p_batch_size integer default 250");
    expect(cleanup).toContain("p_batch_size > 500");
    expect(cleanup).toContain("limit p_batch_size");
    expect(cleanup).toContain("for update of history skip locked");
    expect(cleanup).toContain("join private.retired_cron_job_history_targets");
    expect(cleanup).toContain("delete from cron.job_run_details");
    expect(source).not.toMatch(/delete from cron\.job_run_details\s*;/);

    const afterDefinition = source.slice(cleanupEnd);
    expect(afterDefinition).not.toMatch(
      /(?:perform|select)\s+public\.cleanup_retired_cron_job_history_as_system\s*\(/
    );
  });

  it("source-controls the live cron-history pruner as a bounded maintenance lane", () => {
    const pruneStart = source.indexOf(
      "create or replace function private.prune_cron_history_batch"
    );
    const pruneEnd = source.indexOf(
      "create or replace function private.run_prune_cron_history_controlled"
    );
    const prune = source.slice(pruneStart, pruneEnd);

    expect(pruneStart).toBeGreaterThan(-1);
    expect(prune).toContain("interval '7 days'");
    expect(prune).toContain("limit 500");
    expect(prune).toContain("for update of history skip locked");
    expect(prune).toContain("delete from cron.job_run_details");
    expect(source).toContain("'prune_cron_history'");
    expect(source).toContain("'24 5 * * *'");
    expect(source).toContain(
      "'select private.run_prune_cron_history_controlled();'"
    );
  });

  it("restores the production statement timeout after the emergency diagnostic override", () => {
    expect(source).toContain(
      "alter role authenticator set statement_timeout = '8s'"
    );
  });

  it("source-upserts every active business job with isolated controlled wrappers", () => {
    const schedules = source.slice(
      source.indexOf("do $restore_required_cron_jobs$"),
      source.indexOf(
        "$restore_required_cron_jobs$;",
        source.indexOf("do $restore_required_cron_jobs$")
      ) + "$restore_required_cron_jobs$;".length
    );

    expect(schedules).toContain("fire_due_task_reminders_every_5min");
    expect(schedules).toContain("'*/5 * * * *'");
    expect(schedules).toContain(
      "'select private.run_fire_due_task_reminders_controlled();'"
    );
    expect(schedules).toContain("spec_board_snapshot_refresh");
    expect(schedules).toContain("'1-59/10 * * * *'");
    expect(schedules).toContain(
      "'select private.run_spec_board_snapshot_controlled();'"
    );
    expect(schedules).toContain("crit3-identity-linkage-daily");
    expect(schedules).toContain("'14 8 * * *'");
    expect(schedules).toContain(
      "'select private.run_identity_linkage_metrics_controlled();'"
    );
    expect(schedules).toContain("expense_envelope_sweep_daily");
    expect(schedules).toContain("'24 6 * * *'");
    expect(schedules).toContain(
      "'select private.run_expense_envelope_sweep_controlled();'"
    );
    expect(schedules).toContain("prune_cron_history");
    expect(schedules).toContain("'24 5 * * *'");
    expect(schedules).toContain(
      "'select private.run_prune_cron_history_controlled();'"
    );
    expect(schedules).toContain("cron.schedule(");
    expect(schedules).toContain("perform cron.alter_job");
    expect(schedules).toContain("active := true");
    expect(source).not.toContain(
      "'db-task-reminders',\n    1200"
    );
    expect(source).not.toContain(
      "'db-spec-board-snapshot',\n    1200"
    );
    expect(schedules).not.toContain("into strict");
  });
});
