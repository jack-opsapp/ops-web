import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SpecScopeLockedTotal, SpecScopeTab } from "@/lib/admin/spec-types";

vi.mock("@/app/admin/spec/[id]/_actions/mark-feature", () => ({ markFeature: vi.fn() }));
vi.mock("@/app/admin/spec/[id]/_actions/new-scope-revision", () => ({ newScopeRevision: vi.fn() }));
vi.mock("@/app/admin/spec/[id]/_actions/lock-total", () => ({ lockTotal: vi.fn() }));

import { ScopeTab } from "../ScopeTab";

const projectId = "5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";

const currentDoc = {
  id: "doc-2",
  version: 2,
  contentJson: { features: ["takeoff"] },
  externalUrl: null,
  features: [],
};

const versions = [
  {
    id: "doc-2",
    version: 2,
    contentHash: "abc123def456",
    externalUrl: null,
    draftedAt: "2026-09-04T00:00:00Z",
    sentAt: null,
    supersededAt: null,
    isCurrent: true,
  },
];

const lockable: SpecScopeLockedTotal = {
  tier: "spec03",
  floorCents: 2_500_000,
  lockedTotalCents: null,
  currentDocVersion: 2,
  currentDocTotalCents: null,
  signedAt: null,
  blockedReason: null,
};

function tab(lockedTotal: SpecScopeLockedTotal | null, current: SpecScopeTab["current"] = currentDoc): SpecScopeTab {
  return { versions, current, lockedTotal };
}

describe("ScopeTab — locked-total control", () => {
  it("never renders the control for a fixed-total tier", () => {
    render(<ScopeTab data={tab(null)} projectId={projectId} />);
    expect(screen.queryByText("LOCKED TOTAL")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /TOTAL/ })).toBeNull();
  });

  it("offers the lock with the floor stated when nothing is locked yet", () => {
    render(<ScopeTab data={tab(lockable)} projectId={projectId} />);
    expect(screen.getByText("LOCKED TOTAL")).toBeTruthy();
    expect(screen.getByText(/FLOOR · \$25,000/)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: /TOTAL/ }) as HTMLInputElement;
    expect(input.name).toBe("locked_total");
    expect(input.value).toBe("");
    expect(screen.getByRole("button", { name: "LOCK TOTAL" })).toBeTruthy();
    expect(screen.getByText(/WRITES THE TOTAL ONTO V2/)).toBeTruthy();
  });

  it("carries the project id for the action", () => {
    const { container } = render(<ScopeTab data={tab(lockable)} projectId={projectId} />);
    const hidden = container.querySelectorAll(`input[type="hidden"][name="project_id"][value="${projectId}"]`);
    expect(hidden.length).toBeGreaterThanOrEqual(2); // new-revision form + lock form
  });

  it("shows the locked figure, the resulting split, and a re-lock while the doc is still open", () => {
    render(
      <ScopeTab
        data={tab({ ...lockable, lockedTotalCents: 3_100_000, currentDocTotalCents: 3_100_000 })}
        projectId={projectId}
      />,
    );
    expect(screen.getByText("LOCKED")).toBeTruthy();
    expect(screen.getByText("$31,000")).toBeTruthy();
    expect(screen.getByText(/P1 \$6,250 · P2 \$8,250 · P3 \$8,250 · P4 \$8,250/)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: /TOTAL/ }) as HTMLInputElement;
    expect(input.value).toBe("31,000");
    expect(screen.getByRole("button", { name: "RE-LOCK" })).toBeTruthy();
    expect(screen.getByText(/OPEN UNTIL V2 IS SENT/)).toBeTruthy();
  });

  it("puts the residual cents on P4", () => {
    render(
      <ScopeTab
        data={tab({ ...lockable, lockedTotalCents: 3_100_001, currentDocTotalCents: 3_100_001 })}
        projectId={projectId}
      />,
    );
    expect(screen.getByText(/P2 \$8,250 · P3 \$8,250 · P4 \$8,250\.01/)).toBeTruthy();
  });

  it("flags a doc that carries a different figure than the project", () => {
    render(
      <ScopeTab
        data={tab({
          ...lockable,
          lockedTotalCents: 3_100_000,
          currentDocVersion: 3,
          currentDocTotalCents: 3_000_000,
        })}
        projectId={projectId}
      />,
    );
    expect(screen.getByText(/V3 CARRIES \$30,000 — RE-LOCK TO SYNC/)).toBeTruthy();
  });

  it("closes the control once the doc is sent, naming the version", () => {
    render(
      <ScopeTab
        data={tab({ ...lockable, lockedTotalCents: 3_100_000, blockedReason: "doc_sent" })}
        projectId={projectId}
      />,
    );
    expect(screen.getByText("$31,000")).toBeTruthy();
    expect(screen.getByText(/V2 SENT — CUT A NEW REVISION TO CHANGE THE TOTAL/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /TOTAL/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /LOCK/ })).toBeNull();
  });

  it("closes the control once the customer signs, naming the date", () => {
    render(
      <ScopeTab
        data={tab({
          ...lockable,
          lockedTotalCents: 3_100_000,
          signedAt: "2026-09-05T12:00:00Z",
          blockedReason: "signed",
        })}
        projectId={projectId}
      />,
    );
    expect(screen.getByText(/SIGNED · SEP 05, 2026 — CHANGES GO THROUGH A CHANGE ORDER/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /TOTAL/ })).toBeNull();
  });

  it("closes the control once P2 is invoiced", () => {
    render(
      <ScopeTab
        data={tab({ ...lockable, lockedTotalCents: 3_100_000, blockedReason: "p2_invoiced" })}
        projectId={projectId}
      />,
    );
    expect(screen.getByText(/P2 INVOICED — TOTAL IS BINDING/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /TOTAL/ })).toBeNull();
  });

  it("points at the first draft when no scope doc exists yet", () => {
    render(
      <ScopeTab
        data={tab({ ...lockable, currentDocVersion: null, blockedReason: "no_scope_doc" }, null)}
        projectId={projectId}
      />,
    );
    expect(screen.getByText("LOCKED TOTAL")).toBeTruthy();
    expect(screen.getByText(/DRAFT V1 FIRST — THE TOTAL LIVES ON THE SCOPE DOC/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /TOTAL/ })).toBeNull();
  });

  it("marks a closed engagement", () => {
    render(
      <ScopeTab data={tab({ ...lockable, blockedReason: "engagement_closed" })} projectId={projectId} />,
    );
    expect(screen.getByText(/ENGAGEMENT CLOSED/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /TOTAL/ })).toBeNull();
  });
});
