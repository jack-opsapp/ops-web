import type {
  EvidenceTrust,
  SourceVersion,
} from "@/lib/agent-control-plane/contracts";

export type CorrespondenceMediaType = "text/plain" | "text/html";

export interface CorrespondenceContentInput {
  readonly mediaType: CorrespondenceMediaType;
  readonly value: string;
}

export interface CorrespondenceAttachmentInput {
  readonly attachmentId: string;
  readonly filename: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly inline: boolean;
  readonly contentHash: string | null;
}

export interface NormalizeCorrespondenceInput {
  readonly evidenceId: string;
  readonly companyId: string;
  readonly sourceDomain: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly subject: string | null;
  readonly content: CorrespondenceContentInput;
  readonly attachments?: readonly CorrespondenceAttachmentInput[];
}

export interface NormalizedCorrespondenceAttachment {
  readonly attachmentId: string;
  readonly filename: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly inline: boolean;
  readonly contentHash: string | null;
}

export type CorrespondenceRedactionKind =
  | "content_redacted"
  | "attachment_redacted"
  | "participant_pseudonymized";

export interface DeliveredCorrespondenceMetadata {
  readonly side: "user" | "assistant" | null;
  readonly senderIdentity: string;
  readonly participantResolutionStatus: "resolved" | "unresolved" | "ambiguous";
  readonly direction: "inbound" | "outbound";
  readonly sourceActivityId: string | null;
  readonly sourceCorrespondenceEventId: string | null;
  readonly recipientIdentities: readonly string[];
  readonly ccRecipientIdentities: readonly string[];
}

export interface NormalizedCorrespondenceEvidence {
  readonly evidenceId: string;
  readonly companyId: string;
  readonly sourceDomain: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly trust: EvidenceTrust;
  readonly subject: string | null;
  readonly normalizedPlainText: string;
  readonly attachments: readonly NormalizedCorrespondenceAttachment[];
  /** Null only before the source has been persisted as an immutable turn. */
  readonly delivery: DeliveredCorrespondenceMetadata | null;
  readonly redactionKinds: readonly CorrespondenceRedactionKind[];
  /** Hash of the bounded, validated source payload before normalization. */
  readonly originalContentHash: string;
  /** Integrity hash of normalized content plus provenance, time, and trust. */
  readonly normalizedContentHash: string;
  readonly sourceVersion: SourceVersion;
}

export interface PromptSafeCorrespondenceEvidence {
  readonly evidenceId: string;
  readonly sourceVersion: SourceVersion;
  readonly occurredAt: string;
  readonly trust: EvidenceTrust;
  readonly originalContentHash: string;
  readonly normalizedContentHash: string;
  readonly delivery: DeliveredCorrespondenceMetadata;
  readonly redactionKinds: readonly CorrespondenceRedactionKind[];
}

export interface PromptSafeCorrespondenceEvidenceResult {
  readonly evidence: readonly PromptSafeCorrespondenceEvidence[];
  readonly promptText: string;
  readonly characterCount: number;
}
