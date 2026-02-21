/**
 * OPS Web - Company Service (Supabase + Direct Stripe)
 *
 * Data CRUD → Supabase `companies` table.
 * Subscription/Stripe workflows → /api/stripe/subscription/* (Next.js API routes).
 * Image upload workflows → /api/uploads/presign (S3 presigned URLs).
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
  // SUBSCRIPTION MANAGEMENT (Direct Stripe via Next.js API routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch subscription info for a company directly from Supabase.
   * Replaces: Bubble /wf/fetch_subscription_info
   */
  async fetchSubscriptionInfo(companyId: string): Promise<Record<string, unknown>> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("companies")
      .select(
        "subscription_status, subscription_plan, subscription_period, subscription_end, " +
        "stripe_customer_id, max_seats, seated_employee_ids, trial_start_date, trial_end_date"
      )
      .eq("id", companyId)
      .single();

    if (error || !data) throw new Error(`Failed to fetch subscription: ${error?.message}`);

    const row = data as unknown as Record<string, unknown>;

    return {
      subscriptionStatus: row.subscription_status,
      subscriptionPlan: row.subscription_plan,
      subscriptionPeriod: row.subscription_period,
      subscriptionEnd: row.subscription_end,
      stripeCustomerId: row.stripe_customer_id,
      maxSeats: row.max_seats,
      seatedCount: ((row.seated_employee_ids as string[]) ?? []).length,
      trialStartDate: row.trial_start_date,
      trialEndDate: row.trial_end_date,
    };
  },

  /**
   * Create a Stripe setup intent for adding a payment method.
   * Replaces: Bubble /wf/create_subscription_setup_intent
   */
  async createSetupIntent(
    companyId: string,
    userId: string
  ): Promise<{ clientSecret: string; ephemeralKey: string }> {
    const response = await fetch("/api/stripe/subscription/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, userId }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "Failed to create setup intent");
    }
    return response.json() as Promise<{ clientSecret: string; ephemeralKey: string }>;
  },

  /**
   * Complete a subscription purchase.
   * Replaces: Bubble /wf/complete_subscription
   */
  async completeSubscription(data: {
    companyId: string;
    userId: string;
    planId: string;
    period: "Monthly" | "Annual";
    paymentMethodId?: string;
  }): Promise<void> {
    const response = await fetch("/api/stripe/subscription/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: data.companyId,
        userId: data.userId,
        plan: data.planId,
        period: data.period,
        paymentMethodId: data.paymentMethodId,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "Failed to complete subscription");
    }
  },

  /**
   * Create a subscription with payment in one step.
   * Replaces: Bubble /wf/create_subscription_with_payment
   */
  async createSubscriptionWithPayment(data: {
    companyId: string;
    userId: string;
    planId: string;
    period: "Monthly" | "Annual";
    paymentMethodId: string;
  }): Promise<void> {
    // Same as completeSubscription — payment method is provided
    return CompanyService.completeSubscription(data);
  },

  /**
   * Cancel the company's subscription.
   * Replaces: Bubble /wf/cancel_subscription
   */
  async cancelSubscription(companyId: string): Promise<void> {
    const response = await fetch("/api/stripe/subscription/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "Failed to cancel subscription");
    }
  },

  /**
   * Subscribe user to a specific plan directly.
   * Replaces: Bubble /wf/subscribe_user_to_plan
   */
  async subscribeToPlan(data: {
    userId: string;
    companyId: string;
    planId: string;
    period: "Monthly" | "Annual";
  }): Promise<void> {
    return CompanyService.createSubscriptionWithPayment({
      ...data,
      paymentMethodId: "",
    });
  },

  // ─── Image Upload Workflows (S3 via /api/uploads/presign) ────────────────

  /**
   * Get a presigned URL for uploading a profile/logo image.
   * Calls the internal Next.js API route which generates an S3 presigned URL.
   */
  async getPresignedUrlProfile(
    companyId: string,
    filename: string,
    contentType: string = "image/jpeg"
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        contentType,
        folder: `profiles/${companyId}`,
      }),
    });
    if (!response.ok) throw new Error("Failed to get presigned URL for profile image");
    return response.json();
  },

  /**
   * Get a presigned URL for uploading project images.
   * Calls the internal Next.js API route which generates an S3 presigned URL.
   */
  async getPresignedUrlProject(
    companyId: string,
    projectId: string,
    filename: string,
    contentType: string = "image/jpeg"
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        contentType,
        folder: `projects/${projectId}`,
      }),
    });
    if (!response.ok) throw new Error("Failed to get presigned URL for project image");
    return response.json();
  },

  /**
   * Register uploaded project image URLs directly in Supabase.
   * Images are stored in projects.project_images array.
   */
  async registerProjectImages(
    projectId: string,
    imageUrls: string[]
  ): Promise<void> {
    // Images are now stored directly in Supabase projects.project_images array.
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("projects")
      .update({ project_images: imageUrls })
      .eq("id", projectId);

    if (error) throw new Error(`Failed to register project images: ${error.message}`);
  },
};

export default CompanyService;
