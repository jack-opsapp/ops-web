"use client";

import * as React from "react";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Body } from "@/components/ops/projects/workspace/atoms/body";

// `ScheduleTab` — workspace edit/create schedule surface.
//
// Phase 8.1 lands this component as a section shell so the composer's
// import resolves. Phase 8.3 fills in the real fields (start/end/duration
// grid + visibility segmented control) wired to the shared form context
// via useFormContext().

export function ScheduleTab() {
  return (
    <Section title="SCHEDULE" data-testid="schedule-tab">
      <Body size={12} color="text-3">
        Schedule fields land in 8.3.
      </Body>
    </Section>
  );
}

ScheduleTab.displayName = "ScheduleTab";
