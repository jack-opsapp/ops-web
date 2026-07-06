import { describe, expect, it } from "vitest";
import { buildLeadTitle } from "@/lib/utils/lead-title";

describe("buildLeadTitle — canonical manual-lead grammar", () => {
  it("composes all three parts: Contact (Client) - Source Lead", () => {
    expect(
      buildLeadTitle({
        contactName: "Sarah Mitchell",
        clientName: "Mitchell Homes",
        sourceLabel: "Referral",
      }),
    ).toBe("Sarah Mitchell (Mitchell Homes) - Referral Lead");
  });

  it("degrades to '- Lead' when no source is chosen", () => {
    expect(
      buildLeadTitle({
        contactName: "Sarah Mitchell",
        clientName: "Mitchell Homes",
        sourceLabel: null,
      }),
    ).toBe("Sarah Mitchell (Mitchell Homes) - Lead");
  });

  it("drops the parenthetical when no client is linked", () => {
    expect(
      buildLeadTitle({ contactName: "Sarah Mitchell", sourceLabel: "Website" }),
    ).toBe("Sarah Mitchell - Website Lead");
  });

  it("contact only → 'Contact - Lead'", () => {
    expect(buildLeadTitle({ contactName: "Sarah Mitchell" })).toBe(
      "Sarah Mitchell - Lead",
    );
  });

  it("client only (no contact person) names by the client", () => {
    expect(
      buildLeadTitle({ clientName: "Mitchell Homes", sourceLabel: "Phone" }),
    ).toBe("Mitchell Homes - Phone Lead");
  });

  it("suppresses the parenthetical when contact repeats the client", () => {
    expect(
      buildLeadTitle({
        contactName: "Acme Corp",
        clientName: "Acme Corp",
        sourceLabel: "Repeat client",
      }),
    ).toBe("Acme Corp - Repeat client Lead");
  });

  it("client repetition check is case- and whitespace-insensitive", () => {
    expect(
      buildLeadTitle({
        contactName: "  acme   corp ",
        clientName: "ACME CORP",
      }),
    ).toBe("acme corp - Lead");
  });

  it("returns empty string when there is nothing to name from", () => {
    expect(buildLeadTitle({})).toBe("");
    expect(buildLeadTitle({ contactName: "  ", clientName: "" })).toBe("");
    expect(buildLeadTitle({ sourceLabel: "Referral" })).toBe("");
  });

  it("takes a localized suffix word (es: Prospecto)", () => {
    expect(
      buildLeadTitle({
        contactName: "Sarah Mitchell",
        clientName: "Mitchell Homes",
        sourceLabel: "Referido",
        suffix: "Prospecto",
      }),
    ).toBe("Sarah Mitchell (Mitchell Homes) - Referido Prospecto");
    expect(
      buildLeadTitle({ contactName: "Sarah", suffix: "Prospecto" }),
    ).toBe("Sarah - Prospecto");
  });

  it("collapses internal whitespace in every part", () => {
    expect(
      buildLeadTitle({
        contactName: "Sarah   Mitchell",
        clientName: " Mitchell  Homes ",
        sourceLabel: " Walk  in ",
      }),
    ).toBe("Sarah Mitchell (Mitchell Homes) - Walk in Lead");
  });
});
