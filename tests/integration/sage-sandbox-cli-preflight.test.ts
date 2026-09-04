import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, "../..");

describe("Sage sandbox operator command", () => {
  it("loads server-only modules and blocks before I/O when the profile is absent", async () => {
    try {
      await execFileAsync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/sage-sandbox-war-game.ts",
        ],
        {
          cwd: ROOT,
          env: { ...process.env, SAGE_ACTIVE_PROFILE: "" },
          timeout: 10_000,
        }
      );
      throw new Error("Expected the sandbox preflight to block");
    } catch (error) {
      const result = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      expect(result.code).toBe(2);
      expect(result.stdout?.trim()).toBe(
        "BLOCKED :: SAGE_ACTIVE_PROFILE must be explicitly set to sandbox."
      );
      expect(result.stderr?.trim()).toBe("");
    }
  });
});
