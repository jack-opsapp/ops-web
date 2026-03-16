"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, ArrowLeft, ArrowRight } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { mergePresets, type IndustryGroup } from "@/lib/data/industry-presets";
import { CURATED_COLORS } from "@/lib/data/curated-colors";
import { ColorPickerPopover } from "./color-picker-popover";

// ─── Exported Types ──────────────────────────────────────────────────────────

export interface WizardTaskType {
  id: string;
  name: string;
  color: string;
  tags: string[];
  enabled: boolean;
  estimatedHoursMin: number;
  estimatedHoursMax: number;
  industryGroup: string;
  alsoIn: string[];
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TaskTypesStepProps {
  industries: string[];
  onNext: (taskTypes: WizardTaskType[]) => void;
  onBack: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

function randomCuratedColor(): string {
  return CURATED_COLORS[Math.floor(Math.random() * CURATED_COLORS.length)].hex;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaskTypesStep({
  industries,
  onNext,
  onBack,
}: TaskTypesStepProps) {
  const { t } = useDictionary("settings");

  // ── State ────────────────────────────────────────────────────────────────

  const [wizardTaskTypes, setWizardTaskTypes] = useState<WizardTaskType[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const colorPickerAnchorRef = useRef<HTMLElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const newItemRef = useRef<string | null>(null);

  // ── Build task types from industries ─────────────────────────────────────

  useEffect(() => {
    const merged = mergePresets(industries);
    const types: WizardTaskType[] = merged.groups.flatMap((group) =>
      group.taskTypes.map((mt) => ({
        id: crypto.randomUUID(),
        name: mt.name,
        color: mt.color,
        tags: mt.tags,
        enabled: true,
        estimatedHoursMin: mt.estimatedHoursMin,
        estimatedHoursMax: mt.estimatedHoursMax,
        industryGroup: group.industry,
        alsoIn: mt.alsoIn,
      }))
    );
    setWizardTaskTypes(types);
    setEditingId(null);
    setColorPickerId(null);
  }, [industries]);

  // ── Focus input when editingId changes ─────────────────────────────────

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const toggleEnabled = useCallback((id: string) => {
    setWizardTaskTypes((prev) =>
      prev.map((tt) => (tt.id === id ? { ...tt, enabled: !tt.enabled } : tt))
    );
  }, []);

  const updateName = useCallback((id: string, name: string) => {
    setWizardTaskTypes((prev) =>
      prev.map((tt) => (tt.id === id ? { ...tt, name } : tt))
    );
  }, []);

  const commitName = useCallback(
    (id: string) => {
      setEditingId(null);
      // Remove custom types left with empty names
      setWizardTaskTypes((prev) => {
        const target = prev.find((tt) => tt.id === id);
        if (target && target.name.trim() === "" && target.tags.length === 0) {
          return prev.filter((tt) => tt.id !== id);
        }
        return prev;
      });
    },
    []
  );

  const updateColor = useCallback((id: string, color: string) => {
    setWizardTaskTypes((prev) =>
      prev.map((tt) => (tt.id === id ? { ...tt, color } : tt))
    );
  }, []);

  const addCustomType = useCallback(() => {
    const id = crypto.randomUUID();
    const newType: WizardTaskType = {
      id,
      name: "",
      color: randomCuratedColor(),
      tags: [],
      enabled: true,
      estimatedHoursMin: 0,
      estimatedHoursMax: 0,
      industryGroup: "Custom",
      alsoIn: [],
    };
    setWizardTaskTypes((prev) => [...prev, newType]);
    setEditingId(id);
    newItemRef.current = id;
  }, []);

  const handleContinue = useCallback(() => {
    onNext(wizardTaskTypes.filter((tt) => tt.enabled));
  }, [onNext, wizardTaskTypes]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const enabledCount = useMemo(
    () => wizardTaskTypes.filter((tt) => tt.enabled).length,
    [wizardTaskTypes]
  );

  // Group task types by industry for rendering
  const industryGroups = useMemo(() => {
    const groups: { industry: string; types: WizardTaskType[] }[] = [];
    let currentIndustry = "";
    for (const tt of wizardTaskTypes) {
      if (tt.industryGroup !== currentIndustry) {
        groups.push({ industry: tt.industryGroup, types: [tt] });
        currentIndustry = tt.industryGroup;
      } else {
        groups[groups.length - 1].types.push(tt);
      }
    }
    return groups;
  }, [wizardTaskTypes]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3, ease: EASE_SMOOTH }}
      className="flex flex-col px-4"
    >
      {/* Headline */}
      <h2 className="font-mohave text-[28px] font-bold text-text-primary tracking-tight uppercase mb-[8px]">
        {t("wizard.taskTypes.headline")}
      </h2>

      {/* Subtitle */}
      <p className="font-mohave text-body text-text-secondary mb-[4px]">
        {t("wizard.taskTypes.subtitle")}
      </p>

      {/* Color hint strip */}
      <p className="font-kosugi text-[11px] text-text-disabled mb-[20px]">
        {t("wizard.taskTypes.colorHint")}
      </p>

      {/* Industry-grouped task type list */}
      <div className="space-y-[16px] mb-[16px] max-h-[400px] overflow-y-auto scrollbar-hide">
        {industryGroups.map((group) => (
          <div key={group.industry}>
            {/* Industry header — only show if multiple industries selected */}
            {industries.length > 1 && (
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest mb-[6px] block">
                {group.industry}
              </span>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-[8px]">
              {group.types.map((tt, index) => (
                <TaskTypeCard
                  key={tt.id}
                  taskType={tt}
                  index={index}
                  isEditing={editingId === tt.id}
                  isColorPickerOpen={colorPickerId === tt.id}
                  editInputRef={
                    editingId === tt.id ? editInputRef : undefined
                  }
                  colorPickerAnchorRef={colorPickerAnchorRef}
                  onToggleEnabled={toggleEnabled}
                  onStartEdit={setEditingId}
                  onUpdateName={updateName}
                  onCommitName={commitName}
                  onOpenColorPicker={(id, anchor) => {
                    colorPickerAnchorRef.current = anchor;
                    setColorPickerId(id);
                  }}
                  onCloseColorPicker={() => setColorPickerId(null)}
                  onUpdateColor={updateColor}
                  t={t}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add Custom Type */}
      <button
        type="button"
        onClick={addCustomType}
        className="flex items-center gap-[6px] self-start px-[12px] py-[6px] mb-[20px] rounded border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] text-text-disabled hover:text-text-secondary font-mohave text-body-sm transition-colors"
      >
        <Plus className="w-[14px] h-[14px]" />
        {t("wizard.taskTypes.addCustom")}
      </button>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-[6px] text-text-disabled hover:text-text-secondary font-mohave text-body-sm transition-colors"
        >
          <ArrowLeft className="w-[14px] h-[14px]" />
          {t("wizard.taskTypes.back")}
        </button>

        <button
          type="button"
          onClick={handleContinue}
          disabled={enabledCount === 0}
          className="flex items-center gap-[8px] px-[20px] py-[10px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(89,119,148,0.12)] hover:bg-[rgba(89,119,148,0.2)] text-text-primary font-mohave text-body-sm transition-colors disabled:opacity-50"
        >
          {t("wizard.taskTypes.continue")}
          <ArrowRight className="w-[14px] h-[14px]" />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Card Sub-Component ──────────────────────────────────────────────────────

interface TaskTypeCardProps {
  taskType: WizardTaskType;
  index: number;
  isEditing: boolean;
  isColorPickerOpen: boolean;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
  colorPickerAnchorRef: React.RefObject<HTMLElement | null>;
  onToggleEnabled: (id: string) => void;
  onStartEdit: (id: string) => void;
  onUpdateName: (id: string, name: string) => void;
  onCommitName: (id: string) => void;
  onOpenColorPicker: (id: string, anchor: HTMLElement) => void;
  onCloseColorPicker: () => void;
  onUpdateColor: (id: string, color: string) => void;
  t: (key: string) => string;
}

function TaskTypeCard({
  taskType,
  index,
  isEditing,
  isColorPickerOpen,
  editInputRef,
  colorPickerAnchorRef,
  onToggleEnabled,
  onStartEdit,
  onUpdateName,
  onCommitName,
  onOpenColorPicker,
  onCloseColorPicker,
  onUpdateColor,
  t,
}: TaskTypeCardProps) {
  const colorDotRef = useRef<HTMLButtonElement>(null);
  const { id, name, color, enabled, estimatedHoursMin, estimatedHoursMax, alsoIn } = taskType;

  const hoursLabel =
    estimatedHoursMin > 0 || estimatedHoursMax > 0
      ? `${estimatedHoursMin}-${estimatedHoursMax} ${t("wizard.taskTypes.hours")}`
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: enabled ? 1 : 0.4,
        y: 0,
        scale: enabled ? 1 : 0.98,
      }}
      transition={{
        delay: index * 0.03,
        duration: 0.25,
        ease: EASE_SMOOTH,
      }}
      className="relative rounded border border-[rgba(255,255,255,0.08)] px-[10px] py-[8px]"
      style={{
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
      }}
    >
      {/* Main row */}
      <div className="flex items-center gap-[8px]">
        {/* Toggle */}
        <button
          type="button"
          onClick={() => onToggleEnabled(id)}
          className="relative w-[16px] h-[16px] rounded-sm border shrink-0 transition-colors"
          style={{
            borderColor: enabled
              ? "rgba(89, 119, 148, 0.6)"
              : "rgba(255, 255, 255, 0.12)",
            backgroundColor: enabled
              ? "rgba(89, 119, 148, 0.25)"
              : "transparent",
          }}
          aria-label={`Toggle ${name}`}
        >
          {enabled && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              className="absolute inset-[3px] rounded-[1px]"
              style={{ backgroundColor: "#597794" }}
            />
          )}
        </button>

        {/* Color dot */}
        <button
          ref={colorDotRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isColorPickerOpen) {
              onCloseColorPicker();
            } else {
              onOpenColorPicker(id, colorDotRef.current!);
            }
          }}
          className="w-[16px] h-[16px] rounded-full shrink-0 transition-transform hover:scale-110"
          style={{ backgroundColor: color }}
          aria-label="Change color"
        />

        {/* Name */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              value={name}
              placeholder={t("wizard.taskTypes.namePlaceholder")}
              onChange={(e) => onUpdateName(id, e.target.value)}
              onBlur={() => onCommitName(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitName(id);
                if (e.key === "Escape") onCommitName(id);
              }}
              className="w-full bg-transparent border-b border-[rgba(255,255,255,0.12)] font-mohave text-body-sm text-text-primary outline-none placeholder:text-text-disabled"
            />
          ) : (
            <button
              type="button"
              onClick={() => onStartEdit(id)}
              className="font-mohave text-body-sm text-text-primary truncate text-left w-full hover:text-white transition-colors"
            >
              {name || t("wizard.taskTypes.namePlaceholder")}
            </button>
          )}
        </div>

        {/* Badges */}
        <div className="flex items-center gap-[6px] shrink-0">
          {hoursLabel && (
            <span className="font-mono text-[10px] text-text-disabled whitespace-nowrap">
              {hoursLabel}
            </span>
          )}
          {alsoIn.length > 0 && (
            <span className="font-kosugi text-[9px] text-text-disabled whitespace-nowrap">
              {t("wizard.taskTypes.alsoIn").replace("{industries}", alsoIn.join(", "))}
            </span>
          )}
        </div>
      </div>

      {/* Color picker popover */}
      <AnimatePresence>
        {isColorPickerOpen && (
          <ColorPickerPopover
            selectedColor={color}
            onSelect={(hex) => onUpdateColor(id, hex)}
            onClose={onCloseColorPicker}
            anchorRef={colorPickerAnchorRef}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
