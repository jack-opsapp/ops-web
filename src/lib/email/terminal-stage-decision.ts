const TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);

export interface TerminalStageMessage {
  direction: "inbound" | "outbound";
  body: string | null | undefined;
}

export interface TerminalStageDetection {
  terminalFlag: "likely_won";
  stage: "won";
}

export interface AutoConvertLikelyWonInput {
  terminalFlag: string | null | undefined;
  currentStage: string | null | undefined;
  stageManuallySet: boolean | null | undefined;
}

export function shouldAutoConvertLikelyWon(
  input: AutoConvertLikelyWonInput
): boolean {
  if (input.terminalFlag !== "likely_won") return false;
  if (input.stageManuallySet) return false;

  const currentStage = input.currentStage?.toLowerCase().trim();
  if (!currentStage) return false;
  if (TERMINAL_STAGES.has(currentStage)) return false;

  return true;
}

const ESTIMATE_CONTEXT_RE =
  /\b(?:estimate|quote|proposal|pricing|price|cost|scope of work)\b/i;
const ACCEPTED_DOCUMENT_RE =
  /\b(?:accepted|signed|approved|approval|go-ahead|go ahead)\b.{0,40}\b(?:estimate|quote|proposal|contract)\b|\b(?:estimate|quote|proposal|contract)\b.{0,40}\b(?:accepted|signed|approved)\b/i;
const ACCEPTANCE_RE =
  /\b(?:go ahead|approved|accepted|i accept|we accept|let'?s proceed|proceed|let'?s book|book it|sounds good|sounds great|looks good|works for us|we are good to go)\b/i;
const ESTIMATE_REQUEST_RE =
  /\b(?:send|provide|get|need|waiting for|looking for)\b.{0,30}\b(?:estimate|quote|proposal|pricing|price)\b|\b(?:estimate|quote|proposal|pricing|price)\b.{0,30}\b(?:please|when you can|would like|can you)\b/i;
const CREW_SCHEDULING_RE =
  /\bcrew\b.{0,80}\b(?:arriv(?:e|ing|al)|start(?:ing)?|coming|on site|show(?:ing)? up|scheduled|booked)\b|\b(?:arriv(?:e|ing|al)|start(?:ing)?|coming|on site|show(?:ing)? up|scheduled|booked)\b.{0,80}\bcrew\b/i;
const WORK_START_RE =
  /\b(?:start date|when (?:can|will) you start|see you (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|deposit (?:paid|sent)|payment sent)\b/i;

function cleanBody(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function detectTerminalStageFromMessages(
  messages: TerminalStageMessage[]
): TerminalStageDetection | null {
  let hasEstimateContext = false;

  for (const message of messages) {
    const body = cleanBody(message.body);
    if (!body) continue;

    if (ACCEPTED_DOCUMENT_RE.test(body)) {
      return { terminalFlag: "likely_won", stage: "won" };
    }

    if (CREW_SCHEDULING_RE.test(body) || WORK_START_RE.test(body)) {
      return { terminalFlag: "likely_won", stage: "won" };
    }

    if (message.direction === "outbound" && ESTIMATE_CONTEXT_RE.test(body)) {
      hasEstimateContext = true;
      continue;
    }

    if (
      message.direction === "inbound" &&
      hasEstimateContext &&
      ACCEPTANCE_RE.test(body) &&
      !ESTIMATE_REQUEST_RE.test(body)
    ) {
      return { terminalFlag: "likely_won", stage: "won" };
    }
  }

  return null;
}
