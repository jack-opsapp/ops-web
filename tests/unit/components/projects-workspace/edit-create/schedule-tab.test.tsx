import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";

// `<ScheduleTab>` — workspace edit/create schedule surface.
// Reads the shared form context and registers four fields:
//   startDate  → projects.start_date  (yyyy-mm-dd ISO)
//   endDate    → projects.end_date    (yyyy-mm-dd ISO)
//   duration   → derived from start/end, manually overrideable
//   visibility → projects.visibility (Segmented: all/office/private)

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return { ...actual, useReducedMotion: () => false };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const { ScheduleTab } = await import(
  "@/components/ops/projects/workspace/edit-create/schedule-tab"
);

interface HarnessProps {
  defaults?: Partial<{
    startDate: string;
    endDate: string;
    duration: string;
    visibility: "all" | "office" | "private";
  }>;
  onValuesChange?: (values: Record<string, unknown>) => void;
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
  const values = form.watch();
  React.useEffect(() => {
    onValuesChange?.(values as Record<string, unknown>);
  }, [values, onValuesChange]);
  return (
    <FormProvider {...form}>
      <form>
        <ScheduleTab />
      </form>
    </FormProvider>
  );
}

describe("<ScheduleTab>", () => {
  it("renders the // SCHEDULE section header", () => {
    render(<Harness />);
    expect(screen.getByTestId("schedule-tab")).toBeInTheDocument();
    // Section title resolves via t("schedule.section") — mocked dict
    // returns the key directly.
    expect(screen.getByText("schedule.section")).toBeInTheDocument();
  });

  it("renders Start / End / Duration as a three-cell grid", () => {
    render(<Harness />);
    const grid = screen.getByTestId("schedule-grid");
    expect(grid).toBeInTheDocument();
    expect(grid.querySelectorAll("[data-testid^='schedule-cell-']").length).toBe(3);
  });

  it("seeds Start with the form's startDate value", () => {
    render(<Harness defaults={{ startDate: "2026-05-01" }} />);
    const start = screen.getByLabelText(/start/i) as HTMLInputElement;
    expect(start.value).toBe("2026-05-01");
  });

  it("seeds End with the form's endDate value", () => {
    render(<Harness defaults={{ endDate: "2026-05-15" }} />);
    const end = screen.getByLabelText(/end/i) as HTMLInputElement;
    expect(end.value).toBe("2026-05-15");
  });

  it("writes typed start date back to the form", async () => {
    const onValuesChange = vi.fn();
    render(<Harness onValuesChange={onValuesChange} />);
    const start = screen.getByLabelText(/start/i);
    await userEvent.type(start, "2026-06-01");
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.startDate).toBe("2026-06-01");
  });

  it("auto-derives Duration when both Start and End are set", () => {
    render(
      <Harness
        defaults={{ startDate: "2026-05-01", endDate: "2026-05-15" }}
      />,
    );
    const duration = screen.getByLabelText(/duration/i) as HTMLInputElement;
    // 2026-05-01 → 2026-05-15 inclusive = 15 days; the convention here
    // is end-minus-start + 1 to match how the iOS scheduler counts.
    expect(duration.value).toBe("15");
  });

  it("shows an empty Duration when only one of Start / End is set", () => {
    render(<Harness defaults={{ startDate: "2026-05-01" }} />);
    const duration = screen.getByLabelText(/duration/i) as HTMLInputElement;
    expect(duration.value).toBe("");
  });

  it("renders Visibility segmented control with all three options", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /office/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /private/i })).toBeInTheDocument();
  });

  it("marks the form's visibility value as active in the Segmented", () => {
    render(<Harness defaults={{ visibility: "office" }} />);
    expect(screen.getByRole("radio", { name: /office/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /all/i })).not.toBeChecked();
  });

  it("writes the picked visibility value to the form", async () => {
    const onValuesChange = vi.fn();
    render(<Harness onValuesChange={onValuesChange} />);
    await userEvent.click(screen.getByRole("radio", { name: /private/i }));
    const last = onValuesChange.mock.calls.at(-1)?.[0];
    expect(last?.visibility).toBe("private");
  });

  it("rejects an end date earlier than the start date", () => {
    render(
      <Harness
        defaults={{ startDate: "2026-05-15", endDate: "2026-05-01" }}
      />,
    );
    expect(screen.getByTestId("schedule-end-error")).toBeInTheDocument();
  });
});
