import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectStatus } from "@/lib/types/models";

// `<ProjectEditCreateBody>` is the workspace's edit/create composer. It
// owns the react-hook-form state shared by IdentityTab and ScheduleTab,
// dispatches submit to either createProject or saveProject based on the
// mode, and gates rendering on `projects.edit` / `projects.create`.

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => false };
});

const mockProject = vi.fn();
const mockCan = vi.fn();
const saveMutate = vi.fn();
const createMutate = vi.fn();

vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => mockProject(),
}));

vi.mock("@/lib/hooks/use-project-mutations", () => ({
  useProjectMutations: () => ({
    saveProject: { mutateAsync: saveMutate, isPending: false },
    createProject: { mutateAsync: createMutate, isPending: false },
  }),
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (
    selector: (s: { can: (p: string) => boolean }) => unknown,
  ) => selector({ can: mockCan }),
}));

// Stub the tab children so we can verify dispatch + form context wiring
// without depending on their implementation details.
vi.mock(
  "@/components/ops/projects/workspace/edit-create/identity-tab",
  () => ({
    IdentityTab: ({ mode }: { mode: "editing" | "creating" }) => (
      <div data-testid="identity-tab-stub" data-mode={mode} />
    ),
  }),
);

vi.mock(
  "@/components/ops/projects/workspace/edit-create/schedule-tab",
  () => ({
    ScheduleTab: () => <div data-testid="schedule-tab-stub" />,
  }),
);

const { ProjectEditCreateBody } = await import(
  "@/components/ops/projects/workspace/edit-create/project-edit-create-body"
);

const PROJECT = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Acme HQ Reroof",
  address: "1234 Industry Way",
  latitude: 37.95,
  longitude: -121.29,
  startDate: new Date("2026-05-01"),
  endDate: new Date("2026-05-15"),
  duration: 14,
  status: ProjectStatus.InProgress,
  projectDescription: "Replace flat roof.",
  clientId: "client-001",
  trade: "roofing" as const,
  visibility: "all" as const,
};

const PROJECT_ID = PROJECT.id;
const FORM_ID = "project-edit-create-form-test";

describe("<ProjectEditCreateBody>", () => {
  beforeEach(() => {
    mockProject.mockReturnValue({ data: PROJECT, isLoading: false });
    mockCan.mockReturnValue(true);
    saveMutate.mockReset();
    createMutate.mockReset();
    saveMutate.mockResolvedValue(PROJECT_ID);
    createMutate.mockResolvedValue({ id: "new-project-id", title: "New" });
  });

  it("renders the IdentityTab when tab is 'identity'", () => {
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="identity"
        formId={FORM_ID}
      />,
    );
    expect(screen.getByTestId("identity-tab-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-tab-stub")).not.toBeInTheDocument();
  });

  it("renders the ScheduleTab when tab is 'schedule'", () => {
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="schedule"
        formId={FORM_ID}
      />,
    );
    expect(screen.getByTestId("schedule-tab-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("identity-tab-stub")).not.toBeInTheDocument();
  });

  it("shows the loading state while the project is loading in editing mode", () => {
    mockProject.mockReturnValue({ data: undefined, isLoading: true });
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="identity"
        formId={FORM_ID}
      />,
    );
    expect(
      screen.getByTestId("project-edit-create-body-loading"),
    ).toBeInTheDocument();
  });

  it("blocks editing when projects.edit permission is denied", () => {
    mockCan.mockImplementation((perm: string) => perm !== "projects.edit");
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="identity"
        formId={FORM_ID}
      />,
    );
    expect(
      screen.getByTestId("project-edit-create-body-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("identity-tab-stub")).not.toBeInTheDocument();
  });

  it("blocks creating when projects.create permission is denied", () => {
    mockCan.mockImplementation((perm: string) => perm !== "projects.create");
    render(
      <ProjectEditCreateBody
        mode="creating"
        projectId={null}
        tab="identity"
        formId={FORM_ID}
      />,
    );
    expect(
      screen.getByTestId("project-edit-create-body-denied"),
    ).toBeInTheDocument();
  });

  it("renders the form with the supplied formId so an external footer can submit it", () => {
    render(
      <ProjectEditCreateBody
        mode="creating"
        projectId={null}
        tab="identity"
        formId={FORM_ID}
      />,
    );
    const form = screen.getByTestId("project-edit-create-form");
    expect(form).toHaveAttribute("id", FORM_ID);
  });

  it("calls saveProject with the project id and patch when submitted in editing mode", async () => {
    const onSaved = vi.fn();
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="identity"
        formId={FORM_ID}
        onSaved={onSaved}
      />,
    );
    const form = screen.getByTestId("project-edit-create-form");
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    const arg = saveMutate.mock.calls[0]![0];
    expect(arg.projectId).toBe(PROJECT_ID);
    expect(arg.patch.title).toBe(PROJECT.title);
    expect(arg.patch.clientId).toBe(PROJECT.clientId);
    expect(arg.patch.projectDescription).toBe(PROJECT.projectDescription);
    expect(arg.patch.trade).toBe(PROJECT.trade);
    expect(arg.patch.visibility).toBe("all");

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(PROJECT_ID));
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("calls createProject when submitted in creating mode and forwards the new id to onSaved", async () => {
    const onSaved = vi.fn();
    render(
      <ProjectEditCreateBody
        mode="creating"
        projectId={null}
        tab="identity"
        formId={FORM_ID}
        onSaved={onSaved}
      />,
    );
    const form = screen.getByTestId("project-edit-create-form");
    // Provide minimum-valid title via form input event would require the
    // real IdentityTab; the composer's defaults give an empty title. Use
    // setValue via an internal effect by sending a custom event instead.
    // Simpler: directly inject a title into the hidden test input rendered
    // by the composer for the creating-mode minimum payload.
    const titleProbe = screen.getByTestId(
      "project-edit-create-body-test-title",
    ) as HTMLInputElement;
    await userEvent.clear(titleProbe);
    await userEvent.type(titleProbe, "New Project");
    // A hand-typed name is custom — flip titleIsAuto off (it defaults true in
    // creating mode) so the typed title is kept verbatim.
    const autoProbe = screen.getByTestId(
      "project-edit-create-body-test-title-is-auto",
    ) as HTMLInputElement;
    await userEvent.click(autoProbe);
    // Creating mode requires trade — seed via the hidden test probe.
    const tradeProbe = screen.getByTestId(
      "project-edit-create-body-test-trade",
    ) as HTMLInputElement;
    await userEvent.clear(tradeProbe);
    await userEvent.type(tradeProbe, "hvac");

    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0]![0];
    expect(arg.title).toBe("New Project");
    expect(arg.titleIsAuto).toBe(false);
    expect(arg.trade).toBe("hvac");
    expect(arg.visibility).toBe("all");

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("new-project-id"),
    );
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("exposes a discard handle that resets dirty form values to the project's defaults (editing mode)", async () => {
    // Phase 9.3 — the workspace footer's DISCARD CHANGES action drives a
    // form.reset() on the composer. The composer exposes that via a
    // React.RefObject<{ discard: () => void }> so the footer can trigger
    // it without crossing the body/footer boundary with a callback.
    const ref = React.createRef<{ discard: () => void }>();
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="identity"
        formId={FORM_ID}
        discardRef={ref}
      />,
    );

    // Dirty the form via the hidden test probe.
    const titleProbe = screen.getByTestId(
      "project-edit-create-body-test-title",
    ) as HTMLInputElement;
    await userEvent.clear(titleProbe);
    await userEvent.type(titleProbe, "Dirty Title");
    expect(titleProbe.value).toBe("Dirty Title");

    // Discard via the imperative handle — the form should reset to the
    // editing defaults (the loaded project's title).
    expect(ref.current).not.toBeNull();
    ref.current!.discard();

    await waitFor(() => {
      expect(titleProbe.value).toBe(PROJECT.title);
    });
  });

  it("discard handle resets to empty defaults in creating mode", async () => {
    const ref = React.createRef<{ discard: () => void }>();
    render(
      <ProjectEditCreateBody
        mode="creating"
        projectId={null}
        tab="identity"
        formId={FORM_ID}
        discardRef={ref}
      />,
    );
    const titleProbe = screen.getByTestId(
      "project-edit-create-body-test-title",
    ) as HTMLInputElement;
    await userEvent.type(titleProbe, "Halfway typed name");
    expect(titleProbe.value).toBe("Halfway typed name");

    ref.current!.discard();

    await waitFor(() => {
      expect(titleProbe.value).toBe("");
    });
  });

  // ── Invalid submit must never be silent ────────────────────────────────
  //
  // The footer's CREATE/SAVE button submits via form=..., possibly while the
  // tab that renders the failing field's error is unmounted (e.g. trade is
  // required for creating but its error lives in the identity tab). Without
  // a report channel the click dead-ends with zero feedback — the create-lead
  // ESTIMATED VALUE bug class (f4e85e75). The body reports the tab owning the
  // first error via onInvalid so the container can flip to it.

  it("creating: reports the identity tab on invalid submit while the schedule tab is active", async () => {
    const onInvalid = vi.fn();
    render(
      <ProjectEditCreateBody
        mode="creating"
        projectId={null}
        tab="schedule"
        formId={FORM_ID}
        onInvalid={onInvalid}
      />,
    );
    // Trade untouched → required-field failure owned by the identity tab.
    const form = screen.getByTestId("project-edit-create-form");
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await waitFor(() => expect(onInvalid).toHaveBeenCalledWith("identity"));
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("editing: reports the identity tab when a pasted title exceeds 200 chars", async () => {
    const onInvalid = vi.fn();
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="schedule"
        formId={FORM_ID}
        onInvalid={onInvalid}
      />,
    );
    const titleProbe = screen.getByTestId(
      "project-edit-create-body-test-title",
    ) as HTMLInputElement;
    fireEvent.change(titleProbe, { target: { value: "x".repeat(201) } });

    const form = screen.getByTestId("project-edit-create-form");
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await waitFor(() => expect(onInvalid).toHaveBeenCalledWith("identity"));
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("does not fire onInvalid on a valid submit", async () => {
    const onInvalid = vi.fn();
    render(
      <ProjectEditCreateBody
        mode="editing"
        projectId={PROJECT_ID}
        tab="identity"
        formId={FORM_ID}
        onInvalid={onInvalid}
      />,
    );
    const form = screen.getByTestId("project-edit-create-form");
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("accepts a blank title in creating mode and auto-names the project", async () => {
    // The create-form name field is gone: a blank title is the common path —
    // the project auto-names from its address (titleIsAuto=true), so submit
    // must succeed without a typed name.
    const onSaved = vi.fn();
    render(
      <ProjectEditCreateBody
        mode="creating"
        projectId={null}
        tab="identity"
        formId={FORM_ID}
        onSaved={onSaved}
      />,
    );
    // Trade is still required up front; leave the title blank.
    const tradeProbe = screen.getByTestId(
      "project-edit-create-body-test-trade",
    ) as HTMLInputElement;
    await userEvent.clear(tradeProbe);
    await userEvent.type(tradeProbe, "roofing");

    const form = screen.getByTestId("project-edit-create-form");
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0]![0];
    expect(arg.titleIsAuto).toBe(true);
    expect(arg.title == null || arg.title === "").toBe(true);
    expect(saveMutate).not.toHaveBeenCalled();
  });
});
