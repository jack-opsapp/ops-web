"use client";

import { useState, useMemo } from "react";
import {
  Search,
  Plus,
  X,
  ListFilter,
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle,
  Eye,
  Edit3,
  Send,
  Copy,
  FileDown,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "overdue" | "cancelled";

type SortField = "invoiceNumber" | "clientName" | "amount" | "dueDate" | "sentDate" | "status";
type SortDirection = "asc" | "desc";

interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  projectName: string;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
  sentDate: string | null;
  createdDate: string;
  paidDate: string | null;
  lineItems: { description: string; quantity: number; rate: number }[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<
  InvoiceStatus,
  { label: string; badgeVariant: string; color: string; bgColor: string }
> = {
  draft: {
    label: "Draft",
    badgeVariant: "rfq",
    color: "text-[#6B7280]",
    bgColor: "bg-[#6B7280]",
  },
  sent: {
    label: "Sent",
    badgeVariant: "info",
    color: "text-ops-accent",
    bgColor: "bg-ops-accent",
  },
  viewed: {
    label: "Viewed",
    badgeVariant: "estimated",
    color: "text-[#D97706]",
    bgColor: "bg-[#D97706]",
  },
  paid: {
    label: "Paid",
    badgeVariant: "success",
    color: "text-status-success",
    bgColor: "bg-status-success",
  },
  overdue: {
    label: "Overdue",
    badgeVariant: "error",
    color: "text-ops-error",
    bgColor: "bg-ops-error",
  },
  cancelled: {
    label: "Cancelled",
    badgeVariant: "cancelled",
    color: "text-text-disabled",
    bgColor: "bg-text-disabled",
  },
};

const ITEMS_PER_PAGE = 10;

// ---------------------------------------------------------------------------
// Placeholder Data
// ---------------------------------------------------------------------------
const mockInvoices: Invoice[] = [
  {
    id: "inv1",
    invoiceNumber: "OPS-2024-001",
    clientName: "John Smith",
    projectName: "Kitchen Renovation",
    amount: 34000,
    status: "paid",
    dueDate: "Jan 15, 2024",
    sentDate: "Dec 15, 2023",
    createdDate: "Dec 10, 2023",
    paidDate: "Jan 12, 2024",
    lineItems: [
      { description: "Demolition", quantity: 1, rate: 4000 },
      { description: "Cabinetry", quantity: 1, rate: 18000 },
      { description: "Countertops", quantity: 1, rate: 8000 },
      { description: "Labor", quantity: 80, rate: 50 },
    ],
  },
  {
    id: "inv2",
    invoiceNumber: "OPS-2024-002",
    clientName: "Bob Johnson",
    projectName: "Deck Installation",
    amount: 12500,
    status: "paid",
    dueDate: "Jan 30, 2024",
    sentDate: "Jan 2, 2024",
    createdDate: "Dec 28, 2023",
    paidDate: "Jan 25, 2024",
    lineItems: [
      { description: "Materials", quantity: 1, rate: 6500 },
      { description: "Labor", quantity: 120, rate: 50 },
    ],
  },
  {
    id: "inv3",
    invoiceNumber: "OPS-2024-003",
    clientName: "Tech Solutions Inc",
    projectName: "Office Buildout",
    amount: 45000,
    status: "overdue",
    dueDate: "Feb 1, 2024",
    sentDate: "Jan 10, 2024",
    createdDate: "Jan 5, 2024",
    paidDate: null,
    lineItems: [
      { description: "Framing & Drywall", quantity: 1, rate: 15000 },
      { description: "Electrical", quantity: 1, rate: 12000 },
      { description: "Flooring", quantity: 1, rate: 8000 },
      { description: "Painting", quantity: 1, rate: 5000 },
      { description: "Fixtures", quantity: 1, rate: 5000 },
    ],
    notes: "Net 30 terms",
  },
  {
    id: "inv4",
    invoiceNumber: "OPS-2024-004",
    clientName: "Jane Doe",
    projectName: "Bathroom Remodel",
    amount: 18500,
    status: "sent",
    dueDate: "Mar 1, 2024",
    sentDate: "Feb 5, 2024",
    createdDate: "Feb 1, 2024",
    paidDate: null,
    lineItems: [
      { description: "Plumbing", quantity: 1, rate: 6500 },
      { description: "Tiling", quantity: 1, rate: 4000 },
      { description: "Fixtures", quantity: 1, rate: 3000 },
      { description: "Labor", quantity: 100, rate: 50 },
    ],
  },
  {
    id: "inv5",
    invoiceNumber: "OPS-2024-005",
    clientName: "Alice Williams",
    projectName: "Plumbing Repair",
    amount: 2400,
    status: "paid",
    dueDate: "Feb 10, 2024",
    sentDate: "Jan 26, 2024",
    createdDate: "Jan 25, 2024",
    paidDate: "Feb 3, 2024",
    lineItems: [
      { description: "Parts", quantity: 1, rate: 400 },
      { description: "Labor", quantity: 40, rate: 50 },
    ],
  },
  {
    id: "inv6",
    invoiceNumber: "OPS-2024-006",
    clientName: "Linda Chen",
    projectName: "Roof Repair",
    amount: 5600,
    status: "viewed",
    dueDate: "Mar 15, 2024",
    sentDate: "Feb 10, 2024",
    createdDate: "Feb 8, 2024",
    paidDate: null,
    lineItems: [
      { description: "Materials", quantity: 1, rate: 2600 },
      { description: "Labor", quantity: 60, rate: 50 },
    ],
  },
  {
    id: "inv7",
    invoiceNumber: "OPS-2024-007",
    clientName: "Greg Martinez",
    projectName: "Exterior Painting",
    amount: 8900,
    status: "draft",
    dueDate: "Mar 20, 2024",
    sentDate: null,
    createdDate: "Feb 12, 2024",
    paidDate: null,
    lineItems: [
      { description: "Paint & Supplies", quantity: 1, rate: 1900 },
      { description: "Prep Work", quantity: 1, rate: 2000 },
      { description: "Painting Labor", quantity: 100, rate: 50 },
    ],
  },
  {
    id: "inv8",
    invoiceNumber: "OPS-2024-008",
    clientName: "Susan Roberts",
    projectName: "Landscape Hardscape",
    amount: 15200,
    status: "sent",
    dueDate: "Mar 25, 2024",
    sentDate: "Feb 14, 2024",
    createdDate: "Feb 12, 2024",
    paidDate: null,
    lineItems: [
      { description: "Pavers", quantity: 1, rate: 5200 },
      { description: "Retaining Wall", quantity: 1, rate: 4000 },
      { description: "Grading & Prep", quantity: 1, rate: 2000 },
      { description: "Labor", quantity: 80, rate: 50 },
    ],
  },
  {
    id: "inv9",
    invoiceNumber: "OPS-2024-009",
    clientName: "Mark Spencer",
    projectName: "Driveway Resurface",
    amount: 7800,
    status: "overdue",
    dueDate: "Feb 8, 2024",
    sentDate: "Jan 20, 2024",
    createdDate: "Jan 18, 2024",
    paidDate: null,
    lineItems: [
      { description: "Concrete", quantity: 1, rate: 3800 },
      { description: "Labor", quantity: 80, rate: 50 },
    ],
    notes: "Second reminder sent",
  },
  {
    id: "inv10",
    invoiceNumber: "OPS-2024-010",
    clientName: "Phil Morris",
    projectName: "Garage Conversion",
    amount: 22000,
    status: "cancelled",
    dueDate: "Feb 28, 2024",
    sentDate: "Jan 15, 2024",
    createdDate: "Jan 12, 2024",
    paidDate: null,
    lineItems: [
      { description: "Full conversion package", quantity: 1, rate: 22000 },
    ],
    notes: "Client cancelled project",
  },
  {
    id: "inv11",
    invoiceNumber: "OPS-2024-011",
    clientName: "Kate Wilson",
    projectName: "Flooring Install",
    amount: 6700,
    status: "paid",
    dueDate: "Feb 20, 2024",
    sentDate: "Feb 5, 2024",
    createdDate: "Feb 3, 2024",
    paidDate: "Feb 18, 2024",
    lineItems: [
      { description: "Hardwood Flooring", quantity: 1, rate: 3700 },
      { description: "Installation Labor", quantity: 60, rate: 50 },
    ],
  },
  {
    id: "inv12",
    invoiceNumber: "OPS-2024-012",
    clientName: "David Kim",
    projectName: "Window Replacement",
    amount: 8900,
    status: "draft",
    dueDate: "Apr 1, 2024",
    sentDate: null,
    createdDate: "Feb 14, 2024",
    paidDate: null,
    lineItems: [
      { description: "Windows (6x)", quantity: 6, rate: 1200 },
      { description: "Installation Labor", quantity: 24, rate: 50 },
    ],
  },
  {
    id: "inv13",
    invoiceNumber: "OPS-2024-013",
    clientName: "Martin Properties LLC",
    projectName: "HVAC Ductwork",
    amount: 11300,
    status: "sent",
    dueDate: "Mar 30, 2024",
    sentDate: "Feb 15, 2024",
    createdDate: "Feb 14, 2024",
    paidDate: null,
    lineItems: [
      { description: "Ductwork Materials", quantity: 1, rate: 4300 },
      { description: "HVAC Unit", quantity: 1, rate: 3000 },
      { description: "Installation Labor", quantity: 80, rate: 50 },
    ],
  },
  {
    id: "inv14",
    invoiceNumber: "OPS-2024-014",
    clientName: "Rachel Adams",
    projectName: "Basement Waterproofing",
    amount: 9400,
    status: "viewed",
    dueDate: "Mar 20, 2024",
    sentDate: "Feb 12, 2024",
    createdDate: "Feb 10, 2024",
    paidDate: null,
    lineItems: [
      { description: "Waterproofing Materials", quantity: 1, rate: 3400 },
      { description: "Excavation", quantity: 1, rate: 2000 },
      { description: "Labor", quantity: 80, rate: 50 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Action Menu
// ---------------------------------------------------------------------------
function ActionMenu({
  invoice,
  isOpen,
  onToggle,
}: {
  invoice: Invoice;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="p-[4px] rounded text-text-disabled hover:text-text-tertiary hover:bg-background-elevated transition-colors"
      >
        <MoreHorizontal className="w-[16px] h-[16px]" />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-[4px] z-50 bg-background-card border border-border rounded shadow-floating min-w-[160px] py-0.5 animate-scale-in">
          <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-text-primary hover:bg-background-elevated transition-colors">
            <Eye className="w-[14px] h-[14px] text-text-tertiary" />
            View Invoice
          </button>
          {invoice.status === "draft" && (
            <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-text-primary hover:bg-background-elevated transition-colors">
              <Edit3 className="w-[14px] h-[14px] text-text-tertiary" />
              Edit
            </button>
          )}
          {(invoice.status === "draft" || invoice.status === "viewed") && (
            <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-text-primary hover:bg-background-elevated transition-colors">
              <Send className="w-[14px] h-[14px] text-ops-accent" />
              {invoice.status === "draft" ? "Send" : "Send Reminder"}
            </button>
          )}
          {(invoice.status === "sent" || invoice.status === "viewed" || invoice.status === "overdue") && (
            <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-status-success hover:bg-background-elevated transition-colors">
              <CheckCircle className="w-[14px] h-[14px]" />
              Mark as Paid
            </button>
          )}
          {invoice.status === "overdue" && (
            <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-ops-amber hover:bg-background-elevated transition-colors">
              <Send className="w-[14px] h-[14px]" />
              Send Reminder
            </button>
          )}
          <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-text-primary hover:bg-background-elevated transition-colors">
            <Copy className="w-[14px] h-[14px] text-text-tertiary" />
            Duplicate
          </button>
          <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-text-primary hover:bg-background-elevated transition-colors">
            <FileDown className="w-[14px] h-[14px] text-text-tertiary" />
            Download PDF
          </button>
          {invoice.status !== "cancelled" && invoice.status !== "paid" && (
            <>
              <div className="border-t border-border-subtle my-0.5" />
              <button className="w-full flex items-center gap-1 px-1.5 py-1 font-mohave text-body-sm text-ops-error hover:bg-background-elevated transition-colors">
                <X className="w-[14px] h-[14px]" />
                Cancel Invoice
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoices Page
// ---------------------------------------------------------------------------
export default function InvoicesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("invoiceNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // Unique clients for filter
  const allClients = useMemo(() => {
    const clients = new Set<string>();
    mockInvoices.forEach((inv) => clients.add(inv.clientName));
    return Array.from(clients).sort();
  }, []);

  // Filter
  const filteredInvoices = useMemo(() => {
    return mockInvoices.filter((inv) => {
      const matchesSearch =
        !searchQuery.trim() ||
        inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inv.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inv.projectName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = !statusFilter || inv.status === statusFilter;
      const matchesClient = !clientFilter || inv.clientName === clientFilter;
      return matchesSearch && matchesStatus && matchesClient;
    });
  }, [searchQuery, statusFilter, clientFilter]);

  // Sort
  const sortedInvoices = useMemo(() => {
    return [...filteredInvoices].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "invoiceNumber":
          comparison = a.invoiceNumber.localeCompare(b.invoiceNumber);
          break;
        case "clientName":
          comparison = a.clientName.localeCompare(b.clientName);
          break;
        case "amount":
          comparison = a.amount - b.amount;
          break;
        case "dueDate":
          comparison = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          break;
        case "sentDate":
          comparison =
            (a.sentDate ? new Date(a.sentDate).getTime() : 0) -
            (b.sentDate ? new Date(b.sentDate).getTime() : 0);
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredInvoices, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sortedInvoices.length / ITEMS_PER_PAGE);
  const paginatedInvoices = sortedInvoices.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Summary calculations
  const totalOutstanding = mockInvoices
    .filter((inv) => inv.status === "sent" || inv.status === "viewed" || inv.status === "overdue")
    .reduce((sum, inv) => sum + inv.amount, 0);

  const overdueAmount = mockInvoices
    .filter((inv) => inv.status === "overdue")
    .reduce((sum, inv) => sum + inv.amount, 0);

  const paidThisMonth = mockInvoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + inv.amount, 0);

  const paidInvoices = mockInvoices.filter((inv) => inv.status === "paid");
  const avgDaysToPayment =
    paidInvoices.length > 0
      ? Math.round(
          paidInvoices.reduce((sum, inv) => {
            const sent = inv.sentDate ? new Date(inv.sentDate).getTime() : 0;
            const paid = inv.paidDate ? new Date(inv.paidDate).getTime() : 0;
            return sum + (paid - sent) / (1000 * 60 * 60 * 24);
          }, 0) / paidInvoices.length
        )
      : 0;

  // Sort toggle
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-[12px] h-[12px] text-text-disabled" />;
    }
    return sortDirection === "asc" ? (
      <ChevronUp className="w-[12px] h-[12px] text-ops-accent" />
    ) : (
      <ChevronDown className="w-[12px] h-[12px] text-ops-accent" />
    );
  };

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Header */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
              INVOICES
            </h1>
            <p className="font-kosugi text-caption-sm text-text-tertiary">
              {mockInvoices.length} invoices &middot;{" "}
              <span className="font-mono text-ops-amber">
                ${(mockInvoices.reduce((s, i) => s + i.amount, 0) / 1000).toFixed(1)}k total
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <div className="max-w-[250px]">
              <Input
                placeholder="Search invoices..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                prefixIcon={<Search className="w-[16px] h-[16px]" />}
                suffixIcon={
                  searchQuery ? (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setCurrentPage(1);
                      }}
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
              New Invoice
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="flex items-center gap-2">
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-accent-muted flex items-center justify-center shrink-0">
              <DollarSign className="w-[16px] h-[16px] text-ops-accent" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Outstanding
              </span>
              <span className="font-mono text-data text-text-primary">
                ${totalOutstanding.toLocaleString()}
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-error-muted flex items-center justify-center shrink-0">
              <AlertTriangle className="w-[16px] h-[16px] text-ops-error" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Overdue
              </span>
              <span className="font-mono text-data text-ops-error">
                ${overdueAmount.toLocaleString()}
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-status-success/15 flex items-center justify-center shrink-0">
              <CheckCircle className="w-[16px] h-[16px] text-status-success" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Paid (Total)
              </span>
              <span className="font-mono text-data text-status-success">
                ${paidThisMonth.toLocaleString()}
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-amber-muted flex items-center justify-center shrink-0">
              <Clock className="w-[16px] h-[16px] text-ops-amber" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Avg Days to Pay
              </span>
              <span className="font-mono text-data text-text-primary">
                {avgDaysToPayment} days
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
                  Status
                </span>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className={cn(
                    "bg-background-input text-text-primary font-mohave text-body-sm",
                    "px-1.5 py-[6px] rounded border border-border",
                    "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent",
                    "cursor-pointer"
                  )}
                >
                  <option value="">All Statuses</option>
                  {(Object.keys(STATUS_CONFIG) as InvoiceStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_CONFIG[status].label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  Client
                </span>
                <select
                  value={clientFilter}
                  onChange={(e) => {
                    setClientFilter(e.target.value);
                    setCurrentPage(1);
                  }}
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

              {(statusFilter || clientFilter || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-[4px] text-ops-error"
                  onClick={() => {
                    setStatusFilter("");
                    setClientFilter("");
                    setSearchQuery("");
                    setCurrentPage(1);
                  }}
                >
                  <X className="w-[12px] h-[12px]" />
                  Clear Filters
                </Button>
              )}

              {statusFilter && (
                <Badge variant="info" className="gap-[4px]">
                  Status: {STATUS_CONFIG[statusFilter as InvoiceStatus].label}
                  <button
                    onClick={() => {
                      setStatusFilter("");
                      setCurrentPage(1);
                    }}
                    className="hover:text-white cursor-pointer"
                  >
                    <X className="w-[10px] h-[10px]" />
                  </button>
                </Badge>
              )}
              {clientFilter && (
                <Badge variant="info" className="gap-[4px]">
                  Client: {clientFilter}
                  <button
                    onClick={() => {
                      setClientFilter("");
                      setCurrentPage(1);
                    }}
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

      {/* Invoice Table */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[900px]">
          {/* Table header */}
          <div className="sticky top-0 z-10 bg-background-panel border border-border rounded-t grid grid-cols-[120px_1fr_1fr_120px_100px_110px_110px_60px] gap-1 px-1.5 py-1">
            <button
              onClick={() => handleSort("invoiceNumber")}
              className="flex items-center gap-[4px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest hover:text-text-secondary transition-colors cursor-pointer"
            >
              Invoice # <SortIcon field="invoiceNumber" />
            </button>
            <button
              onClick={() => handleSort("clientName")}
              className="flex items-center gap-[4px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest hover:text-text-secondary transition-colors cursor-pointer"
            >
              Client <SortIcon field="clientName" />
            </button>
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
              Project
            </span>
            <button
              onClick={() => handleSort("amount")}
              className="flex items-center gap-[4px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest hover:text-text-secondary transition-colors cursor-pointer text-right justify-end"
            >
              Amount <SortIcon field="amount" />
            </button>
            <button
              onClick={() => handleSort("status")}
              className="flex items-center gap-[4px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest hover:text-text-secondary transition-colors cursor-pointer"
            >
              Status <SortIcon field="status" />
            </button>
            <button
              onClick={() => handleSort("dueDate")}
              className="flex items-center gap-[4px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest hover:text-text-secondary transition-colors cursor-pointer"
            >
              Due Date <SortIcon field="dueDate" />
            </button>
            <button
              onClick={() => handleSort("sentDate")}
              className="flex items-center gap-[4px] font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest hover:text-text-secondary transition-colors cursor-pointer"
            >
              Sent <SortIcon field="sentDate" />
            </button>
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest text-center">
              Actions
            </span>
          </div>

          {/* Table body */}
          <div className="border border-t-0 border-border rounded-b divide-y divide-border-subtle">
            {paginatedInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 gap-1">
                <DollarSign className="w-[32px] h-[32px] text-text-disabled" />
                <span className="font-mohave text-body text-text-disabled">
                  No invoices found
                </span>
                <span className="font-kosugi text-caption-sm text-text-disabled">
                  Try adjusting your search or filters
                </span>
              </div>
            ) : (
              paginatedInvoices.map((invoice) => {
                const statusCfg = STATUS_CONFIG[invoice.status];
                return (
                  <div
                    key={invoice.id}
                    className={cn(
                      "grid grid-cols-[120px_1fr_1fr_120px_100px_110px_110px_60px] gap-1 px-1.5 py-1",
                      "hover:bg-background-elevated/50 transition-colors cursor-pointer group"
                    )}
                    onClick={() => {
                      // Future: open invoice detail
                    }}
                  >
                    <span className="font-mono text-body-sm text-ops-accent self-center">
                      {invoice.invoiceNumber}
                    </span>
                    <div className="self-center min-w-0">
                      <span className="font-mohave text-body-sm text-text-primary block truncate">
                        {invoice.clientName}
                      </span>
                    </div>
                    <div className="self-center min-w-0">
                      <span className="font-mohave text-body-sm text-text-secondary block truncate">
                        {invoice.projectName}
                      </span>
                    </div>
                    <span className="font-mono text-body-sm text-ops-amber self-center text-right">
                      ${invoice.amount.toLocaleString()}
                    </span>
                    <div className="self-center">
                      <Badge
                        variant={statusCfg.badgeVariant as any}
                        className="text-[10px]"
                      >
                        {statusCfg.label}
                      </Badge>
                    </div>
                    <span
                      className={cn(
                        "font-mono text-[12px] self-center",
                        invoice.status === "overdue"
                          ? "text-ops-error"
                          : "text-text-secondary"
                      )}
                    >
                      {invoice.dueDate}
                    </span>
                    <span className="font-mono text-[12px] text-text-disabled self-center">
                      {invoice.sentDate || "--"}
                    </span>
                    <div className="self-center flex justify-center">
                      <ActionMenu
                        invoice={invoice}
                        isOpen={openActionMenuId === invoice.id}
                        onToggle={() =>
                          setOpenActionMenuId(
                            openActionMenuId === invoice.id ? null : invoice.id
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between px-2 py-1 rounded bg-background-panel border border-border">
          <span className="font-mono text-[11px] text-text-disabled">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-
            {Math.min(currentPage * ITEMS_PER_PAGE, sortedInvoices.length)} of{" "}
            {sortedInvoices.length}
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="h-[32px] w-[32px] p-0"
            >
              <ChevronLeft className="w-[16px] h-[16px]" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentPage(page)}
                className="h-[32px] w-[32px] p-0 font-mono text-[12px]"
              >
                {page}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="h-[32px] w-[32px] p-0"
            >
              <ChevronRight className="w-[16px] h-[16px]" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            {(Object.keys(STATUS_CONFIG) as InvoiceStatus[]).map((status) => {
              const count = mockInvoices.filter((i) => i.status === status).length;
              if (count === 0) return null;
              return (
                <div key={status} className="flex items-center gap-[4px]">
                  <span
                    className={cn("w-[6px] h-[6px] rounded-full", STATUS_CONFIG[status].bgColor)}
                  />
                  <span className="font-mono text-[10px] text-text-disabled">
                    {STATUS_CONFIG[status].label}: {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
