"use client";

import { useCallback } from "react";

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqEditorProps {
  faqs: FaqItem[];
  onChange: (faqs: FaqItem[]) => void;
}

export function FaqEditor({ faqs, onChange }: FaqEditorProps) {
  const addItem = useCallback(() => {
    onChange([...faqs, { question: "", answer: "" }]);
  }, [faqs, onChange]);

  const removeItem = useCallback(
    (index: number) => {
      onChange(faqs.filter((_, i) => i !== index));
    },
    [faqs, onChange]
  );

  const updateItem = useCallback(
    (index: number, field: keyof FaqItem, value: string) => {
      const updated = faqs.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      );
      onChange(updated);
    },
    [faqs, onChange]
  );

  const moveItem = useCallback(
    (index: number, direction: -1 | 1) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= faqs.length) return;
      const updated = [...faqs];
      const temp = updated[index];
      updated[index] = updated[targetIndex];
      updated[targetIndex] = temp;
      onChange(updated);
    },
    [faqs, onChange]
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
          Q&A Section (FAQ Schema)
        </p>
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-1.5 rounded text-[13px] font-mohave text-white bg-[#597794] hover:bg-[#6B8AA6] transition-colors"
        >
          Add Q&A
        </button>
      </div>

      {/* Empty state */}
      {faqs.length === 0 && (
        <p className="text-[13px] text-[#6B6B6B] font-kosugi">
          No FAQ items. Add Q&amp;A pairs to generate FAQPage JSON-LD schema
          for AI SEO.
        </p>
      )}

      {/* FAQ items */}
      <div className="space-y-3">
        {faqs.map((faq, index) => (
          <div
            key={index}
            className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]"
          >
            {/* Card header */}
            <div className="flex items-center justify-between mb-3">
              <span className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
                Q{index + 1}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                  className="px-2 py-1 rounded text-[12px] font-mono text-[#A7A7A7] hover:bg-white/[0.05] hover:text-[#E5E5E5] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  disabled={index === faqs.length - 1}
                  onClick={() => moveItem(index, 1)}
                  className="px-2 py-1 rounded text-[12px] font-mono text-[#A7A7A7] hover:bg-white/[0.05] hover:text-[#E5E5E5] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  &darr;
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="px-2 py-1 rounded text-[12px] font-mono text-[#93321A] hover:text-[#B5432A] transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Question input */}
            <input
              type="text"
              placeholder="Question"
              value={faq.question}
              onChange={(e) => updateItem(index, "question", e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none focus:border-white/[0.2] mb-2"
            />

            {/* Answer textarea */}
            <textarea
              placeholder="Answer"
              rows={3}
              value={faq.answer}
              onChange={(e) => updateItem(index, "answer", e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none focus:border-white/[0.2] resize-y"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
