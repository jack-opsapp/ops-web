import { describe, expect, it } from "vitest";

import { isAIProviderUnavailableError } from "@/lib/api/services/openai-monitoring";

describe("isAIProviderUnavailableError", () => {
  describe("returns true for provider-unavailability", () => {
    it("treats a raw insufficient_quota code as unavailable", () => {
      expect(isAIProviderUnavailableError({ code: "insufficient_quota" })).toBe(
        true
      );
    });

    it("treats a nested { error: { code: insufficient_quota } } as unavailable", () => {
      expect(
        isAIProviderUnavailableError({
          error: { code: "insufficient_quota" },
        })
      ).toBe(true);
    });

    it.each([429, 500, 503, 599, 401, 403])(
      "treats HTTP status %i as unavailable",
      (status) => {
        expect(isAIProviderUnavailableError({ status })).toBe(true);
      }
    );

    it.each(["APIConnectionError", "APIConnectionTimeoutError"])(
      "treats transport error name %s as unavailable",
      (name) => {
        expect(isAIProviderUnavailableError({ name })).toBe(true);
      }
    );

    it("unwraps a provider quota error wrapped as a .cause", () => {
      const wrapped = new Error("[ai-sync-reviewer] batch failed", {
        cause: { code: "insufficient_quota" },
      });
      expect(isAIProviderUnavailableError(wrapped)).toBe(true);
    });

    it("unwraps a provider status error two .cause links deep", () => {
      const deep = { message: "top", cause: { cause: { status: 500 } } };
      expect(isAIProviderUnavailableError(deep)).toBe(true);
    });

    it("unwraps a provider quota error three .cause links deep", () => {
      const deep = {
        cause: { cause: { cause: { code: "insufficient_quota" } } },
      };
      expect(isAIProviderUnavailableError(deep)).toBe(true);
    });

    it("still reports unavailable when a contract error wraps a real quota cause", () => {
      const wrapped = {
        name: "StageEvaluationModelContractError",
        cause: { code: "insufficient_quota" },
      };
      expect(isAIProviderUnavailableError(wrapped)).toBe(true);
    });

    it("still reports unavailable when a refusal error wraps a provider outage status", () => {
      const wrapped = {
        name: "StageEvaluationModelRefusalError",
        cause: { status: 503 },
      };
      expect(isAIProviderUnavailableError(wrapped)).toBe(true);
    });
  });

  describe("returns false for cursor-holding failures", () => {
    it("does not treat a LifecyclePersistenceError as unavailable", () => {
      expect(
        isAIProviderUnavailableError({ name: "LifecyclePersistenceError" })
      ).toBe(false);
    });

    it("does not let a LifecyclePersistenceError status masquerade as a provider outage", () => {
      expect(
        isAIProviderUnavailableError({
          name: "LifecyclePersistenceError",
          status: 500,
        })
      ).toBe(false);
    });

    it.each([
      "StageEvaluationModelContractError",
      "LeadSummaryModelContractError",
      "StageEvaluationModelRefusalError",
    ])("does not treat model %s as unavailable", (name) => {
      expect(isAIProviderUnavailableError({ name })).toBe(false);
    });

    it("does not treat a bare model contract status as a provider outage", () => {
      expect(
        isAIProviderUnavailableError({
          name: "LeadSummaryModelContractError",
          status: 502,
        })
      ).toBe(false);
    });

    it.each([200, 400, 404, 422, 499])(
      "does not treat HTTP status %i as unavailable",
      (status) => {
        expect(isAIProviderUnavailableError({ status })).toBe(false);
      }
    );

    it("does not treat a plain Error as unavailable", () => {
      expect(isAIProviderUnavailableError(new Error("boom"))).toBe(false);
    });

    it("does not treat a deep-but-unrelated .cause chain as unavailable", () => {
      const deep = {
        message: "a",
        cause: { message: "b", cause: { message: "c", status: 400 } },
      };
      expect(isAIProviderUnavailableError(deep)).toBe(false);
    });

    it("does not walk past three .cause links (bounded depth)", () => {
      const tooDeep = {
        cause: { cause: { cause: { cause: { code: "insufficient_quota" } } } },
      };
      expect(isAIProviderUnavailableError(tooDeep)).toBe(false);
    });

    it.each([null, undefined, "insufficient_quota", 429, false])(
      "does not treat non-object %s as unavailable",
      (value) => {
        expect(isAIProviderUnavailableError(value)).toBe(false);
      }
    );

    it("does not treat a non-numeric status as unavailable", () => {
      expect(isAIProviderUnavailableError({ status: "500" })).toBe(false);
    });
  });
});
