/**
 * Status → Tag variant — the single mapping.
 *
 * Earth tones are semantic (DESIGN.md § Tags): olive = done/won, tan =
 * attention, rose = negative, dim = inert/retired, neutral = a live state with
 * no charge. Two surfaces read this module — the command palette's result rows
 * and the Books invoice/estimate registers — so a second copy anywhere is the
 * bug this test exists to prevent.
 */

import { describe, expect, it } from "vitest";
import { EstimateStatus, InvoiceStatus } from "@/lib/types/pipeline";
import {
  ESTIMATE_STATUS_TAG_VARIANT,
  INVOICE_STATUS_TAG_VARIANT,
  statusTagVariant,
} from "@/lib/utils/status-tag-variant";

describe("statusTagVariant", () => {
  it("keeps live, uncharged states neutral", () => {
    expect(statusTagVariant("project", "rfq")).toBe("neutral");
    expect(statusTagVariant("project", "estimated")).toBe("neutral");
    expect(statusTagVariant("project", "accepted")).toBe("neutral");
    expect(statusTagVariant("lead", "new_lead")).toBe("neutral");
    expect(statusTagVariant("lead", "quoted")).toBe("neutral");
    expect(statusTagVariant("task", "active")).toBe("neutral");
    expect(statusTagVariant("document", "sent")).toBe("neutral");
  });

  it("spends olive only on work that moved or landed", () => {
    expect(statusTagVariant("project", "in_progress")).toBe("olive");
    expect(statusTagVariant("project", "completed")).toBe("olive");
    expect(statusTagVariant("lead", "won")).toBe("olive");
    expect(statusTagVariant("task", "completed")).toBe("olive");
    expect(statusTagVariant("document", "paid")).toBe("olive");
    expect(statusTagVariant("document", "approved")).toBe("olive");
  });

  it("spends tan on states that want the operator's attention", () => {
    expect(statusTagVariant("lead", "follow_up")).toBe("tan");
    expect(statusTagVariant("document", "partially_paid")).toBe("tan");
    expect(statusTagVariant("document", "expired")).toBe("tan");
  });

  it("spends rose only on a loss", () => {
    expect(statusTagVariant("lead", "lost")).toBe("rose");
    expect(statusTagVariant("document", "past_due")).toBe("rose");
    expect(statusTagVariant("document", "declined")).toBe("rose");
  });

  it("dims what is retired, cancelled or inert", () => {
    expect(statusTagVariant("project", "closed")).toBe("dim");
    expect(statusTagVariant("project", "archived")).toBe("dim");
    expect(statusTagVariant("lead", "discarded")).toBe("dim");
    expect(statusTagVariant("task", "cancelled")).toBe("dim");
    expect(statusTagVariant("document", "draft")).toBe("dim");
    expect(statusTagVariant("document", "void")).toBe("dim");
    expect(statusTagVariant("document", "written_off")).toBe("dim");
  });

  it("falls back to neutral for an absent, blank or unknown value", () => {
    expect(statusTagVariant("project", null)).toBe("neutral");
    expect(statusTagVariant("project", undefined)).toBe("neutral");
    expect(statusTagVariant("lead", "")).toBe("neutral");
    expect(statusTagVariant("task", "teleported")).toBe("neutral");
  });

  it("reads the raw column value however the database cased or padded it", () => {
    expect(statusTagVariant("project", " IN_PROGRESS ")).toBe("olive");
    expect(statusTagVariant("document", "Past_Due")).toBe("rose");
  });

  it("never lets one kind's value leak into another's", () => {
    // `converted` is an estimate state, `won` a lead state — the palette
    // renders both, and a flat shared table would cross them.
    expect(statusTagVariant("document", "converted")).toBe("olive");
    expect(statusTagVariant("project", "converted")).toBe("neutral");
    expect(statusTagVariant("document", "won")).toBe("neutral");
  });
});

describe("the Books registers read the same table", () => {
  it("maps every invoice status the enum declares", () => {
    for (const status of Object.values(InvoiceStatus)) {
      expect(
        INVOICE_STATUS_TAG_VARIANT[status],
        `invoice status ${status} has no variant`,
      ).toBeDefined();
    }
    expect(INVOICE_STATUS_TAG_VARIANT[InvoiceStatus.PastDue]).toBe("rose");
    expect(INVOICE_STATUS_TAG_VARIANT[InvoiceStatus.Paid]).toBe("olive");
  });

  it("leaves the estimate states Books renders neutral undeclared", () => {
    // Behaviour lifted verbatim from estimates-segment.tsx: these two fall
    // through to the `?? "neutral"` default. Declaring them here would silently
    // restyle the Books register.
    expect(ESTIMATE_STATUS_TAG_VARIANT[EstimateStatus.ChangesRequested]).toBeUndefined();
    expect(ESTIMATE_STATUS_TAG_VARIANT[EstimateStatus.Superseded]).toBeUndefined();
    expect(ESTIMATE_STATUS_TAG_VARIANT[EstimateStatus.Converted]).toBe("olive");
  });
});
