"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import type { SocialContent } from "@/lib/social/contract";
import type { SocialPostRecord } from "@/lib/social/types";

export type SocialAdminActionBody =
  | { action: "edit"; content: SocialContent }
  | { action: "cancel" }
  | { action: "publish_now" }
  | { action: "retry" };

interface SocialListResponse {
  posts: SocialPostRecord[];
}

interface SocialApiErrorBody {
  error?: string;
  code?: string;
}

export class SocialAdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "SocialAdminApiError";
  }
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & SocialApiErrorBody;
  if (!response.ok) {
    throw new SocialAdminApiError(
      body.error ?? "Social publishing request failed",
      response.status,
      body.code
    );
  }
  return body;
}

async function loadPosts(): Promise<SocialPostRecord[]> {
  const response = await fetch("/api/admin/social/posts?limit=100", {
    cache: "no-store",
  });
  return (await responseBody<SocialListResponse>(response)).posts;
}

async function runAction(input: {
  id: string;
  body: SocialAdminActionBody;
}): Promise<unknown> {
  const response = await fetch(`/api/admin/social/posts/${input.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
  });
  return responseBody(response);
}

export function useSocialPosts() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.socialPublishing.list(),
    queryFn: loadPosts,
    refetchInterval: 30_000,
  });
  const action = useMutation({
    mutationFn: runAction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.socialPublishing.all });
    },
  });

  return {
    posts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    action,
  };
}
