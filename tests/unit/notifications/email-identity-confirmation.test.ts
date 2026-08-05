// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  EMAIL_IDENTITY_CONFIRMATION_TYPE,
  emailIdentityConfirmationDedupeKey,
  resolveEmailIdentityConfirmationNotification,
} from "@/lib/notifications/email-identity-confirmation";

function supabaseStub(error: { message: string } | null = null) {
  const filters: Array<[string, unknown, unknown]> = [];
  const update = vi.fn();
  const builder = {
    eq(column: string, value: unknown) {
      filters.push(["eq", column, value]);
      return builder;
    },
    is(column: string, value: unknown) {
      filters.push(["is", column, value]);
      return Promise.resolve({ error }) as unknown as typeof builder;
    },
  };
  const client = {
    from: vi.fn(() => ({
      update: (payload: Record<string, unknown>) => {
        update(payload);
        return builder;
      },
    })),
  };
  return { client, update, filters };
}

const scope = {
  companyId: "company-1",
  connectionId: "connection-1",
  userId: "user-1",
};

describe("email identity confirmation notification", () => {
  it("closes only this operator's outstanding prompt for this mailbox", async () => {
    const { client, update, filters } = supabaseStub();

    await resolveEmailIdentityConfirmationNotification({
      supabase: client as never,
      ...scope,
    });

    expect(client.from).toHaveBeenCalledWith("notifications");
    expect(update).toHaveBeenCalledWith({
      is_read: true,
      resolved_at: expect.any(String),
    });
    expect(filters).toEqual([
      ["eq", "company_id", "company-1"],
      ["eq", "user_id", "user-1"],
      ["eq", "type", "email_identity_confirmation_required"],
      [
        "eq",
        "dedupe_key",
        "email-identity-confirmation:connection-1:user-1",
      ],
      ["is", "resolved_at", null],
    ]);
  });

  it("surfaces a failed resolution rather than reporting a clean save", async () => {
    const { client } = supabaseStub({ message: "permission denied" });

    await expect(
      resolveEmailIdentityConfirmationNotification({
        supabase: client as never,
        ...scope,
      })
    ).rejects.toThrow(/permission denied/);
  });

  it("matches the identity the draft worker raises the notification with", () => {
    // The runtime pulls the whole draft engine, so the settings route cannot
    // import its constant. Read the source instead of letting the two drift.
    const runtimeSource = readFileSync(
      join(
        process.cwd(),
        "src/lib/api/services/email-assignment-contact-form-draft-runtime.ts"
      ),
      "utf8"
    );

    expect(runtimeSource).toContain(
      `IDENTITY_CONFIRMATION_NOTIFICATION_TYPE =\n  "${EMAIL_IDENTITY_CONFIRMATION_TYPE}"`
    );
    expect(runtimeSource).toContain(
      "dedupeKey: `email-identity-confirmation:${input.connectionId}:${input.userId}`"
    );
    expect(
      emailIdentityConfirmationDedupeKey({
        connectionId: "connection-1",
        userId: "user-1",
      })
    ).toBe("email-identity-confirmation:connection-1:user-1");
  });

  it("deep-links the operator to the identity card on the live profile section", () => {
    const runtimeSource = readFileSync(
      join(
        process.cwd(),
        "src/lib/api/services/email-assignment-contact-form-draft-runtime.ts"
      ),
      "utf8"
    );
    const domainsSource = readFileSync(
      join(process.cwd(), "src/components/settings/settings-domains.tsx"),
      "utf8"
    );
    const profileSource = readFileSync(
      join(process.cwd(), "src/components/settings/profile-tab.tsx"),
      "utf8"
    );

    expect(runtimeSource).toContain(
      "actionUrl: `/settings?section=profile&connection=${input.connectionId}`"
    );
    // `section=profile` has to be a section the shell will actually resolve.
    expect(domainsSource).toContain('id: "profile"');
    // …and the tab has to do something with the connection it was handed.
    expect(profileSource).toContain('searchParams.get("connection")');
    expect(profileSource).toContain(
      "highlighted={conn.id === targetConnectionId}"
    );
  });
});
