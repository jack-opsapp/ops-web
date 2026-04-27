/**
 * Snapshot suite — every typed React Email template renders to non-empty
 * HTML, contains the brand markers (Mohave webfont), and is free of retired
 * fonts (Kosugi, Bebas). Each template is rendered with the `PreviewProps`
 * fixture it exposes for the react-email dev tool — the same fixture the
 * preview UI uses, so we test the same rendering path operators preview.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { AdsBriefing } from "@/lib/email/react/templates/AdsBriefing";
import { BetaAccessDecision } from "@/lib/email/react/templates/BetaAccessDecision";
import { BetaAccessRequest } from "@/lib/email/react/templates/BetaAccessRequest";
import { BlogNewsletter } from "@/lib/email/react/templates/BlogNewsletter";
import { EmailChangeConfirmation } from "@/lib/email/react/templates/EmailChangeConfirmation";
import { EmailVerification } from "@/lib/email/react/templates/EmailVerification";
import { FieldNotesNewsletter } from "@/lib/email/react/templates/FieldNotesNewsletter";
import { PasswordReset } from "@/lib/email/react/templates/PasswordReset";
import { PortalEstimateReady } from "@/lib/email/react/templates/PortalEstimateReady";
import { PortalInvoiceReady } from "@/lib/email/react/templates/PortalInvoiceReady";
import { PortalMagicLink } from "@/lib/email/react/templates/PortalMagicLink";
import { PortalQuestionsReminder } from "@/lib/email/react/templates/PortalQuestionsReminder";
import { RoleNeeded } from "@/lib/email/react/templates/RoleNeeded";
import { TeamInvite } from "@/lib/email/react/templates/TeamInvite";
import { TrialExpiryDiscount } from "@/lib/email/react/templates/TrialExpiryDiscount";
import { TrialExpiryReengagement } from "@/lib/email/react/templates/TrialExpiryReengagement";
import { TrialExpiryWarning } from "@/lib/email/react/templates/TrialExpiryWarning";

const templates = [
  ["AdsBriefing", AdsBriefing],
  ["BetaAccessDecision", BetaAccessDecision],
  ["BetaAccessRequest", BetaAccessRequest],
  ["BlogNewsletter", BlogNewsletter],
  ["EmailChangeConfirmation", EmailChangeConfirmation],
  ["EmailVerification", EmailVerification],
  ["FieldNotesNewsletter", FieldNotesNewsletter],
  ["PasswordReset", PasswordReset],
  ["PortalEstimateReady", PortalEstimateReady],
  ["PortalInvoiceReady", PortalInvoiceReady],
  ["PortalMagicLink", PortalMagicLink],
  ["PortalQuestionsReminder", PortalQuestionsReminder],
  ["RoleNeeded", RoleNeeded],
  ["TeamInvite", TeamInvite],
  ["TrialExpiryDiscount", TrialExpiryDiscount],
  ["TrialExpiryReengagement", TrialExpiryReengagement],
  ["TrialExpiryWarning", TrialExpiryWarning],
] as const;

describe("Email template snapshots", () => {
  for (const [name, Component] of templates) {
    it(`${name} renders with PreviewProps and brand markers`, async () => {
      // Each template attaches a `PreviewProps` fixture for the react-email
      // preview tool. Use it as the canonical render fixture so the snapshot
      // covers the same shape an operator previews.
      const previewProps = (Component as unknown as { PreviewProps: object })
        .PreviewProps;
      const element = (
        Component as unknown as (p: object) => React.ReactElement
      )(previewProps);
      const html = await render(element, { pretty: false });

      expect(html.length).toBeGreaterThan(500);
      expect(html).toContain("Mohave");
      expect(html).not.toMatch(/Kosugi/i);
      expect(html).not.toMatch(/Bebas/i);
      expect(html).toMatchSnapshot();
    });
  }
});
