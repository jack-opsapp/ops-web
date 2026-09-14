import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const root = process.cwd();
const sqlRoot = join(root, "tests/sql");
const migration = join(
  root,
  "supabase/migrations/20260914201338_finalize_exact_email_thread_recovery.sql"
);

it("executes exact thread finalization contracts on isolated PostgreSQL 17 with real ownership guards", async () => {
  const location = await mkdtemp(join(tmpdir(), "ops-exact-thread-pg-"));
  const data = join(location, "data");
  // Unix sockets have a short path limit on macOS. This is a private, fresh
  // directory; the server never opens a TCP listener or uses a configured URL.
  const socket = await mkdtemp("/private/tmp/ops-thread-pg-");
  let started = false;
  try {
    const version = await execute("pg_config", ["--version"]);
    expect(version.stdout).toMatch(/PostgreSQL 17\./);
    await mkdir(data);
    await execute(
      "initdb",
      ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"],
      { timeout: 30_000 }
    );
    await execute(
      "pg_ctl",
      [
        "-D",
        data,
        "-l",
        join(location, "postgres.log"),
        "-o",
        `-k ${socket} -c listen_addresses=''`,
        "-w",
        "start",
      ],
      { timeout: 30_000 }
    );
    started = true;
    const result = await execute(
      "psql",
      [
        "-X",
        "-q",
        "-h",
        socket,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        join(sqlRoot, "exact-thread-recovery-finalization-bootstrap.sql"),
        "-f",
        join(sqlRoot, "exact-thread-recovery-finalization-ownership.sql"),
        "-f",
        join(
          sqlRoot,
          "exact-thread-recovery-finalization-attachment-state.sql"
        ),
        "-f",
        migration,
        "-f",
        join(sqlRoot, "exact-thread-recovery-finalization-runtime.sql"),
      ],
      { timeout: 30_000, maxBuffer: 1_000_000 }
    );
    expect(result.stdout).toContain(
      "EXACT_THREAD_FINALIZATION_CONTRACTS_PASSED"
    );
    expect(result.stderr).toBe("");

    const psqlArguments = [
      "-X",
      "-q",
      "-t",
      "-A",
      "-h",
      socket,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ];
    const holder = spawn("psql", psqlArguments, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let holderOutput = "";
    let holderErrors = "";
    holder.stdout.on("data", (chunk) => {
      holderOutput += chunk.toString();
    });
    holder.stderr.on("data", (chunk) => {
      holderErrors += chunk.toString();
    });
    const holderFinished = new Promise<number | null>((resolve, reject) => {
      holder.once("error", reject);
      holder.once("close", resolve);
    });
    try {
      const locked = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(`Finalizer did not acquire locks: ${holderErrors}`)
            ),
          10_000
        );
        holder.stdout.on("data", () => {
          if (holderOutput.includes("FINALIZER_LOCKS_HELD")) {
            clearTimeout(timer);
            resolve();
          }
        });
        holder.once("close", () => {
          clearTimeout(timer);
          reject(new Error(holderErrors));
        });
      });
      holder.stdin.write(
        "select test.reset(); begin; select test.call(); select 'FINALIZER_LOCKS_HELD';\n"
      );
      await locked;
      // A different transaction cannot append an unreviewed message between
      // exact-set validation and commit, even if it bypasses the provider lease.
      const insert = execute("psql", [
        ...psqlArguments,
        "-c",
        "set lock_timeout='100ms'; insert into public.activities(id,email_thread_id) values('a0000000-0000-4000-8000-000000000009','referral-thread');",
      ]);
      await expect(insert).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "canceling statement due to lock timeout"
        ),
      });
      const objectMutation = execute("psql", [
        ...psqlArguments,
        "-c",
        "set lock_timeout='100ms'; update public.email_conversion_photo_objects set state='uploaded' where id='f0000000-0000-4000-8000-000000000003';",
      ]);
      await expect(objectMutation).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "canceling statement due to lock timeout"
        ),
      });
      const objectInsert = execute("psql", [
        ...psqlArguments,
        "-c",
        "set lock_timeout='100ms'; insert into public.email_conversion_photo_objects values('f0000000-0000-4000-8000-000000000009','e0000000-0000-4000-8000-000000000003','uploaded');",
      ]);
      await expect(objectInsert).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "canceling statement due to lock timeout"
        ),
      });
    } finally {
      holder.stdin.end("rollback;\\q\n");
      expect(await holderFinished).toBe(0);
    }
    const afterRollback = await execute("psql", [
      ...psqlArguments,
      "-c",
      "select test.assert((select count(*)=4 from public.activities),'concurrent insert absent'); select test.assert((select count(*)=0 from private.email_thread_recovery_finalizations),'rollback after held locks');",
    ]);
    expect(afterRollback.stderr).toBe("");
    const sql = await readFile(migration, "utf8");
    // The additive contract must never alter the older, same-client API.
    expect(sql).not.toMatch(
      /(?:create|alter|drop)\s+(?:or\s+replace\s+)?function\s+public\.reassign_opportunity_email_thread_guarded/i
    );
  } finally {
    // Never remove an active data directory if stopping the server fails.
    if (started)
      await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
        timeout: 30_000,
      });
    await rm(location, { recursive: true, force: true });
    await rm(socket, { recursive: true, force: true });
  }
}, 120_000);
