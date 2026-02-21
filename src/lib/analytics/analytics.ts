/**
 * OPS Web — Firebase Analytics Instrumentation
 *
 * CLIENT SIDE ONLY (browser).
 * Mirrors exact event names from iOS AnalyticsManager.swift.
 * GA4 auto-tags platform as 'web' — no extra setup needed.
 */
import { getAnalytics, logEvent, type Analytics } from "firebase/analytics";
import { getFirebaseApp } from "@/lib/firebase/config";

// ─── Singleton (lazy, browser-only) ──────────────────────────────────────────

let _analytics: Analytics | null = null;

function getAnalyticsInstance(): Analytics | null {
  if (typeof window === "undefined") return null;
  if (_analytics) return _analytics;
  try {
    _analytics = getAnalytics(getFirebaseApp());
    return _analytics;
  } catch {
    return null;
  }
}

function log(eventName: string, params?: Record<string, unknown>) {
  const analytics = getAnalyticsInstance();
  if (!analytics) return;
  logEvent(analytics, eventName, params);
}

// ─── Auth Events ──────────────────────────────────────────────────────────────

export function trackSignUp(method: "email" | "google") {
  log("sign_up", { method });
}

export function trackLogin(method: "email" | "google") {
  log("login", { method });
}

// ─── Trial & Subscription Events ──────────────────────────────────────────────

export function trackBeginTrial(trialDays = 30) {
  log("begin_trial", { trial_days: trialDays });
}

export function trackSubscribe(planName: string, price: number, currency = "USD") {
  log("purchase", { item_name: planName, price, currency });
  log("subscribe", { item_name: planName, price, currency });
}

// ─── Onboarding Events ────────────────────────────────────────────────────────

export function trackCompleteOnboarding(hasCompany: boolean) {
  log("complete_onboarding", { has_company: hasCompany });
}

export function trackCreateFirstProject() {
  log("create_first_project", {});
}

export function trackCreateProject(projectCount: number) {
  log("create_project", { project_count: projectCount });
  if (projectCount === 1) trackCreateFirstProject();
}

// ─── Entity Events ────────────────────────────────────────────────────────────

export function trackTaskCreated(hasSchedule: boolean, teamSize: number) {
  log("task_created", { has_schedule: hasSchedule, team_size: teamSize });
}

export function trackTaskStatusChanged(oldStatus: string, newStatus: string) {
  log("task_status_changed", { old_status: oldStatus, new_status: newStatus });
}

export function trackTaskCompleted() {
  log("task_completed", {});
}

export function trackClientCreated() {
  log("client_created", {});
}

export function trackProjectStatusChanged(oldStatus: string, newStatus: string) {
  log("project_status_changed", { old_status: oldStatus, new_status: newStatus });
}

export function trackTeamMemberInvited(role: string, teamSize: number) {
  log("team_member_invited", { role, team_size: teamSize });
}

// ─── Engagement Events ────────────────────────────────────────────────────────

export function trackScreenView(screenName: string) {
  log("screen_view", { screen_name: screenName });
}

export function trackFormAbandoned(formType: string, fieldsFilled: number) {
  log("form_abandoned", { form_type: formType, fields_filled: fieldsFilled });
}
