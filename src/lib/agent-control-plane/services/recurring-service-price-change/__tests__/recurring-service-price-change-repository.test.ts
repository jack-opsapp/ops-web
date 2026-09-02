import { describe, expect, it, vi } from "vitest";

import {
  createRecurringServicePriceChangeRepository,
  RecurringServicePriceChangeRepositoryAuthorityError,
  RecurringServicePriceChangeRepositoryBoundError,
  RecurringServicePriceChangeRepositoryInputError,
  RecurringServicePriceChangeRepositoryStaleError,
  RecurringServicePriceChangeRepositoryUnavailableError,
  type RecurringServicePriceChangeRpcClient,
} from "../recurring-service-price-change-repository";
import {
  PRICE_CLIENT_ID,
  PRICE_GRANT_ID,
  PRICE_SCOPES,
  PRICE_USER_ID,
  PRICE_UUID,
  recurringPriceActorFixture,
  recurringPriceCatalogFixture,
  recurringPriceSourceFixture,
} from "./fixtures";

describe("recurring service price-change repository", () => {
  it("reasserts the exact current OAuth and permission binding after the read", async () => {
    const { actor } = await recurringPriceActorFixture();
    const signal = new AbortController().signal;
    const abortSignal = vi.fn(async () => ({
      data: actor.permissionSnapshotRevision,
      error: null,
    }));
    const rpc = vi.fn<RecurringServicePriceChangeRpcClient["rpc"]>(() =>
      Object.assign(
        Promise.resolve({
          data: actor.permissionSnapshotRevision,
          error: null,
        }),
        { abortSignal }
      )
    );
    const repository = createRecurringServicePriceChangeRepository({ rpc });

    await expect(
      repository.assertCurrentAuthority({ actorContext: actor, signal })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "assert_agent_recurring_service_price_change_authority_as_system",
      {
        p_actor_user_id: PRICE_USER_ID,
        p_company_id: PRICE_UUID.company,
        p_oauth_grant_id: PRICE_GRANT_ID,
        p_oauth_client_id: PRICE_CLIENT_ID,
        p_grant_revision: "d".repeat(32),
        p_granted_scope_ceiling: PRICE_SCOPES,
        p_permission_snapshot_revision: `sha256:${"c".repeat(64)}`,
        p_capability_manifest_revision: "2026-09-01.capability-manifest.v15",
        p_exposure_revision: "2026-09-01.mcp-exposure.v9",
        p_capability_id: "prepare_recurring_service_price_change",
        p_capability_revision:
          "prepare_recurring_service_price_change:2026-09-01.v1",
      }
    );
    expect(abortSignal).toHaveBeenCalledWith(signal);

    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () => Promise.resolve({ data: null, error: { code: "42501" } }),
      }).assertCurrentAuthority({ actorContext: actor })
    ).rejects.toBeInstanceOf(
      RecurringServicePriceChangeRepositoryAuthorityError
    );
  });

  it("makes abortable catalog and detail reads with the exact v15/v9 binding and sentinels", async () => {
    const { actor } = await recurringPriceActorFixture();
    const source = recurringPriceSourceFixture();
    const catalog = recurringPriceCatalogFixture();
    const signal = new AbortController().signal;
    const rpc = vi.fn<RecurringServicePriceChangeRpcClient["rpc"]>(
      (_functionName, args) => {
        const data =
          args.p_read_phase === "catalog"
            ? catalog
            : { catalog, snapshot: source };
        return Object.assign(Promise.resolve({ data, error: null }), {
          abortSignal: vi.fn(async () => ({ data, error: null })),
        });
      }
    );
    const repository = createRecurringServicePriceChangeRepository({ rpc });
    await expect(
      repository.readRecurrenceCatalog({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
        signal,
      })
    ).resolves.toEqual(catalog);
    await expect(
      repository.readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
        selectedRecurrenceIds: [PRICE_UUID.recurrence],
        signal,
      })
    ).resolves.toEqual({ catalog, snapshot: source });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "read_agent_recurring_service_price_change_as_system",
      {
        p_actor_user_id: PRICE_USER_ID,
        p_company_id: PRICE_UUID.company,
        p_oauth_grant_id: PRICE_GRANT_ID,
        p_oauth_client_id: PRICE_CLIENT_ID,
        p_grant_revision: "d".repeat(32),
        p_granted_scope_ceiling: PRICE_SCOPES,
        p_permission_snapshot_revision: `sha256:${"c".repeat(64)}`,
        p_capability_manifest_revision: "2026-09-01.capability-manifest.v15",
        p_exposure_revision: "2026-09-01.mcp-exposure.v9",
        p_capability_id: "prepare_recurring_service_price_change",
        p_capability_revision:
          "prepare_recurring_service_price_change:2026-09-01.v1",
        p_observed_at: source.observed_at,
        p_service_selector: "Lawn maintenance",
        p_increase_percent: "8",
        p_effective_month: "2026-11",
        p_account_limit: 101,
        p_read_phase: "catalog",
        p_selected_recurrence_ids: [],
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "read_agent_recurring_service_price_change_as_system",
      expect.objectContaining({
        p_read_phase: "detail",
        p_selected_recurrence_ids: [PRICE_UUID.recurrence],
      })
    );
  });

  it("rejects wrong manifest actors, storage errors, tenant drift, request drift, and malformed snapshots", async () => {
    const { actor } = await recurringPriceActorFixture();
    const source = recurringPriceSourceFixture();
    const catalog = recurringPriceCatalogFixture();
    const rpc = vi.fn<RecurringServicePriceChangeRpcClient["rpc"]>(() =>
      Promise.resolve({ data: catalog, error: null })
    );
    const repository = createRecurringServicePriceChangeRepository({ rpc });
    await expect(
      repository.readRecurrenceCatalog({
        actorContext: { ...actor, capabilityManifestRevision: "wrong" },
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
      })
    ).rejects.toThrow("requires a v15 MCP actor");
    expect(rpc).not.toHaveBeenCalled();

    const cases: unknown[] = [
      null,
      { ...catalog, observed_at: "2026-09-01T12:00:01.000000Z" },
      {
        ...catalog,
        context: {
          ...catalog.context,
          company_id: "99999999-9999-4999-8999-999999999999",
        },
      },
      { ...catalog, request: { ...catalog.request, increase_percent: "9" } },
    ];
    for (const data of cases) {
      await expect(
        createRecurringServicePriceChangeRepository({
          rpc: () => Promise.resolve({ data, error: null }),
        }).readRecurrenceCatalog({
          actorContext: actor,
          observedAt: source.observed_at,
          input: {
            service_selector: "Lawn maintenance",
            increase_percent: "8",
            effective_month: "2026-11",
          },
        })
      ).rejects.toBeInstanceOf(
        RecurringServicePriceChangeRepositoryUnavailableError
      );
    }

    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () => Promise.resolve({ data: null, error: { code: "XX000" } }),
      }).readRecurrenceCatalog({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
      })
    ).rejects.toBeInstanceOf(
      RecurringServicePriceChangeRepositoryUnavailableError
    );
  });

  it("accepts SQL-owned Unicode normalization without recomputing it in ICU", async () => {
    const { actor } = await recurringPriceActorFixture();
    const source = recurringPriceSourceFixture();
    const catalog = recurringPriceCatalogFixture();
    const unicodeSource = {
      ...catalog,
      request: {
        ...catalog.request,
        service_selector: "İnşaat Bakımı",
        normalized_service_selector: "inşaat bakımı",
      },
      business_date: "2026-08-31",
    };
    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () => Promise.resolve({ data: unicodeSource, error: null }),
      }).readRecurrenceCatalog({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "İnşaat Bakımı",
          increase_percent: "8",
          effective_month: "2026-11",
        },
      })
    ).resolves.toEqual(unicodeSource);
  });

  it("preserves the exact effective-month rejection as invalid input", async () => {
    const { actor } = await recurringPriceActorFixture();
    const source = recurringPriceSourceFixture();
    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "22023",
              message: "AGENT_RECURRING_SERVICE_PRICE_CHANGE_MONTH_INVALID",
            },
          }),
      }).readRecurrenceCatalog({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-01",
        },
      })
    ).rejects.toBeInstanceOf(RecurringServicePriceChangeRepositoryInputError);

    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "22023",
              message: "AGENT_RECURRING_SERVICE_PRICE_CHANGE_INPUT_INVALID",
            },
          }),
      }).readRecurrenceCatalog({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Monthly maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
      })
    ).rejects.toBeInstanceOf(RecurringServicePriceChangeRepositoryInputError);
  });

  it("preserves an authority denial returned by the source read", async () => {
    const { actor } = await recurringPriceActorFixture();
    const source = recurringPriceSourceFixture();
    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "42501",
              message:
                "AGENT_RECURRING_SERVICE_PRICE_CHANGE_GRANT_STALE_OR_DENIED",
            },
          }),
      }).readRecurrenceCatalog({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
      })
    ).rejects.toBeInstanceOf(
      RecurringServicePriceChangeRepositoryAuthorityError
    );
  });

  it("preserves a stale detail selection as stale source state", async () => {
    const { actor } = await recurringPriceActorFixture();
    const source = recurringPriceSourceFixture();
    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "55000",
              message: "AGENT_RECURRING_SERVICE_PRICE_CHANGE_SELECTION_STALE",
            },
          }),
      }).readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
        selectedRecurrenceIds: [PRICE_UUID.recurrence],
      })
    ).rejects.toBeInstanceOf(RecurringServicePriceChangeRepositoryStaleError);
  });

  it("preserves a server-side source ceiling as a bounded result", async () => {
    const { actor } = await recurringPriceActorFixture();
    const source = recurringPriceSourceFixture();
    await expect(
      createRecurringServicePriceChangeRepository({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "54000",
              message: "AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_BOUND",
            },
          }),
      }).readRecurrenceCatalog({
        actorContext: actor,
        observedAt: source.observed_at,
        input: {
          service_selector: "Lawn maintenance",
          increase_percent: "8",
          effective_month: "2026-11",
        },
      })
    ).rejects.toBeInstanceOf(RecurringServicePriceChangeRepositoryBoundError);
  });
});
