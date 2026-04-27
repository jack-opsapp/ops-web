import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/hooks", () => ({
  useSendInvite: () => ({ mutate: vi.fn(), isPending: false }),
  useCompany: () => ({
    data: {
      companyCode: "ABC123",
      seatedEmployeeIds: Array.from({ length: 15 }, (_, i) => `u-${i}`),
      maxSeats: 5,
    },
  }),
  useRoles: () => ({
    data: [
      { id: "r-1", name: "Unassigned", description: "" },
      { id: "r-2", name: "Admin", description: "Full access" },
    ],
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/sms/phone-utils", () => ({
  normalizePhoneE164: (v: string) => v,
  formatPhoneNational: (v: string) => v,
  InvalidPhoneError: class extends Error {},
}));

const { InviteModal } = await import(
  "@/components/ops/invite-modal"
);

describe("InviteModal — post-cleanup", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <InviteModal open={true} onOpenChange={vi.fn()} />
    );
    expect(container).toBeTruthy();
  });

  it("does not render InviteModalSeatBanner even when company is over-capacity", () => {
    render(<InviteModal open={true} onOpenChange={vi.fn()} />);
    expect(screen.queryByText(/all seats in use/i)).toBeNull();
    expect(screen.queryByText(/seats remaining/i)).toBeNull();
    expect(screen.queryByText(/upgrade plan/i)).toBeNull();
  });

  it("does not contain any element with font-kosugi class", () => {
    const { container } = render(
      <InviteModal open={true} onOpenChange={vi.fn()} />
    );
    const kosugiElements = container.querySelectorAll(".font-kosugi");
    expect(kosugiElements.length).toBe(0);
  });
});
