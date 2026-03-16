/**
 * OPS Web - Email Connection Types
 *
 * Provider-agnostic email connection types.
 * Replaces GmailConnection types from pipeline.ts.
 */

// ─── Provider Types ──────────────────────────────────────────────────────────

export type EmailProvider = "gmail" | "microsoft365";

export type EmailConnectionStatus = "active" | "paused" | "error" | "setup_incomplete";

// ─── Core Types ──────────────────────────────────────────────────────────────

export interface EmailConnection {
  id: string;
  companyId: string;
  provider: EmailProvider;
  type: "company" | "individual";
  userId: string | null;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  historyId: string | null; // Gmail historyId or M365 deltaLink
  syncEnabled: boolean;
  lastSyncedAt: Date | null;
  syncIntervalMinutes: number;
  syncFilters: SyncProfile; // renamed semantically, same JSONB column for now
  webhookSubscriptionId: string | null;
  webhookExpiresAt: Date | null;
  opsLabelId: string | null;
  aiReviewEnabled: boolean;
  aiMemoryEnabled: boolean;
  status: EmailConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncProfile {
  // Pattern detection results (populated by wizard Step 2)
  estimateSubjectPatterns?: string[];
  companyDomains?: string[];
  teamForwarders?: string[];
  knownPlatformSenders?: string[];
  formSubjectPatterns?: string[];
  userEmailAddresses?: string[];
  aiClassificationThreshold?: number;

  // Legacy filter fields (kept for backward compatibility during migration)
  excludeDomains?: string[];
  excludeAddresses?: string[];
  excludeSubjectKeywords?: string[];
  usePresetBlocklist?: boolean;
  labelIds?: string[];
  includeSentMail?: boolean;
  rules?: EmailFilterRule[];
  ruleLogic?: "all" | "any";

  // Wizard state
  wizardCompleted?: boolean;
  wizardStep?: number;
  lastScanJobId?: string;
  lastScanSummary?: Record<string, unknown>;
}

export interface EmailFilterRule {
  id: string;
  field: "subject" | "from_email" | "from_domain" | "label" | "body";
  operator:
    | "contains"
    | "not_contains"
    | "equals"
    | "not_equals"
    | "starts_with"
    | "ends_with";
  value: string;
}

// ─── CRUD Types ──────────────────────────────────────────────────────────────

export interface CreateEmailConnection {
  companyId: string;
  provider: EmailProvider;
  type: "company" | "individual";
  userId?: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface UpdateEmailConnection {
  syncEnabled?: boolean;
  syncIntervalMinutes?: number;
  syncFilters?: Partial<SyncProfile>;
  historyId?: string;
  lastSyncedAt?: Date;
  webhookSubscriptionId?: string;
  webhookExpiresAt?: Date;
  opsLabelId?: string;
  aiReviewEnabled?: boolean;
  aiMemoryEnabled?: boolean;
  status?: EmailConnectionStatus;
}

// ─── Junction & Feature Types ────────────────────────────────────────────────

/** Links an opportunity to an email thread */
export interface OpportunityEmailThread {
  id: string;
  opportunityId: string;
  threadId: string;
  connectionId: string | null;
  createdAt: Date;
}

/** Per-company admin override for AI features */
export interface AdminFeatureOverride {
  id: string;
  companyId: string;
  featureKey: string;
  enabled: boolean;
  enabledBy: string | null;
  enabledAt: Date | null;
  metadata: Record<string, unknown>;
}
