import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getOptionalPmfOperatorIdentity,
  getPmfRecipients,
} from "@/lib/pmf/recipients";

const OPERATOR_COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OPERATOR_USER_ID = "a6ab38dc-9844-4b72-922f-2d2f70f8e617";

describe("PMF recipient environment normalization", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PMF_NOTIFICATION_SMS = " +15555550100 ";
    process.env.PMF_NOTIFICATION_EMAIL = " ops@opsapp.co ";
    process.env.PMF_OPERATOR_USER_ID = ` ${OPERATOR_USER_ID} `;
    process.env.PMF_OPERATOR_COMPANY_ID = ` ${OPERATOR_COMPANY_ID}\n`;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("trims deployment-secret whitespace before a notification write can use it", () => {
    expect(getPmfRecipients()).toEqual({
      sms: "+15555550100",
      email: "ops@opsapp.co",
      operatorUserId: OPERATOR_USER_ID,
      operatorCompanyId: OPERATOR_COMPANY_ID,
    });
    expect(getOptionalPmfOperatorIdentity()).toEqual({
      operatorUserId: OPERATOR_USER_ID,
      operatorCompanyId: OPERATOR_COMPANY_ID,
    });
  });

  it("rejects a non-UUID operator company instead of creating a phantom tenant", () => {
    process.env.PMF_OPERATOR_COMPANY_ID = "not-a-company";

    expect(() => getPmfRecipients()).toThrow(
      "PMF_OPERATOR_COMPANY_ID must be a UUID"
    );
    expect(() => getOptionalPmfOperatorIdentity()).toThrow(
      "PMF_OPERATOR_COMPANY_ID must be a UUID"
    );
  });

  it("rejects a malformed operator user before it reaches a retrying database path", () => {
    process.env.PMF_OPERATOR_USER_ID = "not-a-user";

    expect(() => getOptionalPmfOperatorIdentity()).toThrow(
      "PMF_OPERATOR_USER_ID must be a UUID"
    );
  });

  it("keeps optional alert paths disabled when either operator value is absent", () => {
    delete process.env.PMF_OPERATOR_USER_ID;

    expect(getOptionalPmfOperatorIdentity()).toBeNull();
  });
});
