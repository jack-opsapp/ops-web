"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Search, X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { INDUSTRIES } from "@/lib/data/industries";

// ─── Types ───────────────────────────────────────────────────────────────────

interface IndustryStepProps {
  onNext: (industries: string[]) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IndustryStep({ onNext }: IndustryStepProps) {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();

  const hasIndustries =
    company?.industries != null && company.industries.length > 0;

  const [showPicker, setShowPicker] = useState(!hasIndustries);
  const [selected, setSelected] = useState<string[]>(
    hasIndustries ? [...company.industries] : [],
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return [...INDUSTRIES];
    const q = search.trim().toLowerCase();
    return INDUSTRIES.filter((i) => i.toLowerCase().includes(q));
  }, [search]);

  function toggleIndustry(industry: string) {
    setSelected((prev) =>
      prev.includes(industry)
        ? prev.filter((i) => i !== industry)
        : [...prev, industry],
    );
  }

  function removeTag(industry: string) {
    setSelected((prev) => prev.filter((i) => i !== industry));
  }

  // ── Confirmation screen (industries already set) ─────────────────────────

  if (hasIndustries && !showPicker) {
    const displayIndustries = company.industries.join(" & ");

    return (
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -40 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center justify-center min-h-[320px] px-4"
      >
        <h2 className="font-mohave text-[28px] font-bold text-text-primary tracking-tight uppercase mb-[8px]">
          {t("wizard.industry.headlineKnown")}
        </h2>
        <p className="font-mohave text-body text-text-secondary text-center max-w-[400px] mb-[32px]">
          {t("wizard.industry.bodyKnown").replace("{industries}", displayIndustries)}
        </p>

        <div className="flex gap-[12px]">
          <button
            type="button"
            onClick={() => onNext(company.industries)}
            className="flex items-center gap-[8px] px-[20px] py-[10px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(89,119,148,0.12)] hover:bg-[rgba(89,119,148,0.2)] text-text-primary font-mohave text-body-sm transition-colors"
          >
            {t("wizard.industry.confirm")}
            <ArrowRight className="w-[14px] h-[14px]" />
          </button>
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-[8px] px-[20px] py-[10px] rounded border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] text-text-disabled hover:text-text-secondary font-mohave text-body-sm transition-colors"
          >
            {t("wizard.industry.change")}
          </button>
        </div>
      </motion.div>
    );
  }

  // ── Picker screen (no industries, or user chose "Change my trade") ───────

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center min-h-[320px] px-4"
    >
      <h2 className="font-mohave text-[28px] font-bold text-text-primary tracking-tight uppercase mb-[8px]">
        {hasIndustries
          ? t("wizard.industry.headlineKnown")
          : t("wizard.industry.headlineUnknown")}
      </h2>
      <p className="font-mohave text-body text-text-secondary text-center max-w-[400px] mb-[24px]">
        {t("wizard.industry.bodyUnknown")}
      </p>

      {/* Search input */}
      <div className="w-full max-w-[400px] mb-[12px]">
        <div
          className="flex items-center gap-[8px] px-[12px] py-[8px] rounded border border-[rgba(255,255,255,0.08)]"
          style={{
            background: "rgba(10, 10, 10, 0.70)",
            backdropFilter: "blur(20px) saturate(1.2)",
          }}
        >
          <Search className="w-[14px] h-[14px] text-text-disabled flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("wizard.industry.searchPlaceholder")}
            className="flex-1 bg-transparent text-text-primary font-mohave text-body-sm placeholder:text-text-disabled outline-none"
          />
        </div>
      </div>

      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="w-full max-w-[400px] flex flex-wrap gap-[6px] mb-[12px]">
          {selected.map((industry) => (
            <button
              key={industry}
              type="button"
              onClick={() => removeTag(industry)}
              className="flex items-center gap-[4px] px-[8px] py-[3px] rounded border border-[rgba(89,119,148,0.3)] bg-[rgba(89,119,148,0.12)] text-text-primary font-kosugi text-[11px] transition-colors hover:bg-[rgba(89,119,148,0.2)]"
            >
              {industry}
              <X className="w-[10px] h-[10px] text-text-secondary" />
            </button>
          ))}
        </div>
      )}

      {/* Scrollable checkbox list */}
      <div
        className="w-full max-w-[400px] max-h-[240px] overflow-y-auto scrollbar-hide rounded border border-[rgba(255,255,255,0.08)] mb-[24px]"
        style={{
          background: "rgba(10, 10, 10, 0.70)",
          backdropFilter: "blur(20px) saturate(1.2)",
        }}
      >
        {filtered.map((industry) => {
          const isSelected = selected.includes(industry);
          return (
            <button
              key={industry}
              type="button"
              onClick={() => toggleIndustry(industry)}
              className="flex items-center gap-[10px] w-full px-[12px] py-[8px] text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            >
              <div
                className={`w-[16px] h-[16px] rounded-[2px] border flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSelected
                    ? "border-[#597794] bg-[rgba(89,119,148,0.2)]"
                    : "border-[rgba(255,255,255,0.12)] bg-transparent"
                }`}
              >
                {isSelected && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 5L4.2 7.5L8 2.5"
                      stroke="#597794"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <span
                className={`font-mohave text-body-sm ${
                  isSelected ? "text-text-primary" : "text-text-secondary"
                }`}
              >
                {industry}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-[12px] py-[16px] text-center">
            <span className="font-kosugi text-[11px] text-text-disabled">
              No trades found
            </span>
          </div>
        )}
      </div>

      {/* Continue button */}
      <button
        type="button"
        disabled={selected.length === 0}
        onClick={() => onNext(selected)}
        className="flex items-center gap-[8px] px-[20px] py-[10px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(89,119,148,0.12)] hover:bg-[rgba(89,119,148,0.2)] text-text-primary font-mohave text-body-sm transition-colors disabled:opacity-40 disabled:pointer-events-none"
      >
        {t("wizard.industry.continue")}
        <ArrowRight className="w-[14px] h-[14px]" />
      </button>
    </motion.div>
  );
}
