/**
 * OPS Web - Company Service
 *
 * Data CRUD → Supabase `companies` table.
 * Subscription management → Stripe API routes.
 * Image uploads → /api/uploads/presign route.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { Company, SubscriptionStatus, SubscriptionPlan, PaymentSchedule } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): Company {
  return {
    id: row.id as string,
    name: row.name as string,
    logoURL: (row.logo_url as string) ?? null,
    externalId: (row.external_id as string) ?? null,
    companyDescription: (row.description as string) ?? null,
    address: (row.address as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    website: (row.website as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    openHour: (row.open_hour as string) ?? null,
    closeHour: (row.close_hour as string) ?? null,
    industries: (row.industries as string[]) ?? [],
    companySize: (row.company_size as string) ?? null,
    companyAge: (row.company_age as string) ?? null,
    referralMethod: (row.referral_method as string) ?? null,
    projectIds: [], // computed from projects table
    teamIds: [], // computed from users table
    adminIds: (row.admin_ids as string[]) ?? [],
    accountHolderId: (row.account_holder_id as string) ?? null,
    defaultProjectColor: (row.default_project_color as string) ?? "#9CA3AF",
    teamMembersSynced: true,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    subscriptionPlan: (row.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionEnd: parseDate(row.subscription_end),
    subscriptionPeriod: (row.subscription_period as PaymentSchedule) ?? null,
    maxSeats: (row.max_seats as number) ?? 10,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    seatGraceStartDate: parseDate(row.seat_grace_start_date),
    trialStartDate: parseDate(row.trial_start_date),
    trialEndDate: parseDate(row.trial_end_date),
    hasPrioritySupport: (row.has_priority_support as boolean) ?? false,
    dataSetupPurchased: (row.data_setup_purchased as boolean) ?? false,
    dataSetupCompleted: (row.data_setup_completed as boolean) ?? false,
    dataSetupScheduledDate: parseDate(row.data_setup_scheduled),
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapToDb(data: Partial<Company>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.name !== undefined) row.name = data.name;
  if (data.logoURL !== undefined) row.logo_url = data.logoURL;
  if (data.externalId !== undefined) row.external_id = data.externalId;
  if (data.companyDescription !== undefined) row.description = data.companyDescription;
  if (data.address !== undefined) row.address = data.address;
  if (data.phone !== undefined) row.phone = data.phone;
  if (data.email !== undefined) row.email = data.email;
  if (data.website !== undefined) row.website = data.website;
  if (data.latitude !== undefined) row.latitude = data.latitude;
  if (data.longitude !== undefined) row.longitude = data.longitude;
  if (data.openHour !== undefined) row.open_hour = data.openHour;
  if (data.closeHour !== undefined) row.close_hour = data.closeHour;
  if (data.industries !== undefined) row.industries = data.industries;
  if (data.companySize !== undefined) row.company_size = data.companySize;
  if (data.companyAge !== undefined) row.company_age = data.companyAge;
  if (data.referralMethod !== undefined) row.referral_method = data.referralMethod;
  if (data.adminIds !== undefined) row.admin_ids = data.adminIds;
  if (data.accountHolderId !== undefined) row.account_holder_id = data.accountHolderId;
  if (data.defaultProjectColor !== undefined) row.default_project_color = data.defaultProjectColor;
  if (data.subscriptionStatus !== undefined) row.subscription_status = data.subscriptionStatus;
  if (data.subscriptionPlan !== undefined) row.subscription_plan = data.subscriptionPlan;
  if (data.subscriptionEnd !== undefined)
    row.subscription_end = data.subscriptionEnd?.toISOString() ?? null;
  if (data.subscriptionPeriod !== undefined) row.subscription_period = data.subscriptionPeriod;
  if (data.maxSeats !== undefined) row.max_seats = data.maxSeats;
  if (data.seatedEmployeeIds !== undefined) row.seated_employee_ids = data.seatedEmployeeIds;
  if (data.seatGraceStartDate !== undefined)
    row.seat_grace_start_date = data.seatGraceStartDate?.toISOString() ?? null;
  if (data.trialStartDate !== undefined)
    row.trial_start_date = data.trialStartDate?.toISOString() ?? null;
  if (data.trialEndDate !== undefined)
    row.trial_end_date = data.trialEndDate?.toISOString() ?? null;
  if (data.hasPrioritySupport !== undefined) row.has_priority_support = data.hasPrioritySupport;
  if (data.dataSetupPurchased !== undefined) row.data_setup_purchased = data.dataSetupPurchased;
  if (data.dataSetupCompleted !== undefined) row.data_setup_completed = data.dataSetupCompleted;
  if (data.dataSetupScheduledDate !== undefined)
    row.data_setup_scheduled = data.dataSetupScheduledDate?.toISOString() ?? null;
  if (data.stripeCustomerId !== undefined) row.stripe_customer_id = data.stripeCustomerId;
  return row;
}

// ─── Company Service ──────────────────────────────────────────────────────────

export const CompanyService = {
  // ═══════════════════════════════════════════════════════════════════════════
  // DATA CRUD (Supabase)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch a single company by ID.
   */
  async fetchCompany(id: string): Promise<Company> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch company: ${error.message}`);
    return mapFromDb(data);
  },

  /**
   * Update company details.
   */
  async updateCompany(id: string, data: Partial<Company>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { error } = await supabase
      .from("companies")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update company: ${error.message}`);
  },

  // ─── Seat Management (Supabase) ────────────────────────────────────────────

  /**
   * Add a user to seated employees.
   */
  async addSeatedEmployee(companyId: string, userId: string): Promise<void> {
    const company = await CompanyService.fetchCompany(companyId);

    if (company.seatedEmployeeIds.includes(userId)) {
      return; // Already seated
    }

    const updatedSeated = [...company.seatedEmployeeIds, userId];

    const supabase = requireSupabase();
    const { error } = await supabase
      .from("companies")
      .update({ seated_employee_ids: updatedSeated })
      .eq("id", companyId);

    if (error) throw new Error(`Failed to add seated employee: ${error.message}`);
  },

  /**
   * Remove a user from seated employees.
   */
  async removeSeatedEmployee(companyId: string, userId: string): Promise<void> {
    const company = await CompanyService.fetchCompany(companyId);

    const updatedSeated = company.seatedEmployeeIds.filter((id) => id !== userId);

    const supabase = requireSupabase();
    const { error } = await supabase
      .from("companies")
      .update({ seated_employee_ids: updatedSeated })
      .eq("id", companyId);

    if (error) throw new Error(`Failed to remove seated employee: ${error.message}`);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTION MANAGEMENT (via Stripe API routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch subscription info — reads directly from companies table.
   */
  async fetchSubscriptionInfo(companyId: string): Promise<{
    status: string | null;
    plan: string | null;
    period: string | null;
    endDate: string | null;
    stripeCustomerId: string | null;
  }> {
    const company = await CompanyService.fetchCompany(companyId);
    return {
      status: company.subscriptionStatus,
      plan: company.subscriptionPlan,
      period: company.subscriptionPeriod,
      endDate: company.subscriptionEnd?.toISOString() ?? null,
      stripeCustomerId: company.stripeCustomerId,
    };
  },

  /**
   * Create a Stripe setup intent for adding a payment method.
   */
  async createSetupIntent(companyId: string): Promise<{ clientSecret: string }> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();

    const response = await fetch("/api/stripe/setup-intent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ companyId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Setup intent failed" }));
      throw new Error(error.error || "Failed to create setup intent");
    }

    return response.json();
  },

  /**
   * Subscribe to a plan (replaces completeSubscription, createSubscriptionWithPayment, subscribeToPlan).
   */
  async subscribe(data: {
    companyId: string;
    plan: string;
    period: "Monthly" | "Annual";
    paymentMethodId?: string;
  }): Promise<{ subscriptionId: string; status: string; clientSecret?: string }> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();

    const response = await fetch("/api/stripe/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Subscribe failed" }));
      throw new Error(error.error || "Failed to subscribe");
    }

    return response.json();
  },

  /**
   * Cancel the company's subscription at period end.
   */
  async cancelSubscription(companyId: string): Promise<void> {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();

    const response = await fetch("/api/stripe/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ companyId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Cancel failed" }));
      throw new Error(error.error || "Failed to cancel subscription");
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IMAGE UPLOADS (via existing /api/uploads/presign route)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a presigned URL for uploading a profile/logo image.
   */
  async getPresignedUrlProfile(
    _companyId: string,
    filename: string,
    contentType: string = "image/jpeg"
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentType, folder: "profiles" }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Presign failed" }));
      throw new Error(error.error || "Failed to get presigned URL");
    }

    return response.json();
  },

  /**
   * Get a presigned URL for uploading project images.
   */
  async getPresignedUrlProject(
    _companyId: string,
    projectId: string,
    filename: string,
    contentType: string = "image/jpeg"
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentType, folder: `projects/${projectId}` }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Presign failed" }));
      throw new Error(error.error || "Failed to get presigned URL");
    }

    return response.json();
  },

  /**
   * Register uploaded project image URLs in Supabase.
   */
  async registerProjectImages(projectId: string, imageUrls: string[]): Promise<void> {
    const supabase = requireSupabase();

    // Fetch current images
    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select("project_images")
      .eq("id", projectId)
      .single();

    if (fetchError) throw new Error(`Failed to fetch project: ${fetchError.message}`);

    const existing = (project?.project_images as string[]) ?? [];
    const updated = [...existing, ...imageUrls];

    const { error: updateError } = await supabase
      .from("projects")
      .update({ project_images: updated })
      .eq("id", projectId);

    if (updateError) throw new Error(`Failed to register images: ${updateError.message}`);
  },
};

export default CompanyService;
