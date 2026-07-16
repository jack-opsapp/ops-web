import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LeadResponsibilityResolutionDialog } from "@/components/settings/lead-responsibility-resolution-dialog";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) =>
      ({
        "roles.assignmentResolutionTitle": "Reassign active leads",
        "roles.assignmentResolutionDescription": "Choose where each lead goes.",
        "roles.assignmentUntitledLead": "Untitled lead",
        "roles.assignmentDestinationLabel": "Move to",
        "roles.assignmentChooseDestination": "Choose destination",
        "roles.assignmentUnassignedQueue": "Unassigned queue",
        "roles.assignmentKeepAccess": "Keep current access",
        "roles.assignmentReassignAndSave": "Reassign and save",
      })[key] ?? key,
  }),
}));

const pending = {
  input: {
    expectedPermissions: [],
    newPermissions: [],
    assignmentResolutions: [],
  },
  stranded: [
    {
      opportunity_id: "lead-1",
      title: "Framing inquiry",
      assigned_to: "member-1",
      assignment_version: 3,
    },
    {
      opportunity_id: "lead-2",
      title: "Renovation inquiry",
      assigned_to: "member-1",
      assignment_version: 4,
    },
  ],
  eligibleAssignees: [
    {
      id: "member-2",
      first_name: "Jason",
      last_name: "Zavarella",
      profile_image_url: null,
      user_color: null,
      role: "Operator",
    },
  ],
};

describe("RoleAssignmentResolutionDialog", () => {
  it("requires an explicit destination for every stranded lead", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <LeadResponsibilityResolutionDialog
        pending={pending}
        loading={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const confirm = screen.getByRole("button", { name: "Reassign and save" });
    expect(confirm).toBeDisabled();

    const selectors = screen.getAllByRole("combobox", { name: "Move to" });
    await user.click(selectors[0]);
    await user.click(screen.getByRole("option", { name: "Unassigned queue" }));
    expect(confirm).toBeDisabled();

    await user.click(selectors[1]);
    await user.click(screen.getByRole("option", { name: "Jason Zavarella" }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const destinations = onConfirm.mock.calls[0][0] as Map<
      string,
      string | null
    >;
    expect(destinations.get("lead-1")).toBeNull();
    expect(destinations.get("lead-2")).toBe("member-2");
  });

  it("keeps the current access unchanged when cancelled", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <LeadResponsibilityResolutionDialog
        pending={pending}
        loading={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Keep current access" })
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
