"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Plus, ArrowLeft, ArrowRight } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  mergePresets,
  type PresetTaskTemplate,
} from "@/lib/data/industry-presets";
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
  templates: PresetTaskTemplate[];
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const colorPickerAnchorRef = useRef<HTMLElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const newItemRef = useRef<string | null>(null);

  // ── Build task types from industries ─────────────────────────────────────

  useEffect(() => {
    const merged = mergePresets(industries);
    const types: WizardTaskType[] = merged.taskTypes.map((mt) => ({
      id: crypto.randomUUID(),
      name: mt.name,
      color: mt.color,
      tags: mt.tags,
      enabled: true,
      estimatedHoursMin: mt.estimatedHoursMin,
      estimatedHoursMax: mt.estimatedHoursMax,
      templates: mt.templates,
    }));
    setWizardTaskTypes(types);
    setExpandedId(null);
    setEditingId(null);
    setColorPickerId(null);
  }, [industries]);

  // ── Focus input when editingId changes ───────────────────────────────────

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ── Handlers ─────────────────────────────────────────────────────────────

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

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
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
      templates: [],
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

  // ── Render ───────────────────────────────────────────────────────────────

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

      {/* Task type grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[8px] mb-[16px] max-h-[400px] overflow-y-auto scrollbar-hide">
        {wizardTaskTypes.map((tt, index) => (
          <TaskTypeCard
            key={tt.id}
            taskType={tt}
            index={index}
            isExpanded={expandedId === tt.id}
            isEditing={editingId === tt.id}
            isColorPickerOpen={colorPickerId === tt.id}
            editInputRef={
              editingId === tt.id ? editInputRef : undefined
            }
            colorPickerAnchorRef={colorPickerAnchorRef}
            onToggleEnabled={toggleEnabled}
            onToggleExpanded={toggleExpanded}
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
          Back
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
  isExpanded: boolean;
  isEditing: boolean;
  isColorPickerOpen: boolean;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
  colorPickerAnchorRef: React.RefObject<HTMLElement | null>;
  onToggleEnabled: (id: string) => void;
  onToggleExpanded: (id: string) => void;
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
  isExpanded,
  isEditing,
  isColorPickerOpen,
  editInputRef,
  colorPickerAnchorRef,
  onToggleEnabled,
  onToggleExpanded,
  onStartEdit,
  onUpdateName,
  onCommitName,
  onOpenColorPicker,
  onCloseColorPicker,
  onUpdateColor,
  t,
}: TaskTypeCardProps) {
  const colorDotRef = useRef<HTMLButtonElement>(null);
  const { id, name, color, enabled, estimatedHoursMin, estimatedHoursMax, templates } = taskType;

  const hoursLabel =
    estimatedHoursMin > 0 || estimatedHoursMax > 0
      ? `${estimatedHoursMin}-${estimatedHoursMax} ${t("wizard.taskTypes.hours")}`
      : null;

  const templateLabel =
    templates.length > 0
      ? `${templates.length} ${t("wizard.taskTypes.templates")}`
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
          {templateLabel && (
            <span className="font-mono text-[10px] text-text-disabled whitespace-nowrap">
              {templateLabel}
            </span>
          )}
        </div>

        {/* Expand chevron */}
        {templates.length > 0 && (
          <button
            type="button"
            onClick={() => onToggleExpanded(id)}
            className="shrink-0 p-[2px] text-text-disabled hover:text-text-secondary transition-colors"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            >
              <ChevronDown className="w-[14px] h-[14px]" />
            </motion.div>
          </button>
        )}
      </div>

      {/* Expanded template list */}
      <AnimatePresence>
        {isExpanded && templates.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="overflow-hidden"
          >
            <div className="pt-[8px] mt-[8px] border-t border-[rgba(255,255,255,0.04)]">
              {templates.map((tmpl, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-[3px]"
                >
                  <span className="font-kosugi text-[11px] text-text-disabled">
                    {tmpl.title}
                  </span>
                  {tmpl.estimatedHours != null && (
                    <span className="font-mono text-[10px] text-text-disabled opacity-60">
                      {tmpl.estimatedHours}h
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
