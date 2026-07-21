import type { EmailThreadCategory } from "@/lib/types/email-thread";

const CATEGORY_LABELS: Record<EmailThreadCategory, string> = {
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
  SUBTRADE: "SUBTRADE",
  JOB_SEEKER: "JOB SEEKER",
  PLATFORM_BID: "PLATFORM BID",
  LEGAL: "LEGAL",
  COLLECTIONS: "COLLECTIONS",
  MARKETING: "MARKETING",
  RECEIPT: "RECEIPT",
  PERSONAL: "PERSONAL",
  INTERNAL: "INTERNAL",
  OTHER: "OTHER",
};

/** Server-safe category label shared by UI and background workers. */
export function categoryLabel(category: EmailThreadCategory): string {
  const label = CATEGORY_LABELS[category];
  if (label) return label;
  if (typeof category === "string" && category.length > 0) {
    return category.replace(/_/g, " ").toUpperCase();
  }
  return CATEGORY_LABELS.OTHER;
}
