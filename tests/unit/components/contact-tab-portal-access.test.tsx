/**
 * The client dossier's CONTACT tab mounts the "Portal access" block for the
 * open client, beneath sub-contacts and above notes.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: <T,>(selector: (s: { can: () => boolean }) => T) =>
    selector({ can: () => true }),
}));
vi.mock("@/lib/hooks", () => ({
  useSubClients: () => ({ data: [] }),
  useCreateSubClient: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSubClient: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/clients/portal-access-block", () => ({
  PortalAccessBlock: ({ clientId }: { clientId: string }) => (
    <section data-testid="portal-access-block" data-client-id={clientId} />
  ),
}));

import { ContactTab } from "@/components/ops/clients/workspace/viewing/contact-tab";
import type { Client } from "@/lib/types/models";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

describe("ContactTab — portal access mount", () => {
  it("mounts the portal access block for the open client between sub-contacts and notes", () => {
    const client = { id: CLIENT_ID, name: "Maverick Homeowner", notes: "" } as unknown as Client;
    render(<ContactTab client={client} clientId={CLIENT_ID} />);

    const block = screen.getByTestId("portal-access-block");
    expect(block).toHaveAttribute("data-client-id", CLIENT_ID);

    const sections = Array.from(document.querySelectorAll("section"));
    const subContacts = sections.findIndex((s) => s.textContent?.includes("window.section.subContacts"));
    const notes = sections.findIndex((s) => s.textContent?.includes("window.section.notes"));
    const portal = sections.indexOf(block as HTMLElement);
    expect(subContacts).toBeGreaterThanOrEqual(0);
    expect(notes).toBeGreaterThan(portal);
    expect(portal).toBeGreaterThan(subContacts);
  });
});
