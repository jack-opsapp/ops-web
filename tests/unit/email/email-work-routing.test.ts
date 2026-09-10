import { describe, expect, it } from "vitest";
import {
  currentEmailWorkBody,
  parseEmailWorkIntent,
  decideEmailWorkRouting,
  type EmailCustomerContext,
} from "@/lib/email/email-work-routing";

const context: EmailCustomerContext = {
  clientIds: ["client-erin"],
  projects: [
    {
      id: "project-deck",
      clientId: "client-erin",
      address: "541 Prince Robert Lane, Victoria, BC",
      status: "in_progress",
    },
  ],
};
const damage =
  "Hi Jackson, something was thrown off the deck and damaged the tenant's baby gate. The crew said they would replace it. I could pay her now to come off the bill later. How do you want to handle it?";

describe("email purpose before sales creation", () => {
  it("routes a known subcontact's damage report to the existing project even without an eligible lead", () => {
    expect(
      decideEmailWorkRouting({ context, intent: "existing_job", body: damage })
    ).toEqual({
      action: "project",
      clientId: "client-erin",
      projectId: "project-deck",
      reason: "existing_job",
    });
  });

  it.each([
    "Can we start tomorrow? Please remove the furniture from the deck.",
    "The invoice has been paid. Can you confirm receipt?",
    "The railing you installed is loose. Can you come back under warranty?",
  ])("retains existing-job correspondence: %s", (body) => {
    expect(
      decideEmailWorkRouting({ context, intent: "existing_job", body }).action
    ).toBe("project");
  });

  it("requires positive new-work evidence before creating another lead for an existing project customer", () => {
    expect(
      decideEmailWorkRouting({ context, intent: "new_work", body: damage })
        .action
    ).toBe("review");
    expect(decideEmailWorkRouting({ context, body: damage }).action).toBe(
      "review"
    );
  });

  it("preserves a genuine separate quote request from the same customer", () => {
    const body =
      "Thanks for finishing our deck. Could you quote a new fence at our other property?";
    expect(
      decideEmailWorkRouting({
        context,
        intent: "new_work",
        body,
        newWorkEvidence: "Could you quote a new fence at our other property?",
      }).action
    ).toBe("sales");
  });

  it("rejects invented new-work evidence", () => {
    expect(
      decideEmailWorkRouting({
        context,
        intent: "new_work",
        body: damage,
        newWorkEvidence: "Please quote a new deck",
      }).action
    ).toBe("review");
  });

  it("does not guess between two customer projects without an exact property address", () => {
    const multiple = {
      ...context,
      projects: [
        ...context.projects,
        {
          ...context.projects[0],
          id: "other-project",
          address: "10 Douglas Street, Victoria, BC",
        },
      ],
    };
    expect(
      decideEmailWorkRouting({
        context: multiple,
        intent: "existing_job",
        body: damage,
      }).action
    ).toBe("review");
    expect(
      decideEmailWorkRouting({
        context: multiple,
        intent: "existing_job",
        body: damage,
        address: "541 Prince Robert Ln, Victoria, BC",
      })
    ).toMatchObject({ action: "project", projectId: "project-deck" });
  });

  it("does not use a city or a conflicting property address to attach correspondence", () => {
    for (const address of ["Victoria", "999 Other Street, Victoria, BC"]) {
      expect(
        decideEmailWorkRouting({
          context,
          intent: "existing_job",
          body: damage,
          address,
        }).action
      ).toBe("review");
    }
  });

  it("holds duplicate customer identities and unknown customers without creating client rows", () => {
    expect(
      decideEmailWorkRouting({
        context: { ...context, clientIds: ["client-erin", "another-client"] },
        intent: "existing_job",
        body: damage,
      }).action
    ).toBe("review");
    expect(
      decideEmailWorkRouting({
        context: { clientIds: [], projects: [] },
        intent: "existing_job",
        body: damage,
      }).action
    ).toBe("review");
  });

  it("supports a completed job's warranty without reopening its sales record", () => {
    expect(
      decideEmailWorkRouting({
        context: {
          ...context,
          projects: [{ ...context.projects[0], status: "completed" }],
        },
        intent: "existing_job",
        body: "The vinyl you installed is leaking under warranty.",
      }).action
    ).toBe("project");
  });

  it("never automatically attaches to an archived project", () => {
    expect(
      decideEmailWorkRouting({
        context: {
          ...context,
          projects: [{ ...context.projects[0], status: "archived" }],
        },
        intent: "existing_job",
        body: damage,
      }).action
    ).toBe("review");
  });

  it("requires source evidence for first-time leads and holds uncertain model results", () => {
    const empty = { clientIds: [], projects: [] };
    expect(
      decideEmailWorkRouting({
        context: empty,
        intent: "new_work",
        body: "Please call me about a deck.",
        newWorkEvidence: "Please call me about a deck.",
      }).action
    ).toBe("sales");
    expect(
      decideEmailWorkRouting({
        context: empty,
        intent: "uncertain",
        body: "Can you call me?",
      }).action
    ).toBe("review");
  });

  it.each([undefined, null, "uncertain", "new_work"] as const)(
    "does not create a first-time lead with %s intent and no inquiry evidence",
    (intent) => {
      expect(
        decideEmailWorkRouting({
          context: { clientIds: [], projects: [] },
          intent,
          body: "You’ve been assigned as an author of a post. For more details, contact the site owner.",
        }).action
      ).toBe("review");
    }
  );

  it("rejects invented evidence for a customer with no projects", () => {
    expect(
      decideEmailWorkRouting({
        context: { clientIds: ["client-new"], projects: [] },
        intent: "new_work",
        body: "You've been assigned as a post author.",
        newWorkEvidence: "Please quote a new deck.",
      }).action
    ).toBe("review");
  });
});

describe("current-message sales evidence", () => {
  const request = "Please quote a new deck at 123 Main Street.";
  const forwarded = `---------- Forwarded message ---------\nFrom: Customer <customer@example.com>\nDate: Yesterday\nTo: Office <office@example.com>\n\n${request}`;
  it("preserves an actual forwarded new request", () => {
    expect(
      currentEmailWorkBody({ subject: "Fwd: Deck", bodyText: forwarded })
    ).toBe(request);
  });
  it.each([
    undefined,
    "The deck you installed is leaking. Can you fix it under warranty?",
  ])(
    "rejects old forwarded sales text in a current warranty reply (%s)",
    (bodyTextClean) => {
      const current =
        "The deck you installed is leaking. Can you fix it under warranty?";
      const body = currentEmailWorkBody({
        subject: "Re: Deck",
        bodyText: `${current}\n\nOn Monday, Jackson wrote:\n${forwarded}`,
        bodyTextClean,
      });
      expect(body).toBe(current);
      expect(
        parseEmailWorkIntent(
          { workIntent: "new_work", newWorkEvidence: request },
          body
        ).workIntent
      ).toBe("uncertain");
    }
  );
  it("does not recover old requests from an explicitly empty provider body", () => {
    expect(
      currentEmailWorkBody({
        subject: "Re: Deck",
        bodyText: `On Monday, Jackson wrote:\n${request}`,
        bodyTextClean: "",
      })
    ).toBe("");
  });
});
