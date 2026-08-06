import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectionsQuery } = vi.hoisted(() => ({
  connectionsQuery: vi.fn(),
}));

vi.mock("@/lib/hooks/use-email-signature", () => ({
  useEmailSignatureConnections: (...args: unknown[]) =>
    connectionsQuery(...args),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/components/settings/email-signature-settings", () => ({
  EmailSignatureSettings: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="identity-card">{connectionId}</div>
  ),
}));

import { SenderIdentityConnectStep } from "@/components/settings/sender-identity-connect-step";

const props = { companyId: "company-1", userId: "user-1" };

function connections(...rows: Array<Record<string, unknown>>) {
  return { data: rows };
}

beforeEach(() => {
  connectionsQuery.mockReset();
});

describe("SenderIdentityConnectStep", () => {
  it("asks for the identity on the mailbox that is holding outreach", () => {
    connectionsQuery.mockReturnValue(
      connections(
        {
          id: "connection-confirmed",
          mailbox: "office@canprodeckandrail.com",
          provider: "gmail",
          type: "company",
          identityConfirmed: true,
        },
        {
          id: "connection-unconfirmed",
          mailbox: "jack@canprodeckandrail.com",
          provider: "gmail",
          type: "individual",
          identityConfirmed: false,
        }
      )
    );

    render(<SenderIdentityConnectStep {...props} active />);

    expect(
      screen.getByTestId("sender-identity-connect-step")
    ).toBeInTheDocument();
    expect(screen.getByTestId("identity-card")).toHaveTextContent(
      "connection-unconfirmed"
    );
  });

  it("stays out of the way when every mailbox is already confirmed", () => {
    connectionsQuery.mockReturnValue(
      connections({
        id: "connection-confirmed",
        mailbox: "jack@canprodeckandrail.com",
        provider: "gmail",
        type: "individual",
        identityConfirmed: true,
      })
    );

    render(<SenderIdentityConnectStep {...props} active />);

    expect(
      screen.queryByTestId("sender-identity-connect-step")
    ).not.toBeInTheDocument();
  });

  it("never interrupts a visit that did not follow a connect", () => {
    connectionsQuery.mockReturnValue(
      connections({
        id: "connection-unconfirmed",
        mailbox: "jack@canprodeckandrail.com",
        provider: "gmail",
        type: "individual",
        identityConfirmed: false,
      })
    );

    render(<SenderIdentityConnectStep {...props} active={false} />);

    expect(
      screen.queryByTestId("sender-identity-connect-step")
    ).not.toBeInTheDocument();
  });
});
