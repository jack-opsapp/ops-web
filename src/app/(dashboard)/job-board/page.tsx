"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  CalendarDays,
  GripVertical,
  Plus,
  Clock,
  DollarSign,
  X,
  ListFilter,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DndContext,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay as DndDragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ColumnId = "rfq" | "estimated" | "accepted" | "in-progress" | "completed";

interface JobCard {
  id: string;
  name: string;
  client: string;
  teamMembers: string[];
  date?: string;
  endDate?: string;
  taskCount: number;
  completedTasks: number;
  value: number;
  daysInStage: number;
}

interface Column {
  id: ColumnId;
  label: string;
  color: string;
  borderColor: string;
  bgAccent: string;
  cards: JobCard[];
}

// ---------------------------------------------------------------------------
// Placeholder Data
// ---------------------------------------------------------------------------
const initialColumns: Column[] = [
  {
    id: "rfq",
    label: "RFQ",
    color: "text-status-rfq",
    borderColor: "border-t-status-rfq",
    bgAccent: "bg-status-rfq",
    cards: [
      {
        id: "j1",
        name: "Deck Repair & Staining",
        client: "Bob Johnson",
        teamMembers: ["Mike D"],
        date: "Mar 1",
        endDate: "Mar 15",
        taskCount: 4,
        completedTasks: 0,
        value: 3200,
        daysInStage: 3,
      },
      {
        id: "j2",
        name: "Fence Installation",
        client: "Tom Clark",
        teamMembers: [],
        date: "Mar 5",
        endDate: "Mar 12",
        taskCount: 3,
        completedTasks: 0,
        value: 4800,
        daysInStage: 1,
      },
      {
        id: "j13",
        name: "Patio Concrete Pour",
        client: "Nancy Green",
        teamMembers: ["Tom B"],
        date: "Mar 10",
        endDate: "Mar 18",
        taskCount: 5,
        completedTasks: 0,
        value: 6200,
        daysInStage: 2,
      },
    ],
  },
  {
    id: "estimated",
    label: "Estimated",
    color: "text-status-estimated",
    borderColor: "border-t-status-estimated",
    bgAccent: "bg-status-estimated",
    cards: [
      {
        id: "j3",
        name: "Bathroom Remodel",
        client: "Jane Doe",
        teamMembers: ["Tom B"],
        date: "Feb 10",
        endDate: "Apr 15",
        taskCount: 12,
        completedTasks: 0,
        value: 18500,
        daysInStage: 5,
      },
      {
        id: "j7",
        name: "Garage Conversion",
        client: "Phil Morris",
        teamMembers: ["Mike D", "Tom B"],
        date: "Mar 20",
        endDate: "May 1",
        taskCount: 9,
        completedTasks: 0,
        value: 22000,
        daysInStage: 7,
      },
      {
        id: "j8",
        name: "Roof Repair",
        client: "Linda Chen",
        teamMembers: ["Chris P"],
        date: "Mar 8",
        endDate: "Mar 14",
        taskCount: 4,
        completedTasks: 0,
        value: 5600,
        daysInStage: 4,
      },
      {
        id: "j14",
        name: "Window Replacement",
        client: "David Kim",
        teamMembers: ["Sarah L"],
        date: "Mar 15",
        endDate: "Mar 22",
        taskCount: 6,
        completedTasks: 0,
        value: 8900,
        daysInStage: 2,
      },
    ],
  },
  {
    id: "accepted",
    label: "Accepted",
    color: "text-status-accepted",
    borderColor: "border-t-status-accepted",
    bgAccent: "bg-status-accepted",
    cards: [
      {
        id: "j4",
        name: "Deck Installation",
        client: "Bob Johnson",
        teamMembers: ["Mike D", "Chris P"],
        date: "Mar 1",
        endDate: "Mar 20",
        taskCount: 8,
        completedTasks: 2,
        value: 12500,
        daysInStage: 4,
      },
      {
        id: "j9",
        name: "Driveway Resurface",
        client: "Mark Spencer",
        teamMembers: ["Tom B", "Sarah L"],
        date: "Mar 3",
        endDate: "Mar 10",
        taskCount: 5,
        completedTasks: 1,
        value: 7800,
        daysInStage: 2,
      },
      {
        id: "j15",
        name: "Basement Waterproofing",
        client: "Rachel Adams",
        teamMembers: ["Mike D"],
        date: "Mar 12",
        endDate: "Mar 25",
        taskCount: 7,
        completedTasks: 0,
        value: 9400,
        daysInStage: 1,
      },
    ],
  },
  {
    id: "in-progress",
    label: "In Progress",
    color: "text-status-in-progress",
    borderColor: "border-t-status-in-progress",
    bgAccent: "bg-status-in-progress",
    cards: [
      {
        id: "j5",
        name: "Kitchen Renovation",
        client: "John Smith",
        teamMembers: ["Mike D", "Sarah L"],
        date: "Feb 1",
        endDate: "Mar 30",
        taskCount: 15,
        completedTasks: 9,
        value: 34000,
        daysInStage: 12,
      },
      {
        id: "j10",
        name: "Office Buildout",
        client: "Tech Solutions Inc",
        teamMembers: ["Chris P", "Mike D", "Tom B"],
        date: "Feb 15",
        endDate: "Apr 10",
        taskCount: 18,
        completedTasks: 7,
        value: 45000,
        daysInStage: 8,
      },
      {
        id: "j11",
        name: "Landscape Hardscape",
        client: "Susan Roberts",
        teamMembers: ["Tom B", "Sarah L"],
        date: "Feb 20",
        endDate: "Mar 15",
        taskCount: 10,
        completedTasks: 6,
        value: 15200,
        daysInStage: 5,
      },
      {
        id: "j16",
        name: "HVAC Ductwork",
        client: "Martin Properties LLC",
        teamMembers: ["Chris P"],
        date: "Mar 1",
        endDate: "Mar 18",
        taskCount: 6,
        completedTasks: 2,
        value: 11300,
        daysInStage: 3,
      },
    ],
  },
  {
    id: "completed",
    label: "Completed",
    color: "text-status-completed",
    borderColor: "border-t-status-completed",
    bgAccent: "bg-status-completed",
    cards: [
      {
        id: "j6",
        name: "Plumbing Repair",
        client: "Alice Williams",
        teamMembers: ["Tom B"],
        date: "Jan 18",
        endDate: "Jan 25",
        taskCount: 3,
        completedTasks: 3,
        value: 2400,
        daysInStage: 0,
      },
      {
        id: "j12",
        name: "Exterior Painting",
        client: "Greg Martinez",
        teamMembers: ["Sarah L", "Chris P"],
        date: "Jan 10",
        endDate: "Feb 5",
        taskCount: 6,
        completedTasks: 6,
        value: 8900,
        daysInStage: 0,
      },
      {
        id: "j17",
        name: "Flooring Install",
        client: "Kate Wilson",
        teamMembers: ["Mike D", "Tom B"],
        date: "Jan 28",
        endDate: "Feb 12",
        taskCount: 5,
        completedTasks: 5,
        value: 6700,
        daysInStage: 0,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sortable Kanban Card
// ---------------------------------------------------------------------------
function SortableKanbanCard({
  card,
  columnColor,
  isDraggingOverlay,
}: {
  card: JobCard;
  columnColor: string;
  isDraggingOverlay?: boolean;
}) {
  const router = useRouter();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const taskProgress =
    card.taskCount > 0 ? Math.round((card.completedTasks / card.taskCount) * 100) : 0;

  return (
    <div
      ref={setNodeRef}
      style={isDraggingOverlay ? undefined : style}
      className={cn(
        "bg-background-card-dark border border-border rounded p-1.5",
        "cursor-pointer transition-all duration-150",
        "group",
        isDragging && !isDraggingOverlay && "opacity-30 scale-[0.98]",
        isDraggingOverlay &&
          "shadow-glow-accent-lg border-ops-accent/60 scale-[1.02] rotate-[1deg]",
        !isDragging &&
          !isDraggingOverlay &&
          "hover:border-ops-accent/50 hover:shadow-glow-accent"
      )}
      onClick={() => {
        if (!isDragging) router.push(`/projects/${card.id}`);
      }}
    >
      {/* Top row: drag handle + name */}
      <div className="flex items-start gap-[6px]">
        <div
          {...attributes}
          {...listeners}
          className="mt-[2px] cursor-grab active:cursor-grabbing touch-none"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-[14px] h-[14px] text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-mohave text-body-sm text-text-primary truncate">{card.name}</h4>
          <p className="font-kosugi text-[10px] text-text-tertiary">{card.client}</p>
        </div>
        {card.value > 0 && (
          <span className="font-mono text-[10px] text-ops-amber shrink-0">
            ${(card.value / 1000).toFixed(1)}k
          </span>
        )}
      </div>

      {/* Task progress bar */}
      {card.taskCount > 0 && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className="flex-1 h-[3px] bg-background-elevated rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                taskProgress === 100 ? "bg-status-success" : "bg-ops-accent"
              )}
              style={{ width: `${taskProgress}%` }}
            />
          </div>
          <span className="font-mono text-[9px] text-text-disabled shrink-0">
            {card.completedTasks}/{card.taskCount}
          </span>
        </div>
      )}

      {/* Bottom row: avatars, date */}
      <div className="flex items-center justify-between mt-1">
        {/* Team avatars */}
        <div className="flex items-center -space-x-[4px]">
          {card.teamMembers.length > 0 ? (
            card.teamMembers.slice(0, 3).map((member, i) => (
              <div
                key={i}
                className="w-[20px] h-[20px] rounded-full bg-ops-accent-muted border border-background-card-dark flex items-center justify-center"
                title={member}
              >
                <span className="font-mohave text-[9px] text-ops-accent">
                  {member.charAt(0)}
                </span>
              </div>
            ))
          ) : (
            <span className="font-kosugi text-[9px] text-text-disabled">Unassigned</span>
          )}
          {card.teamMembers.length > 3 && (
            <div className="w-[20px] h-[20px] rounded-full bg-background-elevated border border-background-card-dark flex items-center justify-center">
              <span className="font-mono text-[8px] text-text-disabled">
                +{card.teamMembers.length - 3}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-[6px]">
          {card.daysInStage > 0 && (
            <div
              className="flex items-center gap-[2px]"
              title={`${card.daysInStage} days in this stage`}
            >
              <Clock className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[9px] text-text-disabled">{card.daysInStage}d</span>
            </div>
          )}
          {card.date && (
            <div className="flex items-center gap-[3px] text-text-disabled">
              <CalendarDays className="w-[10px] h-[10px]" />
              <span className="font-mono text-[9px]">
                {card.date}
                {card.endDate ? ` - ${card.endDate}` : ""}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable Column
// ---------------------------------------------------------------------------
function KanbanColumn({
  column,
  activeCardId,
}: {
  column: Column;
  activeCardId: string | null;
}) {
  const totalValue = column.cards.reduce((sum, c) => sum + c.value, 0);
  const avgDays =
    column.cards.length > 0
      ? Math.round(column.cards.reduce((sum, c) => sum + c.daysInStage, 0) / column.cards.length)
      : 0;

  return (
    <div className={cn("flex flex-col min-w-[280px] max-w-[320px] w-full")}>
      {/* Column header */}
      <div
        className={cn(
          "border-t-2 rounded-t-sm px-1.5 py-1 bg-background-panel border border-border border-b-0",
          column.borderColor
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3
              className={cn(
                "font-mohave text-body font-medium uppercase tracking-wider",
                column.color
              )}
            >
              {column.label}
            </h3>
            <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm">
              {column.cards.length}
            </span>
          </div>
          <button className="p-[4px] rounded text-text-disabled hover:text-text-tertiary hover:bg-background-elevated transition-colors">
            <Plus className="w-[14px] h-[14px]" />
          </button>
        </div>

        {/* Column stats */}
        <div className="flex items-center gap-2 mt-[4px]">
          <div className="flex items-center gap-[3px]">
            <DollarSign className="w-[10px] h-[10px] text-text-disabled" />
            <span className="font-mono text-[10px] text-text-disabled">
              ${(totalValue / 1000).toFixed(1)}k
            </span>
          </div>
          {avgDays > 0 && (
            <div className="flex items-center gap-[3px]">
              <Clock className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[10px] text-text-disabled">avg {avgDays}d</span>
            </div>
          )}
        </div>
      </div>

      {/* Cards area */}
      <SortableContext
        items={column.cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 bg-background-panel/50 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px]">
          {column.cards.map((card) => (
            <SortableKanbanCard
              key={card.id}
              card={card}
              columnColor={column.color}
            />
          ))}

          {column.cards.length === 0 && (
            <div className="flex flex-col items-center justify-center h-[120px] border border-dashed border-border-subtle rounded gap-1">
              <div className="w-[32px] h-[32px] rounded-full bg-background-elevated flex items-center justify-center">
                <LayoutGrid className="w-[14px] h-[14px] text-text-disabled" />
              </div>
              <span className="font-kosugi text-[11px] text-text-disabled">
                No projects in this stage
              </span>
              <span className="font-kosugi text-[9px] text-text-disabled">
                Drop here to move
              </span>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------
function FilterBar({
  searchQuery,
  setSearchQuery,
  clientFilter,
  setClientFilter,
  allClients,
  showFilters,
  setShowFilters,
  totalProjects,
  totalValue,
}: {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  clientFilter: string;
  setClientFilter: (v: string) => void;
  allClients: string[];
  showFilters: boolean;
  setShowFilters: (v: boolean) => void;
  totalProjects: number;
  totalValue: number;
}) {
  return (
    <div className="shrink-0 space-y-1">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
            JOB BOARD
          </h1>
          <div className="flex items-center gap-2">
            <p className="font-kosugi text-caption-sm text-text-tertiary">
              Drag and drop to update project status
            </p>
            <span className="font-mono text-[11px] text-text-disabled">
              {totalProjects} projects
            </span>
            <span className="font-mono text-[11px] text-ops-amber">
              ${(totalValue / 1000).toFixed(1)}k total
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="max-w-[250px]">
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              prefixIcon={<Search className="w-[16px] h-[16px]" />}
              suffixIcon={
                searchQuery ? (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-text-disabled hover:text-text-tertiary cursor-pointer"
                  >
                    <X className="w-[14px] h-[14px]" />
                  </button>
                ) : undefined
              }
            />
          </div>
          <Button
            variant={showFilters ? "default" : "secondary"}
            size="sm"
            className="gap-[6px]"
            onClick={() => setShowFilters(!showFilters)}
          >
            <ListFilter className="w-[14px] h-[14px]" />
            Filter
          </Button>
          <Button variant="default" size="sm" className="gap-[6px]">
            <Plus className="w-[14px] h-[14px]" />
            New Project
          </Button>
        </div>
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <Card className="p-1.5 animate-slide-up">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                Client
              </span>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className={cn(
                  "bg-background-input text-text-primary font-mohave text-body-sm",
                  "px-1.5 py-[6px] rounded border border-border",
                  "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
                  "cursor-pointer"
                )}
              >
                <option value="">All Clients</option>
                {allClients.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
            </div>

            {(clientFilter || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-[4px] text-ops-error"
                onClick={() => {
                  setClientFilter("");
                  setSearchQuery("");
                }}
              >
                <X className="w-[12px] h-[12px]" />
                Clear Filters
              </Button>
            )}

            {/* Active filter badges */}
            {clientFilter && (
              <Badge variant="info" className="gap-[4px]">
                Client: {clientFilter}
                <button
                  onClick={() => setClientFilter("")}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="w-[10px] h-[10px]" />
                </button>
              </Badge>
            )}
            {searchQuery && (
              <Badge variant="info" className="gap-[4px]">
                Search: &quot;{searchQuery}&quot;
                <button
                  onClick={() => setSearchQuery("")}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="w-[10px] h-[10px]" />
                </button>
              </Badge>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job Board Page
// ---------------------------------------------------------------------------
export default function JobBoardPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  // Pointer sensor with small activation distance so clicks still work
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Collect all unique clients for the filter
  const allClients = useMemo(() => {
    const clients = new Set<string>();
    columns.forEach((col) => col.cards.forEach((c) => clients.add(c.client)));
    return Array.from(clients).sort();
  }, [columns]);

  // Filter cards
  const filteredColumns = useMemo(() => {
    return columns.map((col) => ({
      ...col,
      cards: col.cards.filter((card) => {
        const matchesSearch =
          !searchQuery.trim() ||
          card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          card.client.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesClient = !clientFilter || card.client === clientFilter;
        return matchesSearch && matchesClient;
      }),
    }));
  }, [columns, searchQuery, clientFilter]);

  // Total project count and value
  const totalProjects = columns.reduce((sum, col) => sum + col.cards.length, 0);
  const totalValue = columns.reduce(
    (sum, col) => sum + col.cards.reduce((s, c) => s + c.value, 0),
    0
  );

  // Find a card across all columns
  const findCard = useCallback(
    (cardId: string) => {
      for (const col of columns) {
        const card = col.cards.find((c) => c.id === cardId);
        if (card) return { card, columnId: col.id };
      }
      return null;
    },
    [columns]
  );

  // Find the active card for the drag overlay
  const activeCard = activeCardId ? findCard(activeCardId) : null;

  // Drag start handler
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  }, []);

  // Drag end handler - move card between columns
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveCardId(null);

      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Find source column and card
      let sourceColIndex = -1;
      let sourceCardIndex = -1;
      for (let i = 0; i < columns.length; i++) {
        const cardIdx = columns[i].cards.findIndex((c) => c.id === activeId);
        if (cardIdx !== -1) {
          sourceColIndex = i;
          sourceCardIndex = cardIdx;
          break;
        }
      }

      if (sourceColIndex === -1) return;

      // Determine destination: overId could be a card or column id
      let destColIndex = columns.findIndex((col) => col.id === overId);
      let destCardIndex = -1;

      if (destColIndex === -1) {
        // overId is a card, find its column
        for (let i = 0; i < columns.length; i++) {
          const cardIdx = columns[i].cards.findIndex((c) => c.id === overId);
          if (cardIdx !== -1) {
            destColIndex = i;
            destCardIndex = cardIdx;
            break;
          }
        }
      }

      if (destColIndex === -1) return;

      // Same column, same position
      if (sourceColIndex === destColIndex && destCardIndex === -1) return;
      if (
        sourceColIndex === destColIndex &&
        sourceCardIndex === destCardIndex
      )
        return;

      setColumns((prev) => {
        const newColumns = prev.map((col) => ({
          ...col,
          cards: [...col.cards],
        }));

        // Remove from source
        const [movedCard] = newColumns[sourceColIndex].cards.splice(sourceCardIndex, 1);

        // Update daysInStage when moving between columns
        if (sourceColIndex !== destColIndex) {
          movedCard.daysInStage = 0;
        }

        // Insert at destination
        if (destCardIndex === -1) {
          newColumns[destColIndex].cards.push(movedCard);
        } else {
          newColumns[destColIndex].cards.splice(destCardIndex, 0, movedCard);
        }

        return newColumns;
      });

      // In production, this would call the API:
      // await updateProjectStatus(activeId, columns[destColIndex].id);
    },
    [columns]
  );

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Filter Bar */}
      <FilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        clientFilter={clientFilter}
        setClientFilter={setClientFilter}
        allClients={allClients}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        totalProjects={totalProjects}
        totalValue={totalValue}
      />

      {/* Kanban Board with DnD */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto pb-2">
          <div className="flex gap-2 min-w-min">
            {filteredColumns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                activeCardId={activeCardId}
              />
            ))}
          </div>
        </div>

        {/* Drag Overlay */}
        <DndDragOverlay>
          {activeCard ? (
            <div className="w-[280px]">
              <SortableKanbanCard
                card={activeCard.card}
                columnColor=""
                isDraggingOverlay
              />
            </div>
          ) : null}
        </DndDragOverlay>
      </DndContext>

      {/* Bottom summary bar */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1 rounded bg-background-panel border border-border">
        <div className="flex items-center gap-3">
          {filteredColumns.map((col) => (
            <div key={col.id} className="flex items-center gap-[6px]">
              <span
                className={cn(
                  "w-[6px] h-[6px] rounded-full",
                  col.id === "rfq" && "bg-status-rfq",
                  col.id === "estimated" && "bg-status-estimated",
                  col.id === "accepted" && "bg-status-accepted",
                  col.id === "in-progress" && "bg-status-in-progress",
                  col.id === "completed" && "bg-status-completed"
                )}
              />
              <span className="font-mono text-[10px] text-text-disabled">
                {col.label}: {col.cards.length}
              </span>
            </div>
          ))}
        </div>
        <span className="font-kosugi text-[10px] text-text-disabled">
          Drag cards between columns to update status
        </span>
      </div>
    </div>
  );
}
