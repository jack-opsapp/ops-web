import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationService } from "@/lib/api/services/notification-service";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

function makeNotificationQueryDouble(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ method: string; column?: string; options?: unknown }> = [];

  class Query {
    private filters = new Map<string, unknown>();
    private orders: Array<{ column: string; ascending: boolean }> = [];
    private limitCount: number | null = null;

    select() {
      calls.push({ method: "select" });
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    order(column: string, options?: { ascending?: boolean }) {
      calls.push({ method: "order", column, options });
      this.orders.push({ column, ascending: options?.ascending !== false });
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    private result() {
      let data = rows.filter((row) =>
        [...this.filters.entries()].every(([column, value]) => row[column] === value)
      );
      for (const order of [...this.orders].reverse()) {
        data = [...data].sort((a, b) => {
          const left = a[order.column];
          const right = b[order.column];
          if (left === right) return 0;
          const direction = order.ascending ? 1 : -1;
          return String(left) > String(right) ? direction : -direction;
        });
      }
      return {
        data: this.limitCount === null ? data : data.slice(0, this.limitCount),
        error: null,
      };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  return {
    calls,
    from: vi.fn(() => new Query()),
  };
}

describe("NotificationService", () => {
  beforeEach(() => {
    requireSupabaseMock.mockReset();
  });

  it("fetches unread notifications with persistent unresolved lifecycle notifications first, then newest first", async () => {
    const rows = [
      {
        id: "old-standard",
        user_id: "user-1",
        company_id: "company-1",
        type: "mention",
        title: "Old standard",
        body: "",
        project_id: null,
        note_id: null,
        is_read: false,
        persistent: false,
        action_url: null,
        action_label: null,
        created_at: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "new-standard",
        user_id: "user-1",
        company_id: "company-1",
        type: "mention",
        title: "New standard",
        body: "",
        project_id: null,
        note_id: null,
        is_read: false,
        persistent: false,
        action_url: null,
        action_label: null,
        created_at: "2026-05-29T19:00:00.000Z",
      },
      {
        id: "lifecycle-persistent",
        user_id: "user-1",
        company_id: "company-1",
        type: "leads_waiting",
        title: "Lead waiting",
        body: "",
        project_id: null,
        note_id: null,
        is_read: false,
        persistent: true,
        action_url: "/pipeline",
        action_label: "Open opportunity",
        created_at: "2026-05-29T18:00:00.000Z",
      },
    ];
    const supabase = makeNotificationQueryDouble(rows);
    requireSupabaseMock.mockReturnValue(supabase);

    const result = await NotificationService.fetchUnread("user-1", "company-1");

    expect(result.map((row) => row.id)).toEqual([
      "lifecycle-persistent",
      "new-standard",
      "old-standard",
    ]);
    expect(supabase.calls.filter((call) => call.method === "order")).toEqual([
      { method: "order", column: "persistent", options: { ascending: false } },
      { method: "order", column: "created_at", options: { ascending: false } },
    ]);
  });
});
