import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const productionProjectRef = "ijeekuhbatykdomumfjx";

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    target: null,
    mode: null,
    companyId: null,
    runbook: null,
    allowProduction: false,
    batchSize: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--local" || value === "--production") {
      if (options.target !== null) fail("Choose exactly one target");
      options.target = value.slice(2);
    } else if (
      value === "--dry-run" ||
      value === "--execute" ||
      value === "--verify"
    ) {
      if (options.mode !== null) fail("Choose exactly one backfill mode");
      options.mode = value.slice(2);
    } else if (value === "--company-id") {
      options.companyId = argv[index + 1] ?? null;
      index += 1;
    } else if (value === "--launch-runbook") {
      options.runbook = argv[index + 1] ?? null;
      index += 1;
    } else if (value === "--allow-production") {
      options.allowProduction = true;
    } else if (value === "--batch-size") {
      options.batchSize = Number(argv[index + 1]);
      index += 1;
    } else {
      fail(`Unknown argument: ${value}`);
    }
  }

  if (!options.target || !options.mode) {
    fail("A target and mode are required");
  }
  if (
    options.companyId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      options.companyId
    )
  ) {
    fail("--company-id must be a UUID");
  }
  if (
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 500
  ) {
    fail("--batch-size must be an integer from 1 through 500");
  }
  if (options.target === "production") {
    if (
      !options.allowProduction ||
      !options.companyId ||
      !options.runbook ||
      !/^docs\/runbooks\/[A-Za-z0-9._/-]+\.md$/.test(options.runbook)
    ) {
      fail(
        "Production requires --allow-production, the exact --company-id, " +
          "and an approved docs/runbooks/*.md reference"
      );
    }
  }
  return options;
}

function validateTarget(options) {
  const rawUrl =
    process.env.EXTERNAL_API_BACKFILL_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "";
  const serviceRoleKey =
    process.env.EXTERNAL_API_BACKFILL_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";
  if (!rawUrl || !serviceRoleKey) {
    fail(
      "Set EXTERNAL_API_BACKFILL_SUPABASE_URL and " +
        "EXTERNAL_API_BACKFILL_SERVICE_ROLE_KEY"
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("The configured Supabase URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  const local = new Set(["127.0.0.1", "localhost", "::1"]).has(host);
  const projectRef = host.endsWith(".supabase.co") ? host.split(".")[0] : null;

  if (options.target === "local" && !local) {
    fail("--local refuses a non-loopback Supabase URL");
  }
  if (options.target === "production" && projectRef !== productionProjectRef) {
    fail("--production requires the exact OPS production project");
  }
  if (options.target !== "production" && projectRef === productionProjectRef) {
    fail("Refusing the OPS production project without --production");
  }
  return { url: url.toString(), serviceRoleKey };
}

async function command(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) fail(`${name} failed: ${error.message}`);
  if (!data || typeof data !== "object") {
    fail(`${name} returned an invalid result`);
  }
  return data;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const target = validateTarget(options);
  const client = createClient(target.url, target.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (options.mode === "dry-run") {
    const result = await command(
      client,
      "inspect_external_lead_projection_backfill_as_system",
      { p_company_id: options.companyId }
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  let run = await command(
    client,
    "start_external_lead_projection_backfill_as_system",
    { p_company_id: options.companyId }
  );

  if (options.mode === "verify") {
    const result = await command(
      client,
      "verify_external_lead_projection_backfill_as_system",
      { p_run_id: run.id }
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (run.status === "pending") {
    run = await command(
      client,
      "claim_external_lead_projection_backfill_as_system",
      { p_run_id: run.id, p_lease_seconds: 60 }
    );
  } else if (
    run.status === "running" &&
    new Date(run.lease_expires_at).getTime() <= Date.now()
  ) {
    run = await command(
      client,
      "claim_external_lead_projection_backfill_as_system",
      { p_run_id: run.id, p_lease_seconds: 60 }
    );
  } else if (run.status === "running") {
    fail(
      "The existing run still has an active lease. Retry after its lease expires."
    );
  }

  while (run.status === "running") {
    run = await command(
      client,
      "process_external_lead_projection_backfill_as_system",
      {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
        p_lease_generation: run.lease_generation,
        p_batch_size: options.batchSize,
      }
    );
  }
  if (!["complete", "verified"].includes(run.status)) {
    fail(`Backfill ended in unexpected state: ${run.status}`);
  }
  process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Backfill failed"}\n`
  );
  process.exitCode = 1;
});
