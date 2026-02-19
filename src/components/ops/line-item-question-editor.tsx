"use client";

import { useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  GripVertical,
  ChevronDown,
  HelpCircle,
  Hash,
  Type,
  List,
  ListChecks,
  Palette,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  LineItemQuestion,
  QuestionAnswerType,
} from "@/lib/types/portal";

// ─── Props ───────────────────────────────────────────────────────────────────

interface LineItemQuestionEditorProps {
  lineItemId: string;
  estimateId: string;
  companyId: string;
  questions: LineItemQuestion[];
  onChange: (questions: LineItemQuestion[]) => void;
}

// ─── Answer type config ──────────────────────────────────────────────────────

const ANSWER_TYPES: {
  value: QuestionAnswerType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hasOptions: boolean;
}[] = [
  { value: "text", label: "Text", icon: Type, hasOptions: false },
  { value: "number", label: "Number", icon: Hash, hasOptions: false },
  { value: "select", label: "Single Select", icon: List, hasOptions: true },
  { value: "multiselect", label: "Multi Select", icon: ListChecks, hasOptions: true },
  { value: "color", label: "Color", icon: Palette, hasOptions: true },
];

function answerTypeHasOptions(type: QuestionAnswerType): boolean {
  return type === "select" || type === "multiselect" || type === "color";
}

// ─── Temp ID generator ───────────────────────────────────────────────────────

let nextTempId = 1;
function generateTempId(): string {
  return `q-temp-${nextTempId++}-${Date.now()}`;
}

// ─── Options Editor (sub-component) ─────────────────────────────────────────

interface OptionsEditorProps {
  options: string[];
  onChange: (options: string[]) => void;
  answerType: QuestionAnswerType;
}

function OptionsEditor({ options, onChange, answerType }: OptionsEditorProps) {
  const [newOption, setNewOption] = useState("");

  function addOption() {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    if (options.includes(trimmed)) return;
    onChange([...options, trimmed]);
    setNewOption("");
  }

  function removeOption(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addOption();
    }
  }

  const placeholder =
    answerType === "color"
      ? "e.g. Navy Blue, Forest Green..."
      : "Add an option...";

  return (
    <div className="space-y-1">
      <p className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
        Options
      </p>

      {/* Existing options */}
      {options.length > 0 && (
        <div className="flex flex-wrap gap-0.5">
          {options.map((opt, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded bg-background-elevated border border-border text-body-sm text-text-secondary font-mohave"
            >
              {answerType === "color" && (
                <span
                  className="w-[10px] h-[10px] rounded-full border border-[rgba(255,255,255,0.15)]"
                  style={{
                    backgroundColor: opt.startsWith("#") ? opt : undefined,
                  }}
                />
              )}
              {opt}
              <button
                type="button"
                onClick={() => removeOption(i)}
                className="text-text-disabled hover:text-ops-error transition-colors"
              >
                <X className="w-[10px] h-[10px]" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add new option */}
      <div className="flex items-center gap-0.5">
        <Input
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="text-sm flex-1"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={addOption}
          disabled={!newOption.trim()}
          className="shrink-0"
        >
          <Plus className="w-[14px] h-[14px]" />
        </Button>
      </div>
    </div>
  );
}

// ─── Question Form (inline add/edit) ─────────────────────────────────────────

interface QuestionFormData {
  questionText: string;
  answerType: QuestionAnswerType;
  options: string[];
  isRequired: boolean;
}

interface QuestionFormProps {
  initial?: QuestionFormData;
  onSubmit: (data: QuestionFormData) => void;
  onCancel: () => void;
  submitLabel: string;
}

function QuestionForm({ initial, onSubmit, onCancel, submitLabel }: QuestionFormProps) {
  const [questionText, setQuestionText] = useState(initial?.questionText ?? "");
  const [answerType, setAnswerType] = useState<QuestionAnswerType>(
    initial?.answerType ?? "text"
  );
  const [options, setOptions] = useState<string[]>(initial?.options ?? []);
  const [isRequired, setIsRequired] = useState(initial?.isRequired ?? true);

  const hasOptions = answerTypeHasOptions(answerType);

  function handleAnswerTypeChange(value: string) {
    const newType = value as QuestionAnswerType;
    setAnswerType(newType);
    // Clear options when switching to a type that doesn't use them
    if (!answerTypeHasOptions(newType)) {
      setOptions([]);
    }
  }

  function handleSubmit() {
    const trimmed = questionText.trim();
    if (!trimmed) return;
    if (hasOptions && options.length === 0) return;
    onSubmit({
      questionText: trimmed,
      answerType,
      options,
      isRequired,
    });
  }

  const canSubmit =
    questionText.trim().length > 0 &&
    (!hasOptions || options.length > 0);

  return (
    <div className="space-y-1.5 p-1.5 rounded border border-ops-accent bg-[rgba(65,115,148,0.06)]">
      {/* Question text */}
      <Input
        label="Question"
        value={questionText}
        onChange={(e) => setQuestionText(e.target.value)}
        placeholder="What color would you like?"
        autoFocus
      />

      {/* Answer type */}
      <div className="flex flex-col gap-0.5">
        <p className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
          Answer Type
        </p>
        <Select value={answerType} onValueChange={handleAnswerTypeChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANSWER_TYPES.map((at) => (
              <SelectItem key={at.value} value={at.value}>
                <span className="flex items-center gap-[6px]">
                  <at.icon className="w-[14px] h-[14px] text-text-tertiary" />
                  {at.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Options editor (for select/multiselect/color) */}
      {hasOptions && (
        <OptionsEditor
          options={options}
          onChange={setOptions}
          answerType={answerType}
        />
      )}

      {/* Required toggle */}
      <div className="flex items-center justify-between py-[4px]">
        <span className="font-mohave text-body-sm text-text-secondary">Required</span>
        <button
          type="button"
          onClick={() => setIsRequired(!isRequired)}
          className={cn(
            "w-[40px] h-[22px] rounded-full transition-colors relative",
            isRequired ? "bg-ops-accent" : "bg-background-elevated"
          )}
        >
          <span
            className={cn(
              "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
              isRequired ? "right-[2px]" : "left-[2px]"
            )}
          />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 pt-0.5">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          <Check className="w-[14px] h-[14px]" />
          {submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function LineItemQuestionEditor({
  lineItemId,
  estimateId,
  companyId,
  questions,
  onChange,
}: LineItemQuestionEditorProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Add question ─────────────────────────────────────────────────────────
  const handleAdd = useCallback(
    (data: QuestionFormData) => {
      const newQuestion: LineItemQuestion = {
        id: generateTempId(),
        companyId,
        estimateId,
        lineItemId,
        questionText: data.questionText,
        answerType: data.answerType,
        options: data.options,
        isRequired: data.isRequired,
        sortOrder: questions.length,
        createdAt: new Date(),
      };
      onChange([...questions, newQuestion]);
      setIsAdding(false);
    },
    [companyId, estimateId, lineItemId, questions, onChange]
  );

  // ── Edit question ────────────────────────────────────────────────────────
  const handleEdit = useCallback(
    (id: string, data: QuestionFormData) => {
      onChange(
        questions.map((q) =>
          q.id === id
            ? {
                ...q,
                questionText: data.questionText,
                answerType: data.answerType,
                options: data.options,
                isRequired: data.isRequired,
              }
            : q
        )
      );
      setEditingId(null);
    },
    [questions, onChange]
  );

  // ── Delete question ──────────────────────────────────────────────────────
  const handleDelete = useCallback(
    (id: string) => {
      onChange(
        questions
          .filter((q) => q.id !== id)
          .map((q, i) => ({ ...q, sortOrder: i }))
      );
      if (editingId === id) setEditingId(null);
    },
    [questions, onChange, editingId]
  );

  // ── Answer type display helpers ──────────────────────────────────────────
  function getAnswerTypeConfig(type: QuestionAnswerType) {
    return ANSWER_TYPES.find((at) => at.value === type) ?? ANSWER_TYPES[0];
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center gap-[6px]">
        <HelpCircle className="w-[14px] h-[14px] text-text-tertiary" />
        <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
          Client Questions ({questions.length})
        </span>
      </div>

      {/* Existing questions */}
      {questions.length > 0 && (
        <div className="space-y-0.5">
          {questions.map((question) => {
            const typeConfig = getAnswerTypeConfig(question.answerType);

            // Editing mode for this question
            if (editingId === question.id) {
              return (
                <QuestionForm
                  key={question.id}
                  initial={{
                    questionText: question.questionText,
                    answerType: question.answerType,
                    options: question.options,
                    isRequired: question.isRequired,
                  }}
                  onSubmit={(data) => handleEdit(question.id, data)}
                  onCancel={() => setEditingId(null)}
                  submitLabel="Update"
                />
              );
            }

            // Display mode
            return (
              <div
                key={question.id}
                className="flex items-start gap-1 p-1 rounded border border-border bg-[rgba(255,255,255,0.02)] group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[6px]">
                    <p className="font-mohave text-body-sm text-text-primary truncate">
                      {question.questionText}
                    </p>
                    {question.isRequired && (
                      <span className="shrink-0 font-kosugi text-[9px] text-ops-accent bg-ops-accent-muted px-[6px] py-[1px] rounded-full uppercase tracking-wider">
                        Required
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-[6px] mt-[2px]">
                    <typeConfig.icon className="w-[11px] h-[11px] text-text-disabled" />
                    <span className="font-kosugi text-[10px] text-text-disabled">
                      {typeConfig.label}
                    </span>
                    {question.options.length > 0 && (
                      <span className="font-kosugi text-[10px] text-text-disabled">
                        -- {question.options.length} option{question.options.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Show option pills for select/multiselect/color types */}
                  {question.options.length > 0 && (
                    <div className="flex flex-wrap gap-[3px] mt-[4px]">
                      {question.options.slice(0, 6).map((opt, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-[3px] px-[6px] py-[1px] rounded bg-background-elevated text-[10px] text-text-tertiary font-kosugi border border-[rgba(255,255,255,0.06)]"
                        >
                          {question.answerType === "color" && (
                            <span
                              className="w-[8px] h-[8px] rounded-full"
                              style={{
                                backgroundColor: opt.startsWith("#") ? opt : undefined,
                              }}
                            />
                          )}
                          {opt}
                        </span>
                      ))}
                      {question.options.length > 6 && (
                        <span className="text-[10px] text-text-disabled font-kosugi">
                          +{question.options.length - 6} more
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-[2px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setEditingId(question.id)}
                    className="p-[4px] rounded text-text-disabled hover:text-ops-accent hover:bg-ops-accent-muted transition-colors"
                    title="Edit question"
                  >
                    <Pencil className="w-[13px] h-[13px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(question.id)}
                    className="p-[4px] rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                    title="Delete question"
                  >
                    <Trash2 className="w-[13px] h-[13px]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add question form or button */}
      {isAdding ? (
        <QuestionForm
          onSubmit={handleAdd}
          onCancel={() => setIsAdding(false)}
          submitLabel="Add"
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsAdding(true)}
          className="gap-1 text-text-tertiary"
        >
          <Plus className="w-[14px] h-[14px]" />
          Add Question
        </Button>
      )}
    </div>
  );
}
