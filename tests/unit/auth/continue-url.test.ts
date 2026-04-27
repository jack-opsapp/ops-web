import { describe, it, expect } from "vitest";
import { validateContinueUrl } from "@/lib/auth/continue-url";

describe("validateContinueUrl", () => {
  it("rejects missing", () => {
    expect(validateContinueUrl(null).ok).toBe(false);
  });
  it("rejects malformed", () => {
    expect(validateContinueUrl("not a url").reason).toBe("malformed");
  });
  it("accepts opsapp.co", () => {
    expect(validateContinueUrl("https://opsapp.co/x").ok).toBe(true);
  });
  it("accepts subdomains", () => {
    expect(validateContinueUrl("https://app.opsapp.co/y").ok).toBe(true);
  });
  it("rejects http in prod", () => {
    expect(validateContinueUrl("http://opsapp.co").reason).toBe("non_https");
  });
  it("rejects phishing lookalikes", () => {
    expect(validateContinueUrl("https://opsapp.co.evil.com").reason).toBe(
      "host_not_allowed"
    );
    expect(validateContinueUrl("https://attacker.com/?x=opsapp.co").reason).toBe(
      "host_not_allowed"
    );
  });
  it("rejects javascript:/data:", () => {
    expect(validateContinueUrl("javascript:alert(1)").reason).toBe("non_https");
    expect(validateContinueUrl("data:text/html,x").reason).toBe("non_https");
  });
  it("dev allows localhost + vercel", () => {
    expect(
      validateContinueUrl("http://localhost:3000", { allowDev: true }).ok
    ).toBe(true);
    expect(
      validateContinueUrl("https://x.vercel.app", { allowDev: true }).ok
    ).toBe(true);
    expect(validateContinueUrl("http://localhost:3000").ok).toBe(false);
  });
});
