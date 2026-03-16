// src/lib/types/email-import.ts
// Types for the Import Your Pipeline wizard flow

import type { DetectedSource, PatternDetectionResult } from '@/lib/api/services/pattern-detection-service';
import type { ClassificationResult, ThreadAnalysisResult } from '@/lib/api/services/email-ai-classifier';

// Wizard Step 2 → Step 3: analysis results
export interface AnalysisResult {
  jobId: string;
  status: 'pending' | 'analyzing_sent' | 'detecting_platforms' | 'classifying_ai' | 'analyzing_threads' | 'complete' | 'error';
  progress: {
    stage: string;
    message: string;
    percent: number;
  };
  result?: {
    estimatePattern: string | null;
    estimatePatternConfidence: number;
    estimateThreadCount: number;
    detectedSources: DetectedSource[];
    companyDomains: string[];
    teamForwarders: string[];
    leads: AnalyzedLead[];
    totalScanned: number;
  };
  error?: string;
}

// A lead ready for review in Step 4
export interface AnalyzedLead {
  id: string;
  threadId: string;
  emails: Array<{
    id: string;
    from: string;
    subject: string;
    date: string;
    direction: 'inbound' | 'outbound';
  }>;
  client: {
    name: string;
    email: string;
    phone: string | null;
    description: string;
  };
  stage: string;
  stageConfidence: number;
  estimatedValue: number | null;
  correspondenceCount: number;
  outboundCount: number;
  lastMessageDate: string;
  source: 'pattern' | 'platform' | 'forwarder' | 'ai';
  sourceLabel: string;
  duplicateGroupId: string | null;
  matchResult: {
    existingClientId: string | null;
    existingClientName: string | null;
    action: 'link' | 'create_subclient' | 'review' | 'create_new';
    confidence: string;
  };
  enabled: boolean;
}

// Step 4 → Step 5: import payload
export interface ImportPayload {
  connectionId: string;
  companyId: string;
  leads: Array<{
    id: string;
    threadId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string | null;
    description: string;
    stage: string;
    estimatedValue: number | null;
    existingClientId: string | null;
    action: 'create_new' | 'link' | 'create_subclient';
    mergeWithLeadId: string | null;
  }>;
  syncProfile: {
    estimateSubjectPatterns: string[];
    companyDomains: string[];
    teamForwarders: string[];
    knownPlatformSenders: string[];
    formSubjectPatterns: string[];
    userEmailAddresses: string[];
    aiClassificationThreshold: number;
  };
}

// Step 5: activation payload
export interface ActivationPayload {
  connectionId: string;
  companyId: string;
  syncIntervalMinutes: number;
  syncProfile: ImportPayload['syncProfile'];
}

// Import result
export interface ImportResult {
  clientsCreated: number;
  leadsCreated: number;
  activitiesLogged: number;
  labelsApplied: number;
  errors: string[];
}
