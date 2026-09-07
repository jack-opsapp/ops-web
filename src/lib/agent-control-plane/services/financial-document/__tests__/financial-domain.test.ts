import { describe, expect, it, vi } from "vitest";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { createFinancialDocumentRepository } from "../financial-document-repository";
import { createFinancialDocumentService } from "../financial-document-service";
import type { ScheduleChangeRpcClient } from "../../schedule-change/schedule-change-repository";
import {
  actorFixture,
  REQUEST,
  resultFixture,
  ACTOR_ID,
  COMPANY_ID,
  CLIENT_ID,
  HASH,
} from "./financial-fixtures";
import { FINANCIAL_DOCUMENT_PROMPT_SAFETY } from "@/lib/agent-control-plane/contracts/financial-document";

describe("financial repository and current authority", () => {
  it("rejects a structurally copied actor before reading business evidence", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    const service = createFinancialDocumentService({
      repository: createFinancialDocumentRepository({ rpc }),
      authorityRepository: authorityClient.repository,
    });
    await expect(
      service.prepareFinancialDocument({ ...actor }, REQUEST)
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(rpc).not.toHaveBeenCalled();
    expect(authorityClient.actorLookups).toHaveLength(0);
  });
  it("rejects missing granted financial preparation scope before business RPC", async () => {
    const { actor, authorityClient } = await actorFixture({
      scopes: [
        "ops.company.read",
        "ops.customers.read",
        "ops.financial_documents.read",
        "ops.jobs.read",
      ],
    });
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
    const service = createFinancialDocumentService({
      repository: createFinancialDocumentRepository({ rpc }),
      authorityRepository: authorityClient.repository,
    });
    await expect(
      service.prepareFinancialDocument(actor, REQUEST)
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reauthorizes before preparing the exact unchanged request", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
      Promise.resolve({ data: resultFixture(), error: null })
    );
    const service = createFinancialDocumentService({
      repository: createFinancialDocumentRepository({ rpc }),
      authorityRepository: authorityClient.repository,
    });
    expect(await service.prepareFinancialDocument(actor, REQUEST)).toEqual(
      resultFixture()
    );
    expect(authorityClient.actorLookups).toHaveLength(1);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]).toEqual([
      "prepare_financial_document_as_system",
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_request: REQUEST,
        p_capability_manifest_revision: "2026-09-07.capability-manifest.v23",
        p_exposure_revision: "2026-09-07.mcp-exposure.v17",
      }),
    ]);
  });
  it.each(["inactive", "missing", "permissions"])(
    "rejects current authority %s before source RPC",
    async (mode) => {
      const { actor, authorityClient } = await actorFixture();
      if (mode === "missing") authorityClient.mcpResult = null;
      else
        authorityClient.mcpResult = {
          ...authorityClient.mcpResult!,
          ...(mode === "inactive"
            ? { isActive: false }
            : { configuredPermissions: [], effectivePermissions: [] }),
        };
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
      const service = createFinancialDocumentService({
        repository: createFinancialDocumentRepository({ rpc }),
        authorityRepository: authorityClient.repository,
      });
      await expect(
        service.prepareFinancialDocument(actor, REQUEST)
      ).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
  it.each([
    { ...REQUEST, total: "1.00" },
    { ...REQUEST, operation: null },
    { ...REQUEST, lines: [] },
  ])(
    "rejects malformed financial input before authority or persistence",
    async (request) => {
      const { actor, authorityClient } = await actorFixture();
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
      const service = createFinancialDocumentService({
        repository: createFinancialDocumentRepository({ rpc }),
        authorityRepository: authorityClient.repository,
      });
      await expect(
        service.prepareFinancialDocument(actor, request as typeof REQUEST)
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(rpc).not.toHaveBeenCalled();
      expect(authorityClient.actorLookups).toHaveLength(0);
    }
  );
  it.each(["client", "target", "price", "request-id"])(
    "rejects validly shaped response substitution: %s",
    async (field) => {
      const { actor } = await actorFixture();
      const output = resultFixture();
      if (field === "client") output.proposal.request.client_id = COMPANY_ID;
      if (field === "target")
        output.proposal.request.opportunity_id = COMPANY_ID;
      if (field === "price")
        output.proposal.request.lines[0].source.unit_price = "99.00";
      if (field === "request-id") output.request_id = "different-request";
      const repository = createFinancialDocumentRepository({
        rpc: () => Promise.resolve({ data: output, error: null }),
      });
      await expect(
        repository.prepare({
          actorContext: actor,
          request: REQUEST,
          observedAt: "2026-09-07T12:00:00Z",
        })
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    }
  );
  it("accepts semantically identical PostgreSQL JSON with reordered keys", async () => {
    const { actor } = await actorFixture();
    const output = resultFixture();
    output.proposal.request = Object.fromEntries(
      Object.entries(output.proposal.request).reverse()
    ) as typeof REQUEST;
    const repository = createFinancialDocumentRepository({
      rpc: () => Promise.resolve({ data: output, error: null }),
    });
    expect(
      await repository.prepare({
        actorContext: actor,
        request: REQUEST,
        observedAt: "2026-09-07T12:00:00Z",
      })
    ).toEqual(output);
  });
  it.each([
    "FINANCIAL_DOCUMENT_GRANT_STALE",
    "FINANCIAL_DOCUMENT_AUTHORITY_STALE",
  ])(
    "maps revoked database authority %s without exposing details",
    async (message) => {
      const { actor, authorityClient } = await actorFixture();
      const service = createFinancialDocumentService({
        repository: createFinancialDocumentRepository({
          rpc: () => Promise.resolve({ data: null, error: { message } }),
        }),
        authorityRepository: authorityClient.repository,
      });
      await expect(
        service.prepareFinancialDocument(actor, REQUEST)
      ).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    }
  );
  it.each(["substitute", "duplicate", "omit"])(
    "context source identity set rejects %s",
    async (mode) => {
      const { actor } = await actorFixture();
      const source = {
        kind: "catalog",
        id: CLIENT_ID,
        sha256: HASH,
        name: "Fictional product",
        unit_price: "12.50",
        unit: "hour",
        status: "active",
      };
      const result = {
        client_id: CLIENT_ID,
        target_id: CLIENT_ID,
        policy: {
          id: CLIENT_ID,
          sha256: HASH,
          revision: "fixture",
          currency: "CAD",
          terms: REQUEST.terms,
          permitted_price_sources: ["operator"],
          permitted_units: ["hour"],
          source_document_id: CLIENT_ID,
          source_sha256: HASH,
          source_content: "Fictional approved terms",
        },
        sources:
          mode === "omit"
            ? []
            : mode === "duplicate"
              ? [source, source]
              : [{ ...source, id: COMPANY_ID }],
        prompt_safety: FINANCIAL_DOCUMENT_PROMPT_SAFETY,
      };
      const repository = createFinancialDocumentRepository({
        rpc: () => Promise.resolve({ data: result, error: null }),
      });
      await expect(
        repository.inspect(actor, {
          client_id: CLIENT_ID,
          project_id: CLIENT_ID,
          opportunity_id: null,
          product_ids: [CLIENT_ID],
          historical_line_ids: [],
          estimate_ids: [],
          project_note_ids: [],
        })
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    }
  );
});
