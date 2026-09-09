/**
 * CALIBRATION — the page renders a real state for every query outcome
 * (bug 049cb3f5: "calibration page never loads").
 *
 * The deck route was 500ing and the page had exactly two branches: `isLoading`
 * → "SYS :: LOADING", and `!deck` → `null`. A failed read is neither loading
 * nor loaded, so the page parked on the loading line forever and, once the
 * retry ladder gave up, rendered nothing at all. These tests pin the four
 * outcomes an operator can actually land on.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryState = {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

const state = vi.hoisted(() => ({
  deck: {
    data: undefined,
    isPending: true,
    isError: false,
    error: null,
  } as QueryState,
  firstRun: {
    data: undefined,
    isPending: true,
    isError: false,
    error: null,
  } as QueryState,
  refetchDeck: vi.fn(),
  refetchFirstRun: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "@/app/(dashboard)/calibration/_components/hooks/use-calibration-deck",
  () => ({
    useCalibrationDeck: () => ({
      ...state.deck,
      refetch: state.refetchDeck,
    }),
  })
);
vi.mock(
  "@/app/(dashboard)/calibration/_components/hooks/use-calibration-first-run",
  () => ({
    useCalibrationFirstRun: () => ({
      ...state.firstRun,
      refetch: state.refetchFirstRun,
      dismiss: vi.fn(),
    }),
  })
);
vi.mock("@/app/(dashboard)/calibration/_components/command-deck", () => ({
  CommandDeck: () => <div data-testid="command-deck" />,
}));
vi.mock("@/app/(dashboard)/calibration/_components/first-run-wizard", () => ({
  FirstRunWizard: () => <div data-testid="first-run-wizard" />,
}));
vi.mock("@/app/(dashboard)/calibration/_components/section-inputs", () => ({
  SectionInputs: () => <div />,
}));
vi.mock("@/app/(dashboard)/calibration/_components/section-corpus", () => ({
  SectionCorpus: () => <div />,
}));
vi.mock("@/app/(dashboard)/calibration/_components/section-config", () => ({
  SectionConfig: () => <div />,
}));
vi.mock("@/app/(dashboard)/calibration/_components/section-activity", () => ({
  SectionActivity: () => <div />,
}));
vi.mock("@/app/(dashboard)/calibration/_components/section-milestones", () => ({
  SectionMilestones: () => <div />,
}));

import CalibrationPage from "@/app/(dashboard)/calibration/page";

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

const loaded = (data: unknown): QueryState => ({
  data,
  isPending: false,
  isError: false,
  error: null,
});
const failed = (status: number): QueryState => ({
  data: undefined,
  isPending: false,
  isError: true,
  error: httpError(status),
});
const pending: QueryState = {
  data: undefined,
  isPending: true,
  isError: false,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.deck = pending;
  state.firstRun = pending;
});

describe("calibration page states", () => {
  it("reads as loading while the queries are pending", () => {
    render(<CalibrationPage />);
    expect(screen.getByText("state.loading.heading")).toBeTruthy();
    expect(screen.queryByText("state.error.heading")).toBeNull();
  });

  it("reads as loading while a store hydration keeps the query disabled", () => {
    // A disabled query is `isPending` but not `isLoading` — the old gate let
    // this fall through to a blank page.
    state.deck = { ...pending };
    state.firstRun = { ...pending };
    render(<CalibrationPage />);
    expect(screen.getByText("state.loading.heading")).toBeTruthy();
  });

  it("shows the locked state on 403 and offers no retry", () => {
    state.deck = failed(403);
    state.firstRun = failed(403);
    render(<CalibrationPage />);
    expect(screen.getByText("state.forbidden.heading")).toBeTruthy();
    expect(screen.queryByText("state.error.retry")).toBeNull();
  });

  it("shows the error state on 500 and retries both queries", () => {
    state.deck = failed(500);
    state.firstRun = loaded({ shouldShowWizard: false });
    render(<CalibrationPage />);
    expect(screen.getByText("state.error.heading")).toBeTruthy();

    fireEvent.click(screen.getByText("state.error.retry"));
    expect(state.refetchDeck).toHaveBeenCalledTimes(1);
    expect(state.refetchFirstRun).toHaveBeenCalledTimes(1);
  });

  it("prefers the failure over the loading line when the other query is still pending", () => {
    state.deck = pending;
    state.firstRun = failed(500);
    render(<CalibrationPage />);
    expect(screen.getByText("state.error.heading")).toBeTruthy();
    expect(screen.queryByText("state.loading.heading")).toBeNull();
  });

  it("renders the deck once both reads land", () => {
    state.deck = loaded({ inputs: {}, corpus: {}, config: {}, activity: {}, milestones: {} });
    state.firstRun = loaded({ shouldShowWizard: false });
    render(<CalibrationPage />);
    expect(screen.getByTestId("command-deck")).toBeTruthy();
    expect(screen.queryByText("state.loading.heading")).toBeNull();
    expect(screen.queryByText("state.error.heading")).toBeNull();
  });

  it("never renders an empty page when the deck resolves without data", () => {
    state.deck = loaded(undefined);
    state.firstRun = loaded({ shouldShowWizard: false });
    render(<CalibrationPage />);
    expect(screen.getByText("state.error.heading")).toBeTruthy();
  });
});
