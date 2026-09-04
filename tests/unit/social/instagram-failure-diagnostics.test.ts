/** @vitest-environment node */

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
