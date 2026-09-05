/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  instagramFailureDiagnostic,
  instagramProviderFailureDetails,
  instagramResponseShape,
} from "@/lib/social/instagram-failure-diagnostics";

describe("Instagram failure diagnostic disclosure boundary", () => {
  it("retains only known local codes and numeric provider details", () => {
    const failure = Object.assign(new Error("private-token"), {
      code: "INSTAGRAM_OAUTH_REJECTED",
      httpStatus: 400,
      details: {
        providerCode: 190,
        providerSubcode: 460,
        access_token: "private-token",
      },
      stack: "private-stack",
      url: "https://example.test/?code=private-code",
    });
    expect(instagramFailureDiagnostic("code_exchange", failure)).toEqual({
      stage: "code_exchange",
      code: "INSTAGRAM_OAUTH_REJECTED",
      httpStatus: 400,
      providerCode: 190,
      providerSubcode: 460,
    });
  });

  it.each([
    "private-value",
    NaN,
    Infinity,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("drops invalid numeric provider details: %s", (value) => {
    expect(
      instagramProviderFailureDetails({
        error: {
          code: value,
          error_subcode: value,
          message: "private-token",
        },
      })
    ).toEqual({});
    expect(
      instagramFailureDiagnostic("connection_storage", {
        code: "private-code",
        httpStatus: value,
        details: { providerCode: value, providerSubcode: value },
      })
    ).toEqual({
      stage: "connection_storage",
      code: "INSTAGRAM_CONNECTION_FAILED",
    });
  });

  it("handles top-level Instagram token error codes without retaining other fields", () => {
    expect(
      instagramProviderFailureDetails({
        code: 400,
        error_type: "OAuthException",
        error_message: "private-code",
      })
    ).toEqual({ providerCode: 400 });
  });

  it.each([
    { message: "Invalid client secret", hints: ["client_secret", "invalid"] },
    {
      message: "Invalid appsecret_proof provided",
      hints: ["appsecret_proof", "invalid"],
    },
    {
      message: "The access_token parameter is required",
      hints: ["access_token", "missing"],
    },
    {
      message: "OAuth access token has expired",
      hints: ["access_token", "expired"],
    },
    { message: "Invalid client_id", hints: ["client_id", "invalid"] },
    { message: "Invalid app id", hints: ["client_id", "invalid"] },
    { message: "Invalid grant_type", hints: ["grant_type", "invalid"] },
    { message: "Invalid redirect_uri", hints: ["redirect_uri", "invalid"] },
    { message: "Unsupported get request", hints: ["unsupported_request"] },
    { message: "This request requires a permission", hints: ["permission"] },
    { message: "Rate limit exceeded", hints: ["rate_limit"] },
  ])("classifies $message using fixed hints only", ({ message, hints }) => {
    const details = instagramProviderFailureDetails({
      error: { code: 100, message },
    });
    expect(details).toEqual({ providerCode: 100, providerHints: hints });
    expect(
      instagramFailureDiagnostic("token_upgrade", {
        code: "INSTAGRAM_OAUTH_REJECTED",
        details,
      })
    ).toEqual({
      stage: "token_upgrade",
      code: "INSTAGRAM_OAUTH_REJECTED",
      providerCode: 100,
      providerHints: hints,
    });
  });

  it("removes known secret values before classifying a provider message", () => {
    expect(
      instagramProviderFailureDetails(
        {
          error: {
            code: 100,
            message:
              "Failure: access_token-invalid-fixture client_secret-invalid-fixture",
          },
        },
        ["access_token-invalid-fixture", "client_secret-invalid-fixture"]
      )
    ).toEqual({ providerCode: 100 });
  });

  it("classifies top-level errors and drops all free-form provider text", () => {
    const details = instagramProviderFailureDetails({
      code: 400,
      error_message:
        "Invalid client_secret: private-value https://example.test/private user@example.test",
      error_user_msg: "private-provider-text",
    });
    expect(details).toEqual({
      providerCode: 400,
      providerHints: ["client_secret", "invalid"],
    });
    expect(JSON.stringify(details)).not.toContain("private");
    expect(JSON.stringify(details)).not.toContain("example.test");
  });

  it("revalidates hint values at the logging boundary", () => {
    expect(
      instagramFailureDiagnostic("token_upgrade", {
        details: {
          providerHints: [
            "private-token",
            "client_secret",
            "client_secret",
            { value: "private" },
          ],
        },
      })
    ).toEqual({
      stage: "token_upgrade",
      code: "INSTAGRAM_CONNECTION_FAILED",
      providerHints: ["client_secret"],
    });
  });

  it.each([
    { value: undefined, label: "unavailable" },
    { value: null, label: "null" },
    { value: ["private-token"], label: "array" },
    { value: { access_token: "private-token" }, label: "object" },
    {
      value: { data: [{ access_token: "private-token" }] },
      label: "data_array",
    },
    {
      value: { data: { access_token: "private-token" } },
      label: "data_object",
    },
    { value: "private-token", label: "primitive" },
  ])(
    "summarizes $label without including response values",
    ({ value, label }) => {
      expect(instagramResponseShape(value)).toBe(label);
    }
  );
});
