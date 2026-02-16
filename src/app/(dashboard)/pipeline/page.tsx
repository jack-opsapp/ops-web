"use client";

import { useState, useCallback, useMemo, useRef, type DragEvent } from "react";
import {
  Search,
  Plus,
  Clock,
  DollarSign,
  X,
  ListFilter,
  User,
  Phone,
  Globe,
  DoorOpen,
  Users,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Calendar,
  MessageSquare,
  Target,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PipelineStage = "lead" | "contacted" | "quote-sent" | "negotiating" | "won" | "lost";

type LeadSource = "referral" | "website" | "door-knock" | "social-media" | "cold-call" | "repeat-client";

interface PipelineLead {
  id: string;
  clientName: string;
  estimatedValue: number;
  source: LeadSource;
  daysInStage: number;
  assignedTo: string;
  lastActivityDate: string;
  email?: string;
  phone?: string;
  notes?: string;
  projectType?: string;
}

interface PipelineColumn {
  id: PipelineStage;
  label: string;
  color: string;
  borderColor: string;
  bgAccent: string;
  textColor: string;
  cards: PipelineLead[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SOURCE_LABELS: Record<LeadSource, string> = {
  referral: "Referral",
  website: "Website",
  "door-knock": "Door Knock",
  "social-media": "Social Media",
  "cold-call": "Cold Call",
  "repeat-client": "Repeat Client",
};

const SOURCE_ICONS: Record<LeadSource, React.ReactNode> = {
  referral: <Users className="w-[10px] h-[10px]" />,
  website: <Globe className="w-[10px] h-[10px]" />,
  "door-knock": <DoorOpen className="w-[10px] h-[10px]" />,
  "social-media": <MessageSquare className="w-[10px] h-[10px]" />,
  "cold-call": <Phone className="w-[10px] h-[10px]" />,
  "repeat-client": <User className="w-[10px] h-[10px]" />,
};

// ---------------------------------------------------------------------------
// Placeholder Data
// ---------------------------------------------------------------------------
const initialColumns: PipelineColumn[] = [
  {
    id: "lead",
    label: "Lead",
    color: "text-[#6B7280]",
    borderColor: "border-t-[#6B7280]",
    bgAccent: "bg-[#6B7280]",
    textColor: "#6B7280",
    cards: [
      {
        id: "l1",
        clientName: "Marcus Rivera",
        estimatedValue: 8500,
        source: "website",
        daysInStage: 1,
        assignedTo: "Sarah L",
        lastActivityDate: "Feb 14",
        projectType: "Kitchen Remodel",
        notes: "Submitted inquiry form, wants quote within the week",
      },
      {
        id: "l2",
        clientName: "Jennifer Park",
        estimatedValue: 3200,
        source: "referral",
        daysInStage: 0,
        assignedTo: "Unassigned",
        lastActivityDate: "Feb 15",
        projectType: "Deck Installation",
        notes: "Referred by Bob Johnson",
      },
      {
        id: "l3",
        clientName: "Tony Vasquez",
        estimatedValue: 15000,
        source: "door-knock",
        daysInStage: 2,
        assignedTo: "Mike D",
        lastActivityDate: "Feb 13",
        projectType: "Full Bathroom Reno",
      },
      {
        id: "l14",
        clientName: "Diane Foster",
        estimatedValue: 4200,
        source: "social-media",
        daysInStage: 1,
        assignedTo: "Unassigned",
        lastActivityDate: "Feb 14",
        projectType: "Fence Repair",
      },
    ],
  },
  {
    id: "contacted",
    label: "Contacted",
    color: "text-[#D97706]",
    borderColor: "border-t-[#D97706]",
    bgAccent: "bg-[#D97706]",
    textColor: "#D97706",
    cards: [
      {
        id: "l4",
        clientName: "Rachel Adams",
        estimatedValue: 12000,
        source: "referral",
        daysInStage: 3,
        assignedTo: "Sarah L",
        lastActivityDate: "Feb 12",
        projectType: "Basement Finishing",
        phone: "(555) 234-5678",
        notes: "Called twice, scheduled site visit for next week",
      },
      {
        id: "l5",
        clientName: "David Kim",
        estimatedValue: 6800,
        source: "website",
        daysInStage: 5,
        assignedTo: "Mike D",
        lastActivityDate: "Feb 10",
        projectType: "Window Replacement",
        email: "david.kim@email.com",
      },
      {
        id: "l15",
        clientName: "Paul Henderson",
        estimatedValue: 9500,
        source: "cold-call",
        daysInStage: 2,
        assignedTo: "Chris P",
        lastActivityDate: "Feb 13",
        projectType: "Roof Repair",
      },
    ],
  },
  {
    id: "quote-sent",
    label: "Quote Sent",
    color: "text-ops-accent",
    borderColor: "border-t-ops-accent",
    bgAccent: "bg-ops-accent",
    textColor: "#417394",
    cards: [
      {
        id: "l6",
        clientName: "Linda Chen",
        estimatedValue: 22500,
        source: "repeat-client",
        daysInStage: 4,
        assignedTo: "Sarah L",
        lastActivityDate: "Feb 11",
        projectType: "Office Buildout",
        notes: "Sent detailed quote with 3 tier options",
      },
      {
        id: "l7",
        clientName: "Greg Martinez",
        estimatedValue: 5600,
        source: "referral",
        daysInStage: 7,
        assignedTo: "Mike D",
        lastActivityDate: "Feb 8",
        projectType: "Exterior Painting",
        notes: "Following up on Monday",
      },
      {
        id: "l16",
        clientName: "Anna Brooks",
        estimatedValue: 18000,
        source: "website",
        daysInStage: 3,
        assignedTo: "Sarah L",
        lastActivityDate: "Feb 12",
        projectType: "Kitchen Renovation",
      },
    ],
  },
  {
    id: "negotiating",
    label: "Negotiating",
    color: "text-ops-amber",
    borderColor: "border-t-ops-amber",
    bgAccent: "bg-ops-amber",
    textColor: "#C4A868",
    cards: [
      {
        id: "l8",
        clientName: "Tech Solutions Inc",
        estimatedValue: 45000,
        source: "cold-call",
        daysInStage: 6,
        assignedTo: "Sarah L",
        lastActivityDate: "Feb 9",
        projectType: "Commercial Buildout",
        notes: "Negotiating payment terms, wants 30% upfront instead of 50%",
      },
      {
        id: "l9",
        clientName: "Susan Roberts",
        estimatedValue: 14200,
        source: "referral",
        daysInStage: 3,
        assignedTo: "Chris P",
        lastActivityDate: "Feb 12",
        projectType: "Landscape Hardscape",
        notes: "Wants to reduce scope slightly",
      },
    ],
  },
  {
    id: "won",
    label: "Won",
    color: "text-status-success",
    borderColor: "border-t-status-success",
    bgAccent: "bg-status-success",
    textColor: "#4ADE80",
    cards: [
      {
        id: "l10",
        clientName: "Bob Johnson",
        estimatedValue: 12500,
        source: "repeat-client",
        daysInStage: 0,
        assignedTo: "Mike D",
        lastActivityDate: "Feb 14",
        projectType: "Deck Installation",
        notes: "Contract signed, deposit received",
      },
      {
        id: "l11",
        clientName: "Martin Properties LLC",
        estimatedValue: 34000,
        source: "referral",
        daysInStage: 0,
        assignedTo: "Sarah L",
        lastActivityDate: "Feb 13",
        projectType: "HVAC + Ductwork",
      },
      {
        id: "l17",
        clientName: "Kate Wilson",
        estimatedValue: 6700,
        source: "website",
        daysInStage: 0,
        assignedTo: "Tom B",
        lastActivityDate: "Feb 12",
        projectType: "Flooring Install",
      },
    ],
  },
  {
    id: "lost",
    label: "Lost",
    color: "text-ops-error",
    borderColor: "border-t-ops-error",
    bgAccent: "bg-ops-error",
    textColor: "#93321A",
    cards: [
      {
        id: "l12",
        clientName: "Phil Morris",
        estimatedValue: 22000,
        source: "website",
        daysInStage: 0,
        assignedTo: "Mike D",
        lastActivityDate: "Feb 7",
        projectType: "Garage Conversion",
        notes: "Went with competitor - lower price",
      },
      {
        id: "l13",
        clientName: "Nancy Green",
        estimatedValue: 6200,
        source: "door-knock",
        daysInStage: 0,
        assignedTo: "Chris P",
        lastActivityDate: "Feb 5",
        projectType: "Patio Concrete Pour",
        notes: "Project postponed indefinitely",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Draggable Pipeline Card
// ---------------------------------------------------------------------------
function PipelineCard({
  card,
  columnColor,
  isDragOverlay,
  onExpand,
  isExpanded,
}: {
  card: PipelineLead;
  columnColor: string;
  isDragOverlay?: boolean;
  onExpand: (id: string | null) => void;
  isExpanded: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "bg-background-card-dark border border-border rounded p-1.5",
        "cursor-grab active:cursor-grabbing transition-all duration-150",
        "group",
        isDragOverlay &&
          "shadow-glow-accent-lg border-ops-accent/60 scale-[1.02] rotate-[1deg]",
        !isDragOverlay &&
          "hover:border-ops-accent/50 hover:shadow-glow-accent"
      )}
      onClick={() => onExpand(isExpanded ? null : card.id)}
    >
      {/* Top row: name + value */}
      <div className="flex items-start gap-[6px]">
        <div className="flex-1 min-w-0">
          <h4 className="font-mohave text-body-sm text-text-primary truncate">
            {card.clientName}
          </h4>
          {card.projectType && (
            <p className="font-kosugi text-[10px] text-text-tertiary truncate">
              {card.projectType}
            </p>
          )}
        </div>
        <span className="font-mono text-[11px] text-ops-amber shrink-0 font-medium">
          ${card.estimatedValue.toLocaleString()}
        </span>
      </div>

      {/* Source + Assignee row */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-[4px] text-text-disabled">
          {SOURCE_ICONS[card.source]}
          <span className="font-kosugi text-[9px]">
            {SOURCE_LABELS[card.source]}
          </span>
        </div>
        <div className="flex items-center gap-[6px]">
          {card.daysInStage > 0 && (
            <div
              className="flex items-center gap-[2px]"
              title={`${card.daysInStage} days in this stage`}
            >
              <Clock className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[9px] text-text-disabled">
                {card.daysInStage}d
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Assignee + Last activity */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-[4px]">
          {card.assignedTo !== "Unassigned" ? (
            <div className="w-[18px] h-[18px] rounded-full bg-ops-accent-muted border border-background-card-dark flex items-center justify-center">
              <span className="font-mohave text-[8px] text-ops-accent">
                {card.assignedTo.charAt(0)}
              </span>
            </div>
          ) : null}
          <span className="font-kosugi text-[9px] text-text-disabled">
            {card.assignedTo}
          </span>
        </div>
        <div className="flex items-center gap-[3px] text-text-disabled">
          <Calendar className="w-[10px] h-[10px]" />
          <span className="font-mono text-[9px]">{card.lastActivityDate}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="mt-1.5 pt-1.5 border-t border-border-subtle space-y-1 animate-slide-up">
          {card.email && (
            <div className="flex items-center gap-[6px]">
              <span className="font-kosugi text-[9px] text-text-disabled w-[40px]">Email</span>
              <span className="font-mono text-[10px] text-ops-accent">{card.email}</span>
            </div>
          )}
          {card.phone && (
            <div className="flex items-center gap-[6px]">
              <span className="font-kosugi text-[9px] text-text-disabled w-[40px]">Phone</span>
              <span className="font-mono text-[10px] text-text-secondary">{card.phone}</span>
            </div>
          )}
          {card.notes && (
            <div className="mt-0.5">
              <span className="font-kosugi text-[9px] text-text-disabled block mb-[2px]">Notes</span>
              <p className="font-mohave text-[11px] text-text-secondary leading-tight">
                {card.notes}
              </p>
            </div>
          )}
          <div className="flex items-center gap-1 mt-1">
            <Button variant="secondary" size="sm" className="text-[10px] h-[28px] px-1">
              <Phone className="w-[10px] h-[10px]" />
              Call
            </Button>
            <Button variant="secondary" size="sm" className="text-[10px] h-[28px] px-1">
              <MessageSquare className="w-[10px] h-[10px]" />
              Note
            </Button>
            <Button variant="default" size="sm" className="text-[10px] h-[28px] px-1">
              <ArrowRight className="w-[10px] h-[10px]" />
              Advance
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable Column
// ---------------------------------------------------------------------------
function PipelineColumnComponent({
  column,
  expandedCardId,
  onExpandCard,
}: {
  column: PipelineColumn;
  expandedCardId: string | null;
  onExpandCard: (id: string | null) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const totalValue = column.cards.reduce((sum, c) => sum + c.estimatedValue, 0);
  const avgDays =
    column.cards.length > 0
      ? Math.round(
          column.cards.reduce((sum, c) => sum + c.daysInStage, 0) /
            column.cards.length
        )
      : 0;

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return (
    <div
      className={cn("flex flex-col min-w-[260px] max-w-[300px] w-full")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        // Drop is handled at the parent level via the onDrop prop
      }}
      data-column-id={column.id}
    >
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
            <span className="font-mono text-[10px] text-ops-amber">
              ${(totalValue / 1000).toFixed(1)}k
            </span>
          </div>
          {avgDays > 0 && (
            <div className="flex items-center gap-[3px]">
              <Clock className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[10px] text-text-disabled">
                avg {avgDays}d
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Cards area */}
      <div
        className={cn(
          "flex-1 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px] transition-colors duration-150",
          isDragOver
            ? "bg-ops-accent-muted border-ops-accent/30"
            : "bg-background-panel/50"
        )}
      >
        {column.cards.map((card) => (
          <PipelineCard
            key={card.id}
            card={card}
            columnColor={column.color}
            onExpand={onExpandCard}
            isExpanded={expandedCardId === card.id}
          />
        ))}

        {column.cards.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[120px] border border-dashed border-border-subtle rounded gap-1">
            <div className="w-[32px] h-[32px] rounded-full bg-background-elevated flex items-center justify-center">
              <Target className="w-[14px] h-[14px] text-text-disabled" />
            </div>
            <span className="font-kosugi text-[11px] text-text-disabled">
              No leads in this stage
            </span>
            <span className="font-kosugi text-[9px] text-text-disabled">
              Drop here to move
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Page
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [columns, setColumns] = useState<PipelineColumn[]>(initialColumns);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Collect unique values for filters
  const allSources = useMemo(() => {
    const sources = new Set<LeadSource>();
    columns.forEach((col) => col.cards.forEach((c) => sources.add(c.source)));
    return Array.from(sources).sort();
  }, [columns]);

  const allAssignees = useMemo(() => {
    const assignees = new Set<string>();
    columns.forEach((col) => col.cards.forEach((c) => assignees.add(c.assignedTo)));
    return Array.from(assignees).sort();
  }, [columns]);

  // Filter cards
  const filteredColumns = useMemo(() => {
    return columns.map((col) => ({
      ...col,
      cards: col.cards.filter((card) => {
        const matchesSearch =
          !searchQuery.trim() ||
          card.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (card.projectType || "").toLowerCase().includes(searchQuery.toLowerCase());
        const matchesSource = !sourceFilter || card.source === sourceFilter;
        const matchesAssignee = !assigneeFilter || card.assignedTo === assigneeFilter;
        return matchesSearch && matchesSource && matchesAssignee;
      }),
    }));
  }, [columns, searchQuery, sourceFilter, assigneeFilter]);

  // Totals
  const totalLeads = columns.reduce((sum, col) => sum + col.cards.length, 0);
  const totalPipelineValue = columns.reduce(
    (sum, col) => sum + col.cards.reduce((s, c) => s + c.estimatedValue, 0),
    0
  );
  const wonValue = columns
    .find((c) => c.id === "won")
    ?.cards.reduce((s, c) => s + c.estimatedValue, 0) || 0;
  const lostValue = columns
    .find((c) => c.id === "lost")
    ?.cards.reduce((s, c) => s + c.estimatedValue, 0) || 0;
  const activeValue = totalPipelineValue - wonValue - lostValue;
  const conversionRate =
    wonValue + lostValue > 0
      ? Math.round((wonValue / (wonValue + lostValue)) * 100)
      : 0;

  // Handle drop on a column
  const handleBoardDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const cardId = e.dataTransfer.getData("text/plain");
      if (!cardId) return;

      // Find the target column from the drop point
      const target = (e.target as HTMLElement).closest("[data-column-id]");
      if (!target) return;
      const destColumnId = target.getAttribute("data-column-id") as PipelineStage;
      if (!destColumnId) return;

      setColumns((prev) => {
        // Find source
        let sourceColIdx = -1;
        let sourceCardIdx = -1;
        for (let i = 0; i < prev.length; i++) {
          const idx = prev[i].cards.findIndex((c) => c.id === cardId);
          if (idx !== -1) {
            sourceColIdx = i;
            sourceCardIdx = idx;
            break;
          }
        }
        if (sourceColIdx === -1) return prev;

        const destColIdx = prev.findIndex((c) => c.id === destColumnId);
        if (destColIdx === -1) return prev;
        if (sourceColIdx === destColIdx) return prev;

        const newColumns = prev.map((col) => ({
          ...col,
          cards: [...col.cards],
        }));

        const [movedCard] = newColumns[sourceColIdx].cards.splice(sourceCardIdx, 1);
        movedCard.daysInStage = 0;
        newColumns[destColIdx].cards.push(movedCard);

        return newColumns;
      });
    },
    []
  );

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Header */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
              PIPELINE
            </h1>
            <div className="flex items-center gap-2">
              <p className="font-kosugi text-caption-sm text-text-tertiary">
                Drag leads between stages to update status
              </p>
              <span className="font-mono text-[11px] text-text-disabled">
                {totalLeads} leads
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="max-w-[250px]">
              <Input
                placeholder="Search leads..."
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
              New Lead
            </Button>
          </div>
        </div>

        {/* Metrics bar */}
        <div className="flex items-center gap-2">
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-accent-muted flex items-center justify-center shrink-0">
              <DollarSign className="w-[16px] h-[16px] text-ops-accent" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Active Pipeline
              </span>
              <span className="font-mono text-data text-ops-amber">
                ${(activeValue / 1000).toFixed(1)}k
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-status-success/15 flex items-center justify-center shrink-0">
              <TrendingUp className="w-[16px] h-[16px] text-status-success" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Won
              </span>
              <span className="font-mono text-data text-status-success">
                ${(wonValue / 1000).toFixed(1)}k
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-error-muted flex items-center justify-center shrink-0">
              <X className="w-[16px] h-[16px] text-ops-error" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Lost
              </span>
              <span className="font-mono text-data text-ops-error">
                ${(lostValue / 1000).toFixed(1)}k
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-amber-muted flex items-center justify-center shrink-0">
              <Target className="w-[16px] h-[16px] text-ops-amber" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Conversion
              </span>
              <span className="font-mono text-data text-text-primary">
                {conversionRate}%
              </span>
            </div>
          </Card>
        </div>

        {/* Expanded filter panel */}
        {showFilters && (
          <Card className="p-1.5 animate-slide-up">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  Source
                </span>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className={cn(
                    "bg-background-input text-text-primary font-mohave text-body-sm",
                    "px-1.5 py-[6px] rounded border border-border",
                    "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
                    "cursor-pointer"
                  )}
                >
                  <option value="">All Sources</option>
                  {allSources.map((source) => (
                    <option key={source} value={source}>
                      {SOURCE_LABELS[source]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  Assignee
                </span>
                <select
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className={cn(
                    "bg-background-input text-text-primary font-mohave text-body-sm",
                    "px-1.5 py-[6px] rounded border border-border",
                    "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
                    "cursor-pointer"
                  )}
                >
                  <option value="">All Assignees</option>
                  {allAssignees.map((assignee) => (
                    <option key={assignee} value={assignee}>
                      {assignee}
                    </option>
                  ))}
                </select>
              </div>

              {(sourceFilter || assigneeFilter || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-[4px] text-ops-error"
                  onClick={() => {
                    setSourceFilter("");
                    setAssigneeFilter("");
                    setSearchQuery("");
                  }}
                >
                  <X className="w-[12px] h-[12px]" />
                  Clear Filters
                </Button>
              )}

              {/* Active filter badges */}
              {sourceFilter && (
                <Badge variant="info" className="gap-[4px]">
                  Source: {SOURCE_LABELS[sourceFilter as LeadSource]}
                  <button
                    onClick={() => setSourceFilter("")}
                    className="hover:text-white cursor-pointer"
                  >
                    <X className="w-[10px] h-[10px]" />
                  </button>
                </Badge>
              )}
              {assigneeFilter && (
                <Badge variant="info" className="gap-[4px]">
                  Assignee: {assigneeFilter}
                  <button
                    onClick={() => setAssigneeFilter("")}
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

      {/* Pipeline Board */}
      <div
        ref={boardRef}
        className="flex-1 overflow-x-auto pb-2"
        onDrop={handleBoardDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex gap-2 min-w-min">
          {filteredColumns.map((column) => (
            <PipelineColumnComponent
              key={column.id}
              column={column}
              expandedCardId={expandedCardId}
              onExpandCard={setExpandedCardId}
            />
          ))}
        </div>
      </div>

      {/* Bottom summary bar */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1 rounded bg-background-panel border border-border">
        <div className="flex items-center gap-3">
          {filteredColumns.map((col) => (
            <div key={col.id} className="flex items-center gap-[6px]">
              <span
                className="w-[6px] h-[6px] rounded-full"
                style={{ backgroundColor: col.textColor }}
              />
              <span className="font-mono text-[10px] text-text-disabled">
                {col.label}: {col.cards.length}
              </span>
            </div>
          ))}
        </div>
        <span className="font-kosugi text-[10px] text-text-disabled">
          Drag cards between columns to update stage
        </span>
      </div>
    </div>
  );
}
