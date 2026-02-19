/**
 * OPS Web - Client Portal Types
 *
 * Types for the client-facing portal: magic link auth, branding,
 * line-item questions/answers, and messaging.
 */

import type { Client, Project } from "./models";
import type { Estimate, Invoice, LineItem } from "./pipeline";

// ─── Enums ───────────────────────────────────────────────────────────────────

export type PortalTemplate = "modern" | "classic" | "bold";
export type PortalThemeMode = "light" | "dark";
export type QuestionAnswerType = "text" | "select" | "multiselect" | "color" | "number";
export type PortalMessageSender = "client" | "company";

// ─── Auth Entities ───────────────────────────────────────────────────────────

export interface PortalToken {
  id: string;
  companyId: string;
  clientId: string;
  email: string;
  token: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface PortalSession {
  id: string;
  portalTokenId: string;
  sessionToken: string;
  email: string;
  companyId: string;
  clientId: string;
  expiresAt: Date;
  createdAt: Date;
}

// ─── Branding ────────────────────────────────────────────────────────────────

export interface PortalBranding {
  id: string;
  companyId: string;
  logoUrl: string | null;
  accentColor: string;
  template: PortalTemplate;
  themeMode: PortalThemeMode;
  fontCombo: PortalTemplate;
  welcomeMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePortalBranding {
  companyId: string;
  logoUrl?: string | null;
  accentColor?: string;
  template?: PortalTemplate;
  themeMode?: PortalThemeMode;
  fontCombo?: PortalTemplate;
  welcomeMessage?: string | null;
}

// ─── Line Item Questions ─────────────────────────────────────────────────────

export interface LineItemQuestion {
  id: string;
  companyId: string;
  estimateId: string;
  lineItemId: string;
  questionText: string;
  answerType: QuestionAnswerType;
  options: string[];
  isRequired: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface CreateLineItemQuestion {
  companyId: string;
  estimateId: string;
  lineItemId: string;
  questionText: string;
  answerType?: QuestionAnswerType;
  options?: string[];
  isRequired?: boolean;
  sortOrder?: number;
}

export interface LineItemAnswer {
  id: string;
  questionId: string;
  clientId: string;
  answerValue: string;
  answeredAt: Date;
}

export interface CreateLineItemAnswer {
  questionId: string;
  clientId: string;
  answerValue: string;
}

// ─── Messaging ───────────────────────────────────────────────────────────────

export interface PortalMessage {
  id: string;
  companyId: string;
  clientId: string;
  projectId: string | null;
  estimateId: string | null;
  invoiceId: string | null;
  senderType: PortalMessageSender;
  senderName: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreatePortalMessage {
  companyId: string;
  clientId: string;
  projectId?: string | null;
  estimateId?: string | null;
  invoiceId?: string | null;
  senderType: PortalMessageSender;
  senderName: string;
  content: string;
}

// ─── Portal Aggregate Types ──────────────────────────────────────────────────

export interface PortalCompanyInfo {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
}

export interface PortalProject {
  id: string;
  title: string;
  address: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  projectImages: string[];
  estimateCount: number;
  invoiceCount: number;
}

export interface PortalEstimate {
  id: string;
  estimateNumber: string;
  title: string | null;
  status: string;
  total: number;
  issueDate: Date;
  expirationDate: Date | null;
  hasUnansweredQuestions: boolean;
  projectId: string | null;
}

export interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  subject: string | null;
  status: string;
  total: number;
  balanceDue: number;
  issueDate: Date;
  dueDate: Date;
  projectId: string | null;
}

export interface PortalClientData {
  client: Client;
  company: PortalCompanyInfo;
  branding: PortalBranding;
  projects: PortalProject[];
  estimates: PortalEstimate[];
  invoices: PortalInvoice[];
  unreadMessages: number;
}

// ─── Question grouping for UI ────────────────────────────────────────────────

export interface LineItemWithQuestions {
  lineItem: LineItem;
  questions: LineItemQuestion[];
  answers: Record<string, LineItemAnswer>; // keyed by question id
}

export interface EstimateQuestionsData {
  estimate: Estimate;
  lineItemsWithQuestions: LineItemWithQuestions[];
  allAnswered: boolean;
}
