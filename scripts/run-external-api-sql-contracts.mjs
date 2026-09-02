import { randomUUID } from "node:crypto";
import {
  access,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  accessSync,
  constants as fsConstants,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  resolve,
  sep,
} from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const CONTRACT_DIRECTORY = resolve(process.cwd(), "tests/sql");
const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const CONTRACT_PASS_SENTINEL = "OPS_EXTERNAL_API_SQL_CONTRACT_PASS";
const FORBIDDEN_PROJECT_REFS = new Set([
  // OPS production. SQL contracts are destructive by design, even though
  // individual contracts are expected to roll back.
  "ijeekuhbatykdomumfjx",
]);
const activeChildren = new Set();
let cancellationExitCode = null;

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function fail(message) {
  throw new Error(message);
}

function assertNotCancelled() {
  if (cancellationExitCode !== null) {
    fail("SQL contract execution was cancelled");
  }
}

function validateRemoteSslRootCertificate() {
  const certificatePath =
    process.env.EXTERNAL_API_SQL_SSL_ROOT_CERT ?? "";
  if (!isAbsolute(certificatePath)) {
    fail(
      "Remote SQL contracts require an absolute " +
        "EXTERNAL_API_SQL_SSL_ROOT_CERT path"
    );
  }
  try {
    accessSync(certificatePath, fsConstants.R_OK);
    if (!statSync(certificatePath).isFile()) {
      fail("EXTERNAL_API_SQL_SSL_ROOT_CERT must be a readable file");
    }
  } catch {
    fail("EXTERNAL_API_SQL_SSL_ROOT_CERT must be a readable file");
  }
  return certificatePath;
}

function parseArguments(argv) {
  const options = {
    allowDisposableBranch: false,
    expectedProjectRef: null,
    match: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-disposable-branch") {
      options.allowDisposableBranch = true;
      continue;
    }
    if (argument === "--expected-project-ref") {
      options.expectedProjectRef = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--match") {
      options.match = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--timeout-ms") {
      options.timeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${argument}`);
  }

  if (
    options.match !== null &&
    !/^[A-Za-z0-9_.-]+$/.test(options.match)
  ) {
    fail("--match must contain only letters, numbers, dot, dash, or underscore");
  }
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 120_000
  ) {
    fail("--timeout-ms must be an integer from 1000 through 120000");
  }
  if (
    options.expectedProjectRef !== null &&
    !/^[a-z0-9]{20}$/.test(options.expectedProjectRef)
  ) {
    fail("--expected-project-ref is malformed");
  }

  return options;
}

function parseDatabaseTarget(options) {
  const rawUrl =
    process.env.EXTERNAL_API_SQL_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  let databaseUrl;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    fail("EXTERNAL_API_SQL_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    fail("The SQL contract database URL must use postgres or postgresql");
  }

  const hostname = normalizeHostname(databaseUrl.hostname);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  const isLoopback = loopbackHosts.has(hostname);
  let sslRootCertificate = null;

  if (!isLoopback) {
    if (
      !options.allowDisposableBranch ||
      options.expectedProjectRef === null
    ) {
      fail(
        "Refusing a non-loopback database. Supply --allow-disposable-branch " +
          "and --expected-project-ref only for an approved disposable branch."
      );
    }

    if (
      hostname.includes(",") ||
      hostname.includes("..") ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)
    ) {
      fail("The database target must contain exactly one DNS hostname");
    }

    const username = decodeURIComponent(databaseUrl.username).toLowerCase();
    const expectedProjectRef = options.expectedProjectRef.toLowerCase();
    if (FORBIDDEN_PROJECT_REFS.has(expectedProjectRef)) {
      fail("Refusing to run SQL contracts against an OPS production project");
    }
    const isExpectedDirectHost =
      hostname === `db.${expectedProjectRef}.supabase.co` &&
      username === "postgres";
    const isSupabasePoolerHost =
      hostname.endsWith(".pooler.supabase.co") ||
      hostname.endsWith(".pooler.supabase.com");
    const isExpectedPoolerUser =
      isSupabasePoolerHost &&
      username === `postgres.${expectedProjectRef}`;
    if (!isExpectedDirectHost && !isExpectedPoolerUser) {
      fail(
        "The database target is not the expected disposable Supabase project"
      );
    }
    if ((databaseUrl.port || "5432") !== "5432") {
      fail("Remote SQL contracts require a session-mode port");
    }
    if (databaseUrl.pathname.replace(/^\/+/, "") !== "postgres") {
      fail("Remote SQL contracts require the postgres database");
    }
    sslRootCertificate = validateRemoteSslRootCertificate();
  }

  return { databaseUrl, isLoopback, sslRootCertificate };
}

function databaseEnvironment(
  databaseUrl,
  applicationName,
  sslRootCertificate
) {
  const hostname = normalizeHostname(databaseUrl.hostname);
  const isLoopback = new Set(["127.0.0.1", "localhost", "::1"]).has(hostname);
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\/+/, "")
  );
  const username = decodeURIComponent(databaseUrl.username);
  const password = decodeURIComponent(databaseUrl.password);
  if (!databaseName || !username || !password) {
    fail(
      "The SQL contract database URL must include database, username, and password"
    );
  }

  const environment = {
    PATH: process.env.PATH ?? "",
    LANG: process.env.LANG ?? "C",
    LC_ALL: process.env.LC_ALL ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    PGPASSFILE: "/dev/null",
    PGAPPNAME: applicationName,
    PGCONNECT_TIMEOUT: "10",
    PGDATABASE: databaseName,
    PGHOST: hostname,
    PGPASSWORD: password,
    PGPORT: databaseUrl.port || "5432",
    PGSSLMODE: isLoopback ? "disable" : "verify-full",
    PGUSER: username,
    PGOPTIONS:
      "-c statement_timeout=60000 " +
      "-c lock_timeout=10000 " +
      "-c idle_in_transaction_session_timeout=60000",
  };

  if (!environment.LC_ALL) {
    delete environment.LC_ALL;
  }
  if (!isLoopback) {
    if (!sslRootCertificate) {
      fail("Remote SQL contracts require a verified root certificate");
    }
    environment.PGSSLROOTCERT = sslRootCertificate;
  }

  return {
    ...environment,
  };
}

function terminateActiveChildren() {
  for (const child of activeChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => {
    for (const child of activeChildren) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 1_000).unref();
}

function cancel(exitCode) {
  if (cancellationExitCode === null) {
    cancellationExitCode = exitCode;
  }
  process.exitCode = cancellationExitCode;
  terminateActiveChildren();
}

function startPsql({
  applicationName,
  databaseUrl,
  file,
  sslRootCertificate,
  sql,
  timeoutMs,
  tuplesOnly = false,
}) {
  assertNotCancelled();
  const psqlBinary = process.env.EXTERNAL_API_PSQL_BIN || "psql";
  const argumentsList = [
    "-X",
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--set=VERBOSITY=terse",
  ];
  if (tuplesOnly) {
    argumentsList.push("--tuples-only", "--no-align");
  }
  if (file) {
    argumentsList.push("--file", file);
  } else {
    argumentsList.push("--command", sql);
  }

  const child = spawn(psqlBinary, argumentsList, {
    env: databaseEnvironment(
      databaseUrl,
      applicationName,
      sslRootCertificate
    ),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeChildren.add(child);

  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let timedOut = false;
  let outputOverflow = false;

  const appendOutput = (target, chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      outputOverflow = true;
      terminateActiveChildren();
      return target;
    }
    return target + chunk.toString("utf8");
  };

  child.stdout.on("data", (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 1_000).unref();
  }, timeoutMs);
  timer.unref();

  const promise = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", (error) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      rejectPromise(
        new Error(
          error.code === "ENOENT"
            ? `psql was not found. Set EXTERNAL_API_PSQL_BIN to an executable PostgreSQL client.`
            : `Could not start psql: ${error.message}`
        )
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      activeChildren.delete(child);

      if (timedOut) {
        rejectPromise(new Error(`SQL session timed out after ${timeoutMs}ms`));
        return;
      }
      if (outputOverflow) {
        rejectPromise(
          new Error(`SQL session exceeded ${MAX_OUTPUT_BYTES} output bytes`)
        );
        return;
      }
      if (code !== 0) {
        const detail = [stderr.trim(), stdout.trim()]
          .filter(Boolean)
          .join("\n");
        rejectPromise(
          new Error(
            `psql exited with code ${code}${signal ? ` (${signal})` : ""}` +
              (detail ? `\n${detail}` : "")
          )
        );
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });

  return { child, promise };
}

async function runPsql(options) {
  return startPsql(options).promise;
}

function escapeSqlLiteral(value) {
  return value.replaceAll("'", "''");
}

async function assertNoLeakedSessions({
  databaseUrl,
  runPrefix,
  sslRootCertificate,
  timeoutMs,
}) {
  const escapedPrefix = escapeSqlLiteral(runPrefix);
  const { stdout } = await runPsql({
    applicationName: `${runPrefix}-leak-probe`,
    databaseUrl,
    sslRootCertificate,
    sql:
      "select count(*) from pg_catalog.pg_stat_activity " +
      `where application_name like '${escapedPrefix}%' ` +
      "and pid <> pg_catalog.pg_backend_pid();",
    timeoutMs,
    tuplesOnly: true,
  });
  const normalizedOutput = stdout.trim();
  if (!/^\d+$/.test(normalizedOutput)) {
    fail("Could not verify SQL contract session cleanup");
  }
  const leakedSessionCount = Number(normalizedOutput);
  if (!Number.isSafeInteger(leakedSessionCount) || leakedSessionCount !== 0) {
    fail(
      Number.isSafeInteger(leakedSessionCount)
        ? `Detected ${leakedSessionCount} leaked SQL contract session(s)`
        : "Could not verify SQL contract session cleanup"
    );
  }
}

async function readSessionManifest(contractPath) {
  const manifestPath = contractPath.replace(/\.sql$/, ".sessions.json");
  try {
    await access(manifestPath, fsConstants.R_OK);
  } catch {
    return null;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest === null ||
    Array.isArray(manifest) ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.sessions) ||
    manifest.sessions.length < 2 ||
    manifest.sessions.length > 8
  ) {
    fail(
      `${basename(manifestPath)} must define between two and eight sessions`
    );
  }

  const allowedKeys = new Set(["sessions", "timeoutMs"]);
  for (const key of Object.keys(manifest)) {
    if (!allowedKeys.has(key)) {
      fail(`${basename(manifestPath)} contains unsupported key ${key}`);
    }
  }

  const names = new Set();
  const sessions = [];
  for (const session of manifest.sessions) {
    if (
      session === null ||
      Array.isArray(session) ||
      typeof session !== "object" ||
      Object.keys(session).some((key) => !["name", "file"].includes(key)) ||
      typeof session.name !== "string" ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(session.name) ||
      typeof session.file !== "string" ||
      !/^external-[A-Za-z0-9_.-]+\.psql$/.test(session.file)
    ) {
      fail(`${basename(manifestPath)} has an invalid session entry`);
    }
    if (names.has(session.name)) {
      fail(`${basename(manifestPath)} repeats session ${session.name}`);
    }
    names.add(session.name);

    const sessionPath = resolve(dirname(manifestPath), session.file);
    if (!sessionPath.startsWith(`${CONTRACT_DIRECTORY}${sep}`)) {
      fail(`${basename(manifestPath)} references a file outside tests/sql`);
    }
    await access(sessionPath, fsConstants.R_OK);
    sessions.push({ name: session.name, path: sessionPath });
  }

  const timeoutMs = manifest.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 120_000
  ) {
    fail(`${basename(manifestPath)} has an invalid timeoutMs`);
  }

  return { sessions, timeoutMs };
}

async function runContract({
  contractPath,
  databaseUrl,
  runPrefix,
  sslRootCertificate,
  timeoutMs,
}) {
  const manifest = await readSessionManifest(contractPath);
  if (manifest) {
    const sessions = manifest.sessions.map((session) =>
      startPsql({
        applicationName: `${runPrefix}-${session.name}`,
        databaseUrl,
        file: session.path,
        sslRootCertificate,
        timeoutMs: Math.min(timeoutMs, manifest.timeoutMs),
      })
    );
    let firstFailure = null;
    const results = await Promise.allSettled(
      sessions.map(async (session) => {
        try {
          return await session.promise;
        } catch (error) {
          if (firstFailure === null) {
            firstFailure = error;
            terminateActiveChildren();
          }
          throw error;
        }
      })
    );
    if (firstFailure !== null) {
      throw firstFailure;
    }
    const failedResult = results.find(
      (result) => result.status === "rejected"
    );
    if (failedResult) {
      throw failedResult.reason;
    }
  }

  const verification = await runPsql({
    applicationName: `${runPrefix}-verify`,
    databaseUrl,
    file: contractPath,
    sslRootCertificate,
    timeoutMs,
  });
  const emittedPassSentinel = verification.stdout
    .split(/\r?\n/)
    .some((line) => line.trim() === CONTRACT_PASS_SENTINEL);
  if (!emittedPassSentinel) {
    fail(
      `${basename(contractPath)} did not emit ${CONTRACT_PASS_SENTINEL}; ` +
        "the contract may have been skipped or the psql binary is invalid"
    );
  }
  await assertNoLeakedSessions({
    databaseUrl,
    runPrefix,
    sslRootCertificate,
    timeoutMs,
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const {
    databaseUrl,
    isLoopback,
    sslRootCertificate,
  } = parseDatabaseTarget(options);
  const discovered = (await readdir(CONTRACT_DIRECTORY, {
    withFileTypes: true,
  }))
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("external-") &&
        entry.name.endsWith(".sql")
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (discovered.length === 0) {
    fail("No tests/sql/external-*.sql contracts were discovered");
  }

  const selected = options.match
    ? discovered.filter((name) => name.includes(options.match))
    : discovered;
  if (selected.length === 0) {
    fail(`No SQL contract matched ${options.match}`);
  }

  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const targetLabel = isLoopback ? "local database" : "disposable branch";
  process.stdout.write(
    `Running ${selected.length} external API SQL contract(s) on ${targetLabel}\n`
  );

  for (const [index, fileName] of selected.entries()) {
    if (cancellationExitCode !== null) {
      return;
    }
    const contractPath = resolve(CONTRACT_DIRECTORY, fileName);
    const runPrefix = `ops-external-api-${runId}-${index}`;
    try {
      await runContract({
        contractPath,
        databaseUrl,
        runPrefix,
        sslRootCertificate,
        timeoutMs: options.timeoutMs,
      });
      process.stdout.write(`PASS ${fileName}\n`);
    } catch (error) {
      terminateActiveChildren();
      if (cancellationExitCode !== null) {
        process.exitCode = cancellationExitCode;
        return;
      }
      process.stderr.write(
        `FAIL ${fileName}\n${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
      return;
    }
  }
}

process.once("SIGINT", () => {
  cancel(130);
});
process.once("SIGTERM", () => {
  cancel(143);
});

try {
  await main();
} catch (error) {
  terminateActiveChildren();
  if (cancellationExitCode !== null) {
    process.exitCode = cancellationExitCode;
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
