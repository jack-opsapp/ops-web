/**
 * OPS Web - Line Item Question Service
 *
 * Manages line-item questions and client answers for the client portal.
 * Questions are attached to estimate line items; clients submit answers
 * through the portal (e.g., color choices, material preferences).
 *
 * Uses service role key since portal clients have no Firebase auth.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  LineItemQuestion,
  CreateLineItemQuestion,
  LineItemAnswer,
  CreateLineItemAnswer,
  QuestionAnswerType,
} from "@/lib/types/portal";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapQuestionFromDb(row: Record<string, unknown>): LineItemQuestion {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    estimateId: row.estimate_id as string,
    lineItemId: row.line_item_id as string,
    questionText: row.question_text as string,
    answerType: (row.answer_type as QuestionAnswerType) ?? "text",
    options: (row.options as string[]) ?? [],
    isRequired: (row.is_required as boolean) ?? true,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: parseDateRequired(row.created_at),
  };
}

function mapQuestionToDb(
  data: Partial<CreateLineItemQuestion>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.estimateId !== undefined) row.estimate_id = data.estimateId;
  if (data.lineItemId !== undefined) row.line_item_id = data.lineItemId;
  if (data.questionText !== undefined) row.question_text = data.questionText;
  if (data.answerType !== undefined) row.answer_type = data.answerType;
  if (data.options !== undefined) row.options = data.options;
  if (data.isRequired !== undefined) row.is_required = data.isRequired;
  if (data.sortOrder !== undefined) row.sort_order = data.sortOrder;

  return row;
}

function mapAnswerFromDb(row: Record<string, unknown>): LineItemAnswer {
  return {
    id: row.id as string,
    questionId: row.question_id as string,
    clientId: row.client_id as string,
    answerValue: row.answer_value as string,
    answeredAt: parseDateRequired(row.answered_at),
  };
}

function mapAnswerToDb(
  data: CreateLineItemAnswer
): Record<string, unknown> {
  return {
    question_id: data.questionId,
    client_id: data.clientId,
    answer_value: data.answerValue,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const LineItemQuestionService = {
  /**
   * Get all questions for an estimate, ordered by line_item_id then sort_order.
   */
  async getQuestionsForEstimate(
    estimateId: string
  ): Promise<LineItemQuestion[]> {
    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("line_item_questions")
      .select("*")
      .eq("estimate_id", estimateId)
      .order("line_item_id")
      .order("sort_order");

    if (error)
      throw new Error(`Failed to fetch questions for estimate: ${error.message}`);
    return (data ?? []).map(mapQuestionFromDb);
  },

  /**
   * Get all questions for a specific line item, ordered by sort_order.
   */
  async getQuestionsForLineItem(
    lineItemId: string
  ): Promise<LineItemQuestion[]> {
    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("line_item_questions")
      .select("*")
      .eq("line_item_id", lineItemId)
      .order("sort_order");

    if (error)
      throw new Error(`Failed to fetch questions for line item: ${error.message}`);
    return (data ?? []).map(mapQuestionFromDb);
  },

  /**
   * Create a new question for a line item.
   */
  async createQuestion(
    data: CreateLineItemQuestion
  ): Promise<LineItemQuestion> {
    const supabase = getServiceRoleClient();
    const row = mapQuestionToDb(data);

    const { data: created, error } = await supabase
      .from("line_item_questions")
      .insert(row)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create question: ${error.message}`);
    return mapQuestionFromDb(created);
  },

  /**
   * Update an existing question.
   */
  async updateQuestion(
    id: string,
    data: Partial<CreateLineItemQuestion>
  ): Promise<LineItemQuestion> {
    const supabase = getServiceRoleClient();
    const row = mapQuestionToDb(data);

    const { data: updated, error } = await supabase
      .from("line_item_questions")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update question: ${error.message}`);
    return mapQuestionFromDb(updated);
  },

  /**
   * Hard delete a question (cascades to answers via FK).
   */
  async deleteQuestion(id: string): Promise<void> {
    const supabase = getServiceRoleClient();

    const { error } = await supabase
      .from("line_item_questions")
      .delete()
      .eq("id", id);

    if (error)
      throw new Error(`Failed to delete question: ${error.message}`);
  },

  /**
   * Submit (or re-submit) a client answer.
   * Uses upsert on (question_id, client_id) so a client can change their answer.
   */
  async submitAnswer(
    data: CreateLineItemAnswer
  ): Promise<LineItemAnswer> {
    const supabase = getServiceRoleClient();
    const row = mapAnswerToDb(data);
    row.answered_at = new Date().toISOString();

    const { data: upserted, error } = await supabase
      .from("line_item_answers")
      .upsert(row, { onConflict: "question_id,client_id" })
      .select()
      .single();

    if (error)
      throw new Error(`Failed to submit answer: ${error.message}`);
    return mapAnswerFromDb(upserted);
  },

  /**
   * Get all answers for an estimate (join through questions).
   */
  async getAnswersForEstimate(
    estimateId: string
  ): Promise<LineItemAnswer[]> {
    const supabase = getServiceRoleClient();

    // Get question IDs for this estimate first
    const { data: questions, error: qError } = await supabase
      .from("line_item_questions")
      .select("id")
      .eq("estimate_id", estimateId);

    if (qError)
      throw new Error(`Failed to fetch questions for answers: ${qError.message}`);

    const questionIds = (questions ?? []).map((q: Record<string, unknown>) => q.id as string);
    if (questionIds.length === 0) return [];

    const { data, error } = await supabase
      .from("line_item_answers")
      .select("*")
      .in("question_id", questionIds)
      .order("answered_at");

    if (error)
      throw new Error(`Failed to fetch answers for estimate: ${error.message}`);
    return (data ?? []).map(mapAnswerFromDb);
  },

  /**
   * Get questions for an estimate that the given client has not yet answered.
   */
  async getUnansweredQuestions(
    estimateId: string,
    clientId: string
  ): Promise<LineItemQuestion[]> {
    const supabase = getServiceRoleClient();

    // Get all questions for the estimate
    const { data: questions, error: qError } = await supabase
      .from("line_item_questions")
      .select("*")
      .eq("estimate_id", estimateId)
      .order("line_item_id")
      .order("sort_order");

    if (qError)
      throw new Error(`Failed to fetch questions: ${qError.message}`);

    const allQuestions = (questions ?? []).map(mapQuestionFromDb);
    if (allQuestions.length === 0) return [];

    // Get answered question IDs for this client
    const questionIds = allQuestions.map((q) => q.id);

    const { data: answers, error: aError } = await supabase
      .from("line_item_answers")
      .select("question_id")
      .in("question_id", questionIds)
      .eq("client_id", clientId);

    if (aError)
      throw new Error(`Failed to fetch existing answers: ${aError.message}`);

    const answeredIds = new Set(
      (answers ?? []).map((a: Record<string, unknown>) => a.question_id as string)
    );

    return allQuestions.filter((q) => !answeredIds.has(q.id));
  },
};
