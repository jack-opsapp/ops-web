/**
 * OPS Web - Portal Demo Data Module
 *
 * Provides deterministic demo data for the portal preview feature.
 * When an admin previews their client portal, all API endpoints return
 * this hardcoded sample data instead of querying for real client records.
 *
 * Real data: company info + branding are fetched from the DB so the
 * admin sees their actual customizations.
 *
 * Demo data: client, projects, estimates, invoices, messages, and
 * line items are all hardcoded with `preview-` prefixed IDs so that
 * detail endpoints can match them.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { PortalBrandingService } from "./portal-branding-service";
import type { Client } from "@/lib/types/models";
import type { LineItem, Payment } from "@/lib/types/pipeline";
import { PaymentMethod } from "@/lib/types/pipeline";
import type {
  PortalClientData,
  PortalCompanyInfo,
  PortalEstimate,
  PortalInvoice,
  PortalProject,
  PortalMessage,
} from "@/lib/types/portal";

// ─── Deterministic IDs ──────────────────────────────────────────────────────

const DEMO_CLIENT_ID = "preview-client-001";

const DEMO_PROJECT_IDS = {
  kitchenRenovation: "preview-project-001",
  deckInstallation: "preview-project-002",
} as const;

const DEMO_ESTIMATE_IDS = {
  countertopsBacksplash: "preview-estimate-001",
  cabinetRefacing: "preview-estimate-002",
  compositeDeckBuild: "preview-estimate-003",
} as const;

const DEMO_INVOICE_IDS = {
  cabinetDeposit: "preview-invoice-001",
  demoAndPrep: "preview-invoice-002",
  deckMaterials: "preview-invoice-003",
} as const;

const DEMO_MESSAGE_IDS = {
  message1: "preview-message-001",
  message2: "preview-message-002",
} as const;

// ─── Helper ─────────────────────────────────────────────────────────────────

/** Check if a given ID is a preview/demo ID */
export function isPreviewId(id: string): boolean {
  return id.startsWith("preview-");
}

// ─── Static Demo Data ───────────────────────────────────────────────────────

function getDemoClient(companyId: string): Client {
  return {
    id: DEMO_CLIENT_ID,
    name: "Jane Smith",
    email: "jane@example.com",
    phoneNumber: "(555) 123-4567",
    address: "123 Oak Street",
    latitude: null,
    longitude: null,
    profileImageURL: null,
    notes: null,
    companyId,
    lastSyncedAt: null,
    needsSync: false,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    deletedAt: null,
  };
}

function getDemoProjects(): PortalProject[] {
  return [
    {
      id: DEMO_PROJECT_IDS.kitchenRenovation,
      title: "Kitchen Renovation",
      address: "123 Oak Street",
      status: "In Progress",
      startDate: new Date("2025-09-01T08:00:00Z"),
      endDate: new Date("2025-10-15T17:00:00Z"),
      projectImages: [],
      estimateCount: 2,
      invoiceCount: 2,
    },
    {
      id: DEMO_PROJECT_IDS.deckInstallation,
      title: "Deck Installation",
      address: "123 Oak Street",
      status: "Estimated",
      startDate: new Date("2025-11-01T08:00:00Z"),
      endDate: null,
      projectImages: [],
      estimateCount: 1,
      invoiceCount: 1,
    },
  ];
}

function getDemoEstimates(): PortalEstimate[] {
  return [
    {
      id: DEMO_ESTIMATE_IDS.countertopsBacksplash,
      estimateNumber: "EST-1001",
      title: "Countertops & Backsplash",
      status: "sent",
      total: 8750,
      issueDate: new Date("2025-08-20T12:00:00Z"),
      expirationDate: new Date("2025-09-20T12:00:00Z"),
      hasUnansweredQuestions: false,
      projectId: DEMO_PROJECT_IDS.kitchenRenovation,
    },
    {
      id: DEMO_ESTIMATE_IDS.cabinetRefacing,
      estimateNumber: "EST-1002",
      title: "Cabinet Refacing",
      status: "approved",
      total: 4200,
      issueDate: new Date("2025-08-25T12:00:00Z"),
      expirationDate: new Date("2025-09-25T12:00:00Z"),
      hasUnansweredQuestions: false,
      projectId: DEMO_PROJECT_IDS.kitchenRenovation,
    },
    {
      id: DEMO_ESTIMATE_IDS.compositeDeckBuild,
      estimateNumber: "EST-1003",
      title: "Composite Deck Build",
      status: "viewed",
      total: 12500,
      issueDate: new Date("2025-09-05T12:00:00Z"),
      expirationDate: new Date("2025-10-05T12:00:00Z"),
      hasUnansweredQuestions: false,
      projectId: DEMO_PROJECT_IDS.deckInstallation,
    },
  ];
}

function getDemoInvoices(): PortalInvoice[] {
  return [
    {
      id: DEMO_INVOICE_IDS.cabinetDeposit,
      invoiceNumber: "INV-2001",
      subject: "Cabinet Deposit",
      status: "sent",
      total: 2100,
      balanceDue: 2100,
      issueDate: new Date("2025-09-01T12:00:00Z"),
      dueDate: new Date("2025-09-15T12:00:00Z"),
      projectId: DEMO_PROJECT_IDS.kitchenRenovation,
    },
    {
      id: DEMO_INVOICE_IDS.demoAndPrep,
      invoiceNumber: "INV-2002",
      subject: "Demo & Prep",
      status: "partially_paid",
      total: 3500,
      balanceDue: 1750,
      issueDate: new Date("2025-09-10T12:00:00Z"),
      dueDate: new Date("2025-09-24T12:00:00Z"),
      projectId: DEMO_PROJECT_IDS.kitchenRenovation,
    },
    {
      id: DEMO_INVOICE_IDS.deckMaterials,
      invoiceNumber: "INV-2003",
      subject: "Deck Materials",
      status: "sent",
      total: 6250,
      balanceDue: 6250,
      issueDate: new Date("2025-09-15T12:00:00Z"),
      dueDate: new Date("2025-09-29T12:00:00Z"),
      projectId: DEMO_PROJECT_IDS.deckInstallation,
    },
  ];
}

// ─── Line Items (for estimate/invoice detail endpoints) ─────────────────────

function makeLineItem(overrides: Partial<LineItem> & { id: string; name: string }): LineItem {
  return {
    companyId: "preview-company",
    estimateId: null,
    invoiceId: null,
    productId: null,
    type: "MATERIAL",
    taskTypeId: null,
    description: null,
    quantity: 1,
    unit: "each",
    unitPrice: 0,
    unitCost: null,
    discountPercent: 0,
    isTaxable: false,
    taxRateId: null,
    lineTotal: 0,
    isOptional: false,
    isSelected: true,
    sortOrder: 0,
    category: null,
    serviceDate: null,
    createdAt: new Date("2025-08-20T12:00:00Z"),
    ...overrides,
  };
}

function getEstimateLineItems(estimateId: string): LineItem[] | null {
  switch (estimateId) {
    case DEMO_ESTIMATE_IDS.countertopsBacksplash:
      return [
        makeLineItem({
          id: "preview-li-e1-001",
          estimateId,
          name: "Granite Countertop",
          description: "Level 3 granite slab, cut and polished to spec. Includes sink cutout.",
          type: "MATERIAL",
          quantity: 42,
          unit: "sqft",
          unitPrice: 125,
          lineTotal: 5250,
          sortOrder: 0,
        }),
        makeLineItem({
          id: "preview-li-e1-002",
          estimateId,
          name: "Subway Tile Backsplash",
          description: "3x6 ceramic subway tile in matte white, herringbone pattern.",
          type: "MATERIAL",
          quantity: 30,
          unit: "sqft",
          unitPrice: 45,
          lineTotal: 1350,
          sortOrder: 1,
        }),
        makeLineItem({
          id: "preview-li-e1-003",
          estimateId,
          name: "Installation Labor",
          description: "Countertop and backsplash installation including removal of existing surfaces.",
          type: "LABOR",
          quantity: 24,
          unit: "hour",
          unitPrice: 89.58,
          lineTotal: 2150,
          sortOrder: 2,
        }),
      ];

    case DEMO_ESTIMATE_IDS.cabinetRefacing:
      return [
        makeLineItem({
          id: "preview-li-e2-001",
          estimateId,
          name: "Cabinet Door Fronts",
          description: "Shaker-style maple veneer replacement doors, custom measured.",
          type: "MATERIAL",
          quantity: 14,
          unit: "each",
          unitPrice: 175,
          lineTotal: 2450,
          sortOrder: 0,
        }),
        makeLineItem({
          id: "preview-li-e2-002",
          estimateId,
          name: "Refacing Labor",
          description: "Remove existing doors, prep surfaces, install new fronts and hardware.",
          type: "LABOR",
          quantity: 20,
          unit: "hour",
          unitPrice: 87.5,
          lineTotal: 1750,
          sortOrder: 1,
        }),
      ];

    case DEMO_ESTIMATE_IDS.compositeDeckBuild:
      return [
        makeLineItem({
          id: "preview-li-e3-001",
          estimateId,
          name: "Composite Decking Boards",
          description: "Trex Transcend composite boards in Spiced Rum, 1x6x16.",
          type: "MATERIAL",
          quantity: 320,
          unit: "linear ft",
          unitPrice: 18.75,
          lineTotal: 6000,
          sortOrder: 0,
        }),
        makeLineItem({
          id: "preview-li-e3-002",
          estimateId,
          name: "Framing Lumber & Hardware",
          description: "Pressure-treated 2x8 joists, posts, joist hangers, and concrete footings.",
          type: "MATERIAL",
          quantity: 1,
          unit: "flat rate",
          unitPrice: 2500,
          lineTotal: 2500,
          sortOrder: 1,
        }),
        makeLineItem({
          id: "preview-li-e3-003",
          estimateId,
          name: "Deck Construction Labor",
          description: "Full deck build including framing, decking, and aluminum railing installation.",
          type: "LABOR",
          quantity: 50,
          unit: "hour",
          unitPrice: 80,
          lineTotal: 4000,
          sortOrder: 2,
        }),
      ];

    default:
      return null;
  }
}

function getInvoiceLineItems(invoiceId: string): LineItem[] | null {
  switch (invoiceId) {
    case DEMO_INVOICE_IDS.cabinetDeposit:
      return [
        makeLineItem({
          id: "preview-li-i1-001",
          invoiceId,
          name: "Cabinet Refacing Deposit",
          description: "50% deposit for cabinet refacing project per approved estimate EST-1002.",
          type: "MATERIAL",
          quantity: 1,
          unit: "flat rate",
          unitPrice: 2100,
          lineTotal: 2100,
          sortOrder: 0,
        }),
      ];

    case DEMO_INVOICE_IDS.demoAndPrep:
      return [
        makeLineItem({
          id: "preview-li-i2-001",
          invoiceId,
          name: "Kitchen Demo",
          description: "Removal of existing countertops, backsplash, and disposal.",
          type: "LABOR",
          quantity: 12,
          unit: "hour",
          unitPrice: 175,
          lineTotal: 2100,
          sortOrder: 0,
        }),
        makeLineItem({
          id: "preview-li-i2-002",
          invoiceId,
          name: "Surface Preparation",
          description: "Level and prep substrate for new countertop and tile installation.",
          type: "LABOR",
          quantity: 8,
          unit: "hour",
          unitPrice: 175,
          lineTotal: 1400,
          sortOrder: 1,
        }),
      ];

    case DEMO_INVOICE_IDS.deckMaterials:
      return [
        makeLineItem({
          id: "preview-li-i3-001",
          invoiceId,
          name: "Composite Decking Boards",
          description: "Trex Transcend composite boards in Spiced Rum, 1x6x16.",
          type: "MATERIAL",
          quantity: 320,
          unit: "linear ft",
          unitPrice: 18.75,
          lineTotal: 6000,
          sortOrder: 0,
        }),
        makeLineItem({
          id: "preview-li-i3-002",
          invoiceId,
          name: "Delivery Charge",
          description: "Freight delivery to job site.",
          type: "MATERIAL",
          quantity: 1,
          unit: "flat rate",
          unitPrice: 250,
          lineTotal: 250,
          sortOrder: 1,
        }),
      ];

    default:
      return null;
  }
}

function getInvoicePayments(invoiceId: string): Payment[] {
  switch (invoiceId) {
    case DEMO_INVOICE_IDS.demoAndPrep:
      return [
        {
          id: "preview-payment-001",
          companyId: "preview-company",
          invoiceId,
          clientId: DEMO_CLIENT_ID,
          amount: 1750,
          paymentMethod: PaymentMethod.Check,
          referenceNumber: "1042",
          notes: null,
          paymentDate: new Date("2025-09-15T12:00:00Z"),
          stripePaymentIntent: null,
          createdBy: null,
          createdAt: new Date("2025-09-15T12:00:00Z"),
          voidedAt: null,
          voidedBy: null,
        },
      ];
    default:
      return [];
  }
}

// ─── Messages ───────────────────────────────────────────────────────────────

function getDemoMessages(companyId: string): PortalMessage[] {
  return [
    {
      id: DEMO_MESSAGE_IDS.message1,
      companyId,
      clientId: DEMO_CLIENT_ID,
      projectId: DEMO_PROJECT_IDS.kitchenRenovation,
      estimateId: null,
      invoiceId: null,
      senderType: "company",
      senderName: "Your Team",
      content:
        "Hi Jane! Just confirming we are on track to start the kitchen demo next Monday. Please make sure the countertops are cleared off by then.",
      readAt: new Date("2025-09-04T18:30:00Z"),
      createdAt: new Date("2025-09-04T14:00:00Z"),
    },
    {
      id: DEMO_MESSAGE_IDS.message2,
      companyId,
      clientId: DEMO_CLIENT_ID,
      projectId: DEMO_PROJECT_IDS.kitchenRenovation,
      estimateId: null,
      invoiceId: null,
      senderType: "client",
      senderName: "Jane Smith",
      content:
        "Sounds great, everything will be cleared out by Friday. Looking forward to getting started!",
      readAt: null,
      createdAt: new Date("2025-09-04T19:15:00Z"),
    },
  ];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch full portal data for preview mode.
 * Real company info and branding come from the DB; everything else is demo data.
 */
export async function getDemoPortalData(
  companyId: string
): Promise<PortalClientData> {
  const supabase = getServiceRoleClient();

  // Fetch real company info + branding in parallel
  const [companyResult, branding] = await Promise.all([
    supabase
      .from("companies")
      .select("name, logo_url, phone, email")
      .eq("id", companyId)
      .maybeSingle(),
    PortalBrandingService.getBranding(companyId),
  ]);

  const company: PortalCompanyInfo = {
    name: (companyResult.data?.name as string) ?? "Company",
    logoUrl: (companyResult.data?.logo_url as string) ?? null,
    phone: (companyResult.data?.phone as string) ?? null,
    email: (companyResult.data?.email as string) ?? null,
  };

  return {
    client: getDemoClient(companyId),
    company,
    branding,
    projects: getDemoProjects(),
    estimates: getDemoEstimates(),
    invoices: getDemoInvoices(),
    unreadMessages: 1,
  };
}

/**
 * Get demo estimate detail by ID.
 * Returns the estimate fields + lineItems + template:null, or null if ID not found.
 */
export function getDemoEstimateDetail(
  estimateId: string
): {
  id: string;
  companyId: string;
  opportunityId: string | null;
  clientId: string;
  estimateNumber: string;
  version: number;
  parentId: string | null;
  title: string | null;
  clientMessage: string | null;
  internalNotes: string | null;
  terms: string | null;
  subtotal: number;
  discountType: import("@/lib/types/pipeline").DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  depositType: import("@/lib/types/pipeline").DiscountType | null;
  depositValue: number | null;
  depositAmount: number | null;
  status: import("@/lib/types/pipeline").EstimateStatus;
  issueDate: Date;
  expirationDate: Date | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  approvedAt: Date | null;
  pdfStoragePath: string | null;
  templateId: string | null;
  projectId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  lineItems: LineItem[];
  template: null;
} | null {
  const estimates = getDemoEstimates();
  const match = estimates.find((e) => e.id === estimateId);
  if (!match) return null;

  const lineItems = getEstimateLineItems(estimateId) ?? [];

  // Map status strings to the EstimateStatus enum values
  const statusMap: Record<string, import("@/lib/types/pipeline").EstimateStatus> = {
    sent: "sent" as import("@/lib/types/pipeline").EstimateStatus,
    approved: "approved" as import("@/lib/types/pipeline").EstimateStatus,
    viewed: "viewed" as import("@/lib/types/pipeline").EstimateStatus,
  };

  return {
    id: match.id,
    companyId: "preview-company",
    opportunityId: null,
    clientId: DEMO_CLIENT_ID,
    estimateNumber: match.estimateNumber,
    version: 1,
    parentId: null,
    title: match.title,
    clientMessage: null,
    internalNotes: null,
    terms: null,
    subtotal: match.total,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    taxRate: null,
    taxAmount: 0,
    total: match.total,
    depositType: null,
    depositValue: null,
    depositAmount: null,
    status: statusMap[match.status] ?? ("sent" as import("@/lib/types/pipeline").EstimateStatus),
    issueDate: match.issueDate,
    expirationDate: match.expirationDate,
    sentAt: match.issueDate,
    viewedAt: match.status === "viewed" ? new Date("2025-09-06T10:00:00Z") : null,
    approvedAt: match.status === "approved" ? new Date("2025-08-27T14:00:00Z") : null,
    pdfStoragePath: null,
    templateId: null,
    projectId: match.projectId,
    createdBy: null,
    createdAt: match.issueDate,
    updatedAt: match.issueDate,
    deletedAt: null,
    lineItems,
    template: null,
  };
}

/**
 * Get demo invoice detail by ID.
 * Returns the invoice fields + lineItems + payments + template:null, or null if ID not found.
 */
export function getDemoInvoiceDetail(
  invoiceId: string
): {
  id: string;
  companyId: string;
  clientId: string;
  estimateId: string | null;
  opportunityId: string | null;
  projectId: string | null;
  invoiceNumber: string;
  subject: string | null;
  clientMessage: string | null;
  internalNotes: string | null;
  footer: string | null;
  terms: string | null;
  subtotal: number;
  discountType: import("@/lib/types/pipeline").DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  depositApplied: number;
  status: import("@/lib/types/pipeline").InvoiceStatus;
  issueDate: Date;
  dueDate: Date;
  paymentTerms: string | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  paidAt: Date | null;
  pdfStoragePath: string | null;
  templateId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  lineItems: LineItem[];
  payments: Payment[];
  template: null;
} | null {
  const invoices = getDemoInvoices();
  const match = invoices.find((i) => i.id === invoiceId);
  if (!match) return null;

  const lineItems = getInvoiceLineItems(invoiceId) ?? [];
  const payments = getInvoicePayments(invoiceId);

  const statusMap: Record<string, import("@/lib/types/pipeline").InvoiceStatus> = {
    sent: "sent" as import("@/lib/types/pipeline").InvoiceStatus,
    partially_paid: "partially_paid" as import("@/lib/types/pipeline").InvoiceStatus,
  };

  const amountPaid = match.total - match.balanceDue;

  return {
    id: match.id,
    companyId: "preview-company",
    clientId: DEMO_CLIENT_ID,
    estimateId: null,
    opportunityId: null,
    projectId: match.projectId,
    invoiceNumber: match.invoiceNumber,
    subject: match.subject,
    clientMessage: null,
    internalNotes: null,
    footer: null,
    terms: null,
    subtotal: match.total,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    taxRate: null,
    taxAmount: 0,
    total: match.total,
    amountPaid,
    balanceDue: match.balanceDue,
    depositApplied: 0,
    status: statusMap[match.status] ?? ("sent" as import("@/lib/types/pipeline").InvoiceStatus),
    issueDate: match.issueDate,
    dueDate: match.dueDate,
    paymentTerms: "Net 15",
    sentAt: match.issueDate,
    viewedAt: null,
    paidAt: null,
    pdfStoragePath: null,
    templateId: null,
    createdBy: null,
    createdAt: match.issueDate,
    updatedAt: match.issueDate,
    deletedAt: null,
    lineItems,
    payments,
    template: null,
  };
}

/**
 * Get demo project detail by ID, or null if not found.
 */
export function getDemoProjectDetail(
  projectId: string
): PortalProject | null {
  const projects = getDemoProjects();
  return projects.find((p) => p.id === projectId) ?? null;
}

/**
 * Get demo portal messages for preview mode.
 */
export function getDemoPortalMessages(
  companyId: string
): PortalMessage[] {
  return getDemoMessages(companyId);
}
