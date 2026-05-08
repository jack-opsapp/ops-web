"use client";

import * as React from "react";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Body } from "@/components/ops/projects/workspace/atoms/body";

// `IdentityTab` — workspace edit/create identity surface.
//
// Phase 8.1 lands this component as a section shell so the composer's
// import resolves. Phase 8.2 fills in the real fields (project name,
// client picker, site address, description) wired to the shared form
// context via useFormContext().

export function IdentityTab() {
  return (
    <Section title="IDENTITY" data-testid="identity-tab">
      <Body size={12} color="text-3">
        Identity fields land in 8.2.
      </Body>
    </Section>
  );
}

IdentityTab.displayName = "IdentityTab";
