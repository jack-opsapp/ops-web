"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import type { SocialContent } from "@/lib/social/contract";
import type { SocialPostRecord } from "@/lib/social/types";
import type { InstagramConnectionStatus } from "@/lib/social/instagram-connection-types";

const ACTIVE_SOCIAL_STATUSES = new Set(["rendering", "review", "publishing"]);

export type SocialAdminActionBody =
  | { action: "edit"; content: SocialContent }
  | { action: "cancel" }
  | { action: "publish_now" }
  | { action: "retry" };

interface SocialListResponse {
  posts: SocialPostRecord[];
}

interface InstagramConnectionResponse {
  connection: InstagramConnectionStatus;
}

interface InstagramAuthorizationResponse {
  authorizationUrl: string;
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
  const body = (await response.json().catch(() => ({}))) as T &
    SocialApiErrorBody;
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
    refetchInterval: (current) =>
      current.state.data?.some((post) =>
        ACTIVE_SOCIAL_STATUSES.has(post.status)
      )
        ? 30_000
        : false,
  });
  const action = useMutation({
    mutationFn: runAction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.socialPublishing.all,
      });
    },
  });

  return {
    posts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    action,
  };
}

async function loadInstagramConnection(): Promise<InstagramConnectionStatus> {
  const response = await fetch("/api/admin/social/instagram", {
    cache: "no-store",
  });
  return (await responseBody<InstagramConnectionResponse>(response)).connection;
}

async function beginInstagramConnection(): Promise<InstagramAuthorizationResponse> {
  const response = await fetch("/api/admin/social/instagram", {
    method: "POST",
  });
  const body = await responseBody<InstagramAuthorizationResponse>(response);
  const destination = new URL(body.authorizationUrl);
  if (destination.protocol !== "https:") {
    throw new SocialAdminApiError(
      "Instagram returned an invalid login destination",
      502,
      "INSTAGRAM_AUTHORIZATION_URL_INVALID"
    );
  }
  return { authorizationUrl: destination.toString() };
}

async function disconnectInstagram(): Promise<{ ok: true }> {
  const response = await fetch("/api/admin/social/instagram", {
    method: "DELETE",
  });
  return responseBody<{ ok: true }>(response);
}

export function useInstagramConnection() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.socialPublishing.instagramConnection(),
    queryFn: loadInstagramConnection,
  });
  const connect = useMutation({ mutationFn: beginInstagramConnection });
  const disconnect = useMutation({
    mutationFn: disconnectInstagram,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.socialPublishing.instagramConnection(),
      });
    },
  });

  return {
    connection: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    connect,
    disconnect,
  };
}
