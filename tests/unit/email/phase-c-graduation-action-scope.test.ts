import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildPhaseCGraduationActionUrl,
  parsePhaseCGraduationActionScope,
  selectPhaseCCalibrationConnection,
} from "@/lib/email/phase-c-graduation-action";

const CONNECTION_A = "11111111-1111-4111-8111-111111111111";
const CONNECTION_B = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const wizardSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/agent/comms-config-wizard/comms-config-wizard.tsx"
  ),
  "utf8"
);

describe("Phase C graduation calibration action", () => {
  it("round-trips the exact mailbox and primary category at wizard step 9", () => {
    const url = buildPhaseCGraduationActionUrl(CONNECTION_B, "VENDOR");

    expect(url).toBe(
      `/agent/auto-send?connectionId=${CONNECTION_B}&category=VENDOR`
    );
    const searchParams = new URL(`https://ops.test${url}`).searchParams;
    expect(parsePhaseCGraduationActionScope(searchParams)).toEqual({
      connectionId: CONNECTION_B,
      category: "VENDOR",
    });
  });

  it("rejects incomplete or unsupported graduation scopes", () => {
    expect(
      parsePhaseCGraduationActionScope(
        new URLSearchParams({ connectionId: CONNECTION_A })
      )
    ).toBeNull();
    expect(
      parsePhaseCGraduationActionScope(
        new URLSearchParams({
          connectionId: CONNECTION_A,
          category: "LEGAL",
        })
      )
    ).toBeNull();
    expect(
      parsePhaseCGraduationActionScope(
        new URLSearchParams({
          connectionId: "not-a-mailbox-id",
          category: "CUSTOMER",
        })
      )
    ).toBeNull();
  });

  it("fails closed instead of falling back when a requested mailbox is unavailable", () => {
    const connections = [
      {
        id: CONNECTION_A,
        type: "individual",
        userId: ACTOR,
        status: "active",
      },
      {
        id: CONNECTION_B,
        type: "company",
        userId: null,
        status: "disconnected",
      },
    ];

    expect(
      selectPhaseCCalibrationConnection(connections, ACTOR, CONNECTION_B)
    ).toBeNull();
    expect(
      selectPhaseCCalibrationConnection(connections, ACTOR, null)?.id
    ).toBe(CONNECTION_A);
  });

  it("uses the canonical trimmed OPS owner id for a personal mailbox", () => {
    const connection = {
      id: CONNECTION_A,
      type: "individual",
      userId: `  ${ACTOR}  `,
      status: "active",
    };

    expect(
      selectPhaseCCalibrationConnection([connection], ACTOR, CONNECTION_A)?.id
    ).toBe(CONNECTION_A);
  });

  it("makes the wizard consume the exact graduation scope and focus its category", () => {
    expect(wizardSource).toContain("parsePhaseCGraduationActionScope(");
    expect(wizardSource).toContain("selectPhaseCCalibrationConnection(");
    expect(wizardSource).toContain("focusPrimaryCategory=");
  });
});
