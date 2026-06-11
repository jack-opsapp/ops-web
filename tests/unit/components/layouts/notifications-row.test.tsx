import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationRow } from "@/components/layouts/notifications-row";
import type { AppNotification } from "@/lib/api/services/notification-service";
import { NOTIF_TYPE_META } from "@/lib/notifications/notification-meta";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const baseNotif: AppNotification = {
  id: "n1",
  userId: "u1",
  companyId: "c1",
  type: "mention",
  title: "Marcus mentioned you",
  body: "On PROJ-00251 — Waiting on your quote.",
  projectId: null,
  noteId: null,
  isRead: false,
  persistent: false,
  actionUrl: "/dashboard?openProject=00251&mode=view",
  actionLabel: "OPEN",
  createdAt: new Date(Date.now() - 14 * 60_000),
};

const renderRow = (override: Partial<Parameters<typeof NotificationRow>[0]> = {}) =>
  render(
    <NotificationRow
      notification={baseNotif}
      meta={NOTIF_TYPE_META.mention}
      tone="attn"
      expanded={false}
      onRowClick={() => {}}
      onAction={() => {}}
      onDismiss={() => {}}
      {...override}
    />,
  );

describe("<NotificationRow>", () => {
  it("renders title and timestamp", () => {
    renderRow();
    expect(screen.getByText("Marcus mentioned you")).toBeInTheDocument();
    expect(screen.getByText(/^14m$/)).toBeInTheDocument();
  });

  it("reveals the action button and dismiss × on hover (collapsed)", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderRow({ onAction });
    // At rest the controls are hidden — the timestamp shows instead.
    expect(screen.queryByRole("button", { name: /OPEN/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^14m$/)).toBeInTheDocument();
    await user.hover(screen.getByText("Marcus mentioned you"));
    // fireEvent: userEvent's pointer walk re-renders the row mid-sequence
    // (hover state), detaching the freshly revealed button node.
    fireEvent.click(screen.getByRole("button", { name: /OPEN/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /row\.dismissAriaLabel/i }),
    ).toBeInTheDocument();
  });

  it("does NOT reveal a hover dismiss for persistent notifications", async () => {
    const user = userEvent.setup();
    renderRow({ notification: { ...baseNotif, persistent: true } });
    await user.hover(screen.getByText("Marcus mentioned you"));
    expect(
      screen.queryByRole("button", { name: /row\.dismissAriaLabel/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render body or action buttons when collapsed", () => {
    renderRow({ expanded: false });
    expect(screen.queryByText(/waiting on your quote/i)).not.toBeInTheDocument();
  });

  it("shows body + action button + dismiss button when expanded", () => {
    renderRow({ expanded: true });
    expect(screen.getByText(/waiting on your quote/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /OPEN/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /row\.dismiss/i })).toBeInTheDocument();
  });

  it("fires onRowClick when clicked", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    renderRow({ onRowClick });
    await user.click(screen.getByText("Marcus mentioned you"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("fires onAction when action button clicked and stops propagation", async () => {
    const onAction = vi.fn();
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    renderRow({ expanded: true, onAction, onRowClick });
    await user.click(screen.getByRole("button", { name: /OPEN/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("fires onDismiss when dismiss button clicked", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderRow({ expanded: true, onDismiss });
    await user.click(screen.getByRole("button", { name: /row\.dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith("n1");
  });

  it("does NOT render dismiss button when notification is persistent", () => {
    renderRow({
      expanded: true,
      notification: { ...baseNotif, persistent: true },
    });
    expect(screen.queryByRole("button", { name: /row\.dismiss/i })).not.toBeInTheDocument();
  });

  it("does not render a snooze control (cut until snooze ships)", () => {
    renderRow({ expanded: true });
    expect(screen.queryByText(/row\.snooze/i)).not.toBeInTheDocument();
  });

  it("translates i18n-keyed title via useDictionary('common')", () => {
    renderRow({
      notification: { ...baseNotif, title: "notification.mention.title" },
    });
    expect(screen.getByText("notification.mention.title")).toBeInTheDocument();
  });
});
