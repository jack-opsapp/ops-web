import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CURRENT_USER_ID = "e2e-user-inbox-operator";
const AUTH_TOKEN = "mock-id-token";
const E2E_ORIGIN =
  process.env.E2E_BASE_URL ??
  `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
const FIREBASE_FALLBACK_API_KEY = "ops-e2e-api-key";

export const inboxPopulatedFixture = {
  companyId: "e2e-company-maverick-projects",
  clientId: "e2e-client-calloway-roofing",
  threadId: "e2e-thread-calloway-roof-flashing",
  providerThreadId: "provider-thread-calloway-roof-flashing",
  connectionId: "e2e-connection-ops-inbox",
  opportunityId: "e2e-opportunity-roof-flashing",
  wonOpportunityId: "e2e-opportunity-won-maintenance",
  projectId: "e2e-project-roof-flashing",
  commitmentId: "e2e-commitment-roof-flashing",
  subject: "Roof flashing decision before Friday pour",
  clientName: "Calloway Roofing Co.",
  inboundSenderName: "Jeanne Calloway",
  inboundSenderEmail: "jeanne@callowayroof.co",
};

export type InboxPopulatedInterceptKey =
  | "api:threads"
  | "api:thread-detail"
  | "api:drafts"
  | "api:attachments"
  | "supabase:clients"
  | "supabase:sub_clients"
  | "supabase:email_threads"
  | "supabase:opportunity_email_threads"
  | "supabase:opportunities"
  | "supabase:projects"
  | "supabase:project_tasks"
  | "supabase:project_photos"
  | "supabase:estimates"
  | "supabase:invoices";

export interface InboxPopulatedFixtureRoutes {
  seen: Set<InboxPopulatedInterceptKey>;
}

type InboxPopulatedFixtureState = {
  unreadCount: number;
};

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function firebaseApiKeys(): string[] {
  const keys = new Set<string>([FIREBASE_FALLBACK_API_KEY]);
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    keys.add(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  }

  try {
    const envLocal = readFileSync(".env.local", "utf8");
    const match = envLocal.match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(.+)$/m);
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (value) keys.add(value);
  } catch {
    // Optional local env file. The Playwright config still provides fallback.
  }

  return [...keys];
}

function postgrestHeaders(count?: number): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (count !== undefined) {
    headers["content-range"] = count > 0 ? `0-${count - 1}/${count}` : "*/0";
  }
  return headers;
}

async function fulfillJson(route: Route, body: unknown, count?: number) {
  await route.fulfill({
    status: 200,
    headers: postgrestHeaders(count),
    body: JSON.stringify(body),
  });
}

function e2eUser() {
  return {
    id: CURRENT_USER_ID,
    firstName: "E2E",
    lastName: "Operator",
    email: "e2e-operator@ops.test",
    phone: null,
    profileImageURL: null,
    role: "admin",
    companyId: inboxPopulatedFixture.companyId,
    userType: "employee",
    latitude: null,
    longitude: null,
    locationName: null,
    homeAddress: null,
    clientId: null,
    isActive: true,
    userColor: null,
    devPermission: true,
    onboardingCompleted: { web: true },
    hasCompletedAppTutorial: true,
    isCompanyAdmin: true,
    specialPermissions: [],
    setupProgress: { steps: { identity: true, company: true } },
    stripeCustomerId: null,
    deviceToken: null,
    fabActions: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
  };
}

function e2eCompany() {
  return {
    id: inboxPopulatedFixture.companyId,
    name: "Maverick Projects",
    logoURL: null,
    externalId: null,
    companyCode: "E2E",
    companyDescription: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    latitude: null,
    longitude: null,
    openHour: null,
    closeHour: null,
    industries: [],
    companySize: null,
    companyAge: null,
    referralMethod: null,
    projectIds: [],
    teamIds: [],
    adminIds: [CURRENT_USER_ID],
    accountHolderId: CURRENT_USER_ID,
    defaultProjectColor: "#6F94B0",
    teamMembersSynced: true,
    subscriptionStatus: "active",
    subscriptionPlan: "team",
    subscriptionEnd: null,
    subscriptionPeriod: null,
    maxSeats: 50,
    seatedEmployeeIds: [CURRENT_USER_ID],
    seatGraceStartDate: null,
    trialStartDate: null,
    trialEndDate: null,
    hasPrioritySupport: false,
    dataSetupPurchased: false,
    dataSetupCompleted: false,
    dataSetupScheduledDate: null,
    stripeCustomerId: null,
    preciseSchedulingEnabled: true,
    skipWeekendsInAutoSchedule: false,
    defaultWorkStart: "08:00",
    defaultWorkEnd: "17:00",
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
  };
}

function dashboardPreferencesRow() {
  return {
    id: "e2e-dashboard-preferences",
    user_id: CURRENT_USER_ID,
    company_id: inboxPopulatedFixture.companyId,
    widget_instances: [
      {
        id: "e2e-inbox-layout-anchor",
        type: "metrics",
        position: 0,
        size: "medium",
        config: {},
      },
    ],
    dashboard_layout: "default",
    scheduling_type: "both",
    map_default_zoom: 12,
    map_default_center: null,
    map_show_traffic: false,
    map_show_crew_labels: true,
    created_at: iso(-30 * DAY),
    updated_at: iso(-1 * DAY),
  };
}

function routeForAuthAndShell(route: Route, url: URL) {
  const path = url.pathname;
  const method = route.request().method();

  if (url.hostname.includes("identitytoolkit.googleapis.com")) {
    if (path.includes("accounts:lookup")) {
      return fulfillJson(route, {
        users: [
          {
            localId: CURRENT_USER_ID,
            email: "e2e-operator@ops.test",
            displayName: "E2E Operator",
            emailVerified: true,
            providerUserInfo: [],
          },
        ],
      });
    }

    return fulfillJson(route, {
      kind: "identitytoolkit#VerifyCustomTokenResponse",
      idToken: AUTH_TOKEN,
      refreshToken: "mock-refresh-token",
      expiresIn: "3600",
      isNewUser: false,
      localId: CURRENT_USER_ID,
      email: "e2e-operator@ops.test",
      displayName: "E2E Operator",
    });
  }

  if (url.hostname.includes("securetoken.googleapis.com")) {
    return fulfillJson(route, {
      id_token: AUTH_TOKEN,
      refresh_token: "mock-refresh-token",
      expires_in: "3600",
      user_id: CURRENT_USER_ID,
    });
  }

  if (path === "/api/dev/bypass-token") {
    if (method === "GET") {
      return fulfillJson(route, {
        key: "e2e",
        email: "e2e-operator@ops.test",
        label: "E2E Operator",
        available: [],
      });
    }
    return fulfillJson(route, {
      token: "mock-custom-token",
      email: "e2e-operator@ops.test",
    });
  }

  if (path === "/api/auth/sync-user") {
    return fulfillJson(route, {
      user: e2eUser(),
      company: e2eCompany(),
    });
  }

  if (path === "/api/feature-flags") {
    return fulfillJson(route, [
      {
        slug: "pipeline",
        enabled: true,
        hasOverride: false,
        routes: ["/pipeline"],
        permissions: [
          "pipeline.view",
          "pipeline.manage",
          "pipeline.configure_stages",
        ],
      },
      {
        slug: "portal",
        enabled: true,
        hasOverride: false,
        routes: ["/inbox"],
        permissions: ["portal.view", "portal.manage_branding"],
      },
    ]);
  }

  if (path === "/api/dashboard-preferences") {
    return fulfillJson(route, dashboardPreferencesRow());
  }

  if (path === "/api/agent/queue") {
    return fulfillJson(
      route,
      url.searchParams.get("countOnly") === "true"
        ? { count: 0 }
        : { actions: [] }
    );
  }

  if (path === "/api/duplicates") {
    return fulfillJson(route, { reviews: [] });
  }

  return route.fallback();
}

function selectedThreadRow(state: InboxPopulatedFixtureState) {
  return {
    id: inboxPopulatedFixture.threadId,
    connectionId: inboxPopulatedFixture.connectionId,
    providerThreadId: inboxPopulatedFixture.providerThreadId,
    primaryCategory: "CUSTOMER",
    categoryConfidence: 0.94,
    categoryManuallySet: false,
    labels: ["AWAITING_REPLY", "HAS_ATTACHMENT"],
    archivedAt: null,
    snoozedUntil: null,
    priorityScore: 91,
    aiSummary:
      "Calloway needs a flashing call before the Friday concrete pour. Reply with the selected curb detail and confirm delivery window.",
    subject: inboxPopulatedFixture.subject,
    participants: [
      inboxPopulatedFixture.inboundSenderEmail,
      "ops@maverickprojects.test",
    ],
    firstMessageAt: iso(-3 * HOUR),
    lastMessageAt: iso(-2 * HOUR),
    messageCount: 4,
    unreadCount: state.unreadCount,
    latestDirection: "inbound" as const,
    latestSenderEmail: inboxPopulatedFixture.inboundSenderEmail,
    latestSenderName: inboxPopulatedFixture.inboundSenderName,
    latestSnippet:
      "Need the final flashing call before we pour. Crew is holding at bay three until you confirm.",
    opportunityId: inboxPopulatedFixture.opportunityId,
    clientId: inboxPopulatedFixture.clientId,
    clientName: inboxPopulatedFixture.clientName,
    nextCommitmentDueAt: iso(3 * HOUR),
    hasUnresolvedCommitments: true,
    nextCommitmentId: inboxPopulatedFixture.commitmentId,
    phaseC: "none" as const,
    agentBlockingQuestion: null,
  };
}

function siblingThreadRow() {
  return {
    id: "e2e-thread-calloway-invoice-closeout",
    connection_id: inboxPopulatedFixture.connectionId,
    provider_thread_id: "provider-thread-calloway-invoice-closeout",
    company_id: inboxPopulatedFixture.companyId,
    primary_category: "CUSTOMER",
    category_confidence: 0.88,
    category_classified_at: iso(-5 * DAY),
    category_classifier_version: "v2",
    category_manually_set: false,
    labels: ["HAS_INVOICE"],
    archived_at: null,
    snoozed_until: null,
    priority_score: 42,
    ai_summary: "Invoice closeout is waiting on owner approval.",
    subject: "Invoice closeout for maintenance block",
    participants: [
      inboxPopulatedFixture.inboundSenderEmail,
      "ops@maverickprojects.test",
    ],
    first_message_at: iso(-9 * DAY),
    last_message_at: iso(-5 * DAY),
    message_count: 3,
    unread_count: 0,
    latest_direction: "outbound",
    latest_sender_email: "ops@maverickprojects.test",
    latest_sender_name: "OPS",
    latest_snippet: "Sent the closeout package and invoice PDF.",
    opportunity_id: inboxPopulatedFixture.wonOpportunityId,
    client_id: inboxPopulatedFixture.clientId,
    next_commitment_due_at: null,
    has_unresolved_commitments: false,
    agent_blocking_question: null,
    created_at: iso(-10 * DAY),
    updated_at: iso(-5 * DAY),
  };
}

function threadDetail(state: InboxPopulatedFixtureState) {
  return {
    thread: {
      id: inboxPopulatedFixture.threadId,
      primaryCategory: "CUSTOMER",
      categoryConfidence: 0.94,
      categoryManuallySet: false,
      labels: ["AWAITING_REPLY", "HAS_ATTACHMENT"],
      archivedAt: null,
      snoozedUntil: null,
      aiSummary:
        "Calloway needs a flashing call before the Friday concrete pour. Reply with the selected curb detail and confirm delivery window.",
      subject: inboxPopulatedFixture.subject,
      participants: [
        inboxPopulatedFixture.inboundSenderEmail,
        "ops@maverickprojects.test",
      ],
      messageCount: 4,
      unreadCount: state.unreadCount,
      opportunityId: inboxPopulatedFixture.opportunityId,
      clientId: inboxPopulatedFixture.clientId,
      clientName: inboxPopulatedFixture.clientName,
      latestDirection: "inbound",
      phaseC: "none",
      agentBlockingQuestion: null,
    },
    messages: [
      {
        id: "msg-001",
        from: inboxPopulatedFixture.inboundSenderEmail,
        fromName: inboxPopulatedFixture.inboundSenderName,
        to: ["ops@maverickprojects.test"],
        cc: [],
        subject: inboxPopulatedFixture.subject,
        snippet:
          "Can you confirm whether we are going with the standing seam curb flashing before Friday?",
        bodyText:
          "Can you confirm whether we are going with the standing seam curb flashing before Friday?\n\nThe concrete crew needs the answer before they lock the forms.",
        cleanBodyText:
          "Can you confirm whether we are going with the standing seam curb flashing before Friday?\n\nThe concrete crew needs the answer before they lock the forms.",
        direction: "inbound",
        date: iso(-3 * HOUR),
        isRead: true,
        hasAttachments: true,
      },
      {
        id: "msg-002",
        from: "ops@maverickprojects.test",
        fromName: "Jackson",
        to: [inboxPopulatedFixture.inboundSenderEmail],
        cc: [],
        subject: `Re: ${inboxPopulatedFixture.subject}`,
        snippet:
          "Holding for one measurement. I will send the final curb detail before the end of day.",
        bodyText:
          "Holding for one measurement. I will send the final curb detail before the end of day.",
        cleanBodyText:
          "Holding for one measurement. I will send the final curb detail before the end of day.",
        direction: "outbound",
        date: iso(-2.5 * HOUR),
        isRead: true,
        hasAttachments: false,
      },
      {
        id: "msg-003",
        from: inboxPopulatedFixture.inboundSenderEmail,
        fromName: inboxPopulatedFixture.inboundSenderName,
        to: ["ops@maverickprojects.test"],
        cc: ["sitelead@callowayroof.co"],
        subject: `Re: ${inboxPopulatedFixture.subject}`,
        snippet:
          "Need the final flashing call before we pour. Crew is holding at bay three until you confirm.",
        bodyText:
          "Need the final flashing call before we pour.\n\nCrew is holding at bay three until you confirm the detail and delivery window.",
        cleanBodyText:
          "Need the final flashing call before we pour.\n\nCrew is holding at bay three until you confirm the detail and delivery window.",
        direction: "inbound",
        date: iso(-2 * HOUR),
        isRead: state.unreadCount === 0,
        hasAttachments: true,
      },
    ],
    siblingThreads: [
      {
        id: "e2e-thread-calloway-invoice-closeout",
        connectionId: inboxPopulatedFixture.connectionId,
        providerThreadId: "provider-thread-calloway-invoice-closeout",
        subject: "Invoice closeout for maintenance block",
        primaryCategory: "CUSTOMER",
        lastMessageAt: iso(-5 * DAY),
        messageCount: 3,
        unreadCount: 0,
        latestSenderName: "OPS",
        latestSenderEmail: "ops@maverickprojects.test",
        latestSnippet: "Sent the closeout package and invoice PDF.",
        archivedAt: null,
        snoozedUntil: null,
      },
    ],
    commitments: [
      {
        id: inboxPopulatedFixture.commitmentId,
        content: "Send final curb flashing selection before the Friday pour.",
        dueDate: iso(3 * HOUR),
        confidence: 0.91,
        createdAt: iso(-2 * HOUR),
      },
    ],
  };
}

function clientRow() {
  return {
    id: inboxPopulatedFixture.clientId,
    name: inboxPopulatedFixture.clientName,
    email: inboxPopulatedFixture.inboundSenderEmail,
    phone_number: "604-555-0184",
    address: "5421 Ash St, Vancouver BC",
    latitude: 49.233,
    longitude: -123.101,
    profile_image_url: null,
    notes: "Property management client. Four active buildings.",
    company_id: inboxPopulatedFixture.companyId,
    created_at: iso(-180 * DAY),
    deleted_at: null,
    sub_clients: [
      {
        id: "e2e-subclient-bay-three",
        name: "Bay three roofline",
        title: "Warehouse envelope",
        email: "sitelead@callowayroof.co",
        phone_number: "604-555-0191",
        address: "5421 Ash St, Vancouver BC",
        client_id: inboxPopulatedFixture.clientId,
        created_at: iso(-120 * DAY),
        updated_at: iso(-7 * DAY),
        deleted_at: null,
      },
    ],
  };
}

function activeOpportunityRow() {
  return {
    id: inboxPopulatedFixture.opportunityId,
    company_id: inboxPopulatedFixture.companyId,
    client_id: inboxPopulatedFixture.clientId,
    title: "Bay three curb flashing",
    description:
      "Confirm flashing detail, deliver material, keep pour on schedule.",
    contact_name: inboxPopulatedFixture.inboundSenderName,
    contact_email: inboxPopulatedFixture.inboundSenderEmail,
    contact_phone: "604-555-0184",
    stage: "quoting",
    source: "email",
    assigned_to: null,
    priority: "high",
    estimated_value: 18400,
    actual_value: null,
    win_probability: 0.72,
    expected_close_date: iso(2 * DAY),
    actual_close_date: null,
    stage_entered_at: iso(-2 * DAY),
    project_id: null,
    lost_reason: null,
    lost_notes: null,
    source_email_id: inboxPopulatedFixture.threadId,
    correspondence_count: 4,
    outbound_count: 1,
    inbound_count: 3,
    last_inbound_at: iso(-2 * HOUR),
    last_outbound_at: iso(-2.5 * HOUR),
    last_message_direction: "in",
    ai_summary:
      "Decision needed before concrete pour. Strong expansion path if OPS keeps the job moving.",
    ai_stage_confidence: 0.83,
    ai_stage_signals: ["deadline", "material decision", "repeat client"],
    detected_value: 18400,
    quote_delivery_method: "email",
    address: "5421 Ash St, Vancouver BC",
    latitude: 49.233,
    longitude: -123.101,
    last_activity_at: iso(-2 * HOUR),
    next_follow_up_at: iso(3 * HOUR),
    tags: ["roofing", "urgent"],
    created_at: iso(-4 * DAY),
    updated_at: iso(-2 * HOUR),
    deleted_at: null,
    archived_at: null,
  };
}

function wonOpportunityRow() {
  return {
    ...activeOpportunityRow(),
    id: inboxPopulatedFixture.wonOpportunityId,
    title: "Spring maintenance block",
    description: "Completed maintenance block for west warehouse roofline.",
    stage: "won",
    estimated_value: 9600,
    actual_value: 9400,
    win_probability: 1,
    actual_close_date: iso(-18 * DAY),
    stage_entered_at: iso(-18 * DAY),
    project_id: "e2e-project-maintenance-block",
    source_email_id: "e2e-thread-calloway-invoice-closeout",
    correspondence_count: 8,
    outbound_count: 5,
    inbound_count: 3,
    last_inbound_at: iso(-22 * DAY),
    last_outbound_at: iso(-18 * DAY),
    last_message_direction: "out",
    ai_summary: "Closed maintenance block. Invoice sent.",
    tags: ["roofing", "maintenance"],
    created_at: iso(-40 * DAY),
    updated_at: iso(-18 * DAY),
  };
}

function projectRow() {
  return {
    id: inboxPopulatedFixture.projectId,
    title: "Calloway bay three roof curb",
    address: "5421 Ash St, Vancouver BC",
    latitude: 49.233,
    longitude: -123.101,
    start_date: iso(2 * DAY),
    end_date: iso(4 * DAY),
    duration: 2,
    status: "in_progress",
    notes: "Crew is waiting on the final curb flashing selection.",
    company_id: inboxPopulatedFixture.companyId,
    client_id: inboxPopulatedFixture.clientId,
    all_day: false,
    team_member_ids: [],
    description: "Roof curb detail and pour coordination.",
    project_images: [],
    trade: "roofing",
    visibility: "all",
    opportunity_id: inboxPopulatedFixture.opportunityId,
    created_at: iso(-5 * DAY),
    deleted_at: null,
  };
}

function taskRows() {
  const project = {
    ...projectRow(),
    client: clientRow(),
  };
  return [
    {
      id: "e2e-task-confirm-flashing",
      project_id: inboxPopulatedFixture.projectId,
      company_id: inboxPopulatedFixture.companyId,
      status: "active",
      task_color: "#6F94B0",
      task_notes: "Confirm the final curb flashing selection.",
      task_type_id: "e2e-task-type-site",
      display_order: 1,
      custom_title: "Confirm curb flashing detail",
      team_member_ids: [],
      source_line_item_id: null,
      source_estimate_id: null,
      dependency_overrides: null,
      start_date: iso(3 * HOUR),
      end_date: iso(5 * HOUR),
      duration: 1,
      start_time: "13:00:00",
      end_time: "15:00:00",
      all_day: false,
      recurrence_id: null,
      recurrence_origin_date: null,
      schedule_confirmed_at: null,
      schedule_confirmed_by: null,
      updated_at: iso(-30 * MINUTE),
      inventory_deducted: false,
      deleted_at: null,
      task_type: {
        id: "e2e-task-type-site",
        display: "Site decision",
        color: "#6F94B0",
        icon: null,
        is_default: false,
        company_id: inboxPopulatedFixture.companyId,
        display_order: 1,
        default_team_member_ids: [],
        dependencies: [],
        deleted_at: null,
      },
      project,
    },
  ];
}

function routeForApi(
  route: Route,
  url: URL,
  seen: Set<InboxPopulatedInterceptKey>,
  state: InboxPopulatedFixtureState
) {
  const path = url.pathname;
  const method = route.request().method();
  const filter = url.searchParams.get("filter");

  if (path === `/api/inbox/threads/${inboxPopulatedFixture.threadId}`) {
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as {
        action?: string;
        isRead?: boolean;
      };
      if (body.action === "archive") {
        return fulfillJson(route, {
          needsConfirmation: true,
          connectionId: inboxPopulatedFixture.connectionId,
          leadPreference: "ask",
          linkedOpportunity: {
            id: inboxPopulatedFixture.opportunityId,
            title: "Bay three curb flashing",
          },
          siblingThreads: [
            {
              id: "e2e-thread-calloway-invoice-closeout",
              subject: "Invoice closeout for maintenance block",
              latestSenderName: "OPS",
              latestSenderEmail: "ops@maverickprojects.test",
              latestSnippet: "Sent the closeout package and invoice PDF.",
              lastMessageAt: iso(-5 * DAY),
            },
          ],
        });
      }

      if (body.action === "markRead" && typeof body.isRead === "boolean") {
        state.unreadCount = body.isRead ? 0 : 1;
      }

      return fulfillJson(route, { ok: true });
    }

    if (method === "GET") {
      seen.add("api:thread-detail");
      return fulfillJson(route, threadDetail(state));
    }
  }

  if (
    path === `/api/inbox/threads/${inboxPopulatedFixture.threadId}/attachments`
  ) {
    seen.add("api:attachments");
    return fulfillJson(route, {
      attachments: [
        {
          id: "msg-003:att-flashing-pdf",
          messageId: "msg-003",
          attachmentId: "att-flashing-pdf",
          filename: "curb-flashing-field-measure.pdf",
          mimeType: "application/pdf",
          size: 842_112,
          fromEmail: inboxPopulatedFixture.inboundSenderEmail,
          date: iso(-2 * HOUR),
          url: "/api/integrations/email/attachment?companyId=e2e-company-maverick-projects&messageId=msg-003&attachmentId=att-flashing-pdf&mimeType=application%2Fpdf",
        },
        {
          id: "msg-001:att-site-photo",
          messageId: "msg-001",
          attachmentId: "att-site-photo",
          filename: "bay-three-curb-photo.jpg",
          mimeType: "image/jpeg",
          size: 1_321_904,
          fromEmail: inboxPopulatedFixture.inboundSenderEmail,
          date: iso(-3 * HOUR),
          url: "/api/integrations/email/attachment?companyId=e2e-company-maverick-projects&messageId=msg-001&attachmentId=att-site-photo&mimeType=image%2Fjpeg",
        },
      ],
    });
  }

  if (path === "/api/inbox/threads") {
    seen.add("api:threads");
    if (filter === "SNOOZED" || filter === "ARCHIVED" || filter === "WAITING") {
      return fulfillJson(route, { threads: [], nextCursor: null });
    }
    return fulfillJson(route, {
      threads: [selectedThreadRow(state)],
      nextCursor: null,
    });
  }

  if (path === "/api/inbox/drafts") {
    seen.add("api:drafts");
    return fulfillJson(route, {
      drafts: [
        {
          source: "provider",
          id: "e2e-draft-roof-flashing",
          threadId: inboxPopulatedFixture.providerThreadId,
          connectionId: inboxPopulatedFixture.connectionId,
          fromEmail: "ops@maverickprojects.test",
          to: [inboxPopulatedFixture.inboundSenderEmail],
          cc: [],
          subject: `Re: ${inboxPopulatedFixture.subject}`,
          bodyText:
            "Use the standing seam curb flashing. Material lands by 14:00 and the pour can hold schedule.",
          updatedAt: iso(-20 * MINUTE),
        },
      ],
    });
  }

  return route.fallback();
}

function routeForSupabase(
  route: Route,
  url: URL,
  seen: Set<InboxPopulatedInterceptKey>
) {
  const restIndex = url.pathname.indexOf("/rest/v1/");
  if (restIndex === -1 || route.request().method() !== "GET") {
    return route.fallback();
  }

  const table = url.pathname.slice(restIndex + "/rest/v1/".length);
  const query = url.searchParams;

  if (
    table === "clients" &&
    query.get("id") === `eq.${inboxPopulatedFixture.clientId}`
  ) {
    seen.add("supabase:clients");
    return fulfillJson(route, clientRow());
  }

  if (
    table === "sub_clients" &&
    query.get("client_id") === `eq.${inboxPopulatedFixture.clientId}`
  ) {
    seen.add("supabase:sub_clients");
    return fulfillJson(route, clientRow().sub_clients, 1);
  }

  if (
    table === "email_threads" &&
    query.get("client_id") === `eq.${inboxPopulatedFixture.clientId}`
  ) {
    seen.add("supabase:email_threads");
    return fulfillJson(route, [siblingThreadRow()], 1);
  }

  if (
    table === "opportunity_email_threads" &&
    query.get("thread_id") === `eq.${inboxPopulatedFixture.threadId}`
  ) {
    seen.add("supabase:opportunity_email_threads");
    return fulfillJson(
      route,
      [{ opportunity_id: inboxPopulatedFixture.opportunityId }],
      1
    );
  }

  if (
    table === "opportunities" &&
    query.get("client_id") === `eq.${inboxPopulatedFixture.clientId}`
  ) {
    seen.add("supabase:opportunities");
    const stage = query.get("stage") ?? "";
    const rows = stage.includes("won")
      ? [wonOpportunityRow()]
      : [activeOpportunityRow()];
    return fulfillJson(route, rows, rows.length);
  }

  if (
    table === "projects" &&
    query.get("client_id") === `eq.${inboxPopulatedFixture.clientId}`
  ) {
    seen.add("supabase:projects");
    return fulfillJson(route, [projectRow()], 1);
  }

  if (
    table === "project_tasks" &&
    query.get("project_id") === `eq.${inboxPopulatedFixture.projectId}`
  ) {
    seen.add("supabase:project_tasks");
    return fulfillJson(route, taskRows(), taskRows().length);
  }

  if (
    table === "project_photos" &&
    query.get("project_id") === `eq.${inboxPopulatedFixture.projectId}`
  ) {
    seen.add("supabase:project_photos");
    return fulfillJson(
      route,
      [
        {
          id: "e2e-photo-curb-bay-three",
          project_id: inboxPopulatedFixture.projectId,
          company_id: inboxPopulatedFixture.companyId,
          url: "/placeholder.svg",
          thumbnail_url: "/placeholder.svg",
          source: "site_visit",
          site_visit_id: null,
          uploaded_by: "sitelead@callowayroof.co",
          taken_at: iso(-3 * HOUR),
          caption: "Bay three curb before pour",
          deleted_at: null,
          created_at: iso(-3 * HOUR),
          is_client_visible: true,
        },
      ],
      1
    );
  }

  if (
    table === "estimates" &&
    query.get("client_id") === `eq.${inboxPopulatedFixture.clientId}`
  ) {
    seen.add("supabase:estimates");
    return fulfillJson(
      route,
      [
        {
          id: "e2e-estimate-roof-flashing",
          estimate_number: "EST-2041",
          status: "sent",
          pdf_storage_path: "/documents/EST-2041.pdf",
          updated_at: iso(-1 * DAY),
          total: 18400,
        },
      ],
      1
    );
  }

  if (
    table === "invoices" &&
    query.get("client_id") === `eq.${inboxPopulatedFixture.clientId}`
  ) {
    seen.add("supabase:invoices");
    return fulfillJson(
      route,
      [
        {
          id: "e2e-invoice-maintenance",
          invoice_number: "INV-1188",
          status: "sent",
          pdf_storage_path: "/documents/INV-1188.pdf",
          updated_at: iso(-4 * DAY),
          total: 9400,
        },
        {
          id: "e2e-invoice-paid-retainer",
          invoice_number: "INV-1189",
          status: "paid",
          pdf_storage_path: "/documents/INV-1189.pdf",
          updated_at: iso(-12 * DAY),
          total: 3200,
        },
        {
          id: "e2e-invoice-overdue-closeout",
          invoice_number: "INV-1190",
          status: "overdue",
          pdf_storage_path: "/documents/INV-1190.pdf",
          updated_at: iso(-31 * DAY),
          total: 1800,
        },
      ],
      3
    );
  }

  if (
    table === "notifications" &&
    query.get("user_id") === `eq.${CURRENT_USER_ID}` &&
    query.get("company_id") === `eq.${inboxPopulatedFixture.companyId}`
  ) {
    return fulfillJson(route, [], 0);
  }

  return route.fallback();
}

/**
 * Network map, traced from the production hooks in `InboxRoute`:
 * - Inbox API reads: threads list, selected detail, drafts, attachments.
 * - Right-rail Supabase reads: client, siblings, opportunity links,
 *   opportunities, projects, tasks, photos, estimates, invoices, sub-clients.
 *
 * Dashboard chrome, sidebar, and topbar are deliberately not mocked. The auth
 * bootstrap endpoints are stabilized so this fixture can run without Firebase
 * Admin credentials while still rendering the real dev-bypass dashboard shell.
 */
export async function installInboxPopulatedFixture(
  page: Page
): Promise<InboxPopulatedFixtureRoutes> {
  const seen = new Set<InboxPopulatedInterceptKey>();
  const state: InboxPopulatedFixtureState = { unreadCount: 1 };

  await page.addInitScript(
    ({ apiKeys, authToken, company, user, userId }) => {
      const now = Date.now();
      for (const apiKey of apiKeys) {
        const authUser = {
          uid: userId,
          email: user.email,
          emailVerified: true,
          displayName: `${user.firstName} ${user.lastName}`,
          isAnonymous: false,
          phoneNumber: null,
          photoURL: null,
          tenantId: null,
          providerId: "firebase",
          providerData: [
            {
              providerId: "password",
              uid: user.email,
              displayName: `${user.firstName} ${user.lastName}`,
              email: user.email,
              phoneNumber: null,
              photoURL: null,
            },
          ],
          stsTokenManager: {
            refreshToken: "mock-refresh-token",
            accessToken: authToken,
            expirationTime: now + 60 * 60 * 1000,
          },
          createdAt: String(now - 24 * 60 * 60 * 1000),
          lastLoginAt: String(now),
          apiKey,
          appName: "[DEFAULT]",
        };

        window.localStorage.setItem(
          `firebase:authUser:${apiKey}:[DEFAULT]`,
          JSON.stringify(authUser)
        );
      }
      window.localStorage.setItem(
        "ops-auth-storage",
        JSON.stringify({
          state: {
            currentUser: user,
            company,
            token: authToken,
            isAuthenticated: true,
            role: user.role,
          },
          version: 0,
        })
      );
    },
    {
      apiKeys: firebaseApiKeys(),
      authToken: AUTH_TOKEN,
      company: e2eCompany(),
      user: e2eUser(),
      userId: CURRENT_USER_ID,
    }
  );

  await page.context().addCookies([
    {
      name: "ops-auth-token",
      value: AUTH_TOKEN,
      url: E2E_ORIGIN,
    },
    {
      name: "__session",
      value: AUTH_TOKEN,
      url: E2E_ORIGIN,
    },
  ]);

  await page.route("**/identitytoolkit.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/securetoken.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/api/dev/bypass-token**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/api/auth/sync-user**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/api/feature-flags**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/api/dashboard-preferences**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/api/agent/queue**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/api/duplicates**", (route) => {
    const url = new URL(route.request().url());
    return routeForAuthAndShell(route, url);
  });

  await page.route("**/api/inbox/**", (route) => {
    const url = new URL(route.request().url());
    return routeForApi(route, url, seen, state);
  });

  await page.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    return routeForSupabase(route, url, seen);
  });

  return { seen };
}
