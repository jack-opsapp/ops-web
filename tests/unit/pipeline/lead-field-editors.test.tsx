/**
 * Tests for the lead-detail inline field editors (`lead-field-editors.tsx`).
 *
 * These small editors back the map-backed summary band + the Overview tab. Each
 * receives a SHARED `edit` instance ({@link useOpportunityFieldEdit}) from the
 * parent — never its own — so here we hand every editor a fake `edit` whose
 * `commit` is a spy and whose `saveState` is a stub. That lets us assert the
 * exact `commit(field, value)` calls without standing up TanStack Query.
 *
 * The non-negotiable contract under test:
 *  - read display renders the value (mono/formatted for currency) or the `—`
 *    sentinel for empty,
 *  - `canManage === false` renders a pure read-out: clicking opens NO editor and
 *    never calls `commit`,
 *  - opening an editor → entering a value → committing calls `edit.commit` with
 *    the right field + raw value, only when changed,
 *  - Esc closes a popover WITHOUT committing,
 *  - the priority chip always carries its text label (never colour-only),
 *  - tags add/remove round-trip through `commit("tags", …)`.
 */

import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

// The global setup registers jest-dom via setupFiles, but when this file is run
// through a name filter (`vitest run lead-field-editors`) the matcher extension
// is not reliably applied to the worker — so register it explicitly here. This
// is idempotent and harmless when the global registration also runs.
expect.extend(jestDomMatchers);

import {
  OpportunityPriority,
  OpportunitySource,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { UseOpportunityFieldEdit } from "@/lib/hooks/use-opportunity-field-edit";

// Echo-key dictionary so labels are deterministic; the `t(key, fallback)`
// contract returns the English fallback when present, so we forward it.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

// Team members for the OwnerField picker — two named, active users.
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({
    data: {
      users: [
        {
          id: "user-ada",
          firstName: "Ada",
          lastName: "Lovelace",
          isActive: true,
          profileImageURL: null,
        },
        {
          id: "user-grace",
          firstName: "Grace",
          lastName: "Hopper",
          isActive: true,
          profileImageURL: null,
        },
      ],
    },
    isLoading: false,
  }),
}));

// AddressAutocomplete is geocode-backed (network + Mapbox); stub it to a plain
// input that echoes a fixed selection so we can assert the address commit
// without the real debounce/query machinery.
vi.mock(
  "@/components/ops/projects/workspace/inputs/address-autocomplete",
  () => ({
    AddressAutocomplete: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (sel: {
        address: string;
        latitude: number;
        longitude: number;
      }) => void;
    }) => (
      <input
        aria-label="address-autocomplete-stub"
        defaultValue={value}
        onChange={() =>
          onChange({
            address: "500 Howe St, Vancouver",
            latitude: 49.2827,
            longitude: -123.1207,
          })
        }
      />
    ),
  }),
);

import {
  AddressField,
  CurrencyField,
  DateField,
  OwnerField,
  PriorityField,
  SourceField,
  TagsField,
  TextAreaField,
} from "@/app/(dashboard)/pipeline/_components/lead-field-editors";

/** Build a fake shared edit instance with a spy `commit`. */
function makeEdit(): UseOpportunityFieldEdit & { commit: ReturnType<typeof vi.fn> } {
  const commit = vi.fn().mockResolvedValue(undefined);
  return {
    saveState: () => "idle",
    commit,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── CurrencyField ────────────────────────────────────────────────────────────

describe("CurrencyField", () => {
  it("displays the formatted currency value", () => {
    const edit = makeEdit();
    render(<CurrencyField edit={edit} canManage value={14200} />);
    expect(screen.getByText(formatCurrency(14200))).toBeInTheDocument();
  });

  it("displays the em-dash sentinel for a null value", () => {
    const edit = makeEdit();
    render(<CurrencyField edit={edit} canManage value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("commits the raw numeric value on Enter when changed", () => {
    const edit = makeEdit();
    render(<CurrencyField edit={edit} canManage value={1000} />);

    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2500" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(edit.commit).toHaveBeenCalledTimes(1);
    expect(edit.commit).toHaveBeenCalledWith("estimatedValue", "2500");
  });

  it("does NOT commit when the value is unchanged", () => {
    const edit = makeEdit();
    render(<CurrencyField edit={edit} canManage value={1000} />);

    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    // Leave the prefilled "1000" untouched, commit.
    fireEvent.keyDown(input, { key: "Enter" });

    expect(edit.commit).not.toHaveBeenCalled();
  });

  it("closes on Esc WITHOUT committing", () => {
    const edit = makeEdit();
    render(<CurrencyField edit={edit} canManage value={1000} />);

    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(edit.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("renders read-only when !canManage — clicking opens no editor and never commits", () => {
    const edit = makeEdit();
    render(<CurrencyField edit={edit} canManage={false} value={1000} />);

    expect(screen.queryByRole("button")).toBeNull();
    // The display value is still legible.
    expect(screen.getByText(formatCurrency(1000))).toBeInTheDocument();
    expect(edit.commit).not.toHaveBeenCalled();
  });
});

// ─── SourceField ────────────────────────────────────────────────────────────

describe("SourceField", () => {
  it("displays the em-dash sentinel when no source is set", () => {
    const edit = makeEdit();
    render(<SourceField edit={edit} canManage value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("commits the picked source value", () => {
    const edit = makeEdit();
    render(<SourceField edit={edit} canManage value={null} />);

    fireEvent.click(screen.getByRole("button"));
    const listbox = screen.getByRole("listbox");
    fireEvent.click(within(listbox).getByText("Referral"));

    expect(edit.commit).toHaveBeenCalledWith("source", OpportunitySource.Referral);
  });

  it("commits null when Clear is chosen", () => {
    const edit = makeEdit();
    render(<SourceField edit={edit} canManage value={OpportunitySource.Website} />);

    fireEvent.click(screen.getByRole("button"));
    const listbox = screen.getByRole("listbox");
    fireEvent.click(within(listbox).getByText("Clear"));

    expect(edit.commit).toHaveBeenCalledWith("source", null);
  });

  it("renders read-only when !canManage", () => {
    const edit = makeEdit();
    render(<SourceField edit={edit} canManage={false} value={OpportunitySource.Referral} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(edit.commit).not.toHaveBeenCalled();
  });
});

// ─── PriorityField ────────────────────────────────────────────────────────────

describe("PriorityField", () => {
  it("renders the priority chip with its text label (never colour-only)", () => {
    const edit = makeEdit();
    render(<PriorityField edit={edit} canManage value={OpportunityPriority.High} />);
    // The chip text label must be present, not just a colour swatch.
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("displays the em-dash sentinel when no priority is set", () => {
    const edit = makeEdit();
    render(<PriorityField edit={edit} canManage value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("commits the picked priority value", () => {
    const edit = makeEdit();
    render(<PriorityField edit={edit} canManage value={null} />);

    fireEvent.click(screen.getByRole("button"));
    const listbox = screen.getByRole("listbox");
    fireEvent.click(within(listbox).getByText("Medium"));

    expect(edit.commit).toHaveBeenCalledWith("priority", OpportunityPriority.Medium);
  });
});

// ─── DateField ────────────────────────────────────────────────────────────────

describe("DateField", () => {
  it("displays the em-dash sentinel when no date is set", () => {
    const edit = makeEdit();
    render(<DateField edit={edit} canManage value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("commits the ISO date string on change", () => {
    const edit = makeEdit();
    render(<DateField edit={edit} canManage value={null} />);

    fireEvent.click(screen.getByRole("button"));
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "2026-07-15" } });

    expect(edit.commit).toHaveBeenCalledTimes(1);
    const [field, value] = edit.commit.mock.calls[0];
    expect(field).toBe("expectedCloseDate");
    expect(typeof value).toBe("string");
    expect(value).toContain("2026-07-15");
  });

  it("renders read-only when !canManage", () => {
    const edit = makeEdit();
    render(<DateField edit={edit} canManage={false} value={null} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(edit.commit).not.toHaveBeenCalled();
  });
});

// ─── OwnerField ────────────────────────────────────────────────────────────────

describe("OwnerField", () => {
  it("shows the assigned member name", () => {
    const edit = makeEdit();
    render(<OwnerField edit={edit} canManage value="user-ada" />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("shows the unassigned placeholder when value is null", () => {
    const edit = makeEdit();
    render(<OwnerField edit={edit} canManage value={null} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("commits the selected member id", () => {
    const edit = makeEdit();
    render(<OwnerField edit={edit} canManage value={null} />);

    fireEvent.click(screen.getByRole("button"));
    const listbox = screen.getByRole("listbox");
    fireEvent.click(within(listbox).getByText("Grace Hopper"));

    expect(edit.commit).toHaveBeenCalledWith("assignedTo", "user-grace");
  });

  it("commits null when Unassign is chosen", () => {
    const edit = makeEdit();
    render(<OwnerField edit={edit} canManage value="user-ada" />);

    fireEvent.click(screen.getByRole("button"));
    const listbox = screen.getByRole("listbox");
    // The clear option lives inside the listbox; pick it by its option role.
    const unassign = within(listbox)
      .getAllByRole("option")
      .find((el) => el.getAttribute("data-owner-clear") === "true");
    expect(unassign).toBeDefined();
    fireEvent.click(unassign as HTMLElement);

    expect(edit.commit).toHaveBeenCalledWith("assignedTo", null);
  });

  it("renders read-only when !canManage", () => {
    const edit = makeEdit();
    render(<OwnerField edit={edit} canManage={false} value="user-ada" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(edit.commit).not.toHaveBeenCalled();
  });
});

// ─── TagsField ────────────────────────────────────────────────────────────────

describe("TagsField", () => {
  it("renders the existing tags as chips", () => {
    const edit = makeEdit();
    render(<TagsField edit={edit} canManage value={["roofing", "urgent"]} />);
    expect(screen.getByText("roofing")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  it("adds a tag via the input + Enter and commits the next tag list", () => {
    const edit = makeEdit();
    render(<TagsField edit={edit} canManage value={["roofing"]} />);

    fireEvent.click(screen.getByRole("button", { name: /add|tag/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "commercial" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(edit.commit).toHaveBeenCalledWith("tags", ["roofing", "commercial"]);
  });

  it("removes a tag and commits the next tag list", () => {
    const edit = makeEdit();
    render(<TagsField edit={edit} canManage value={["roofing", "urgent"]} />);

    fireEvent.click(screen.getByRole("button", { name: /add|tag/i }));
    // Each removable tag exposes a remove control labelled by its tag.
    fireEvent.click(screen.getByRole("button", { name: /remove.*roofing/i }));

    expect(edit.commit).toHaveBeenCalledWith("tags", ["urgent"]);
  });

  it("does not commit a duplicate or empty tag", () => {
    const edit = makeEdit();
    render(<TagsField edit={edit} canManage value={["roofing"]} />);

    fireEvent.click(screen.getByRole("button", { name: /add|tag/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "roofing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(edit.commit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(edit.commit).not.toHaveBeenCalled();
  });

  it("renders read-only chips when !canManage (no add affordance)", () => {
    const edit = makeEdit();
    render(<TagsField edit={edit} canManage={false} value={["roofing"]} />);
    expect(screen.getByText("roofing")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(edit.commit).not.toHaveBeenCalled();
  });
});

// ─── TextAreaField ──────────────────────────────────────────────────────────────

describe("TextAreaField", () => {
  it("commits the text on blur when changed", () => {
    const edit = makeEdit();
    render(<TextAreaField edit={edit} canManage value="old scope" />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "new scope" } });
    fireEvent.blur(textarea);

    expect(edit.commit).toHaveBeenCalledWith("description", "new scope");
  });

  it("does NOT commit on blur when unchanged", () => {
    const edit = makeEdit();
    render(<TextAreaField edit={edit} canManage value="same" />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.blur(textarea);

    expect(edit.commit).not.toHaveBeenCalled();
  });

  it("reverts to the original value on Esc and does not commit", () => {
    const edit = makeEdit();
    render(<TextAreaField edit={edit} canManage value="original" />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "edited" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(textarea.value).toBe("original");
    expect(edit.commit).not.toHaveBeenCalled();
  });

  it("renders a read-only paragraph when !canManage", () => {
    const edit = makeEdit();
    render(<TextAreaField edit={edit} canManage={false} value="read me" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("read me")).toBeInTheDocument();
  });

  it("renders the em-dash sentinel when read-only and empty", () => {
    const edit = makeEdit();
    render(<TextAreaField edit={edit} canManage={false} value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// ─── AddressField ────────────────────────────────────────────────────────────

describe("AddressField", () => {
  it("commits the geocoded selection through onChange", () => {
    const edit = makeEdit();
    render(
      <AddressField
        edit={edit}
        canManage
        value={{ address: "123 Main", latitude: 1, longitude: 2 }}
      />,
    );

    const input = screen.getByLabelText("address-autocomplete-stub");
    fireEvent.change(input, { target: { value: "500 Howe" } });

    expect(edit.commit).toHaveBeenCalledWith("address", {
      address: "500 Howe St, Vancouver",
      latitude: 49.2827,
      longitude: -123.1207,
    });
  });

  it("renders a read-only address when !canManage", () => {
    const edit = makeEdit();
    render(
      <AddressField
        edit={edit}
        canManage={false}
        value={{ address: "123 Main St", latitude: 1, longitude: 2 }}
      />,
    );
    expect(screen.queryByLabelText("address-autocomplete-stub")).toBeNull();
    expect(screen.getByText("123 Main St")).toBeInTheDocument();
  });

  it("renders the em-dash sentinel when read-only and no address", () => {
    const edit = makeEdit();
    render(
      <AddressField
        edit={edit}
        canManage={false}
        value={{ address: null, latitude: null, longitude: null }}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
