/**
 * OPS Web - Email Template Hooks
 *
 * TanStack Query hooks for email template CRUD.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "../api/query-client";
import { EmailTemplateService } from "../api/services/email-template-service";
import { useAuthStore } from "../store/auth-store";
import type {
  CreateEmailTemplate,
  UpdateEmailTemplate,
} from "../types/email-template";

/**
 * Fetch all active templates for the current company (compose modal picker).
 */
export function useEmailTemplates() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.emailTemplates.list(companyId),
    queryFn: () => EmailTemplateService.getTemplates(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch all templates including inactive (Settings management).
 */
export function useAllEmailTemplates() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: [...queryKeys.emailTemplates.list(companyId), "all"] as const,
    queryFn: () => EmailTemplateService.getAllTemplates(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Create a new email template.
 */
export function useCreateEmailTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateEmailTemplate) =>
      EmailTemplateService.createTemplate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.emailTemplates.all,
      });
      toast.success("Template created");
    },
    onError: () => {
      toast.error("Failed to create template");
    },
  });
}

/**
 * Update an existing email template.
 */
export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEmailTemplate }) =>
      EmailTemplateService.updateTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.emailTemplates.all,
      });
      toast.success("Template updated");
    },
    onError: () => {
      toast.error("Failed to update template");
    },
  });
}

/**
 * Delete (soft-delete) an email template.
 */
export function useDeleteEmailTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => EmailTemplateService.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.emailTemplates.all,
      });
      toast.success("Template removed");
    },
    onError: () => {
      toast.error("Failed to remove template");
    },
  });
}
