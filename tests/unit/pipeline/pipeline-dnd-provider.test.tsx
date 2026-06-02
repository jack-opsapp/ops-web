import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OpportunityStage } from "@/lib/types/pipeline";
import {
  PipelineDndProvider,
  pipelineCollisionDetection,
  pipelineKeyboardCoordinates,
} from "@/app/(dashboard)/pipeline/_components/pipeline-dnd-provider";

const dndMocks = vi.hoisted(() => {
  const PointerSensor = function PointerSensor() {};
  const KeyboardSensor = function KeyboardSensor() {};
  type MockCollision = { id: string };

  return {
    PointerSensor,
    KeyboardSensor,
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors),
    pointerWithin: vi.fn((): MockCollision[] => []),
    closestCenter: vi.fn((): MockCollision[] => []),
  };
});

const sortableMocks = vi.hoisted(() => ({
  sortableKeyboardCoordinates: vi.fn(() => ({ x: 900, y: 900 })),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="dnd-context">{children}</div>,
  KeyboardCode: {
    Space: "Space",
    Down: "ArrowDown",
    Right: "ArrowRight",
    Left: "ArrowLeft",
    Up: "ArrowUp",
    Esc: "Escape",
    Enter: "Enter",
    Tab: "Tab",
  },
  KeyboardSensor: dndMocks.KeyboardSensor,
  PointerSensor: dndMocks.PointerSensor,
  closestCenter: dndMocks.closestCenter,
  pointerWithin: dndMocks.pointerWithin,
  useSensor: dndMocks.useSensor,
  useSensors: dndMocks.useSensors,
}));

vi.mock("@dnd-kit/sortable", () => ({
  sortableKeyboardCoordinates: sortableMocks.sortableKeyboardCoordinates,
}));

function makeKeyboardEvent(code: string) {
  return {
    code,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

function makeCollisionArgs(
  mode: "focused" | "table"
): Parameters<typeof pipelineCollisionDetection>[0] {
  return {
    active: {
      data: {
        current: { mode },
      },
    },
  } as unknown as Parameters<typeof pipelineCollisionDetection>[0];
}

function makeKeyboardArgs({
  mode = "focused",
  sourceStage = OpportunityStage.Quoted,
  overStage = null,
  droppables,
}: {
  mode?: "focused" | "table";
  sourceStage?: OpportunityStage;
  overStage?: OpportunityStage | null;
  droppables: Array<{
    id: string;
    stage: OpportunityStage;
    left: number;
    top: number;
  }>;
}): Parameters<typeof pipelineKeyboardCoordinates>[1] {
  const rects = new Map(
    droppables.map(({ id, left, top }) => [
      id,
      {
        left,
        top,
        right: left + 64,
        bottom: top + 120,
        width: 64,
        height: 120,
      },
    ])
  );
  const overDroppable = overStage
    ? droppables.find((droppable) => droppable.stage === overStage)
    : null;

  const args = {
    active: "opp-1",
    currentCoordinates: { x: 0, y: 0 },
    context: {
      activatorEvent: null,
      active: {
        id: "opp-1",
        data: {
          current: {
            mode,
            opportunity: { stage: sourceStage },
          },
        },
        rect: {
          current: {
            initial: null,
            translated: null,
          },
        },
      },
      activeNode: null,
      collisionRect: null,
      collisions: null,
      draggableNodes: new Map(),
      draggingNode: null,
      draggingNodeRect: null,
      droppableContainers: {
        getEnabled: () =>
          droppables.map(({ id, stage }) => ({
            id,
            key: id,
            disabled: false,
            node: { current: null },
            rect: { current: null },
            data: {
              current: {
                mode: "focused",
                stage,
              },
            },
          })),
      },
      droppableRects: rects,
      over: overDroppable
        ? {
            id: overDroppable.id,
            rect: rects.get(overDroppable.id)!,
            disabled: false,
            data: {
              current: {
                mode: "focused",
                stage: overDroppable.stage,
              },
            },
          }
        : null,
      scrollableAncestors: [],
      scrollAdjustedTranslate: null,
    },
  };

  return args as unknown as Parameters<typeof pipelineKeyboardCoordinates>[1];
}

describe("<PipelineDndProvider>", () => {
  beforeEach(() => {
    dndMocks.useSensor.mockClear();
    dndMocks.useSensors.mockClear();
    sortableMocks.sortableKeyboardCoordinates.mockClear();
  });

  it("registers pointer and keyboard sensors", () => {
    render(
      <PipelineDndProvider
        mode="focused"
        activeDragId={null}
        onDragStart={vi.fn()}
        onDragOver={vi.fn()}
        onDragEnd={vi.fn()}
        onDragCancel={vi.fn()}
      >
        <div>pipeline body</div>
      </PipelineDndProvider>
    );

    expect(screen.getByTestId("dnd-context")).toHaveTextContent(
      "pipeline body"
    );
    expect(dndMocks.useSensor).toHaveBeenCalledWith(
      dndMocks.PointerSensor,
      { activationConstraint: { distance: 5 } }
    );
    expect(dndMocks.useSensor).toHaveBeenCalledWith(
      dndMocks.KeyboardSensor,
      {
        coordinateGetter: pipelineKeyboardCoordinates,
        scrollBehavior: "auto",
      }
    );
  });

  it("uses pointer-only collisions for focused card drags", () => {
    dndMocks.pointerWithin.mockReturnValueOnce([]);
    dndMocks.closestCenter.mockReturnValueOnce([{ id: "nearest-stage" }]);

    expect(pipelineCollisionDetection(makeCollisionArgs("focused"))).toEqual(
      []
    );
    expect(dndMocks.closestCenter).not.toHaveBeenCalled();
  });

  it("keeps closest-center fallback for non-focused card drags", () => {
    dndMocks.pointerWithin.mockReturnValueOnce([]);
    dndMocks.closestCenter.mockReturnValueOnce([{ id: "nearest-stage" }]);

    expect(pipelineCollisionDetection(makeCollisionArgs("table"))).toEqual([
      { id: "nearest-stage" },
    ]);
    expect(dndMocks.closestCenter).toHaveBeenCalled();
  });

  it("maps focused keyboard drag to the next logical stage target", () => {
    const event = makeKeyboardEvent("ArrowRight");
    const result = pipelineKeyboardCoordinates(
      event,
      makeKeyboardArgs({
        sourceStage: OpportunityStage.Quoted,
        droppables: [
          {
            id: "focused-stage-follow-up",
            stage: OpportunityStage.FollowUp,
            left: 120,
            top: 20,
          },
          {
            id: "focused-stage-negotiation",
            stage: OpportunityStage.Negotiation,
            left: 220,
            top: 20,
          },
        ],
      })
    );

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result).toEqual({ x: 120, y: 20 });
  });

  it("steps from the hovered terminal item to the next terminal target", () => {
    const event = makeKeyboardEvent("ArrowDown");
    const result = pipelineKeyboardCoordinates(
      event,
      makeKeyboardArgs({
        sourceStage: OpportunityStage.Negotiation,
        overStage: OpportunityStage.Won,
        droppables: [
          {
            id: "focused-terminal-won",
            stage: OpportunityStage.Won,
            left: 320,
            top: 20,
          },
          {
            id: "focused-terminal-lost",
            stage: OpportunityStage.Lost,
            left: 320,
            top: 160,
          },
        ],
      })
    );

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result).toEqual({ x: 320, y: 160 });
  });

  it("delegates non-focused keyboard movement to dnd-kit sortable coordinates", () => {
    const event = makeKeyboardEvent("ArrowRight");
    const args = makeKeyboardArgs({
      mode: "table",
      droppables: [
        {
          id: "stage-follow-up",
          stage: OpportunityStage.FollowUp,
          left: 120,
          top: 20,
        },
      ],
    });

    const result = pipelineKeyboardCoordinates(event, args);

    expect(sortableMocks.sortableKeyboardCoordinates).toHaveBeenCalledWith(
      event,
      args
    );
    expect(result).toEqual({ x: 900, y: 900 });
  });
});
