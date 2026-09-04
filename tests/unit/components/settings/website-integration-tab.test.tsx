import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authedFetchMock, toastErrorMock, toastSuccessMock } = vi.hoisted(
  () => ({
    authedFetchMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
  })
);

vi.mock("@/lib/utils/authed-fetch", () => ({
  authedFetch: authedFetchMock,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { WebsiteIntegrationTab } from "@/components/settings/website-integration-tab";

const SOURCE_ID = "a45b37e7-c226-40f8-9c53-479838d3d170";
const CREDENTIAL_ID = "a8531078-5dd0-4ac6-bf28-ab9115ce7a42";
const RAW_SECRET =
  "opsx_7_testprefix_RawCredentialMaterialThatMustOnlyAppearOnce";
const NOW = "2026-07-26T20:00:00.000Z";
const FUTURE = "2027-07-26T20:00:00.000Z";

const source = {
  sourceId: SOURCE_ID,
  integrationType: "website",
  siteLabel: "Main website",
  canonicalHost: "example.com",
  defaultPhoneRegion: "CA",
  allowedBrowserOrigins: ["https://example.com"],
  defaultCoarseSource: "website",
  defaultIntakeOwnerId: null,
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
  forms: [
    {
      formId: "0854859f-eab9-4e7c-874a-c9d176852b92",
      key: "default",
      label: "Default",
      isDefault: true,
      active: true,
    },
  ],
};

const intakeCredential = {
  credentialId: CREDENTIAL_ID,
  name: "Website intake",
  class: "intake",
  scopes: ["intake.write"],
  sourceIds: [SOURCE_ID],
  prefix: "opsx_7_testprefix",
  status: "active",
  createdByUserId: "9f8c11d6-3a0b-4edf-aac8-24deff7d5a44",
  createdAt: NOW,
  updatedAt: NOW,
  lastUsedAt: null,
  expiresAt: FUTURE,
  overlapUntil: null,
  rejectionCount: 0,
  recentRejectionCount: 0,
};

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

function settings(
  overrides: {
    sources?: (typeof source)[];
    credentials?: (typeof intakeCredential)[];
  } = {}
) {
  return {
    featureEnabled: true,
    sources: overrides.sources ?? [],
    credentials: overrides.credentials ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("WebsiteIntegrationTab", () => {
  it("uses the OPS display voice for section and form labels", async () => {
    const user = userEvent.setup();
    authedFetchMock.mockReturnValue(response(settings()));

    render(<WebsiteIntegrationTab />);

    const emptyHeading = await screen.findByRole("heading", {
      name: "WEBSITE INTAKE",
    });
    expect(emptyHeading).toHaveClass(
      "font-cakemono",
      "font-light",
      "uppercase"
    );

    await user.click(screen.getByRole("button", { name: "CONNECT WEBSITE" }));
    expect(
      screen.getByRole("heading", { name: "CONNECT WEBSITE" })
    ).toHaveClass("font-cakemono", "font-light", "uppercase");
    expect(screen.getByText("SITE LABEL", { selector: "label" })).toHaveClass(
      "font-cakemono",
      "font-light",
      "uppercase"
    );
    expect(screen.getByText("PHONE REGION", { selector: "label" })).toHaveClass(
      "font-cakemono",
      "font-light",
      "uppercase"
    );
  });

  it("renders one clear first-use action", async () => {
    authedFetchMock.mockReturnValue(response(settings()));

    render(<WebsiteIntegrationTab />);

    expect(
      await screen.findByRole("button", { name: "CONNECT WEBSITE" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "CREATE INTAKE KEY" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "CREATE ANALYTICS KEY" })
    ).not.toBeInTheDocument();
  });

  it("explains the two setup steps before the first action", async () => {
    authedFetchMock.mockReturnValue(response(settings()));

    render(<WebsiteIntegrationTab />);

    const steps = await screen.findByRole("list", { name: "SETUP STEPS" });
    const titles = within(steps)
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("heading", { level: 3 }).textContent);
    expect(titles).toEqual(["REGISTER YOUR WEBSITE", "CREATE AN INTAKE KEY"]);
    expect(
      within(steps).getByText(
        "Issue a key for that source and hand it to whoever runs your website. It shows once."
      )
    ).toBeInTheDocument();

    const connect = screen.getByRole("button", { name: "CONNECT WEBSITE" });
    expect(
      steps.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    for (const heading of within(steps).getAllByRole("heading", { level: 3 })) {
      expect(heading).toHaveClass("font-cakemono", "uppercase");
    }
  });

  it("shows configured source health before credentials", async () => {
    authedFetchMock.mockReturnValue(
      response(settings({ sources: [source], credentials: [intakeCredential] }))
    );

    render(<WebsiteIntegrationTab />);

    const sourceHeading = await screen.findByRole("heading", {
      name: "WEBSITE SOURCE",
    });
    const credentialHeading = screen.getByRole("heading", {
      name: "ACCESS KEYS",
    });

    expect(
      sourceHeading.compareDocumentPosition(credentialHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText("Main website")).toBeInTheDocument();
    expect(screen.getByText("LAST ACCEPTED")).toBeInTheDocument();
    expect(screen.getByText("PENDING FILES")).toBeInTheDocument();
    expect(screen.getByText("REJECTED FILES")).toBeInTheDocument();
  });

  it("keeps intake and analytics creation as separate flows", async () => {
    const user = userEvent.setup();
    authedFetchMock.mockReturnValue(response(settings({ sources: [source] })));

    render(<WebsiteIntegrationTab />);

    await user.click(
      await screen.findByRole("button", { name: "CREATE INTAKE KEY" })
    );
    expect(
      screen.getByRole("heading", { name: "CREATE INTAKE KEY" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This key can read pseudonymous lead data for the entire company."
      )
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(
      screen.getByRole("button", { name: "CREATE ANALYTICS KEY" })
    );
    expect(
      screen.getByRole("heading", { name: "CREATE ANALYTICS KEY" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This key can read pseudonymous lead data for the entire company."
      )
    ).toBeInTheDocument();
  });

  it("warns again before monetary data is added", async () => {
    const user = userEvent.setup();
    authedFetchMock.mockReturnValue(response(settings({ sources: [source] })));

    render(<WebsiteIntegrationTab />);
    await user.click(
      await screen.findByRole("button", { name: "CREATE ANALYTICS KEY" })
    );
    await user.click(
      screen.getByRole("checkbox", { name: "INCLUDE MONETARY DATA" })
    );

    expect(
      screen.getByText(
        "Revenue, estimate, invoice, and payment metrics will be available to this key."
      )
    ).toBeInTheDocument();
  });

  it("reveals a new secret once without persisting it", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    authedFetchMock
      .mockReturnValueOnce(response(settings({ sources: [source] })))
      .mockReturnValueOnce(
        response(
          {
            credential: intakeCredential,
            secret: RAW_SECRET,
          },
          201
        )
      );

    render(<WebsiteIntegrationTab />);
    const createIntake = await screen.findByRole("button", {
      name: "CREATE INTAKE KEY",
    });
    await user.click(createIntake);
    await user.click(screen.getByRole("button", { name: "ISSUE INTAKE KEY" }));

    const reveal = await screen.findByRole("dialog");
    expect(within(reveal).getByDisplayValue(RAW_SECRET)).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    await user.click(within(reveal).getByRole("button", { name: "COPY KEY" }));
    expect(writeText).toHaveBeenCalledWith(RAW_SECRET);
    await user.click(within(reveal).getByRole("button", { name: "DONE" }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue(RAW_SECRET)).not.toBeInTheDocument();
    });
    expect(createIntake).toHaveFocus();
    expect(JSON.stringify(localStorage)).not.toContain(RAW_SECRET);
    expect(JSON.stringify(sessionStorage)).not.toContain(RAW_SECRET);
  });

  it("returns focus to a destructive-action trigger after cancellation", async () => {
    const user = userEvent.setup();
    authedFetchMock.mockReturnValue(
      response(settings({ sources: [source], credentials: [intakeCredential] }))
    );

    render(<WebsiteIntegrationTab />);
    const revoke = await screen.findByRole("button", {
      name: "REVOKE WEBSITE INTAKE",
    });
    await user.click(revoke);
    await user.click(screen.getByRole("button", { name: "KEEP KEY" }));

    expect(revoke).toHaveFocus();
  });

  it("returns focus after rotation and expiry dialogs close", async () => {
    const user = userEvent.setup();
    authedFetchMock.mockReturnValue(
      response(settings({ sources: [source], credentials: [intakeCredential] }))
    );

    render(<WebsiteIntegrationTab />);
    const rotate = await screen.findByRole("button", {
      name: "ROTATE WEBSITE INTAKE",
    });
    await user.click(rotate);
    await user.click(screen.getByRole("button", { name: "KEEP CURRENT KEY" }));
    expect(rotate).toHaveFocus();

    const edit = screen.getByRole("button", {
      name: "EDIT WEBSITE INTAKE",
    });
    await user.click(edit);
    expect(screen.getByLabelText("EXPIRY DATE")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(edit).toHaveFocus();
  });

  it("shows safe owner-facing copy instead of server details", async () => {
    authedFetchMock.mockReturnValue(
      response(
        {
          error:
            "postgres 42501 opsx_7_hidden_secret materialized internal stack",
        },
        500
      )
    );

    render(<WebsiteIntegrationTab />);

    expect(
      await screen.findByText("WEBSITE SETTINGS UNAVAILABLE")
    ).toBeInTheDocument();
    expect(screen.queryByText(/postgres|42501|opsx_/i)).not.toBeInTheDocument();
  });
});
