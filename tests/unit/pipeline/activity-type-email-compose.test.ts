import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_TYPE_COLORS,
  ActivityType,
} from "@/lib/types/pipeline";

const feedSource = readFileSync(
  path.join(
    process.cwd(),
    "src/components/dashboard/widgets/activity-feed-widget.tsx"
  ),
  "utf8"
);
const timelineSource = readFileSync(
  path.join(
    process.cwd(),
    "src/app/(dashboard)/pipeline/_components/pipeline-detail-timeline-tab.tsx"
  ),
  "utf8"
);
const english = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "src/i18n/dictionaries/en/dashboard.json"),
    "utf8"
  )
) as Record<string, string>;
const spanish = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "src/i18n/dictionaries/es/dashboard.json"),
    "utf8"
  )
) as Record<string, string>;

describe("local email-compose activity rendering", () => {
  it("keeps the provider-safe raw type intentionally email-shaped", () => {
    expect(ActivityType.EmailCompose).toBe("email_compose");
    expect(ACTIVITY_TYPE_COLORS[ActivityType.EmailCompose]).toBe(
      ACTIVITY_TYPE_COLORS[ActivityType.Email]
    );
    expect(feedSource).toContain(
      "[ActivityType.EmailCompose]: Mail"
    );
    expect(timelineSource).toMatch(
      /case ActivityType\.Email:\s*case ActivityType\.EmailCompose:\s*return Mail/
    );
  });

  it("has explicit labels in both shipped dictionaries", () => {
    expect(english["activity.type.email_compose"]).toBe("Email");
    expect(spanish["activity.type.email_compose"]).toBe("Correo");
  });
});
