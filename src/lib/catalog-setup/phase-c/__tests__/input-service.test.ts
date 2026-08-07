import { describe, expect, it } from "vitest";
import type { GuidedInputQueryClient } from "../input-service";
import {
  mutateGuidedSetupInput,
  GuidedSetupInputConflictError,
} from "../input-service";
import { CATALOG_CAPABILITY_MANIFEST_REVISION } from "../catalog-capability-manifest";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OPERATOR_ID = "d82114aa-7b98-4439-85f0-978f835e0627";
const SESSION_ID = "54ce9e88-5688-4e73-ae4e-a62f85044b77";

function createInputClient() {
  let current: Record<string, unknown> = {
    id: SESSION_ID,
    company_id: COMPANY_ID,
    operator_id: OPERATOR_ID,
    status: "interviewing",
    version: 0,
    input_revision: 0,
    processed_input_revision: 0,
    input_ledger: [],
    capability_manifest_revision:
      CATALOG_CAPABILITY_MANIFEST_REVISION,
    conversation: [],
    unresolved_questions: [
      {
        id: "first-service-line",
        intent: "service_selection",
        capabilityRef: "catalog-core/v1",
        prompt: "What service do you want to set up first?",
        answerKind: "text",
        factKeys: ["customer_products.first_service_line"],
      },
    ],
  };
  const updates: Record<string, unknown>[] = [];

  class Query {
    private filters: Array<[string, string | number]> = [];
    private values: Record<string, unknown> | null = null;

    select() {
      return this;
    }

    eq(column: string, value: string | number) {
      this.filters.push([column, value]);
      return this;
    }

    update(values: Record<string, unknown>) {
      this.values = values;
      return this;
    }

    maybeSingle() {
      const matches = this.filters.every(
        ([column, value]) => current[column] === value,
      );
      if (!matches) return Promise.resolve({ data: null, error: null });
      if (this.values) {
        updates.push(this.values);
        current = { ...current, ...this.values };
      }
      return Promise.resolve({ data: current, error: null });
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: null }) => TResult1)
        | null,
      onrejected?: ((reason: unknown) => TResult2) | null,
    ) {
      return this.maybeSingle().then(onfulfilled, onrejected);
    }
  }

  return {
    updates,
    current: () => current,
    client: {
      from() {
        return new Query();
      },
    } as unknown as GuidedInputQueryClient,
  };
}

describe("Phase C immediate operator input service", () => {
  it("persists a queued message before any Phase C generation", async () => {
    const { client, current } = createInputClient();
    const result = await mutateGuidedSetupInput({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      operation: "append",
      answer: "Vinyl decking",
      expectedVersion: 0,
      client,
      createInputId: () => "input-1",
      now: () => "2026-07-27T20:00:00.000Z",
    });

    expect(result.input).toMatchObject({
      id: "input-1",
      revision: 1,
      state: "queued",
    });
    expect(result.session).toMatchObject({
      version: 1,
      input_revision: 1,
      processed_input_revision: 0,
    });
    expect(
      (current().conversation as Array<Record<string, unknown>>).at(-1),
    ).toEqual(
      expect.objectContaining({
        inputId: "input-1",
        content: "Vinyl decking",
        state: "queued",
      }),
    );
  });

  it("accepts a quick follow-up while the first message is still queued", async () => {
    const { client, current } = createInputClient();
    await mutateGuidedSetupInput({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      operation: "append",
      answer: "Vinyl decking",
      expectedVersion: 0,
      client,
      createInputId: () => "input-1",
      now: () => "2026-07-27T20:00:00.000Z",
    });
    await mutateGuidedSetupInput({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      operation: "append",
      answer: "We use DekSmart",
      expectedVersion: 1,
      client,
      createInputId: () => "input-2",
      now: () => "2026-07-27T20:00:01.000Z",
    });

    expect(current()).toMatchObject({
      version: 2,
      input_revision: 2,
      processed_input_revision: 0,
    });
    expect(
      (current().input_ledger as Array<Record<string, unknown>>).map(
        (entry) => entry.state,
      ),
    ).toEqual(["queued", "queued"]);
  });

  it("edits and removes only the newest queued message", async () => {
    const { client, current } = createInputClient();
    await mutateGuidedSetupInput({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      operation: "append",
      answer: "DekSmart",
      expectedVersion: 0,
      client,
      createInputId: () => "input-1",
      now: () => "2026-07-27T20:00:00.000Z",
    });
    await mutateGuidedSetupInput({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      operation: "edit",
      answer: "DekSmart 68 mil",
      expectedInputId: "input-1",
      expectedVersion: 1,
      client,
      createInputId: () => "input-2",
      now: () => "2026-07-27T20:00:01.000Z",
    });
    await mutateGuidedSetupInput({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      operation: "remove",
      expectedInputId: "input-2",
      expectedVersion: 2,
      client,
      createInputId: () => "unused",
      now: () => "2026-07-27T20:00:02.000Z",
    });

    expect(
      (current().input_ledger as Array<Record<string, unknown>>).map(
        (entry) => entry.state,
      ),
    ).toEqual(["superseded", "removed"]);
    expect(
      (current().conversation as Array<Record<string, unknown>>).map(
        (message) => message.state,
      ).filter(Boolean),
    ).toEqual(["superseded", "removed"]);
  });

  it("rejects a stale session version without changing input", async () => {
    const { client, updates } = createInputClient();

    await expect(
      mutateGuidedSetupInput({
        token: "token",
        companyId: COMPANY_ID,
        operatorId: OPERATOR_ID,
        sessionId: SESSION_ID,
        operation: "append",
        answer: "Vinyl",
        expectedVersion: 4,
        client,
      }),
    ).rejects.toBeInstanceOf(GuidedSetupInputConflictError);
    expect(updates).toHaveLength(0);
  });
});
