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

export function trackSignUp(method: "email" | "google" | "apple") {
  log("sign_up", { method });
}

export function trackLogin(method: "email" | "google" | "apple") {
  log("login", { method });
}

// ─── Subscription Events ──────────────────────────────────────────────────────

export function trackSubscribe(planName: string, price: number, currency = "USD") {
  log("purchase", { item_name: planName, price, currency });
  log("subscribe", { item_name: planName, price, currency });
}

// ─── Setup & Onboarding Events ───────────────────────────────────────────────

export function trackSetupStarted(source: "registration" | "direct") {
  log("setup_started", { source });
}

export function trackSetupStepViewed(step: "identity" | "company" | "starfield") {
  log("setup_step_viewed", { step });
}

export function trackSetupStepCompleted(step: "identity" | "company" | "starfield", duration_ms: number) {
  log("setup_step_completed", { step, duration_ms });
}

export function trackSetupStepSkipped(step: string, skipped_from: "button" | "skip-all") {
  log("setup_step_skipped", { step, skipped_from });
}

export function trackSetupCompleted(
  method: "full" | "partial" | "skipped",
  steps_completed: string[],
  total_duration_ms: number
) {
  log("setup_completed", { method, steps_completed, total_duration_ms });
}

// ─── Starfield Events ────────────────────────────────────────────────────────

export function trackStarfieldEntered() {
  log("starfield_entered", {});
}

export function trackStarfieldNodeFocused(
  question_id: string,
  question_number: number,
  answered_count: number
) {
  log("starfield_node_focused", { question_id, question_number, answered_count });
}

export function trackStarfieldQuestionAnswered(
  question_id: string,
  answer_id: string | number,
  question_number: number,
  answered_count: number,
  time_on_question_ms: number
) {
  log("starfield_question_answered", {
    question_id,
    answer_id,
    question_number,
    answered_count,
    time_on_question_ms,
  });
}

export function trackStarfieldLaunched(
  answered_count: number,
  questions_answered: string[],
  total_duration_ms: number
) {
  log("starfield_launched", { answered_count, questions_answered, total_duration_ms });
}

export function trackStarfieldExited(answered_count: number, exit_method: "skip" | "back") {
  log("starfield_exited", { answered_count, exit_method });
}

// ─── Interception Modal Events ───────────────────────────────────────────────

export function trackInterceptionShown(trigger_action: string, missing_steps: string[]) {
  log("interception_shown", { trigger_action, missing_steps });
}

export function trackInterceptionStepCompleted(step: string, remaining_steps: number) {
  log("interception_step_completed", { step, remaining_steps });
}

export function trackInterceptionCompleted(
  steps_completed: number,
  trigger_action: string,
  total_duration_ms: number
) {
  log("interception_completed", { steps_completed, trigger_action, total_duration_ms });
}

export function trackInterceptionDismissed(step_on_dismiss: string, trigger_action: string) {
  log("interception_dismissed", { step_on_dismiss, trigger_action });
}

// ─── Onboarding Entity Events ────────────────────────────────────────────────

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
