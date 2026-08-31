import { analyticsService } from "./analytics-service";

export function trackLogin(method: "email" | "google" | "apple") {
  analyticsService?.track("lifecycle", "login", { method });
}

export function trackSetupStarted(source: "registration" | "direct") {
  analyticsService?.track("lifecycle", "setup_started", { source });
}

export function trackSetupStepViewed(step: "identity" | "company" | "starfield") {
  analyticsService?.track("screen_view", "setup_step_viewed", { step });
}

export function trackSetupStepCompleted(
  step: "identity" | "company" | "starfield",
  durationMs: number
) {
  analyticsService?.track("action", "setup_step_completed", { step }, durationMs);
}

export function trackSetupStepSkipped(
  step: string,
  skippedFrom: "button" | "skip-all"
) {
  analyticsService?.track("action", "setup_step_skipped", {
    step,
    skipped_from: skippedFrom,
  });
}

export function trackSetupCompleted(
  method: "full" | "partial" | "skipped",
  stepsCompleted: string[],
  totalDurationMs: number
) {
  analyticsService?.track(
    "lifecycle",
    "setup_completed",
    { method, steps_completed: stepsCompleted },
    totalDurationMs
  );
}

export function trackStarfieldEntered() {
  analyticsService?.track("screen_view", "starfield_entered");
}

export function trackStarfieldNodeFocused(
  questionId: string,
  questionNumber: number,
  answeredCount: number
) {
  analyticsService?.track("action", "starfield_node_focused", {
    question_id: questionId,
    question_number: questionNumber,
    answered_count: answeredCount,
  });
}

export function trackStarfieldQuestionAnswered(
  questionId: string,
  answerId: string | number,
  questionNumber: number,
  answeredCount: number,
  timeOnQuestionMs: number
) {
  analyticsService?.track("action", "starfield_question_answered", {
    question_id: questionId,
    answer_id: answerId,
    question_number: questionNumber,
    answered_count: answeredCount,
    time_on_question_ms: timeOnQuestionMs,
  });
}

export function trackStarfieldLaunched(
  answeredCount: number,
  questionsAnswered: string[],
  totalDurationMs: number
) {
  analyticsService?.track(
    "action",
    "starfield_launched",
    { answered_count: answeredCount, questions_answered: questionsAnswered },
    totalDurationMs
  );
}

export function trackStarfieldExited(
  answeredCount: number,
  exitMethod: "skip" | "back"
) {
  analyticsService?.track("action", "starfield_exited", {
    answered_count: answeredCount,
    exit_method: exitMethod,
  });
}

export function trackInterceptionShown(
  triggerAction: string,
  missingSteps: string[]
) {
  analyticsService?.track("screen_view", "interception_shown", {
    trigger_action: triggerAction,
    missing_steps: missingSteps,
  });
}

export function trackInterceptionStepCompleted(
  step: string,
  remainingSteps: number
) {
  analyticsService?.track("action", "interception_step_completed", {
    step,
    remaining_steps: remainingSteps,
  });
}

export function trackInterceptionCompleted(
  stepsCompleted: number,
  triggerAction: string,
  totalDurationMs: number
) {
  analyticsService?.track(
    "lifecycle",
    "interception_completed",
    { steps_completed: stepsCompleted, trigger_action: triggerAction },
    totalDurationMs
  );
}

export function trackInterceptionDismissed(
  stepOnDismiss: string,
  triggerAction: string
) {
  analyticsService?.track("action", "interception_dismissed", {
    step_on_dismiss: stepOnDismiss,
    trigger_action: triggerAction,
  });
}

export function trackTaskCreated(hasSchedule: boolean, teamSize: number) {
  analyticsService?.track("action", "task_created", {
    has_schedule: hasSchedule,
    team_size: teamSize,
  });
}

export function trackClientCreated() {
  analyticsService?.track("action", "client_created");
}

export function trackFormAbandoned(formType: string, fieldsFilled: number) {
  analyticsService?.track("action", "form_abandoned", {
    form_type: formType,
    fields_filled: fieldsFilled,
  });
}

