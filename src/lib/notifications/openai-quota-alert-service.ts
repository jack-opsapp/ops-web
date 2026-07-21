import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendOneSignalPush,
  type SendPushParams,
  type SendPushResult,
} from "@/lib/integrations/onesignal";
import {
  createTrustedNotifications,
  type TrustedNotificationInput,
} from "@/lib/notifications/server-notification-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const NOTIFICATION_TYPE = "ai_provider_quota";
const NOTIFICATION_TITLE = "OPENAI CREDITS EXHAUSTED";
const NOTIFICATION_BODY = "OpenAI calls stopped. Add credits now.";
const ADMIN_ACTION_URL = "/admin/platform-health";
const ADMIN_ACTION_LABEL = "CHECK OPENAI";
const DATABASE_TIMEOUT_MS = 1_500;
const PUSH_TIMEOUT_MS = 2_000;
const ACTION_ACCESS_TIMEOUT_MS = 100;
const DEDUPE_PREFIX = "platform-provider:openai:insufficient-quota:";
const MAX_MONITORING_TOKEN_LENGTH = 64;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_SOURCE_PATTERN = /^OPENAI_API_KEY(?:_[A-Z0-9_]+)?$/;
const WORKLOAD_PATTERN = /^[a-z][a-z0-9_]*$/;
const SAFE_LOG_TOKEN_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface OpenAIQuotaIncidentCapture {
  notificationId: string;
  recipientUserId: string;
  dedupeKey: string;
  incidentVersion: number;
}

export interface OpenAIQuotaErrorMetadata {
  status: number;
  code: string;
  type?: string;
  requestId?: string;
  endpoint?: string;
}

export interface ReportOpenAIQuotaExhaustedInput {
  keySource: string;
  workload: string;
  errorMetadata?: OpenAIQuotaErrorMetadata;
}

interface AlertEnvironment {
  OPS_PLATFORM_ALERT_USER_ID?: string;
  OPS_PLATFORM_ALERT_COMPANY_ID?: string;
}

interface ConfiguredRecipient {
  userId: string;
  companyId: string;
  email: string | null;
}

interface TrustedNotificationResult {
  attempted: number;
  errors: number;
  createdRecipientIds: string[];
  createdNotifications: Array<{
    notificationId: string;
    recipientUserId: string;
  }>;
}

interface OpenAIQuotaAlertServiceDependencies {
  db: SupabaseClient;
  env?: AlertEnvironment;
  createNotifications?: (
    input: TrustedNotificationInput,
    db: SupabaseClient
  ) => Promise<TrustedNotificationResult>;
  sendPush?: (params: SendPushParams) => Promise<SendPushResult>;
  databaseTimeoutMs?: number;
  pushTimeoutMs?: number;
  actionAccessTimeoutMs?: number;
  log?: (event: string, metadata: Record<string, string | number>) => void;
}

export interface OpenAIQuotaAlertService {
  reportOpenAIQuotaExhausted(
    input: ReportOpenAIQuotaExhaustedInput
  ): Promise<void>;
  captureOpenAIQuotaIncident(
    keySource: string
  ): Promise<OpenAIQuotaIncidentCapture | null>;
  resolveCapturedOpenAIQuotaIncident(
    capture: OpenAIQuotaIncidentCapture
  ): Promise<void>;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : fallback;
}

async function bounded<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function configuredIdentity(env: AlertEnvironment): {
  userId: string;
  companyId: string;
} {
  const userId = env.OPS_PLATFORM_ALERT_USER_ID?.trim() ?? "";
  const companyId = env.OPS_PLATFORM_ALERT_COMPANY_ID?.trim() ?? "";
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(companyId)) {
    throw new Error("OPS platform alert identity is not configured");
  }
  return { userId, companyId };
}

function isValidKeySource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_MONITORING_TOKEN_LENGTH &&
    KEY_SOURCE_PATTERN.test(value)
  );
}

function dedupeKeyFor(keySource: string): string {
  if (!isValidKeySource(keySource)) {
    throw new Error("OpenAI key source is invalid");
  }
  return `${DEDUPE_PREFIX}${keySource}`;
}

function validateWorkload(workload: string): void {
  if (
    typeof workload !== "string" ||
    workload.length > MAX_MONITORING_TOKEN_LENGTH ||
    !WORKLOAD_PATTERN.test(workload)
  ) {
    throw new Error("OpenAI workload is invalid");
  }
}

function endpointClass(endpoint: string | undefined): string | undefined {
  if (typeof endpoint !== "string") return undefined;
  const routes: Array<[prefix: string, label: string]> = [
    ["/v1/chat/completions", "chat_completions"],
    ["/v1/responses", "responses"],
    ["/v1/embeddings", "embeddings"],
    ["/v1/moderations", "moderations"],
    ["/v1/images", "images"],
    ["/v1/audio", "audio"],
  ];
  const match = routes.find(
    ([prefix]) => endpoint === prefix || endpoint.startsWith(`${prefix}/`)
  );
  return match?.[1] ?? "other";
}

function safeOperationalMetadata(
  input: ReportOpenAIQuotaExhaustedInput
): Record<string, string | number> {
  const metadata: Record<string, string | number> = {
    keySource: input.keySource,
    workload: input.workload,
  };
  const error = input.errorMetadata;
  if (!error) return metadata;

  if (
    Number.isInteger(error.status) &&
    error.status >= 100 &&
    error.status <= 599
  ) {
    metadata.status = error.status;
  }
  if (error.code === "insufficient_quota") {
    metadata.code = error.code;
  }
  if (
    typeof error.type === "string" &&
    error.type.length <= MAX_MONITORING_TOKEN_LENGTH &&
    SAFE_LOG_TOKEN_PATTERN.test(error.type)
  ) {
    metadata.type = error.type;
  }
  if (
    typeof error.requestId === "string" &&
    error.requestId.length <= 128 &&
    SAFE_REQUEST_ID_PATTERN.test(error.requestId)
  ) {
    metadata.requestId = error.requestId;
  }
  const classifiedEndpoint = endpointClass(error.endpoint);
  if (classifiedEndpoint) metadata.endpointClass = classifiedEndpoint;
  return metadata;
}

function defaultOperationalLog(
  event: string,
  metadata: Record<string, string | number>
): void {
  console.error(`[openai-quota] ${event}`, metadata);
}

function canonicalAdminIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function resolveConfiguredRecipient(
  db: SupabaseClient,
  env: AlertEnvironment
): Promise<ConfiguredRecipient> {
  const { userId, companyId } = configuredIdentity(env);
  const { data: user, error: userError } = await db
    .from("users")
    .select("id, company_id, email, is_active, is_company_admin, deleted_at")
    .eq("id", userId)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (userError) {
    throw new Error(`configured recipient lookup failed: ${userError.message}`);
  }
  if (
    !user ||
    user.id !== userId ||
    user.company_id !== companyId ||
    user.is_active !== true ||
    user.deleted_at !== null
  ) {
    throw new Error("configured recipient is unavailable");
  }

  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id, account_holder_id, admin_ids, deleted_at")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (companyError) {
    throw new Error(
      `configured company lookup failed: ${companyError.message}`
    );
  }
  if (!company || company.id !== companyId || company.deleted_at !== null) {
    throw new Error("configured company is unavailable");
  }

  const isCompanyAdmin =
    user.is_company_admin === true ||
    company.account_holder_id === userId ||
    canonicalAdminIds(company.admin_ids).includes(userId);
  if (!isCompanyAdmin) {
    throw new Error("configured recipient is not a company administrator");
  }

  return {
    userId,
    companyId,
    email: typeof user.email === "string" ? user.email.trim() || null : null,
  };
}

async function hasPlatformHealthAccess(
  db: SupabaseClient,
  recipient: ConfiguredRecipient
): Promise<boolean> {
  if (!recipient.email) return false;
  const { data, error } = await db
    .from("admins")
    .select("email")
    .eq("email", recipient.email)
    .maybeSingle();
  return !error && data?.email === recipient.email;
}

function assertCapture(
  capture: OpenAIQuotaIncidentCapture,
  recipient: ConfiguredRecipient
): void {
  const capturedKeySource = capture.dedupeKey.startsWith(DEDUPE_PREFIX)
    ? capture.dedupeKey.slice(DEDUPE_PREFIX.length)
    : null;
  if (
    !UUID_PATTERN.test(capture.notificationId) ||
    capture.recipientUserId !== recipient.userId ||
    !isValidKeySource(capturedKeySource) ||
    !Number.isSafeInteger(capture.incidentVersion) ||
    capture.incidentVersion < 1
  ) {
    throw new Error("quota incident capture is invalid");
  }
}

export function createOpenAIQuotaAlertService({
  db,
  env,
  createNotifications = createTrustedNotifications,
  sendPush = sendOneSignalPush,
  databaseTimeoutMs: requestedDatabaseTimeout,
  pushTimeoutMs: requestedPushTimeout,
  actionAccessTimeoutMs: requestedActionAccessTimeout,
  log = defaultOperationalLog,
}: OpenAIQuotaAlertServiceDependencies): OpenAIQuotaAlertService {
  const alertEnvironment: AlertEnvironment = env ?? {
    OPS_PLATFORM_ALERT_USER_ID: process.env.OPS_PLATFORM_ALERT_USER_ID,
    OPS_PLATFORM_ALERT_COMPANY_ID: process.env.OPS_PLATFORM_ALERT_COMPANY_ID,
  };
  const databaseTimeoutMs = positiveTimeout(
    requestedDatabaseTimeout,
    DATABASE_TIMEOUT_MS
  );
  const pushTimeoutMs = positiveTimeout(requestedPushTimeout, PUSH_TIMEOUT_MS);
  const actionAccessTimeoutMs = positiveTimeout(
    requestedActionAccessTimeout,
    ACTION_ACCESS_TIMEOUT_MS
  );
  const emitOperationalLog = (
    event: string,
    metadata: Record<string, string | number>
  ): void => {
    try {
      log(event, metadata);
    } catch {
      // Diagnostics must never become part of provider request semantics.
    }
  };

  return {
    async reportOpenAIQuotaExhausted(input): Promise<void> {
      let operationalMetadata: Record<string, string | number> | null = null;
      try {
        const dedupeKey = dedupeKeyFor(input.keySource);
        validateWorkload(input.workload);
        operationalMetadata = safeOperationalMetadata(input);
        emitOperationalLog("openai_quota_exhausted", operationalMetadata);
        const newNotification = await bounded(
          async () => {
            const recipient = await resolveConfiguredRecipient(
              db,
              alertEnvironment
            );
            const canOpenPlatformHealth = await bounded(
              () => hasPlatformHealthAccess(db, recipient),
              actionAccessTimeoutMs,
              "Platform health access lookup"
            ).catch(() => false);
            const result = await createNotifications(
              {
                companyId: recipient.companyId,
                recipientUserIds: [recipient.userId],
                type: NOTIFICATION_TYPE,
                title: NOTIFICATION_TITLE,
                body: NOTIFICATION_BODY,
                persistent: true,
                actionUrl: canOpenPlatformHealth ? ADMIN_ACTION_URL : null,
                actionLabel: canOpenPlatformHealth ? ADMIN_ACTION_LABEL : null,
                deepLinkType: null,
                dedupeKey,
              },
              db
            );
            if (result.errors !== 0) {
              throw new Error("quota notification persistence failed");
            }
            if (result.createdNotifications.length === 0) {
              return null;
            }
            if (result.createdNotifications.length !== 1) {
              throw new Error("quota notification identity is ambiguous");
            }
            const created = result.createdNotifications[0];
            if (
              created.recipientUserId !== recipient.userId ||
              !UUID_PATTERN.test(created.notificationId)
            ) {
              throw new Error("quota notification identity is invalid");
            }
            return created;
          },
          databaseTimeoutMs,
          "OpenAI quota notification write"
        );

        if (!newNotification) return;
        try {
          const pushResult = await bounded(
            () =>
              sendPush({
                recipientUserIds: [newNotification.recipientUserId],
                title: NOTIFICATION_TITLE,
                body: NOTIFICATION_BODY,
                data: { type: NOTIFICATION_TYPE, screen: "notifications" },
                idempotencyKey: newNotification.notificationId,
                timeoutMs: pushTimeoutMs,
              }),
            pushTimeoutMs + 100,
            "OpenAI quota push"
          );
          if (!pushResult.ok) {
            emitOperationalLog("openai_quota_push_failed", {
              ...operationalMetadata,
              ...(typeof pushResult.status === "number"
                ? { pushStatus: pushResult.status }
                : {}),
            });
          }
        } catch {
          emitOperationalLog("openai_quota_push_failed", operationalMetadata);
        }
      } catch {
        if (operationalMetadata) {
          emitOperationalLog(
            "openai_quota_notification_failed",
            operationalMetadata
          );
        }
        // Alerting is best effort. Provider errors must retain their original
        // timing and response semantics even when notification systems fail.
      }
    },

    async captureOpenAIQuotaIncident(keySource) {
      const dedupeKey = dedupeKeyFor(keySource);
      return bounded(
        async () => {
          const recipient = await resolveConfiguredRecipient(
            db,
            alertEnvironment
          );
          const { data, error } = await db
            .from("notifications")
            .select("id, incident_version")
            .eq("user_id", recipient.userId)
            .eq("company_id", recipient.companyId)
            .eq("type", NOTIFICATION_TYPE)
            .eq("dedupe_key", dedupeKey)
            .is("resolved_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) {
            throw new Error(`quota notification read failed: ${error.message}`);
          }
          if (!data) return null;
          if (typeof data.id !== "string" || !UUID_PATTERN.test(data.id)) {
            throw new Error("quota notification identity is invalid");
          }
          if (
            !Number.isSafeInteger(data.incident_version) ||
            data.incident_version < 1
          ) {
            throw new Error("quota notification generation is invalid");
          }
          return {
            notificationId: data.id,
            recipientUserId: recipient.userId,
            dedupeKey,
            incidentVersion: data.incident_version,
          };
        },
        databaseTimeoutMs,
        "OpenAI quota notification read"
      );
    },

    async resolveCapturedOpenAIQuotaIncident(capture) {
      await bounded(
        async () => {
          const recipient = await resolveConfiguredRecipient(
            db,
            alertEnvironment
          );
          assertCapture(capture, recipient);
          const { data, error } = await db.rpc(
            "resolve_openai_quota_notification_as_system",
            {
              p_notification_id: capture.notificationId,
              p_user_id: recipient.userId,
              p_company_id: recipient.companyId,
              p_dedupe_key: capture.dedupeKey,
              p_expected_incident_version: capture.incidentVersion,
            }
          );
          if (error) {
            throw new Error(
              `quota notification resolution failed: ${error.message}`
            );
          }
          if (data !== true) {
            throw new Error("quota incident was not resolved");
          }
        },
        databaseTimeoutMs,
        "OpenAI quota notification resolution"
      );
    },
  };
}

function defaultService(): OpenAIQuotaAlertService {
  return createOpenAIQuotaAlertService({ db: getServiceRoleClient() });
}

export async function reportOpenAIQuotaExhausted(
  input: ReportOpenAIQuotaExhaustedInput
): Promise<void> {
  try {
    await defaultService().reportOpenAIQuotaExhausted(input);
  } catch {
    // Construction/configuration failures are monitoring failures only.
  }
}

export async function captureOpenAIQuotaIncident(
  keySource: string
): Promise<OpenAIQuotaIncidentCapture | null> {
  return defaultService().captureOpenAIQuotaIncident(keySource);
}

export async function resolveCapturedOpenAIQuotaIncident(
  capture: OpenAIQuotaIncidentCapture
): Promise<void> {
  return defaultService().resolveCapturedOpenAIQuotaIncident(capture);
}
