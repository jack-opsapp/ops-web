import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-client";
import type {
  EmailSignatureScope,
  EmailSignatureSettingsResponse,
  SaveEmailSignatureInput,
} from "@/lib/types/email-signature";
import { authedFetch } from "@/lib/utils/authed-fetch";

const SIGNATURE_ROUTE = "/api/integrations/email/signature";

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? fallback;
}

async function fetchEmailSignature(
  scope: EmailSignatureScope
): Promise<EmailSignatureSettingsResponse> {
  const params = new URLSearchParams({
    companyId: scope.companyId,
    userId: scope.userId,
    connectionId: scope.connectionId,
  });
  const response = await authedFetch(`${SIGNATURE_ROUTE}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(
      await readError(response, "Failed to load email signature")
    );
  }
  return response.json();
}

async function saveEmailSignature(
  input: SaveEmailSignatureInput
): Promise<EmailSignatureSettingsResponse> {
  const response = await authedFetch(SIGNATURE_ROUTE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      await readError(response, "Failed to save email signature")
    );
  }
  return response.json();
}

async function importProviderEmailSignature(
  scope: EmailSignatureScope
): Promise<EmailSignatureSettingsResponse> {
  const response = await authedFetch(SIGNATURE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...scope, action: "import_provider" }),
  });
  if (!response.ok) {
    throw new Error(
      await readError(response, "Failed to import provider signature")
    );
  }
  return response.json();
}

export function useEmailSignature(scope: EmailSignatureScope) {
  const enabled = Boolean(
    scope.companyId && scope.userId && scope.connectionId
  );

  return useQuery({
    queryKey: queryKeys.emailSignatures.detail(
      scope.companyId,
      scope.userId,
      scope.connectionId
    ),
    queryFn: () => fetchEmailSignature(scope),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveEmailSignature() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveEmailSignature,
    onSuccess: (data, input) => {
      queryClient.setQueryData(
        queryKeys.emailSignatures.detail(
          input.companyId,
          input.userId,
          input.connectionId
        ),
        data
      );
    },
  });
}

export function useImportProviderEmailSignature() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: importProviderEmailSignature,
    onSuccess: (data, scope) => {
      queryClient.setQueryData(
        queryKeys.emailSignatures.detail(
          scope.companyId,
          scope.userId,
          scope.connectionId
        ),
        data
      );
    },
  });
}
