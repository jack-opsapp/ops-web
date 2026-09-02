import { describe, expect, it } from "vitest";

import {
  RECURRING_SERVICE_PRICE_CHANGE_MAX_EVIDENCE_REFS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_OUTPUT_CHARACTERS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_SNAPSHOT_CHARACTERS,
  RecurringServicePriceChangeResultSchema,
} from "@/lib/agent-control-plane/contracts/recurring-service-price-change";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";

import {
  calculateRecurringServicePriceChange,
  RecurringServicePriceChangePrepareError,
  selectRecurringServicePriceChangeRecurrenceIds,
} from "../recurring-service-price-change-service";
import {
  PRICE_UUID,
  recurringPriceCatalogFixture,
  recurringPriceSourceFixture,
} from "./fixtures";

const INPUT = {
  service_selector: "Lawn maintenance",
  increase_percent: "8",
  effective_month: "2026-11",
} as const;

function uuid(sequence: number): string {
  return `20000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function sha(sequence: number): string {
  return sequence.toString(16).padStart(64, "0");
}

describe("recurring service price-change calculation", () => {
  it("builds the exact ephemeral 8% package with notice, tax, draft, and stable identity", () => {
    const source = recurringPriceSourceFixture();
    const first = calculateRecurringServicePriceChange(source, INPUT, "req-1");
    const second = calculateRecurringServicePriceChange(source, INPUT, "req-1");

    expect(first.status).toBe("ready");
    expect(first.selection).toMatchObject({
      total_accounts: 1,
      included_count: 1,
      excluded_count: 0,
    });
    expect(first.previews[0]).toMatchObject({
      client_id: PRICE_UUID.client,
      contact: { address: "morgan@example.com", channel: "email" },
      pricing: {
        currency_code: "CAD",
        current_unit_minor: 10_000,
        proposed_unit_minor: 10_800,
        tax: {
          proposed_unit_tax_minor: 540,
          proposed_unit_total_minor: 11_340,
        },
      },
      schedule: {
        effective_date: "2026-11-02",
        recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
      },
      notice_rule: {
        latest_notice_date: "2026-10-03",
        evaluation_date: "2026-09-01",
        satisfied: true,
      },
      churn_risk: {
        level: "unknown",
        confidence: "unknown",
        correspondence_window: {
          start: "2025-09-01T12:00:00.000Z",
          end: "2026-09-01T12:00:00.000000Z",
        },
        correspondence_evidence_complete_within_window: true,
        signal_codes: ["insufficient_history"],
      },
      draft: { send_state: "not_sent" },
    });
    expect(first.previews[0]!.draft.subject).toBe(
      "Lawn maintenance rate update"
    );
    expect(first.previews[0]!.draft.body).toContain(
      "Starting November 2, 2026, the Lawn maintenance rate will change from CAD 100.00 to CAD 108.00 per visit, plus GST at 5%."
    );
    expect(first.previews[0]!.draft.formatter_revision).toBe(
      "ops.price-notice.en.v1"
    );
    expect(first.plan_hash).toBe(second.plan_hash);
    expect(first.previews[0]!.preview_id).toBe(second.previews[0]!.preview_id);
    expect(first.safety).toEqual({
      ephemeral: true,
      preview_content_stored: false,
      transport_audit_metadata_recorded: true,
      sent: false,
      prices_changed: false,
      contracts_changed: false,
      invoices_changed: false,
      service_changed: false,
      commit_capability_available: false,
    });
  });

  it("truncates notice subjects on Unicode code-point and UTF-8 byte boundaries", () => {
    const source = recurringPriceSourceFixture();
    const serviceName = `${"a".repeat(174)}😀${"b".repeat(64)}`;
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        service_resolution: {
          ...source.service_resolution,
          service_name: serviceName,
        },
        accounts: source.accounts.map((account) => ({
          ...account,
          service_name: serviceName,
        })),
      },
      INPUT,
      "req-unicode-subject"
    );
    const subject = result.previews[0]!.draft.subject;
    expect(Buffer.byteLength(subject, "utf8")).toBeLessThanOrEqual(200);
    expect(subject).not.toMatch(/[\ud800-\udfff]/u);
    expect(subject).toMatch(/ rate update$/);
  });

  it("discloses the rolling evidence window without putting observation time in identity", () => {
    const source = recurringPriceSourceFixture();
    const later = {
      ...source,
      observed_at: "2026-09-01T12:00:30.000000Z",
    };
    const first = calculateRecurringServicePriceChange(source, INPUT, "req-a");
    const second = calculateRecurringServicePriceChange(later, INPUT, "req-b");

    expect(second.previews[0]!.churn_risk.correspondence_window.end).toBe(
      later.observed_at
    );
    expect(second.previews[0]!.preview_id).toBe(first.previews[0]!.preview_id);
    expect(second.plan_hash).toBe(first.plan_hash);
  });

  it("changes each preview identity when authoritative company pricing or notice context changes", () => {
    const source = recurringPriceSourceFixture();
    const baseline = calculateRecurringServicePriceChange(
      source,
      INPUT,
      "req-context-baseline"
    );
    const yen = calculateRecurringServicePriceChange(
      { ...source, context: { ...source.context, currency_code: "JPY" } },
      INPUT,
      "req-context-jpy"
    );
    const renamed = calculateRecurringServicePriceChange(
      {
        ...source,
        context: { ...source.context, company_name: "Northstar Services" },
      },
      INPUT,
      "req-context-name"
    );

    expect(yen.previews[0]!.pricing.currency_minor_exponent).toBe(0);
    expect(yen.previews[0]!.preview_id).not.toBe(
      baseline.previews[0]!.preview_id
    );
    expect(renamed.previews[0]!.draft.body).toContain("Northstar Services");
    expect(renamed.previews[0]!.preview_id).not.toBe(
      baseline.previews[0]!.preview_id
    );
  });

  it("binds every evaluated account source revision into the package identity", () => {
    const source = recurringPriceSourceFixture();
    const excluded = {
      ...source,
      accounts: source.accounts.map((account) => ({
        ...account,
        correspondence: {
          ...account.correspondence,
          unreadable_count: 1,
        },
      })),
    };
    const changed = {
      ...excluded,
      accounts: excluded.accounts.map((account) => ({
        ...account,
        source_revision: sha(77_001),
      })),
    };

    const first = calculateRecurringServicePriceChange(
      excluded,
      INPUT,
      "req-excluded-source-a"
    );
    const second = calculateRecurringServicePriceChange(
      changed,
      INPUT,
      "req-excluded-source-b"
    );

    expect(first.exclusions).toEqual(second.exclusions);
    expect(first.plan_hash).not.toBe(second.plan_hash);
  });

  it("keeps an active recurring account eligible after more than ten years", () => {
    const source = recurringPriceSourceFixture();
    const oldSeries = {
      ...source,
      accounts: source.accounts.map((account) => ({
        ...account,
        recurrence: {
          ...account.recurrence,
          start_anchor: "2015-01-05",
          source_sha256: sha(20_150_105),
        },
        source_revision: sha(20_260_901),
      })),
    };

    expect(
      calculateRecurringServicePriceChange(oldSeries, INPUT, "req-old-series")
        .previews[0]!.schedule.effective_date
    ).toBe("2026-11-02");
  });

  it("honours an exact recurrence exception moved into the month from more than 31 days away", () => {
    const source = recurringPriceSourceFixture();
    const moved = {
      ...source,
      accounts: source.accounts.map((account) => ({
        ...account,
        recurrence: {
          ...account.recurrence,
          rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
          start_anchor: "2026-01-15",
          exceptions: [
            {
              original_date: "2026-01-15",
              action: "reschedule" as const,
              new_date: "2026-11-01",
            },
          ],
          source_sha256: sha(31_001),
        },
        source_revision: sha(31_002),
      })),
    };

    expect(
      calculateRecurringServicePriceChange(moved, INPUT, "req-long-move")
        .previews[0]!.schedule.effective_date
    ).toBe("2026-11-01");
  });

  it("supports the RFC 5545 last-weekday BYSETPOS rule", () => {
    const source = recurringPriceSourceFixture();
    const rrule = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1";
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: source.accounts.map((account) => ({
          ...account,
          recurrence: {
            ...account.recurrence,
            rrule,
            source_sha256: sha(55_001),
          },
          source_revision: sha(55_002),
        })),
      },
      INPUT,
      "req-bysetpos"
    );

    expect(result.previews[0]!.schedule).toMatchObject({
      recurrence_rule: rrule,
      effective_date: "2026-11-30",
    });
  });

  it("fast-forwards an ancient high-count daily rule without enumerating its history", () => {
    const source = recurringPriceSourceFixture();
    const ancient = {
      ...source,
      accounts: source.accounts.map((account) => ({
        ...account,
        recurrence: {
          ...account.recurrence,
          rrule: "FREQ=DAILY;COUNT=999999",
          start_anchor: "0001-01-01",
          source_sha256: sha(999_001),
        },
        source_revision: sha(999_002),
      })),
    };
    const startedAt = performance.now();
    const result = calculateRecurringServicePriceChange(
      ancient,
      INPUT,
      "req-ancient"
    );

    expect(result.previews[0]!.schedule.effective_date).toBe("2026-11-01");
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("supports a sparse century-old yearly COUNT rule when actual work stays bounded", () => {
    const source = recurringPriceSourceFixture();
    const sparse = {
      ...source,
      accounts: source.accounts.map((account) => ({
        ...account,
        recurrence: {
          ...account.recurrence,
          rrule: "FREQ=YEARLY;COUNT=999999;BYMONTH=1;BYMONTHDAY=15",
          start_anchor: "1900-01-15",
          source_sha256: sha(200_115),
        },
        source_revision: sha(200_116),
      })),
    };
    const januaryInput = { ...INPUT, effective_month: "2027-01" } as const;
    const result = calculateRecurringServicePriceChange(
      {
        ...sparse,
        request: { ...sparse.request, effective_month: "2027-01" },
        accounts: sparse.accounts.map((account) => ({
          ...account,
          policy: {
            ...account.policy!,
            authorized_effective_month: "2027-01",
          },
        })),
      },
      januaryInput,
      "req-sparse-count"
    );

    expect(result.previews[0]!.schedule.effective_date).toBe("2027-01-15");
  });

  it("fails closed before enumerating an exhausted dense COUNT history", () => {
    const source = recurringPriceSourceFixture();
    const hours = Array.from({ length: 24 }, (_, value) => value).join(",");
    const minutes = Array.from({ length: 60 }, (_, value) => value).join(",");
    const dense = {
      ...source,
      accounts: source.accounts.map((account) => ({
        ...account,
        recurrence: {
          ...account.recurrence,
          rrule: `FREQ=DAILY;COUNT=999999;BYHOUR=${hours};BYMINUTE=${minutes}`,
          start_anchor: "2020-01-01",
          source_sha256: sha(999_101),
        },
        source_revision: sha(999_102),
      })),
    };
    const startedAt = performance.now();
    const result = calculateRecurringServicePriceChange(
      dense,
      INPUT,
      "req-dense-count"
    );

    expect(result.exclusions[0]!.reason_codes).toContain(
      "recurrence_unavailable"
    );
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("uses explainable provider evidence for high risk without returning raw content", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: source.accounts.map((account) => ({
          ...account,
          correspondence: {
            ...account.correspondence,
            risk_signals: [
              {
                code: "explicit_cancellation" as const,
                source_ref: `provider_delivery:${PRICE_UUID.provider}`,
                source_sha256: "a".repeat(64),
                occurred_at: "2026-08-20T12:00:00.000000Z",
              },
            ],
          },
        })),
      },
      INPUT,
      "req-1"
    );
    expect(result.previews[0]!.churn_risk).toMatchObject({
      level: "high",
      confidence: "high",
      signal_codes: ["explicit_cancellation"],
      evidence: [
        {
          code: "explicit_cancellation",
          source_ref: `provider_delivery:${PRICE_UUID.provider}`,
          source_sha256: "a".repeat(64),
          occurred_at: "2026-08-20T12:00:00.000000Z",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("normalized_plain_text");
  });

  it("rejects noncanonical spellings of the same percentage", () => {
    const source = recurringPriceSourceFixture();
    expect(() =>
      calculateRecurringServicePriceChange(
        {
          ...source,
          request: { ...source.request, increase_percent: "8.0000" },
        },
        { ...INPUT, increase_percent: "8.0000" },
        "req-decimal"
      )
    ).toThrow();
  });

  it.each([
    [
      "terms_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: null,
      }),
    ],
    [
      "adjustment_not_allowed",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: { ...source.accounts[0]!.policy!, adjustment_allowed: false },
      }),
    ],
    [
      "adjustment_not_allowed",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: {
          ...source.accounts[0]!.policy!,
          authorized_increase_percent: "7.9999",
        },
      }),
    ],
    [
      "adjustment_not_allowed",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: {
          ...source.accounts[0]!.policy!,
          authorized_effective_month: "2026-12",
        },
      }),
    ],
    [
      "terms_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: {
          ...source.accounts[0]!.policy!,
          effective_from: "2026-11-03",
        },
      }),
    ],
    [
      "grandfathered",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: {
          ...source.accounts[0]!.policy!,
          grandfathered_until: "2026-11-30",
        },
      }),
    ],
    [
      "contact_ambiguous",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        contact: { ...source.accounts[0]!.contact!, active_identity_count: 2 },
      }),
    ],
    [
      "correspondence_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        correspondence: {
          ...source.accounts[0]!.correspondence,
          total_count: 5,
          unreadable_count: 1,
        },
      }),
    ],
    [
      "correspondence_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        correspondence: {
          ...source.accounts[0]!.correspondence,
          overflow: true,
        },
      }),
    ],
    [
      "correspondence_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        correspondence: {
          ...source.accounts[0]!.correspondence,
          oversized_text_count: 1,
          readable_count: 3,
          unreadable_count: 1,
        },
      }),
    ],
    [
      "notice_period_not_met",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: { ...source.accounts[0]!.policy!, notice_period_days: 90 },
      }),
    ],
    [
      "pricing_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        pricing: null,
      }),
    ],
    [
      "pricing_source_stale",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        policy: {
          ...source.accounts[0]!.policy!,
          price_source_sha256: "c".repeat(64),
        },
      }),
    ],
    [
      "tax_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        pricing: {
          ...source.accounts[0]!.pricing!,
          tax_rate_id: null,
          tax_rate_name: null,
          tax_rate_percent: null,
          tax_rate_source_sha256: null,
        },
      }),
    ],
    [
      "tax_unavailable",
      (source: ReturnType<typeof recurringPriceSourceFixture>) => ({
        ...source.accounts[0]!,
        pricing: {
          ...source.accounts[0]!.pricing!,
          tax_rate_percent: "1000",
        },
      }),
    ],
  ] as const)("excludes the account for %s", (reason, mutate) => {
    const source = recurringPriceSourceFixture();
    const account = mutate(source);
    const result = calculateRecurringServicePriceChange(
      { ...source, accounts: [account] },
      INPUT,
      "req-1"
    );
    expect(result.status).toBe("blocked");
    expect(result.previews).toEqual([]);
    expect(result.exclusions[0]!.reason_codes).toContain(reason);
  });

  it("honors recurrence skips and uses the next real service date", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: source.accounts.map((account) => ({
          ...account,
          recurrence: {
            ...account.recurrence,
            exceptions: [
              {
                original_date: "2026-11-02",
                action: "skip" as const,
                new_date: null,
              },
            ],
          },
        })),
      },
      INPUT,
      "req-1"
    );
    expect(result.previews[0]!.schedule.effective_date).toBe("2026-11-09");
  });

  it.each(["FREQ=WEEKLY;BYDAY=MO,WE", "FREQ=MONTHLY;BYMONTHDAY=1,15"])(
    "returns the exact multi-occurrence recurrence rule %s",
    (rrule) => {
      const source = recurringPriceSourceFixture();
      const result = calculateRecurringServicePriceChange(
        {
          ...source,
          accounts: source.accounts.map((account) => ({
            ...account,
            recurrence: { ...account.recurrence, rrule },
          })),
        },
        INPUT,
        "req-1"
      );
      expect(result.previews).toHaveLength(1);
      expect(result.previews[0]!.schedule.recurrence_rule).toBe(rrule);
    }
  );

  it("accepts the canonical yearly Easter-Sunday extension", () => {
    const source = recurringPriceSourceFixture();
    const effectiveMonth = "2027-03";
    const input = { ...INPUT, effective_month: effectiveMonth } as const;
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        request: { ...source.request, effective_month: effectiveMonth },
        accounts: source.accounts.map((account) => ({
          ...account,
          recurrence: {
            ...account.recurrence,
            rrule: "FREQ=YEARLY;BYEASTER=0",
            start_anchor: "2026-01-01",
          },
          policy: {
            ...account.policy!,
            authorized_effective_month: effectiveMonth,
          },
        })),
      },
      input,
      "req-easter"
    );

    expect(result.previews[0]!.schedule).toMatchObject({
      recurrence_rule: "FREQ=YEARLY;BYEASTER=0",
      effective_date: "2027-03-28",
    });
  });

  it("fails closed on phantom reschedules and dense or unsupported RRULEs", () => {
    const source = recurringPriceSourceFixture();
    for (const recurrence of [
      {
        ...source.accounts[0]!.recurrence,
        exceptions: [
          {
            original_date: "2026-11-03",
            action: "reschedule" as const,
            new_date: "2026-11-04",
          },
        ],
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=SECONDLY;INTERVAL=1",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=DAILY;INTERVAL=-1",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=WEEKLY;BYDAY=53MO",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=WEEKLY;BYMONTHDAY=2",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=MONTHLY;BYWEEKNO=1",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=MONTHLY;BYYEARDAY=1",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=DAILY;BYYEARDAY=1",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=WEEKLY;BYYEARDAY=1",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=YEARLY;BYWEEKNO=1;BYDAY=1MO",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=MONTHLY;BYEASTER=0",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=YEARLY;BYEASTER=0,1",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=MONTHLY;UNTIL=20261301T256100Z",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule:
          "FREQ=DAILY;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23",
      },
      {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=DAILY",
        start_anchor: "1900-01-01",
        exceptions: [
          {
            original_date: "1900-01-02",
            action: "reschedule" as const,
            new_date: "2026-11-02",
          },
        ],
      },
    ]) {
      const result = calculateRecurringServicePriceChange(
        {
          ...source,
          accounts: [{ ...source.accounts[0]!, recurrence }],
        },
        INPUT,
        "req-1"
      );
      expect(result.status).toBe("blocked");
      expect(result.exclusions[0]!.reason_codes).toContain(
        "recurrence_unavailable"
      );
    }
  });

  it("accepts a bounded cross-anchor reschedule into the requested month", () => {
    const source = recurringPriceSourceFixture();
    const input = { ...INPUT, effective_month: "2026-10" } as const;
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        request: { ...source.request, effective_month: "2026-10" },
        accounts: source.accounts.map((account) => ({
          ...account,
          recurrence: {
            ...account.recurrence,
            rrule: "FREQ=MONTHLY;BYMONTHDAY=30",
            start_anchor: "2026-01-30",
            end_anchor: "2026-09-30",
            exceptions: [
              {
                original_date: "2026-09-30",
                action: "reschedule" as const,
                new_date: "2026-10-01",
              },
            ],
          },
          policy: {
            ...account.policy!,
            authorized_effective_month: "2026-10",
          },
        })),
      },
      input,
      "req-cross-anchor"
    );
    expect(result.status).toBe("ready");
    expect(result.previews[0]!.schedule.effective_date).toBe("2026-10-01");
  });

  it("fails the whole request when recurrence exceptions hit the 101-row sentinel", () => {
    const source = recurringPriceSourceFixture();
    const exceptions = Array.from({ length: 101 }, (_, index) => ({
      original_date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      action: "skip" as const,
      new_date: null,
    }));
    expect(() =>
      calculateRecurringServicePriceChange(
        {
          ...source,
          accounts: [
            {
              ...source.accounts[0]!,
              recurrence: { ...source.accounts[0]!.recurrence, exceptions },
            },
          ],
        },
        INPUT,
        "req-1"
      )
    ).toThrowError(
      expect.objectContaining<Partial<RecurringServicePriceChangePrepareError>>(
        { code: "RESULT_TOO_LARGE" }
      )
    );
  });

  it("rounds deterministically at the currency minor unit", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        context: { ...source.context, currency_code: "JPY" },
        request: { ...source.request, increase_percent: "12.5" },
        accounts: source.accounts.map((account) => ({
          ...account,
          policy: {
            ...account.policy!,
            authorized_increase_percent: "12.5",
          },
          pricing: {
            ...account.pricing!,
            unit_price: "101",
            is_taxable: false,
            tax_rate_id: null,
            tax_rate_name: null,
            tax_rate_percent: null,
            tax_rate_source_sha256: null,
          },
        })),
      },
      { ...INPUT, increase_percent: "12.5" },
      "req-1"
    );
    expect(result.previews[0]!.pricing).toMatchObject({
      currency_minor_exponent: 0,
      current_unit_minor: 101,
      proposed_unit_minor: 114,
    });
    expect(result.previews[0]!.draft.body).toContain("JPY 101 to JPY 114");
  });

  it("prepares a non-taxable price at zero tax when no rate is emitted", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: source.accounts.map((account) => ({
          ...account,
          pricing: {
            ...account.pricing!,
            is_taxable: false,
            tax_rate_id: null,
            tax_rate_name: null,
            tax_rate_percent: null,
            tax_rate_source_sha256: null,
          },
        })),
      },
      INPUT,
      "req-1"
    );
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0]!.pricing.tax).toEqual({
      taxable: false,
      rate_name: null,
      rate_percent: null,
      proposed_unit_tax_minor: 0,
      proposed_unit_total_minor: 10_800,
    });
    expect(result.previews[0]!.draft.body).toContain(
      "per visit, with no tax applied."
    );
  });

  it("fails closed when a per-unit price line has no unit", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: source.accounts.map((account) => ({
          ...account,
          pricing: { ...account.pricing!, unit_label: null },
        })),
      },
      INPUT,
      "req-missing-unit"
    );

    expect(result.previews).toEqual([]);
    expect(result.exclusions[0]!.reason_codes).toContain(
      "pricing_terms_complex"
    );
  });

  it("rejects source money that is not exactly representable in the currency", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        context: { ...source.context, currency_code: "JPY" },
        accounts: source.accounts.map((account) => ({
          ...account,
          pricing: {
            ...account.pricing!,
            unit_price: "100.50",
            is_taxable: false,
            tax_rate_id: null,
            tax_rate_name: null,
            tax_rate_percent: null,
            tax_rate_source_sha256: null,
          },
        })),
      },
      INPUT,
      "req-1"
    );
    expect(result.previews).toEqual([]);
    expect(result.exclusions[0]!.reason_codes).toContain("pricing_unavailable");
  });

  it("rejects increases that round to no customer-visible price change", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        request: { ...source.request, increase_percent: "0.1" },
        accounts: source.accounts.map((account) => ({
          ...account,
          policy: {
            ...account.policy!,
            authorized_increase_percent: "0.1",
          },
          pricing: { ...account.pricing!, unit_price: "1.00" },
        })),
      },
      { ...INPUT, increase_percent: "0.1" },
      "req-1"
    );
    expect(result.previews).toEqual([]);
    expect(result.exclusions[0]!.reason_codes).toContain(
      "increase_below_currency_precision"
    );
  });

  it("keeps one malformed-contact exclusion local to its account", () => {
    const source = recurringPriceSourceFixture();
    const valid = source.accounts[0]!;
    const invalidContactAccount = {
      ...valid,
      client_id: uuid(41_001),
      client_name: "Malformed contact account",
      recurrence: {
        ...valid.recurrence,
        recurrence_id: uuid(41_002),
        project_id: uuid(41_003),
      },
      policy: {
        ...valid.policy!,
        policy_id: uuid(41_004),
        price_source_line_item_id: uuid(41_005),
        notice_contact_id: uuid(41_001),
        policy_source_ref: "agreement:malformed-contact:v1",
      },
      pricing: {
        ...valid.pricing!,
        line_item_id: uuid(41_005),
        document_id: uuid(41_006),
      },
      contact: null,
      correspondence: {
        ...valid.correspondence,
        total_count: 0,
        readable_count: 0,
        unreadable_count: 0,
        inbound_count: 0,
        outbound_count: 0,
        latest_outbound_source_ref: null,
        latest_outbound_source_sha256: null,
        risk_signals: [],
      },
      late_payment_evidence: [],
      source_revision: sha(41_007),
    };
    const result = calculateRecurringServicePriceChange(
      { ...source, accounts: [valid, invalidContactAccount] },
      INPUT,
      "req-1"
    );

    expect(result.previews).toHaveLength(1);
    expect(result.previews[0]!.client_id).toBe(valid.client_id);
    expect(result.exclusions).toHaveLength(1);
    expect(result.exclusions[0]).toMatchObject({
      client_id: invalidContactAccount.client_id,
      reason_codes: expect.arrayContaining(["contact_unavailable"]),
    });
  });

  it("keeps one null-tax-source exclusion local to its account", () => {
    const source = recurringPriceSourceFixture();
    const valid = source.accounts[0]!;
    const invalidPriceAccount = {
      ...valid,
      client_id: uuid(42_001),
      client_name: "Null tax source account",
      recurrence: {
        ...valid.recurrence,
        recurrence_id: uuid(42_002),
        project_id: uuid(42_003),
      },
      policy: {
        ...valid.policy!,
        policy_id: uuid(42_004),
        price_source_line_item_id: uuid(42_005),
        notice_contact_id: uuid(42_006),
        policy_source_ref: "agreement:null-tax:v1",
      },
      pricing: null,
      contact: {
        ...valid.contact!,
        contact_id: uuid(42_006),
        normalized_email: "null-tax@example.com",
      },
      correspondence: {
        ...valid.correspondence,
        latest_outbound_source_ref:
          "provider_delivery:20000000-0000-4000-8000-000000042007",
      },
      source_revision: sha(42_008),
    };
    const result = calculateRecurringServicePriceChange(
      { ...source, accounts: [valid, invalidPriceAccount] },
      INPUT,
      "req-1"
    );

    expect(result.previews).toHaveLength(1);
    expect(result.previews[0]!.client_id).toBe(valid.client_id);
    expect(result.exclusions[0]).toMatchObject({
      client_id: invalidPriceAccount.client_id,
      reason_codes: expect.arrayContaining(["pricing_unavailable"]),
    });
  });

  it("never infers low risk from the absence of narrow negative signals", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: source.accounts.map((account) => ({
          ...account,
          correspondence: {
            ...account.correspondence,
            total_count: 1,
            readable_count: 1,
            inbound_count: 0,
            outbound_count: 1,
          },
        })),
      },
      INPUT,
      "req-1"
    );
    expect(result.previews[0]!.churn_risk).toMatchObject({
      level: "unknown",
      confidence: "unknown",
      correspondence_evidence_complete_within_window: true,
      signal_codes: ["insufficient_history"],
      evidence: [],
    });
  });

  it("rejects a definitive churn label without matching complete evidence", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(source, INPUT, "req-1");
    const forged = structuredClone(result);
    forged.previews[0]!.churn_risk = {
      ...forged.previews[0]!.churn_risk,
      level: "high",
      confidence: "high",
      correspondence_evidence_complete_within_window: false,
      signal_codes: ["insufficient_history"],
      evidence: [],
      explanation: "Forged definitive risk.",
    };
    expect(() => RecurringServicePriceChangeResultSchema.parse(forged)).toThrow(
      "churn risk evidence drift"
    );
  });

  it.each([
    ["quantity", { quantity: "2" }],
    ["discount", { discount_percent: "5" }],
    ["minimum charge", { minimum_charge: "125" }],
  ])(
    "excludes complex %s pricing instead of overstating an account increase",
    (_label, patch) => {
      const source = recurringPriceSourceFixture();
      const result = calculateRecurringServicePriceChange(
        {
          ...source,
          accounts: [
            {
              ...source.accounts[0]!,
              pricing: { ...source.accounts[0]!.pricing!, ...patch },
            },
          ],
        },
        INPUT,
        "req-1"
      );
      expect(result.exclusions[0]!.reason_codes).toContain(
        "pricing_terms_complex"
      );
    }
  );

  it("accepts an exact zero minimum charge with surplus trailing scale", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: [
          {
            ...source.accounts[0]!,
            pricing: {
              ...source.accounts[0]!.pricing!,
              minimum_charge: "0.00000",
            },
          },
        ],
      },
      INPUT,
      "req-1"
    );
    expect(result.exclusions).toHaveLength(0);
    expect(result.previews).toHaveLength(1);
  });

  it("prepares exactly 100 eligible taxable accounts and rejects the 101 sentinel", () => {
    const source = recurringPriceSourceFixture();
    const accounts = Array.from({ length: 100 }, (_, index) => {
      const sequence = index + 1;
      const base = source.accounts[0]!;
      return {
        ...base,
        client_id: uuid(10_000 + sequence),
        client_name: `Eligible account ${sequence}`,
        recurrence: {
          ...base.recurrence,
          recurrence_id: uuid(20_000 + sequence),
          project_id: uuid(30_000 + sequence),
          source_sha256: sha(20_000 + sequence),
        },
        policy: {
          ...base.policy!,
          policy_id: uuid(40_000 + sequence),
          price_source_line_item_id: uuid(50_000 + sequence),
          price_source_sha256: sha(50_000 + sequence),
          notice_contact_id: uuid(60_000 + sequence),
          policy_source_ref: `agreement:eligible-${sequence}`,
          policy_source_sha256: sha(40_000 + sequence),
        },
        pricing: {
          ...base.pricing!,
          line_item_id: uuid(50_000 + sequence),
          document_id: uuid(70_000 + sequence),
          tax_rate_id: uuid(80_000 + sequence),
          tax_rate_source_sha256: sha(80_000 + sequence),
          source_sha256: sha(50_000 + sequence),
        },
        contact: {
          ...base.contact!,
          contact_id: uuid(60_000 + sequence),
          normalized_email: `eligible-${sequence}@example.com`,
          source_sha256: sha(60_000 + sequence),
        },
        correspondence: {
          ...base.correspondence,
          total_count: 25,
          readable_count: 25,
          inbound_count: 24,
          outbound_count: 1,
          latest_outbound_source_ref: `provider_delivery:eligible-${sequence}`,
          latest_outbound_source_sha256: sha(90_000 + sequence),
          risk_signals: (
            [
              "explicit_cancellation",
              "price_objection",
              "service_complaint",
              "overcharge_complaint",
            ] as const
          ).map((code, evidenceIndex) => ({
            code,
            source_ref: `provider_delivery:risk-${sequence}-${evidenceIndex}`,
            source_sha256: sha(110_000 + sequence * 4 + evidenceIndex),
            occurred_at: "2026-08-20T12:00:00.000000Z",
          })),
        },
        late_payment_evidence: Array.from(
          { length: 20 },
          (_, evidenceIndex) => ({
            source_ref: `invoice:late-${sequence}-${evidenceIndex}`,
            source_sha256: sha(120_000 + sequence * 20 + evidenceIndex),
            due_date: "2026-07-01",
            paid_at: "2026-07-10T12:00:00.000000Z",
            days_late: 9,
          })
        ),
        source_revision: sha(100_000 + sequence),
      };
    });
    const maximumSource = { ...source, accounts, account_count: 100 };
    expect(JSON.stringify(maximumSource).length).toBeLessThanOrEqual(
      RECURRING_SERVICE_PRICE_CHANGE_MAX_SOURCE_SNAPSHOT_CHARACTERS
    );
    const result = calculateRecurringServicePriceChange(
      maximumSource,
      INPUT,
      "req-100"
    );
    expect(result.status).toBe("ready");
    expect(result.selection).toMatchObject({
      total_accounts: 100,
      included_count: 100,
      excluded_count: 0,
    });
    expect(result.supporting_records).toHaveLength(
      RECURRING_SERVICE_PRICE_CHANGE_MAX_EVIDENCE_REFS
    );
    expect(serializeUntrustedPromptData(result).length).toBeLessThanOrEqual(
      RECURRING_SERVICE_PRICE_CHANGE_MAX_OUTPUT_CHARACTERS
    );
    expect(() =>
      calculateRecurringServicePriceChange(
        {
          ...source,
          accounts: [...accounts, accounts[0]!],
          account_count: 101,
          overflow: true,
        },
        INPUT,
        "req-101"
      )
    ).toThrowError(
      expect.objectContaining<Partial<RecurringServicePriceChangePrepareError>>(
        { code: "RESULT_TOO_LARGE" }
      )
    );
  });

  it("excludes one account identity when the source finds multiple recurrences", () => {
    const source = recurringPriceSourceFixture();
    const result = calculateRecurringServicePriceChange(
      {
        ...source,
        accounts: [
          {
            ...source.accounts[0]!,
            recurrence_match_count: 2,
            additional_recurrence_sources: [
              { recurrence_id: uuid(9_001), source_sha256: sha(9_001) },
            ],
          },
        ],
        account_count: 1,
      },
      INPUT,
      "req-1"
    );
    expect(result.status).toBe("blocked");
    expect(result.previews).toEqual([]);
    expect(result.exclusions).toHaveLength(1);
    expect(result.exclusions[0]!.reason_codes).toContain(
      "duplicate_account_service"
    );
    expect(result.exclusions[0]!.supporting_record_refs).toContain(
      `recurrence:${uuid(9_001)}`
    );
  });

  it("filters finite COUNT and UNTIL histories only after proving they ended", () => {
    const catalog = recurringPriceCatalogFixture();
    const expired = Array.from({ length: 404 }, (_, index) => ({
      client_id: uuid(10_000 + index),
      recurrence: {
        recurrence_id: uuid(20_000 + index),
        project_id: uuid(30_000 + index),
        rrule:
          index < 101
            ? "FREQ=DAILY;COUNT=1"
            : index < 202
              ? "FREQ=MONTHLY;COUNT=2"
              : index < 303
                ? "FREQ=MONTHLY;COUNT=2;BYMONTHDAY=15"
                : "FREQ=DAILY;UNTIL=20200102T000000Z",
        start_anchor: "2020-01-01",
        end_anchor: null,
        exceptions: [],
        source_sha256: sha(20_000 + index),
      },
    }));
    expect(
      selectRecurringServicePriceChangeRecurrenceIds(
        {
          ...catalog,
          recurrences: [...expired, ...catalog.recurrences],
          recurrence_count: expired.length + catalog.recurrences.length,
        },
        "req-expired"
      )
    ).toEqual([PRICE_UUID.recurrence]);
  });

  it("keeps active sparse, invalid, and target-month rescheduled rules conservative", () => {
    const catalog = recurringPriceCatalogFixture();
    const entries = [
      {
        ...catalog.recurrences[0]!,
        recurrence: {
          ...catalog.recurrences[0]!.recurrence,
          recurrence_id: uuid(41_001),
          rrule: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=1",
          start_anchor: "2026-02-01",
        },
      },
      {
        ...catalog.recurrences[0]!,
        client_id: uuid(41_002),
        recurrence: {
          ...catalog.recurrences[0]!.recurrence,
          recurrence_id: uuid(41_002),
          rrule: "FREQ=SECONDLY",
        },
      },
      {
        ...catalog.recurrences[0]!,
        client_id: uuid(41_003),
        recurrence: {
          ...catalog.recurrences[0]!.recurrence,
          recurrence_id: uuid(41_003),
          rrule: "FREQ=DAILY;COUNT=1",
          start_anchor: "2020-01-01",
          exceptions: [
            {
              original_date: "2020-01-01",
              action: "reschedule" as const,
              new_date: "2026-11-15",
            },
          ],
        },
      },
      {
        ...catalog.recurrences[0]!,
        client_id: uuid(41_004),
        recurrence: {
          ...catalog.recurrences[0]!.recurrence,
          recurrence_id: uuid(41_004),
          rrule: "FREQ=DAILY;COUNT=1",
          start_anchor: "2020-01-01",
          exceptions: [
            {
              original_date: "2026-11-01",
              action: "skip" as const,
              new_date: null,
            },
          ],
        },
      },
      {
        ...catalog.recurrences[0]!,
        client_id: uuid(41_005),
        recurrence: {
          ...catalog.recurrences[0]!.recurrence,
          recurrence_id: uuid(41_005),
          rrule: "FREQ=DAILY;UNTIL=20200102T000000Z",
          start_anchor: "2020-01-01",
          exceptions: [
            {
              original_date: "2026-11-01",
              action: "reschedule" as const,
              new_date: "2026-12-01",
            },
          ],
        },
      },
    ];
    expect(
      selectRecurringServicePriceChangeRecurrenceIds(
        {
          ...catalog,
          recurrences: entries,
          recurrence_count: entries.length,
        },
        "req-conservative"
      )
    ).toEqual(entries.map((entry) => entry.recurrence.recurrence_id).sort());
  });

  it("keeps complex COUNT catalogs O(input) before the identity sentinel", () => {
    const catalog = recurringPriceCatalogFixture();
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      client_id: PRICE_UUID.client,
      recurrence: {
        ...catalog.recurrences[0]!.recurrence,
        recurrence_id: uuid(50_000 + index),
        rrule:
          "FREQ=DAILY;COUNT=999999;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23;BYMINUTE=0,1,2,3,4,5,6,7,8,9",
        source_sha256: sha(50_000 + index),
      },
    }));
    expect(() =>
      selectRecurringServicePriceChangeRecurrenceIds(
        {
          ...catalog,
          recurrences: entries,
          recurrence_count: entries.length,
        },
        "req-aggregate-work"
      )
    ).toThrowError(
      expect.objectContaining<Partial<RecurringServicePriceChangePrepareError>>(
        { code: "RESULT_TOO_LARGE" }
      )
    );
  });

  it("fails closed when RRULE UNTIL conflicts with the generator end anchor", () => {
    const source = recurringPriceSourceFixture();
    const conflicting = {
      ...source.accounts[0]!,
      recurrence: {
        ...source.accounts[0]!.recurrence,
        rrule: "FREQ=DAILY;UNTIL=20200102T000000Z",
        start_anchor: "2020-01-01",
        end_anchor: "2027-01-01",
      },
    };
    const catalog = recurringPriceCatalogFixture();
    expect(
      selectRecurringServicePriceChangeRecurrenceIds(
        {
          ...catalog,
          recurrences: [
            {
              client_id: conflicting.client_id,
              recurrence: conflicting.recurrence,
            },
          ],
          recurrence_count: 1,
        },
        "req-dual-termination"
      )
    ).toEqual([conflicting.recurrence.recurrence_id]);
    const result = calculateRecurringServicePriceChange(
      { ...source, accounts: [conflicting], account_count: 1 },
      INPUT,
      "req-dual-termination"
    );
    expect(result.exclusions[0]!.reason_codes).toContain(
      "recurrence_unavailable"
    );
  });

  it("does not treat a filtered COUNT=1 DTSTART as the sole occurrence", () => {
    const catalog = recurringPriceCatalogFixture();
    const entry = {
      ...catalog.recurrences[0]!,
      recurrence: {
        ...catalog.recurrences[0]!.recurrence,
        rrule: "FREQ=YEARLY;COUNT=1;BYMONTH=12;BYMONTHDAY=15",
        start_anchor: "2026-09-01",
      },
    };
    expect(
      selectRecurringServicePriceChangeRecurrenceIds(
        {
          ...catalog,
          request: { ...catalog.request, effective_month: "2026-12" },
          recurrences: [entry],
          recurrence_count: 1,
        },
        "req-filtered-count-one"
      )
    ).toEqual([entry.recurrence.recurrence_id]);
  });

  it("fails the package when one source ref points to two different hashes", () => {
    const source = recurringPriceSourceFixture();
    const base = source.accounts[0]!;
    const second = {
      ...base,
      client_id: uuid(910),
      recurrence: {
        ...base.recurrence,
        recurrence_id: uuid(911),
        project_id: uuid(912),
        source_sha256: sha(911),
      },
      policy: {
        ...base.policy!,
        policy_id: uuid(913),
        policy_source_sha256: sha(913),
        price_source_line_item_id: uuid(914),
        price_source_sha256: sha(914),
        notice_contact_id: uuid(915),
      },
      pricing: {
        ...base.pricing!,
        line_item_id: uuid(914),
        document_id: uuid(916),
        tax_rate_id: uuid(917),
        tax_rate_source_sha256: sha(917),
        source_sha256: sha(914),
      },
      contact: {
        ...base.contact!,
        contact_id: uuid(915),
        normalized_email: "collision@example.com",
        source_sha256: sha(915),
      },
      correspondence: {
        ...base.correspondence,
        latest_outbound_source_ref: "provider_delivery:collision",
        latest_outbound_source_sha256: sha(918),
      },
      source_revision: sha(919),
    };
    expect(() =>
      calculateRecurringServicePriceChange(
        { ...source, accounts: [base, second], account_count: 2 },
        INPUT,
        "req-collision"
      )
    ).toThrowError(
      expect.objectContaining<Partial<RecurringServicePriceChangePrepareError>>(
        { code: "STALE_CONTEXT" }
      )
    );
  });

  it("fails when one source ref and hash claim two evidence kinds", () => {
    const source = recurringPriceSourceFixture();
    const account = source.accounts[0]!;
    const recurrenceRef = `recurrence:${account.recurrence.recurrence_id}`;
    const colliding = {
      ...account,
      policy: {
        ...account.policy!,
        policy_source_ref: recurrenceRef,
        policy_source_sha256: account.recurrence.source_sha256,
      },
    };

    expect(() =>
      calculateRecurringServicePriceChange(
        { ...source, accounts: [colliding] },
        INPUT,
        "req-kind-collision"
      )
    ).toThrowError(
      expect.objectContaining<Partial<RecurringServicePriceChangePrepareError>>(
        { code: "STALE_CONTEXT" }
      )
    );
  });

  it("orders Unicode source references by UTF-8 bytes for stable plan identity", () => {
    const source = recurringPriceSourceFixture();
    const account = (sequence: number, policySourceRef: string) => {
      const base = source.accounts[0]!;
      return {
        ...base,
        client_id: uuid(100 + sequence),
        recurrence: {
          ...base.recurrence,
          recurrence_id: uuid(200 + sequence),
          project_id: uuid(300 + sequence),
        },
        policy: {
          ...base.policy!,
          policy_id: uuid(400 + sequence),
          price_source_line_item_id: uuid(500 + sequence),
          price_source_sha256: sha(500 + sequence),
          notice_contact_id: uuid(600 + sequence),
          policy_source_ref: policySourceRef,
          policy_source_sha256: sha(600 + sequence),
        },
        pricing: {
          ...base.pricing!,
          line_item_id: uuid(500 + sequence),
          document_id: uuid(700 + sequence),
          tax_rate_id: uuid(800 + sequence),
          tax_rate_source_sha256: sha(800 + sequence),
          source_sha256: sha(500 + sequence),
        },
        contact: {
          ...base.contact!,
          contact_id: uuid(600 + sequence),
          normalized_email: `client-${sequence}@example.com`,
          source_sha256: sha(600 + sequence),
        },
        correspondence: {
          ...base.correspondence,
          latest_outbound_source_ref: `provider_delivery:outbound-${sequence}`,
          latest_outbound_source_sha256: sha(900 + sequence),
        },
        source_revision: sha(3_000 + sequence),
      };
    };
    const accounts = [account(1, "agreement:ä"), account(2, "agreement:z")];
    const first = calculateRecurringServicePriceChange(
      { ...source, accounts, account_count: 2 },
      INPUT,
      "req-unicode"
    );
    const second = calculateRecurringServicePriceChange(
      { ...source, accounts: [...accounts].reverse(), account_count: 2 },
      INPUT,
      "req-unicode"
    );
    expect(first.plan_hash).toBe(second.plan_hash);
    expect(
      first.supporting_records
        .map((record) => record.source_ref)
        .filter((reference) => reference.startsWith("agreement:"))
    ).toEqual(["agreement:z", "agreement:ä"]);
  });

  it("fails the whole request on an oversized source instead of truncating", () => {
    const source = recurringPriceSourceFixture();
    expect(() =>
      calculateRecurringServicePriceChange(
        { ...source, overflow: true },
        INPUT,
        "req-1"
      )
    ).toThrowError(
      expect.objectContaining<Partial<RecurringServicePriceChangePrepareError>>(
        {
          code: "RESULT_TOO_LARGE",
        }
      )
    );
  });
});
