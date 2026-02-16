/**
 * OPS Web - Company Service
 *
 * Complete CRUD operations for Companies including subscription management.
 * Company dates can be UNIX timestamps (Stripe) OR ISO8601 (Bubble).
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
  BubbleCompanyFields,
} from "../../constants/bubble-fields";
import {
  type CompanyDTO,
  type BubbleObjectResponse,
  companyDtoToModel,
  companyModelToDto,
} from "../../types/dto";
import type { Company } from "../../types/models";

// ─── Company Service ──────────────────────────────────────────────────────────

export const CompanyService = {
  /**
   * Fetch a single company by ID.
   */
  async fetchCompany(id: string): Promise<Company> {
    const client = getBubbleClient();

    const response = await client.get<BubbleObjectResponse<CompanyDTO>>(
      `/obj/${BubbleTypes.company.toLowerCase()}/${id}`
    );

    return companyDtoToModel(response.response);
  },

  /**
   * Update company details.
   */
  async updateCompany(
    id: string,
    data: Partial<Company>
  ): Promise<void> {
    const client = getBubbleClient();

    const dto = companyModelToDto(data);

    await client.patch(
      `/obj/${BubbleTypes.company.toLowerCase()}/${id}`,
      dto
    );
  },

  /**
   * Update company via workflow API (for complex operations).
   */
  async updateCompanyWorkflow(
    data: Record<string, unknown>
  ): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/update_company", data);
  },

  /**
   * Update the default project color for the company.
   */
  async updateDefaultProjectColor(
    id: string,
    color: string
  ): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.company.toLowerCase()}/${id}`,
      { [BubbleCompanyFields.defaultProjectColor]: color }
    );
  },

  // ─── Subscription Management ──────────────────────────────────────────────

  /**
   * Fetch subscription info for a company.
   */
  async fetchSubscriptionInfo(
    companyId: string
  ): Promise<Record<string, unknown>> {
    const client = getBubbleClient();

    const response = await client.post<{
      response: Record<string, unknown>;
    }>("/wf/fetch_subscription_info", {
      company_id: companyId,
    });

    return response.response;
  },

  /**
   * Create a Stripe setup intent for adding a payment method.
   */
  async createSetupIntent(
    companyId: string,
    userId: string
  ): Promise<{ clientSecret: string; ephemeralKey: string }> {
    const client = getBubbleClient();

    const response = await client.post<{
      response: {
        client_secret: string;
        ephemeral_key: string;
      };
    }>("/wf/create_subscription_setup_intent", {
      company_id: companyId,
      user_id: userId,
    });

    return {
      clientSecret: response.response.client_secret,
      ephemeralKey: response.response.ephemeral_key,
    };
  },

  /**
   * Complete a subscription purchase.
   */
  async completeSubscription(data: {
    companyId: string;
    userId: string;
    planId: string;
    period: "Monthly" | "Annual";
    paymentMethodId?: string;
  }): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/complete_subscription", {
      company_id: data.companyId,
      user_id: data.userId,
      plan_id: data.planId,
      period: data.period,
      payment_method_id: data.paymentMethodId,
    });
  },

  /**
   * Create a subscription with payment in one step.
   */
  async createSubscriptionWithPayment(data: {
    companyId: string;
    userId: string;
    planId: string;
    period: "Monthly" | "Annual";
    paymentMethodId: string;
  }): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/create_subscription_with_payment", {
      company_id: data.companyId,
      user_id: data.userId,
      plan_id: data.planId,
      period: data.period,
      payment_method_id: data.paymentMethodId,
    });
  },

  /**
   * Cancel the company's subscription.
   */
  async cancelSubscription(companyId: string): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/cancel_subscription", {
      company_id: companyId,
    });
  },

  /**
   * Subscribe user to a specific plan directly.
   */
  async subscribeToPlan(data: {
    userId: string;
    companyId: string;
    planId: string;
    period: "Monthly" | "Annual";
  }): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/subscribe_user_to_plan", {
      user_id: data.userId,
      company_id: data.companyId,
      plan_id: data.planId,
      period: data.period,
    });
  },

  // ─── Seat Management ──────────────────────────────────────────────────────

  /**
   * Add a user to seated employees.
   */
  async addSeatedEmployee(
    companyId: string,
    userId: string
  ): Promise<void> {
    const client = getBubbleClient();

    // Fetch current company to get existing seated employees
    const company = await CompanyService.fetchCompany(companyId);

    if (company.seatedEmployeeIds.includes(userId)) {
      return; // Already seated
    }

    const updatedSeated = [...company.seatedEmployeeIds, userId];

    await client.patch(
      `/obj/${BubbleTypes.company.toLowerCase()}/${companyId}`,
      { [BubbleCompanyFields.seatedEmployees]: updatedSeated }
    );
  },

  /**
   * Remove a user from seated employees.
   */
  async removeSeatedEmployee(
    companyId: string,
    userId: string
  ): Promise<void> {
    const client = getBubbleClient();

    const company = await CompanyService.fetchCompany(companyId);

    const updatedSeated = company.seatedEmployeeIds.filter(
      (id) => id !== userId
    );

    await client.patch(
      `/obj/${BubbleTypes.company.toLowerCase()}/${companyId}`,
      { [BubbleCompanyFields.seatedEmployees]: updatedSeated }
    );
  },

  // ─── Image Upload Workflows ───────────────────────────────────────────────

  /**
   * Get a presigned URL for uploading a profile/logo image.
   */
  async getPresignedUrlProfile(
    companyId: string,
    filename: string,
    contentType: string = "image/jpeg"
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const client = getBubbleClient();

    const response = await client.post<{
      response: {
        upload_url: string;
        public_url: string;
      };
    }>("/wf/get_presigned_url_profile", {
      company_id: companyId,
      filename,
      content_type: contentType,
    });

    return {
      uploadUrl: response.response.upload_url,
      publicUrl: response.response.public_url,
    };
  },

  /**
   * Get a presigned URL for uploading project images.
   */
  async getPresignedUrlProject(
    companyId: string,
    projectId: string,
    filename: string,
    contentType: string = "image/jpeg"
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const client = getBubbleClient();

    const response = await client.post<{
      response: {
        upload_url: string;
        public_url: string;
      };
    }>("/wf/get_presigned_url", {
      company_id: companyId,
      project_id: projectId,
      filename,
      content_type: contentType,
    });

    return {
      uploadUrl: response.response.upload_url,
      publicUrl: response.response.public_url,
    };
  },

  /**
   * Register uploaded project image URLs with Bubble.
   */
  async registerProjectImages(
    projectId: string,
    imageUrls: string[]
  ): Promise<void> {
    const client = getBubbleClient();

    await client.post("/wf/upload_project_images", {
      project_id: projectId,
      image_urls: imageUrls,
    });
  },
};

export default CompanyService;
