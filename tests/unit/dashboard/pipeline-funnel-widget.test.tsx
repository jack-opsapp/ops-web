import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { ProjectStatus, type Project } from "@/lib/types/models";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "pipelineFunnel.title": "Pipeline",
        "pipelineFunnel.weighted": "Weighted",
        "pipelineFunnel.ofPipeline": "Of pipeline",
        "trend.active": "Active",
        "trend.all": "All",
        "stat.statusRfq": "RFQ",
        "stat.statusEstimated": "Estimated",
        "stat.statusAccepted": "Accepted",
        "stat.statusInProgress": "In progress",
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock("@/lib/hooks/use-forecast", () => ({
  useWeightedPipelineValue: () => ({
    data: { totalWeighted: 24_680 },
  }),
}));

vi.mock(
  "@/components/dashboard/widgets/shared/use-widget-intersection",
  () => ({
    useWidgetIntersection: () => true,
  })
);

vi.mock("@/components/dashboard/widgets/shared/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

vi.mock("@/components/dashboard/widgets/shared/use-widget-entity-open", () => ({
  useWidgetEntityOpen: () => vi.fn(),
}));

import { PipelineFunnelWidget } from "@/components/dashboard/widgets/pipeline-funnel-widget";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const ACTIVE_PROJECT = {
  id: "project-1",
  title: "Broadway re-roof",
  address: "101 Broadway",
  status: ProjectStatus.RFQ,
  deletedAt: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
} as Project;

afterEach(() => {
  cleanup();
});

describe("PipelineFunnelWidget", () => {
  it.each(["xs", "sm", "md", "lg"] satisfies WidgetSize[])(
    "does not render weighted pipeline value at %s size",
    (size) => {
      render(
        <PipelineFunnelWidget
          size={size}
          projects={[ACTIVE_PROJECT]}
          isLoading={false}
          onNavigate={vi.fn()}
        />
      );

      expect(screen.queryByText(/Weighted/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/\$24\.7K/i)).not.toBeInTheDocument();
    }
  );
});
