/**
 * Component tests for the "How'd you find us" question on the web company step
 * (Unified Attribution P2).
 *
 * The contract that matters is that this question is genuinely optional: it
 * must never gate Continue, and the user must be able to un-answer it. Those
 * are behavioural, so they are asserted here rather than eyeballed.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IdentityStep2 } from "@/components/setup/SetupIdentityStep";
import { REFERRAL_SOURCES } from "@/lib/data/referral-sources";

function renderStep(referralMethod = "") {
  const onUpdate = vi.fn();
  render(
    <IdentityStep2
      companyName="Smith Roofing Co."
      industries={[]}
      companySize=""
      companyAge=""
      weatherDependent=""
      referralMethod={referralMethod}
      onUpdate={onUpdate}
    />
  );
  return { onUpdate };
}

describe("Company step — how'd you find us", () => {
  it("renders the question labelled as optional", () => {
    renderStep();
    expect(screen.getByText(/HOW'D YOU FIND US\? \(OPTIONAL\)/i)).toBeInTheDocument();
  });

  it("renders every referral option", () => {
    renderStep();
    for (const src of REFERRAL_SOURCES) {
      expect(
        screen.getByRole("button", { name: src.label })
      ).toBeInTheDocument();
    }
  });

  it("reports the SLUG (not the label) when an option is picked", () => {
    // Storing the slug is what keeps historical data aggregatable when the
    // copy changes.
    const { onUpdate } = renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Someone told me" }));
    expect(onUpdate).toHaveBeenCalledWith({ referralMethod: "word_of_mouth" });
  });

  it("clears the answer when the selected option is tapped again", () => {
    // Deselection IS the skip — there is no separate skip control.
    const { onUpdate } = renderStep("google");
    fireEvent.click(screen.getByRole("button", { name: "Google" }));
    expect(onUpdate).toHaveBeenCalledWith({ referralMethod: "" });
  });

  it("marks only the selected option as pressed", () => {
    renderStep("instagram");
    expect(screen.getByRole("button", { name: "Instagram" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Facebook" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("exposes the group to assistive tech as optional", () => {
    renderStep();
    expect(
      screen.getByRole("group", { name: /how you found us, optional/i })
    ).toBeInTheDocument();
  });

  it("renders no required-field affordance on the question", () => {
    // Nothing here may gate Continue. The question owns no error slot, no
    // asterisk, and no validation state.
    const { onUpdate } = renderStep();
    const group = screen.getByRole("group", { name: /how you found us, optional/i });
    expect(group.textContent).not.toMatch(/\*|required/i);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
