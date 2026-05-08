import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// `<IdentityTab>` — workspace edit/create identity surface.
// Reads the shared form context via useFormContext() and registers five
// fields: title, clientId, trade, address (+ lat/lon), projectDescription.
//
// Trade is required in creating mode (the column was added 2026-05-07,
// every new project captures a category up front). Editing leaves it
// optional so legacy NULL-trade rows save without forcing a backfill.

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => false };
});

const mockClients = vi.fn();

vi.mock("@/lib/hooks/use-clients", () => ({
  useClients: () => mockClients(),
}));

// Mock AddressAutocomplete — its full behaviour is exercised in the
// inputs/address-autocomplete test. Here we only need to confirm the
// IdentityTab wires it to the shared form's address/lat/lon fields.
vi.mock(
  "@/components/ops/projects/workspace/inputs/address-autocomplete",
  () => ({
    AddressAutocomplete: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (sel: { address: string; latitude: number; longitude: number }) => void;
    }) => (
      <div data-testid="address-autocomplete-stub" data-value={value}>
        <button
          type="button"
          data-testid="address-autocomplete-pick"
          onClick={() =>
            onChange({
              address: "9 Pier Way, San Francisco, CA",
              latitude: 37.808,
              longitude: -122.41,
            })
          }
        >
          pick
        </button>
      </div>
    ),
  }),
);

const { IdentityTab } = await import(
  "@/components/ops/projects/workspace/edit-create/identity-tab"
);

// Mirror the production schemas so the harness validates the same way
// ProjectEditCreateBody does. The IdentityTab itself doesn't know mode
// for validation — that's the resolver's job — but it does read mode to
// toggle the Trade label between [optional] and *required.
const TRADE_VALUES = ["roofing", "hvac", "plumbing"] as const;
const baseSchema = z.object({
  title: z.string().min(1).max(200),
  clientId: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  projectDescription: z.string().nullable(),
  trade: z.enum(TRADE_VALUES).nullable(),
  startDate: z.string(),
  endDate: z.string(),
  duration: z.string(),
  visibility: z.enum(["all", "office", "private"]),
});
const creatingSchema = baseSchema.extend({
  trade: z.enum(TRADE_VALUES, {
    errorMap: () => ({ message: "Trade is required" }),
  }),
});

interface HarnessProps {
  mode?: "editing" | "creating";
  defaults?: Partial<{
    title: string;
    clientId: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    projectDescription: string | null;
    trade: "roofing" | "hvac" | "plumbing" | null;
  }>;
  onValuesChange?: (
    values: Record<string, unknown>,
  ) => void;
  onSubmit?: (values: Record<string, unknown>) => void;
}

function Harness({ mode = "editing", defaults, onValuesChange, onSubmit }: HarnessProps) {
  const form = useForm({
    resolver: zodResolver(mode === "creating" ? creatingSchema : baseSchema),
    defaultValues: {
      title: "",
      clientId: null,
      address: null,
      latitude: null,
      longitude: null,
      projectDescription: null,
      trade: null,
      startDate: "",
      endDate: "",
      duration: "",
      visibility: "all",
      ...defaults,
    },
  });
  // Surface form values to the test on every render so assertions can
  // observe writes performed by the IdentityTab's controllers.
  const values = form.watch();
  React.useEffect(() => {
    onValuesChange?.(values as Record<string, unknown>);
  }, [values, onValuesChange]);
  const handleSubmit = form.handleSubmit((vals) => {
    onSubmit?.(vals as Record<string, unknown>);
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit}>
        <IdentityTab mode={mode} />
        <button type="submit" data-testid="harness-submit">
          submit
        </button>
      </form>
    </FormProvider>
  );
}

const SAMPLE_CLIENTS = [
  { id: "c1", name: "Acme Construction", email: null, phoneNumber: null },
  { id: "c2", name: "Beacon Roofing", email: null, phoneNumber: null },
  { id: "c3", name: "Cascade Industries", email: null, phoneNumber: null },
];

describe("<IdentityTab>", () => {
  beforeEach(() => {
    mockClients.mockReturnValue({
      data: { clients: SAMPLE_CLIENTS, count: 3, remaining: 0 },
      isLoading: false,
    });
  });

  it("renders the // IDENTITY section header", () => {
    render(<Harness />);
    expect(screen.getByTestId("identity-tab")).toBeInTheDocument();
    expect(screen.getByText("IDENTITY")).toBeInTheDocument();
  });

  it("renders the project name input with the form's title value", () => {
    render(<Harness defaults={{ title: "Acme HQ Reroof" }} />);
    const input = screen.getByLabelText(/project name/i) as HTMLInputElement;
    expect(input.value).toBe("Acme HQ Reroof");
  });

  it("writes typed input back to the form's title field", async () => {
    const onValuesChange = vi.fn();
    render(<Harness onValuesChange={onValuesChange} />);
    const input = screen.getByLabelText(/project name/i);
    await userEvent.type(input, "New Project");
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.title).toBe("New Project");
  });

  it("shows the 'no client linked' state when clientId is null", () => {
    render(<Harness defaults={{ clientId: null }} />);
    expect(screen.getByTestId("client-picker-empty")).toBeInTheDocument();
  });

  it("renders the linked client name when clientId is set", () => {
    render(<Harness defaults={{ clientId: "c2" }} />);
    expect(screen.getByText("Beacon Roofing")).toBeInTheDocument();
  });

  it("opens the client search dropdown when the operator clicks the picker", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByTestId("client-picker-trigger"));
    expect(screen.getByTestId("client-picker-search")).toBeInTheDocument();
  });

  it("filters clients as the operator types in the search input", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByTestId("client-picker-trigger"));
    const search = screen.getByTestId("client-picker-search") as HTMLInputElement;
    await userEvent.type(search, "beac");
    expect(screen.getByText("Beacon Roofing")).toBeInTheDocument();
    expect(screen.queryByText("Acme Construction")).not.toBeInTheDocument();
    expect(screen.queryByText("Cascade Industries")).not.toBeInTheDocument();
  });

  it("writes the selected clientId to the form when a client is picked", async () => {
    const onValuesChange = vi.fn();
    render(<Harness onValuesChange={onValuesChange} />);
    await userEvent.click(screen.getByTestId("client-picker-trigger"));
    await userEvent.click(screen.getByText("Cascade Industries"));
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.clientId).toBe("c3");
  });

  it("clears the linked client when the operator picks 'remove client'", async () => {
    const onValuesChange = vi.fn();
    render(
      <Harness defaults={{ clientId: "c1" }} onValuesChange={onValuesChange} />,
    );
    await userEvent.click(screen.getByTestId("client-picker-trigger"));
    await userEvent.click(screen.getByTestId("client-picker-clear"));
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.clientId).toBe(null);
  });

  it("renders the AddressAutocomplete seeded with the form's current address", () => {
    render(
      <Harness
        defaults={{
          address: "1234 Industry Way",
          latitude: 37.95,
          longitude: -121.29,
        }}
      />,
    );
    const stub = screen.getByTestId("address-autocomplete-stub");
    expect(stub).toHaveAttribute("data-value", "1234 Industry Way");
  });

  it("writes address + lat + lon to the form when an address is picked", async () => {
    const onValuesChange = vi.fn();
    render(<Harness onValuesChange={onValuesChange} />);
    await userEvent.click(screen.getByTestId("address-autocomplete-pick"));
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.address).toBe("9 Pier Way, San Francisco, CA");
    expect(last?.latitude).toBe(37.808);
    expect(last?.longitude).toBe(-122.41);
  });

  it("renders the description textarea with the form's value", () => {
    render(
      <Harness
        defaults={{ projectDescription: "Replace flat roof and gutters." }}
      />,
    );
    const ta = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(ta.value).toBe("Replace flat roof and gutters.");
  });

  it("writes typed text back to the form's projectDescription field", async () => {
    const onValuesChange = vi.fn();
    render(<Harness onValuesChange={onValuesChange} />);
    const ta = screen.getByLabelText(/description/i);
    await userEvent.type(ta, "Replace roof.");
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.projectDescription).toBe("Replace roof.");
  });

  // ── Trade field ────────────────────────────────────────────────────

  it("renders the Trade field labelled and placed beside Client", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/trade/i)).toBeInTheDocument();
    expect(screen.getByTestId("identity-client-trade-row")).toBeInTheDocument();
  });

  it("marks Trade as [optional] in editing mode", () => {
    render(<Harness mode="editing" />);
    const tradeLabel = screen.getByText(/^trade$/i);
    expect(tradeLabel.parentElement).toHaveTextContent(/optional/i);
    expect(tradeLabel.parentElement?.textContent).not.toContain("*");
  });

  it("marks Trade as required in creating mode", () => {
    render(<Harness mode="creating" />);
    const tradeLabel = screen.getByText(/^trade$/i);
    expect(tradeLabel.parentElement?.textContent).toContain("*");
    expect(tradeLabel.parentElement).not.toHaveTextContent(/optional/i);
  });

  it("exposes ROOFING, HVAC, and PLUMBING when the Trade Select is opened", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText(/trade/i));
    // Radix renders options in a portal — use role queries to scope.
    const options = screen.getAllByRole("option");
    const labels = options.map((o) => o.textContent?.trim());
    expect(labels).toEqual(["ROOFING", "HVAC", "PLUMBING"]);
  });

  it("writes the lowercase enum value to the form when an option is selected", async () => {
    const onValuesChange = vi.fn();
    render(<Harness onValuesChange={onValuesChange} />);
    await userEvent.click(screen.getByLabelText(/trade/i));
    await userEvent.click(screen.getByRole("option", { name: "HVAC" }));
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.trade).toBe("hvac");
  });

  it("renders the seeded trade label uppercase when the form already has a value", () => {
    render(<Harness defaults={{ trade: "plumbing" }} />);
    // Radix renders the selected option's text inside the trigger.
    const trigger = screen.getByLabelText(/trade/i);
    expect(trigger.textContent).toContain("PLUMBING");
  });

  it("blocks submit when trade is null in creating mode", async () => {
    const onSubmit = vi.fn();
    render(<Harness mode="creating" onSubmit={onSubmit} defaults={{ title: "Acme HQ Reroof" }} />);
    await userEvent.click(screen.getByTestId("harness-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("allows submit with null trade in editing mode (legacy projects)", async () => {
    const onSubmit = vi.fn();
    render(<Harness mode="editing" onSubmit={onSubmit} defaults={{ title: "Legacy Project" }} />);
    await userEvent.click(screen.getByTestId("harness-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]?.trade).toBeNull();
  });
});
