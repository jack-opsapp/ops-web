-- Fix: Add UNIQUE constraint on (question_id, client_id) for line_item_answers
-- Required for upsert operations in LineItemQuestionService.submitAnswer()
ALTER TABLE line_item_answers
  ADD CONSTRAINT uq_answer_question_client UNIQUE (question_id, client_id);
