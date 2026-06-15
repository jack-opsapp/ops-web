import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

import { QuickBooksPane } from "../QuickBooksPane";

describe("<QuickBooksPane>", () => {
  it("ready: offers the read-only pull with a connected badge + trust line", () => {
    const onPull = vi.fn();
    render(<QuickBooksPane status="ready" onPull={onPull} />);
    expect(screen.getByTestId("quickbooks-connected-badge")).toBeInTheDocument();
    const pull = screen.getByTestId("quickbooks-pull");
    expect(pull).toBeInTheDocument();
    expect(screen.getByText(/read-only — nothing changes in QuickBooks/i)).toBeInTheDocument();
    fireEvent.click(pull);
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it("connect: offers connect (no badge) when there is no live connection", () => {
    const onConnect = vi.fn();
    render(<QuickBooksPane status="connect" onConnect={onConnect} />);
    expect(screen.queryByTestId("quickbooks-connected-badge")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("quickbooks-connect-action"));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("pulling: shows the working state", () => {
    render(<QuickBooksPane status="pulling" />);
    expect(screen.getByTestId("quickbooks-working")).toBeInTheDocument();
  });

  it("result: surfaces the pulled count + matched count and a pull-again", () => {
    render(
      <QuickBooksPane status="result" summary={{ pulled: 12, matched: 3 }} onPull={vi.fn()} />,
    );
    expect(screen.getByTestId("quickbooks-pulled")).toHaveTextContent(/12/);
    expect(screen.getByTestId("quickbooks-matched")).toHaveTextContent(/3/);
    expect(screen.getByTestId("quickbooks-pull-again")).toBeInTheDocument();
  });

  it("result: hides the matched line when nothing matched", () => {
    render(<QuickBooksPane status="result" summary={{ pulled: 5, matched: 0 }} />);
    expect(screen.queryByTestId("quickbooks-matched")).not.toBeInTheDocument();
  });

  it("result: surfaces blockers + needs-review so pulled-but-unbuildable rows aren't silent", () => {
    render(
      <QuickBooksPane
        status="result"
        summary={{ pulled: 10, matched: 0, blockers: 2, needsReview: 3 }}
      />,
    );
    expect(screen.getByTestId("quickbooks-blockers")).toHaveTextContent(/2/);
    expect(screen.getByTestId("quickbooks-needs-review")).toHaveTextContent(/3/);
  });

  it("error (generic): offers a retry", () => {
    const onPull = vi.fn();
    render(<QuickBooksPane status="error" errorKind="generic" onPull={onPull} />);
    fireEvent.click(screen.getByTestId("quickbooks-retry"));
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it("error (reconnect): offers a reconnect, not a retry", () => {
    const onConnect = vi.fn();
    render(<QuickBooksPane status="error" errorKind="reconnect" onConnect={onConnect} />);
    expect(screen.queryByTestId("quickbooks-retry")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("quickbooks-reconnect"));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("back returns to the source picker", () => {
    const onBack = vi.fn();
    render(<QuickBooksPane status="ready" onBack={onBack} />);
    fireEvent.click(screen.getByTestId("quickbooks-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
