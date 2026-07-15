import { describe, it, expect } from "vitest";
import { buildLeadFormSchema } from "@/components/ops/create-lead-modal";

const t = (key: string) => key;

function validBase() {
  return {
    contactName: "James Boss",
    title: "James Boss - Lead",
    contactEmail: "",
    contactPhone: "",
    clientId: null,
    source: "",
    estimatedValue: null,
    priority: "",
    description: "",
    address: "",
  };
}

describe("buildLeadFormSchema — estimatedValue", () => {
  // RHF reads "" from the DOM for a never-touched number input (setValueAs
  // only runs on change/blur events), so "" must be a valid cleared state —
  // otherwise submit fails silently on a field that shows no error.
  it("accepts \"\" as the untouched/cleared state", () => {
    const parsed = buildLeadFormSchema(t).safeParse({
      ...validBase(),
      estimatedValue: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts null and numbers", () => {
    const schema = buildLeadFormSchema(t);
    expect(schema.safeParse({ ...validBase(), estimatedValue: null }).success).toBe(true);
    expect(schema.safeParse({ ...validBase(), estimatedValue: 2500 }).success).toBe(true);
    expect(schema.safeParse({ ...validBase(), estimatedValue: 0 }).success).toBe(true);
  });

  it("still rejects non-numeric junk", () => {
    const parsed = buildLeadFormSchema(t).safeParse({
      ...validBase(),
      estimatedValue: "abc",
    });
    expect(parsed.success).toBe(false);
  });
});
