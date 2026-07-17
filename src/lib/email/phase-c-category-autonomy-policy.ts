import type {
  EmailThreadAutonomyLevel,
  EmailThreadCategory,
} from "@/lib/types/email-thread";

/** Pure category policy shared by the browser settings UI and server service. */
export function allowedLevelsFor(
  category: EmailThreadCategory
): EmailThreadAutonomyLevel[] {
  switch (category) {
    case "CUSTOMER":
      return [
        "off",
        "draft_on_request",
        "auto_draft",
        "auto_send",
        "auto_follow_up",
      ];
    case "VENDOR":
    case "SUBTRADE":
      return ["off", "draft_on_request", "auto_draft", "auto_send"];
    case "PLATFORM_BID":
      return [
        "off",
        "draft_on_request",
        "auto_draft",
        "auto_send",
        "auto_archive",
      ];
    case "LEGAL":
    case "COLLECTIONS":
    case "JOB_SEEKER":
      return ["off", "draft_on_request"];
    case "MARKETING":
    case "RECEIPT":
    case "PERSONAL":
    case "INTERNAL":
    case "OTHER":
      return ["off", "auto_archive"];
  }
}

export function defaultLevelFor(
  category: EmailThreadCategory
): EmailThreadAutonomyLevel {
  switch (category) {
    case "LEGAL":
    case "COLLECTIONS":
    case "JOB_SEEKER":
      return "draft_on_request";
    case "MARKETING":
    case "RECEIPT":
      return "off";
    default:
      return "off";
  }
}
