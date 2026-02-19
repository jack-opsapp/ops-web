/**
 * GET  /api/portal/estimates/[id]/questions
 * POST /api/portal/estimates/[id]/questions
 *
 * GET:  Returns all questions and answers for the estimate.
 * POST: Submits answers for one or more questions.
 *       Body: { answers: Array<{ questionId: string, answerValue: string }> }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { LineItemQuestionService } from "@/lib/api/services/line-item-question-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const { id: estimateId } = await params;

    const [questions, answers] = await Promise.all([
      LineItemQuestionService.getQuestionsForEstimate(estimateId),
      LineItemQuestionService.getAnswersForEstimate(estimateId),
    ]);

    return NextResponse.json({ questions, answers });
  } catch (error) {
    console.error("[portal/estimates/[id]/questions] GET Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch questions" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const { id: estimateId } = await params;
    const body = await req.json();

    if (!Array.isArray(body.answers) || body.answers.length === 0) {
      return NextResponse.json(
        { error: "Request body must include a non-empty 'answers' array" },
        { status: 400 }
      );
    }

    // Validate each answer object
    for (const answer of body.answers) {
      if (!answer.questionId || typeof answer.answerValue !== "string") {
        return NextResponse.json(
          {
            error:
              "Each answer must have 'questionId' (string) and 'answerValue' (string)",
          },
          { status: 400 }
        );
      }
    }

    // Submit all answers
    const submitted = await Promise.all(
      body.answers.map(
        (answer: { questionId: string; answerValue: string }) =>
          LineItemQuestionService.submitAnswer({
            questionId: answer.questionId,
            clientId: session.clientId,
            answerValue: answer.answerValue,
          })
      )
    );

    return NextResponse.json({ success: true, answers: submitted });
  } catch (error) {
    console.error("[portal/estimates/[id]/questions] POST Error:", error);
    return NextResponse.json(
      { error: "Failed to submit answers" },
      { status: 500 }
    );
  }
}
