import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";

// `<IdentityTab>` — workspace edit/create identity surface.
// Reads the shared form context via useFormContext() and registers four
// fields: title, clientId, address (+ lat/lon), projectDescription.
//
// Trade is intentionally absent — `projects.trade` does not exist in
// the schema and adding it is out of scope for Phase 8 (surfaced to
// reviewer).

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

interface HarnessProps {
  defaults?: Partial<{
    title: string;
    clientId: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    projectDescription: string | null;
  }>;
  onValuesChange?: (
    values: Record<string, unknown>,
  ) => void;
}

function Harness({ defaults, onValuesChange }: HarnessProps) {
  const form = useForm({
    defaultValues: {
      title: "",
      clientId: null,
      address: null,
      latitude: null,
      longitude: null,
      projectDescription: null,
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
  return (
    <FormProvider {...form}>
      <form>
        <IdentityTab />
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
});
