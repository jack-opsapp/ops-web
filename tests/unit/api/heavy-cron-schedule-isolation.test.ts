import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type CronConfig = {
  crons: Array<{ path: string; schedule: string }>;
};

const vercel = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8")
) as CronConfig;
const schedulesByPath = new Map(
  vercel.crons.map((cron) => [cron.path, cron.schedule])
);

/**
 * Complete production Vercel cron manifest. Every scheduled route shares the
 * durable global database lease: even routes that are normally provider-heavy
 * must fail closed when the database pressure circuit is open.
 *
 * Keeping this map exhaustive is deliberate. A new cron cannot silently land
 * without an explicit schedule and workload-control decision.
 */
const guardedProductionRoutes = new Map<string, string>([
  ["/api/cron/email-sync", "4-59/20 13-23,0-4 * * *"],
  ["/api/cron/email-ingest-heartbeat", "37 * * * *"],
  ["/api/cron/email-attachment-worker", "3-59/20 * * * *"],
  ["/api/cron/lead-assignment-deliveries", "2-59/10 * * * *"],
  ["/api/cron/webhook-renewal", "4 6 * * *"],
  ["/api/cron/auto-send", "16-59/20 13-23,0-4 * * *"],
  ["/api/cron/email-send-reconciliation", "8-59/20 * * * *"],
  ["/api/cron/ads-briefing", "34 12 * * 1"],
  ["/api/cron/ads-sync", "4 8 * * *"],
  ["/api/cron/app-store-sync", "4 9 * * *"],
  ["/api/cron/search-console-sync", "26 9 * * *"],
  ["/api/cron/ga4-acquisition-sync", "44 9 * * *"],
  ["/api/cron/analytics-health", "46 10 * * *"],
  ["/api/cron/duplicate-scan", "4 5 * * *"],
  ["/api/cron/memory-decay", "59 3 * * *"],
  ["/api/cron/expire-actions", "34 5 * * *"],
  ["/api/cron/expire-grace-periods", "44 5 * * *"],
  ["/api/cron/reconcile-stripe-subscriptions", "59 2 * * *"],
  ["/api/cron/project-health", "24 8 * * *"],
  ["/api/cron/project-status-updates", "24 9 * * 1"],
  ["/api/cron/payment-reminders", "4 10 * * *"],
  ["/api/cron/financial-digest", "4 7 * * 1"],
  ["/api/cron/schedule-optimization", "14 5 * * *"],
  ["/api/cron/appointment-reminders", "38 * * * *"],
  ["/api/cron/auto-confirm-schedules", "39 * * * *"],
  ["/api/cron/recurrence-generate", "59 */4 * * *"],
  ["/api/cron/auto-execute-actions", "6-59/20 13-23,0-4 * * *"],
  ["/api/cron/trial-expiry", "44 12 * * *"],
  ["/api/cron/unsnooze", "1-59/5 13-23,0-4 * * *"],
  ["/api/cron/stale-leads", "17 * * * *"],
  ["/api/cron/storage/site-visit-erasure", "54 6 * * *"],
  ["/api/cron/phase-c-graduation-check", "24 12 * * *"],
  ["/api/cron/pmf/threshold-check", "57 13-14,16-23,0-4 * * *"],
  ["/api/cron/pmf/daily-digest", "59 15 * * *"],
  ["/api/cron/pmf/weekly-digest", "14 7 * * 1"],
  ["/api/cron/pmf/google-ads-sync", "24 10 * * *"],
  ["/api/cron/pmf/cleanup-snapshots", "4 11 * * *"],
  ["/api/cron/email/dispatcher", "7-59/20 13-23,0-4 * * *"],
  ["/api/cron/email/worker", "13-59/20 13-23,0-4 * * *"],
  ["/api/cron/email/auto-resume", "2-59/5 13-23,0-4 * * *"],
  ["/api/cron/email/anomaly-check", "3-59/5 13-23,0-4 * * *"],
  ["/api/cron/email/projection-stuck-check", "9-59/20 * * * *"],
  ["/api/cron/onboarding-drip", "19 * * * *"],
  ["/api/cron/lead-lifecycle", "14 11 * * *"],
  ["/api/cron/lead-summary-refresh", "18-59/15 13-23,0-4 * * *"],
  ["/api/cron/accounting/quickbooks/push-queue", "14-59/20 13-23,0-4 * * *"],
  // Full-day on purpose: booked-visit prompts are appointment-time-critical
  // and cannot live in the overnight email window. Shares the */5 grid with
  // the fire_due_task_reminders DB lane only — inside the 3-lane budget.
  ["/api/cron/site-visit-prompts", "*/5 * * * *"],
  // Full-day on purpose: booked visits propagate to Google Calendar whenever
  // they change. Third and final lane on the */5 grid (with
  // site-visit-prompts + fire_due_task_reminders) — exactly at the 3-lane
  // budget; the next full-day cron must pick a different grid.
  ["/api/cron/google-calendar-sync", "*/5 * * * *"],
  // Full-day on purpose, but offset from the three existing minute-zero
  // lanes. Runtime activation remains independently server-gated.
  ["/api/cron/day-closeout-routines", "2-59/5 * * * *"],
]);

const migrationDirectory = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationDirectory).find((name) =>
  name.endsWith("_cron_workload_controls.sql")
);
const migration = migrationName
  ? readFileSync(join(migrationDirectory, migrationName), "utf8")
  : "";

function expandMinutes(expression: string): number[] {
  const stepMatch = expression.match(/^(\*|\d+-59)\/(\d+)$/);
  if (stepMatch) {
    const start = stepMatch[1] === "*" ? 0 : Number(stepMatch[1].split("-")[0]);
    const step = Number(stepMatch[2]);
    const minutes: number[] = [];
    for (let minute = start; minute < 60; minute += step) {
      minutes.push(minute);
    }
    return minutes;
  }
  if (/^\d+$/.test(expression)) {
    return [Number(expression)];
  }
  throw new Error(`Unsupported minute expression: ${expression}`);
}

function expandHours(expression: string): number[] {
  if (expression === "*") {
    return Array.from({ length: 24 }, (_, hour) => hour);
  }

  const step = expression.match(/^\*\/(\d+)$/);
  if (step) {
    const increment = Number(step[1]);
    return Array.from(
      { length: Math.ceil(24 / increment) },
      (_, index) => index * increment
    ).filter((hour) => hour < 24);
  }

  const hours = new Set<number>();
  for (const segment of expression.split(",")) {
    const range = segment.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let hour = start; hour <= end; hour += 1) hours.add(hour);
      continue;
    }
    if (/^\d+$/.test(segment)) {
      hours.add(Number(segment));
      continue;
    }
    throw new Error(`Unsupported hour expression: ${expression}`);
  }
  return [...hours];
}

function routeSourcePath(apiPath: string): string {
  const routeSuffix = apiPath.replace(/^\/api\/cron\//, "");
  return join(process.cwd(), "src/app/api/cron", routeSuffix, "route.ts");
}

function sourceUsesDurableGuard(apiPath: string): boolean {
  const sourcePath = routeSourcePath(apiPath);
  if (!existsSync(sourcePath)) return false;
  const source = readFileSync(sourcePath, "utf8");
  if (/await\s+runWithCronWorkloadControl\s*\(\s*\{/.test(source)) return true;

  // Some routes isolate the pure HTTP handler for unit testing. The production
  // route must inject the exact shared guard and that handler must await it.
  if (!/runWithControl:\s*runWithCronWorkloadControl/.test(source))
    return false;
  const handlerPath = join(routeSourcePath(apiPath), "..", "handler.ts");
  return (
    existsSync(handlerPath) &&
    /await\s+dependencies\.runWithControl\s*\(\s*\{/.test(
      readFileSync(handlerPath, "utf8")
    )
  );
}

describe("heavy production cron schedule isolation", () => {
  it("inventories every Vercel cron and verifies its durable guard call", () => {
    expect(new Set(vercel.crons.map((cron) => cron.path)).size).toBe(
      vercel.crons.length
    );
    expect(
      [...schedulesByPath.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ).toEqual(
      [...guardedProductionRoutes.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )
    );

    for (const [path, schedule] of guardedProductionRoutes) {
      expect(schedulesByPath.get(path)).toBe(schedule);
      expect(sourceUsesDurableGuard(path), path).toBe(true);
    }

    const discoveredGuardedRoutes = vercel.crons
      .map((cron) => cron.path)
      .filter(sourceUsesDurableGuard)
      .sort();
    expect(discoveredGuardedRoutes).toEqual(
      [...guardedProductionRoutes.keys()].sort()
    );
  });

  it("removes the old minute-zero/fifteen pileups while the global lease handles residual starts", () => {
    const lanes = [
      ...Array.from(guardedProductionRoutes, ([path, schedule]) => ({
        name: path,
        minuteExpression: schedule.split(" ")[0],
        hourExpression: schedule.split(" ")[1],
      })),
      {
        name: "fire_due_task_reminders_every_5min",
        minuteExpression: "*/5",
        hourExpression: "*",
      },
      {
        name: "spec_board_snapshot_refresh",
        minuteExpression: "1-59/10",
        hourExpression: "*",
      },
      {
        name: "crit3-identity-linkage-daily",
        minuteExpression: "14",
        hourExpression: "8",
      },
      {
        name: "expense_envelope_sweep_daily",
        minuteExpression: "24",
        hourExpression: "6",
      },
      {
        name: "prune_cron_history",
        minuteExpression: "24",
        hourExpression: "5",
      },
    ];

    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 1) {
        const running = lanes
          .filter(
            (lane) =>
              expandHours(lane.hourExpression).includes(hour) &&
              expandMinutes(lane.minuteExpression).includes(minute)
          )
          .map((lane) => lane.name);
        const infrequentRunning = lanes.filter(
          (lane) =>
            running.includes(lane.name) &&
            expandMinutes(lane.minuteExpression).length *
              expandHours(lane.hourExpression).length ===
              1
        );
        if (infrequentRunning.length > 0) {
          expect(
            running,
            `${hour.toString().padStart(2, "0")}:${minute
              .toString()
              .padStart(2, "0")}: infrequent lane collision: ${running.join(
              ", "
            )}`
          ).toHaveLength(1);
        }
        expect(
          running.length,
          `${hour.toString().padStart(2, "0")}:${minute
            .toString()
            .padStart(2, "0")}: ${running.join(", ")}`
        ).toBeLessThanOrEqual(3);
      }
    }

    expect(migration).toContain("'*/5 * * * *'");
    expect(migration).toContain("'1-59/10 * * * *'");
    expect(migration).toContain("'14 8 * * *'");
    expect(migration).toContain("'24 6 * * *'");
    expect(migration).toContain("'24 5 * * *'");
  });
});
