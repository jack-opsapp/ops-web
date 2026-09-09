import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProposalPanel } from "../_components/engine/proposal-panel";
import { TestsPanel } from "../_components/engine/tests-panel";
import { FunnelTable } from "../_components/engine/funnel-table";
import { ChangeLedger } from "../_components/engine/change-ledger";
import { EngineHealth } from "../_components/engine/engine-health";
import type { AdminChangeRow, AdminProposalRow, EngineSettingsRow } from "@/lib/ads/engine/admin";
import type { HealthResponse, TestRow } from "@/lib/hooks/use-ads-engine";
import { PROPOSAL_KINDS } from "@/lib/ads/engine/types";

const NOW = new Date("2026-10-20T15:05:00.000Z");

function proposal(overrides: Partial<AdminProposalRow> = {}): AdminProposalRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    run_id: "22222222-2222-4222-8222-222222222222",
    kind: "add_negatives",
    target: "negatives:NEG · Job seekers:abcdef01",
    submission_index: 0,
    state: "proposed",
    mode_at_submit: "propose",
    payload: {
      list: "NEG · Job seekers",
      listResourceName: "customers/4454506598/sharedSets/501",
      classification: "job_seeker",
      terms: [
        { text: "job management jobs", matchType: "PHRASE" },
        { text: "job management course", matchType: "PHRASE" },
      ],
    },
    evidence: [
      { term: "job management jobs", clicks: 4, spend: 18, conversions: 0 },
      { term: "job management course", clicks: 3, spend: 12, conversions: 0 },
    ],
    rationale: "Job-seeker and training intent spent thirty dollars with no trial.",
    review_notes: null,
    reviewed_by: null,
    reviewed_at: null,
    applied_at: null,
    applied_by: null,
    applied_resource_names: null,
    label: null,
    error: null,
    google_validation: null,
    created_at: "2026-10-20T15:02:00.000Z",
    expires_at: "2026-11-03T15:02:00.000Z",
    updated_at: "2026-10-20T15:02:00.000Z",
    ...overrides,
  };
}

const challenger = (): AdminProposalRow =>
  proposal({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
    kind: "create_rsa_challenger",
    target: "challenger:customers/4454506598/adGroups/22",
    payload: {
      ad_group: "customers/4454506598/adGroups/22",
      adGroupName: "Crew scheduling",
      campaignName: "CORE · CA",
      hypothesis: "Naming the crew in headline one lifts CTR.",
      headlines: [
        { text: "Crew scheduling for trades", pinnedField: "HEADLINE_1" },
        { text: "Every crew knows where to be", pinnedField: "HEADLINE_1" },
        { text: "No training required" },
        { text: "Built by trades, for trades" },
      ],
      descriptions: [{ text: "One app your crew will actually use." }, { text: "Free to start. No credit card." }],
      path1: "crews",
      path2: "schedule",
      final_url: "https://try.opsapp.co/scheduling",
    },
    evidence: [],
    rationale: "The control is five weeks old with no test running.",
  });

const settingsRow = (): EngineSettingsRow => ({
  modes: Object.fromEntries(PROPOSAL_KINDS.map((k) => [k, "propose"])) as EngineSettingsRow["modes"],
  monthly_cap: 1500,
  daily_cap: 60,
  max_budget_change_pct: 15,
  budget_cooldown_days: 14,
  max_structural_per_run: 3,
  lease_minutes: 40,
  stall_hours: 50,
  target_cost_per_trial: 150,
  heartbeat_at: "2026-10-20T14:00:00.000Z",
  stall_notified_on: null,
  updated_at: "2026-10-19T00:00:00.000Z",
});

const health = (overrides: Partial<HealthResponse> = {}): HealthResponse => ({
  last_run: { id: "r1", state: "released", worker: "routine", duties: ["hygiene", "creative"], outcome: "done", summary: "FILED add_negatives NEG · Job seekers (2 terms)\nFILED create_rsa_challenger Crew scheduling", proposals_accepted: 2, proposals_rejected: 1, brief_version: "ads-brief-2026-09-10-v1", created_at: "2026-10-20T15:00:00.000Z", released_at: "2026-10-20T15:09:00.000Z" },
  recent_runs: [],
  next_due_at: "2026-10-21T15:00:00.000Z",
  heartbeat_at: "2026-10-20T14:00:00.000Z",
  heartbeat_age_hours: 1.1,
  stall: { stalled: false, threshold_hours: 50, campaigns_live: true },
  campaigns_live: true,
  google: "available",
  rehearsal: false,
  counts: { proposed: 2, approved: 0, rejected: 1, applied: 4, failed: 0, expired: 0 },
  modes: settingsRow().modes,
  snapshot_at: "2026-10-20T08:10:00.000Z",
  ...overrides,
});

describe("ProposalPanel", () => {
  it("shows a skeleton while pending so a paused fetch never reads as empty", () => {
    render(<ProposalPanel proposals={undefined} isPending error={null} onReview={vi.fn()} />);
    expect(screen.getByTestId("panel-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("No proposals waiting.")).not.toBeInTheDocument();
  });

  it("says plainly when nothing waits, and surfaces a load error with a retry", () => {
    const { rerender } = render(<ProposalPanel proposals={[]} isPending={false} error={null} onReview={vi.fn()} />);
    expect(screen.getByText("No proposals waiting.")).toBeInTheDocument();
    const retry = vi.fn();
    rerender(<ProposalPanel proposals={undefined} isPending={false} error={new Error("500")} onReview={vi.fn()} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load.");
    fireEvent.click(screen.getByRole("button", { name: "RETRY" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders a negatives card with the engine's words, the evidence and the terms, then applies on approve", async () => {
    const onReview = vi.fn(async () => ({ proposal: proposal({ state: "applied" }), outcome: { state: "applied" as const, validation: { results: [], failures: [] }, resourceNames: ["x"], label: "gen-x", changeId: "c", testId: null } }));
    render(<ProposalPanel proposals={[proposal()]} isPending={false} error={null} onReview={onReview} now={NOW} />);
    const card = screen.getByTestId("proposal-card");
    expect(within(card).getByText("NEGATIVES")).toBeInTheDocument();
    expect(within(card).getByText("NEG · Job seekers · 2 terms")).toBeInTheDocument();
    expect(within(card).getByText(/Job-seeker and training intent/)).toBeInTheDocument();
    expect(within(card).getByText("// ENGINE")).toBeInTheDocument();
    expect(within(card).getByText("// EVIDENCE")).toBeInTheDocument();
    expect(within(card).getByText("[expires in 14 days]")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "APPROVE" }));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({ id: proposal().id, decision: "approve", notes: undefined }));
    await waitFor(() => expect(within(card).getByText("APPLIED")).toBeInTheDocument());
    expect(within(card).queryByRole("button", { name: "APPROVE" })).not.toBeInTheDocument();
  });

  it("previews a challenger ad with its pinned headlines and hypothesis", () => {
    render(<ProposalPanel proposals={[challenger()]} isPending={false} error={null} onReview={vi.fn()} now={NOW} />);
    const preview = screen.getByTestId("rsa-preview");
    expect(preview).toHaveTextContent("try.opsapp.co › crews › schedule");
    expect(preview).toHaveTextContent("Crew scheduling for trades");
    expect(within(preview).getAllByLabelText("pinned to position one")).toHaveLength(2);
    expect(screen.getByText(/Naming the crew in headline one/)).toBeInTheDocument();
    expect(screen.getByText("CHALLENGER AD")).toBeInTheDocument();
  });

  it("runs the reject flow through the dialog and sends the reason", async () => {
    const onReview = vi.fn(async () => ({ proposal: proposal({ state: "rejected" }), outcome: { state: "rejected" as const } }));
    render(<ProposalPanel proposals={[proposal()]} isPending={false} error={null} onReview={onReview} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "REJECT" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("REJECT PROPOSAL");
    fireEvent.change(within(dialog).getByPlaceholderText("Reason"), { target: { value: "Keep it a week longer." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "REJECT" }));
    await waitFor(() => expect(onReview).toHaveBeenCalledWith({ id: proposal().id, decision: "reject", notes: "Keep it a week longer." }));
    await waitFor(() => expect(screen.getByText("REJECTED")).toBeInTheDocument());
  });

  it("offers one accent batch approve when several negative lists wait, and none otherwise", async () => {
    const onReview = vi.fn(async ({ id }: { id: string }) => ({ proposal: proposal({ id, state: "applied" }), outcome: { state: "applied" as const, validation: { results: [], failures: [] }, resourceNames: [], label: null, changeId: null, testId: null } }));
    const second = proposal({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003", target: "negatives:NEG · Training:12345678", payload: { ...proposal().payload, list: "NEG · Training" } });
    const { rerender } = render(<ProposalPanel proposals={[proposal(), second]} isPending={false} error={null} onReview={onReview} now={NOW} />);
    const bar = screen.getByTestId("batch-bar");
    expect(within(bar).getByRole("button", { name: "APPROVE 2" })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "APPROVE 2" }));
    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(2));
    rerender(<ProposalPanel proposals={[proposal()]} isPending={false} error={null} onReview={onReview} now={NOW} />);
    expect(screen.queryByTestId("batch-bar")).not.toBeInTheDocument();
  });

  it("shows a failed apply with Google's reason and keeps the card decided", async () => {
    const onReview = vi.fn(async () => ({ proposal: proposal({ state: "failed" }), outcome: { state: "failed" as const, validation: null, error: "POLICY_FINDING@0: Trademark", policyTopics: ["TRADEMARKS"] } }));
    const { rerender } = render(<ProposalPanel proposals={[challenger()]} isPending={false} error={null} onReview={onReview} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "APPROVE" }));
    await waitFor(() => expect(screen.getByText("FAILED")).toBeInTheDocument());
    expect(screen.getByText("POLICY_FINDING@0: Trademark")).toBeInTheDocument();
    // The list refetch no longer returns the reviewed row; the card stays with its verdict.
    rerender(<ProposalPanel proposals={[]} isPending={false} error={null} onReview={onReview} now={NOW} />);
    expect(screen.getByText("FAILED")).toBeInTheDocument();
    expect(screen.getByText("POLICY_FINDING@0: Trademark")).toBeInTheDocument();
    expect(screen.queryByText("No proposals waiting.")).not.toBeInTheDocument();
  });
});

describe("TestsPanel", () => {
  const test = (overrides: Partial<TestRow> = {}): TestRow => ({
    id: "tttttttt-tttt-4ttt-8ttt-000000000001",
    campaign_id: "11",
    ad_group_id: "21",
    ad_group_name: "Job management",
    control_ad_id: "201",
    challenger_ad_id: "202",
    started_at: "2026-10-08T15:00:00.000Z",
    min_days: 14,
    min_impressions: 2000,
    max_days: 56,
    state: "running",
    stats: { control: { impressions: 1800, clicks: 54, ctr: 0.03, trials: 1 }, challenger: { impressions: 1900, clicks: 76, ctr: 0.04, trials: 1 }, days: 9, z: -1.7, p: 0.089, veto: false },
    verdict_at: null,
    control: { headlines: ["Job management for trades"], status: "ENABLED" },
    challenger: { headlines: ["Your crew opens it and goes"], status: "ENABLED" },
    ...overrides,
  });

  it("renders both arms with CTR, impressions, clicks and the verdict tag", () => {
    render(<TestsPanel tests={[test(), test({ id: "tttttttt-tttt-4ttt-8ttt-000000000002", state: "challenger_won", started_at: "2026-09-01T15:00:00.000Z" })]} isPending={false} error={null} />);
    const rows = screen.getAllByTestId("test-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-state", "running");
    expect(rows[0]).toHaveTextContent("day 9 of 14");
    expect(rows[0]).toHaveTextContent("3.00% CTR");
    expect(rows[0]).toHaveTextContent("4.00% CTR");
    expect(rows[0]).toHaveTextContent("1,800 impr.");
    expect(within(rows[0]).getByText("RUNNING")).toBeInTheDocument();
    expect(within(rows[1]).getByText("CHALLENGER WON")).toBeInTheDocument();
  });

  it("has an empty state and a skeleton", () => {
    const { rerender } = render(<TestsPanel tests={[]} isPending={false} error={null} />);
    expect(screen.getByText("No test running.")).toBeInTheDocument();
    rerender(<TestsPanel tests={undefined} isPending error={null} />);
    expect(screen.getByTestId("panel-skeleton")).toBeInTheDocument();
  });
});

describe("FunnelTable", () => {
  it("prints the funnel with mono numbers and dashes for what has not happened", () => {
    render(
      <FunnelTable
        rows={[
          { campaign_name: "CORE · CA", ad_group_name: "Job management", keyword: "job management app", clicks: 40, trials: 1, activated: 0, paid: 0, spend: 180, cost_per_trial: 180, cost_per_paid: null },
          { campaign_name: "CORE · CA", ad_group_name: "Crew scheduling", keyword: "crew scheduling app", clicks: 12, trials: 0, activated: 0, paid: 0, spend: 30.5, cost_per_trial: null, cost_per_paid: null },
        ]}
        available
        isPending={false}
        error={null}
      />
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("job management app");
    expect(rows[0]).toHaveTextContent("$180.00");
    expect(rows[1]).toHaveTextContent("$30.50");
    expect(rows[1].textContent?.match(/—/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("reads as no paid traffic when the view is unavailable or empty", () => {
    const { rerender } = render(<FunnelTable rows={[]} available={false} isPending={false} error={null} />);
    expect(screen.getByText("No paid traffic yet.")).toBeInTheDocument();
    rerender(<FunnelTable rows={[]} available isPending={false} error={null} />);
    expect(screen.getByText("No paid traffic yet.")).toBeInTheDocument();
  });
});

describe("ChangeLedger", () => {
  const change = (overrides: Partial<AdminChangeRow> = {}): AdminChangeRow => ({
    id: "cccccccc-cccc-4ccc-8ccc-000000000001",
    proposal_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000009",
    kind: "adjust_cpc_cap",
    campaign_id: "11",
    ad_group_id: null,
    resource_names: ["customers/4454506598/campaigns/11"],
    before: { cpcCeiling: 7 },
    after: { cpcCeiling: 8 },
    applied_at: "2026-09-20T16:00:00.000Z",
    measure_from: "2026-09-21",
    measure_to: "2026-10-04",
    pre_metrics: { ctr: 0.03 },
    post_metrics: { ctr: 0.036, deltaPct: 20 },
    verdict: "better",
    verdict_at: "2026-10-08T15:00:00.000Z",
    proposal: { kind: "adjust_cpc_cap", rationale: "Impression share lost to rank.", reviewed_by: "jackson@opsapp.co", applied_by: "operator", label: "gen-x" },
    ...overrides,
  });

  it("describes each change and scores it, with days left while measuring", () => {
    render(
      <ChangeLedger
        changes={[change(), change({ id: "cccccccc-cccc-4ccc-8ccc-000000000002", kind: "add_negatives", before: { members: 2 }, after: { members: 4, added: ["a", "b"] }, applied_at: "2026-10-15T16:00:00.000Z", measure_from: "2026-10-16", measure_to: "2026-10-29", verdict: "pending", post_metrics: null })]}
        isPending={false}
        error={null}
        today="2026-10-20"
      />
    );
    const rows = screen.getAllByTestId("ledger-row");
    expect(rows[0]).toHaveAttribute("data-verdict", "pending");
    expect(rows[0]).toHaveTextContent("2 negatives added");
    expect(rows[0]).toHaveTextContent("9 days left");
    expect(rows[1]).toHaveTextContent("CPC cap $7.00 → $8.00");
    expect(rows[1]).toHaveTextContent("+20.0% CTR");
    expect(within(rows[1]).getByText("BETTER")).toBeInTheDocument();
  });

  it("has an empty state", () => {
    render(<ChangeLedger changes={[]} isPending={false} error={null} />);
    expect(screen.getByText("Nothing applied yet.")).toBeInTheDocument();
  });
});

describe("EngineHealth", () => {
  const humanOnly = ["create_rsa_challenger", "adjust_budget", "adjust_cpc_cap", "set_bidding_strategy", "add_ad_group"] as const;

  it("shows the run, the next due time, the check-in and the state", () => {
    render(<EngineHealth health={health()} settings={settingsRow()} humanOnlyKinds={[...humanOnly]} kinds={PROPOSAL_KINDS} isPending={false} error={null} onSave={vi.fn()} now={NOW} />);
    expect(screen.getByText("CHECKED IN")).toBeInTheDocument();
    expect(screen.getByText(/hygiene, creative/)).toBeInTheDocument();
    expect(screen.getByText("in 24h")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    expect(screen.getByText("reachable")).toBeInTheDocument();
  });

  it("flags a stall and a dark account", () => {
    const { rerender } = render(<EngineHealth health={health({ stall: { stalled: true, threshold_hours: 50, campaigns_live: true } })} settings={settingsRow()} humanOnlyKinds={[...humanOnly]} kinds={PROPOSAL_KINDS} isPending={false} error={null} onSave={vi.fn()} now={NOW} />);
    expect(screen.getByText("STALLED")).toBeInTheDocument();
    rerender(<EngineHealth health={health({ campaigns_live: false, stall: { stalled: false, threshold_hours: 50, campaigns_live: false } })} settings={settingsRow()} humanOnlyKinds={[...humanOnly]} kinds={PROPOSAL_KINDS} isPending={false} error={null} onSave={vi.fn()} now={NOW} />);
    expect(screen.getByText("DARK")).toBeInTheDocument();
  });

  it("never offers auto for the kinds that stay human, and saves a mode flip immediately", () => {
    const onSave = vi.fn();
    render(<EngineHealth health={health()} settings={settingsRow()} humanOnlyKinds={[...humanOnly]} kinds={PROPOSAL_KINDS} isPending={false} error={null} onSave={onSave} now={NOW} />);
    const budget = screen.getByRole("radiogroup", { name: "Budget mode" });
    expect(within(budget).queryByLabelText("AUTO")).not.toBeInTheDocument();
    const negatives = screen.getByRole("radiogroup", { name: "Negative keywords mode" });
    fireEvent.click(within(negatives).getByLabelText("AUTO"));
    expect(onSave).toHaveBeenCalledWith({ modes: { add_negatives: "auto" } });
  });

  it("saves changed caps as one patch", () => {
    const onSave = vi.fn();
    render(<EngineHealth health={health()} settings={settingsRow()} humanOnlyKinds={[...humanOnly]} kinds={PROPOSAL_KINDS} isPending={false} error={null} onSave={onSave} now={NOW} />);
    expect(screen.queryByRole("button", { name: "SAVE" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Daily cap"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(onSave).toHaveBeenCalledWith({ daily_cap: 55 });
  });
});
