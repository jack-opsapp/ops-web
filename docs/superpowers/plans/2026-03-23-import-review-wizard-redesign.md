# Import Review Wizard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the email pipeline import wizard's review phase (Step 4) from a monolithic scrollable list into a 4-sub-step guided flow with keyboard-driven carousel navigation, company contact consolidation, and improved AI terminal detection.

**Architecture:** The existing 5-step wizard container (`import-pipeline-wizard.tsx`) gets a vertical stepper rail replacing the horizontal dot indicator. Step 4 splits into 4 sub-steps (filter → consolidate → triage → confirm), each with its own component. A shared `CardCarousel` primitive handles keyboard navigation for sub-steps 1-3. A shared `EmailThreadView` component renders email excerpts across all sub-steps.

**Tech Stack:** Next.js 14 App Router, TypeScript, Framer Motion, Tailwind CSS, Lucide React icons, Supabase (existing), TanStack Query (existing)

**Spec:** `docs/superpowers/specs/2026-03-23-import-review-wizard-redesign.md`

**Design system:** Dark theme (`#0D0D0D`), accent `#6F94B0`, Mohave/Kosugi fonts, `EASE_SMOOTH` from `src/lib/utils/motion.ts`, `transform`+`opacity` only, 2-4px border radius, frosted glass surfaces (`rgba(10,10,10,0.70)` + `backdrop-blur(20px) saturate(1.2)` + `1px solid rgba(255,255,255,0.08)`)

**Deliberate renames:** The existing wizard uses "ANALYZE" and "IMPORT" for steps 2 and 4. This redesign renames them to **"SCAN"** and **"REVIEW"** to better describe what the user is doing (scanning their inbox, reviewing results). The old labels described the system action; the new labels describe the user action.

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `src/components/settings/wizard-steps/stepper-rail.tsx` | Vertical step navigation with sub-step support |
| `src/components/settings/wizard-steps/card-carousel.tsx` | Reusable vertical carousel with keyboard nav |
| `src/components/settings/wizard-steps/email-thread-view.tsx` | Shared email thread renderer |
| `src/components/settings/wizard-steps/filter-flagged-step.tsx` | Sub-step 1: binary import/discard for flagged leads |
| `src/components/settings/wizard-steps/consolidate-contacts-step.tsx` | Sub-step 2: company grouping + lead title editing |
| `src/components/settings/wizard-steps/triage-step.tsx` | Sub-step 3: won/lost/active/discard sort |
| `src/components/settings/wizard-steps/confirm-pipeline-step.tsx` | Sub-step 4: final review list with stage dropdowns |
| `src/components/settings/wizard-steps/consolidation-utils.ts` | `buildConsolidationGroups` utility (used by both consolidate step and main wizard) |
| `src/i18n/dictionaries/en/import-wizard.json` | English strings for all wizard UI |
| `src/i18n/dictionaries/es/import-wizard.json` | Spanish strings |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/types/email-import.ts` | Add `ConsolidationGroup` type, add `title` and `actualCloseDate` to `ImportPayload.leads` |
| `src/i18n/types.ts` | Add `'import-wizard'` to `Namespace` union |
| `src/components/settings/import-pipeline-wizard.tsx` | Replace horizontal dots with stepper rail, add sub-step state management within step 4, wire up 4 new sub-step components |
| `src/app/api/integrations/email/import/route.ts` | Accept `title` and `actualCloseDate` fields per lead |
| `src/lib/api/services/email-ai-classifier.ts` | Add time-based terminal detection heuristics to classification prompts |

### Removed Files

| File | Reason |
|------|--------|
| `src/components/settings/wizard-steps/review-import-step.tsx` | Replaced by 4 sub-step components |
| `src/components/settings/wizard-steps/resolve-duplicates-step.tsx` | Replaced by consolidate-contacts-step |
| `src/components/settings/wizard-steps/confirm-import-step.tsx` | Dead code — not imported by current wizard, superseded by confirm-pipeline-step |

---

## Task 1: Type Definitions and i18n Foundation

**Files:**
- Modify: `src/lib/types/email-import.ts`
- Modify: `src/i18n/types.ts`
- Create: `src/i18n/dictionaries/en/import-wizard.json`
- Create: `src/i18n/dictionaries/es/import-wizard.json`

- [ ] **Step 1: Add `ConsolidationGroup` type to `email-import.ts`**

After the existing `AnalyzedLead` interface (line 79), add:

```typescript
/** A group of leads from the same company that need consolidation */
export interface ConsolidationGroup {
  id: string;
  companyName: string;
  domain: string | null;
  contacts: Array<{
    leadId: string;
    name: string;
    email: string;
    phone: string | null;
  }>;
  leads: Array<{
    leadId: string;
    title: string;
    primaryContactEmail: string;
    correspondenceCount: number;
    lastMessageDate: string;
  }>;
  decision: 'confirm' | 'merge' | null;
}

export type TriageDecision = 'won' | 'lost' | 'active' | 'discard';
```

- [ ] **Step 2: Add `title` and `actualCloseDate` to `ImportPayload.leads`**

In the `ImportPayload` interface (line 82), add two fields to the leads array item after `subContacts`:

```typescript
    subContacts?: Array<{ name: string; email: string; phone: string | null }>;
    title: string | null;
    actualCloseDate: string | null;
```

- [ ] **Step 3: Add `'import-wizard'` to Namespace type**

In `src/i18n/types.ts`, add `'import-wizard'` to the `Namespace` type union.

- [ ] **Step 4: Create English dictionary `src/i18n/dictionaries/en/import-wizard.json`**

```json
{
  "steps": {
    "connect": "CONNECT",
    "scan": "SCAN",
    "sources": "SOURCES",
    "review": "REVIEW",
    "activate": "ACTIVATE"
  },
  "subSteps": {
    "filter": "filter",
    "consolidate": "consolidate",
    "triage": "triage",
    "confirm": "confirm"
  },
  "filter": {
    "title": "FILTER FLAGGED ITEMS",
    "description": "These were flagged by the agent. Decide what belongs in your pipeline.",
    "import": "IMPORT",
    "discard": "DISCARD",
    "skipToNext": "SKIP TO NEXT STEP",
    "reasons": {
      "legal": "Legal",
      "legal_desc": "Settlement, dispute, or lawyer correspondence",
      "job_seeker": "Job Seeker",
      "job_seeker_desc": "Someone looking for work or employment",
      "collections": "Collections",
      "collections_desc": "Invoice dispute or overdue payment follow-up",
      "platform_bid": "Platform Bid",
      "platform_bid_desc": "Bid invitation from Procore, BuilderTrend, etc.",
      "warranty": "Warranty",
      "warranty_desc": "Past client reporting an issue after completion",
      "ambiguous": "Ambiguous",
      "ambiguous_desc": "Relationship direction is unclear"
    }
  },
  "consolidate": {
    "title": "CONSOLIDATE CONTACTS",
    "description": "These contacts appear to be from the same company.",
    "contactsFrom": "contacts from",
    "confirm": "CONFIRM",
    "mergeIntoOne": "MERGE INTO 1 LEAD",
    "editTitle": "edit title",
    "via": "via",
    "leads": "Leads",
    "contacts": "Contacts"
  },
  "triage": {
    "title": "TRIAGE COMPLETED WORK",
    "description": "Mark past projects as won or lost. Everything else stays active.",
    "won": "WON",
    "lost": "LOST",
    "active": "ACTIVE"
  },
  "confirmPipeline": {
    "title": "CONFIRM PIPELINE",
    "description": "Review your active leads and adjust stages before import.",
    "summary": "{active} active · {won} won · {lost} lost · {discarded} discarded",
    "import": "IMPORT {count} LEADS",
    "back": "BACK",
    "noLeads": "No leads to import",
    "noLeadsDescription": "All leads were discarded or marked as won/lost in previous steps.",
    "viewFullThread": "View full thread in Gmail",
    "showOlder": "Show older messages ({count} more)"
  },
  "keyboard": {
    "navigate": "navigate",
    "accept": "accept",
    "discard": "discard"
  },
  "stages": {
    "new_lead": "New Lead",
    "qualifying": "Qualifying",
    "quoting": "Quoting",
    "quoted": "Quoted",
    "follow_up": "Follow Up",
    "negotiation": "Negotiation",
    "won": "Won",
    "lost": "Lost"
  },
  "emails": "emails",
  "last": "Last"
}
```

- [ ] **Step 5: Create Spanish dictionary `src/i18n/dictionaries/es/import-wizard.json`**

Mirror the English structure with Spanish translations. Use the same keys — translate only the values.

**i18n access pattern note:** The `useDictionary` hook returns the full dictionary object. Access nested values via direct object access (`dict.filter.title`), NOT via the `t()` function (which only resolves top-level keys). All new components should use `const dict = useDictionary("import-wizard")` then `dict.filter.title`, `dict.triage.won`, etc.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/email-import.ts src/i18n/types.ts src/i18n/dictionaries/en/import-wizard.json src/i18n/dictionaries/es/import-wizard.json
git commit -m "feat(import-wizard): add types, consolidation group, and i18n dictionaries"
```

---

## Task 2: Email Thread View Component

**Files:**
- Create: `src/components/settings/wizard-steps/email-thread-view.tsx`

This is a shared component used by every sub-step. Build it first so all other components can import it.

- [ ] **Step 1: Create `email-thread-view.tsx`**

```typescript
"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { AnalyzedLead } from "@/lib/types/email-import";

const INITIAL_VISIBLE = 3;

interface EmailThreadViewProps {
  lead: AnalyzedLead;
  /** Start expanded */
  defaultExpanded?: boolean;
  /** Whether this thread view is inside the focused carousel card (enables E key) */
  keyboardEnabled?: boolean;
}

export function EmailThreadView({ lead, defaultExpanded = false, keyboardEnabled = false }: EmailThreadViewProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);
  const prefersReduced = useReducedMotion();

  // E key toggles thread when keyboardEnabled (inside focused carousel card)
  useEffect(() => {
    if (!keyboardEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setIsExpanded((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardEnabled]);

  const excerpts = lead.emailExcerpts ?? [];
  if (excerpts.length === 0) return null;

  const sorted = [...excerpts].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const visible = showAll ? sorted : sorted.slice(0, INITIAL_VISIBLE);
  const hiddenCount = sorted.length - INITIAL_VISIBLE;

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${lead.threadId}`;

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 font-mohave text-[11px] text-[#555] hover:text-[#999] transition-colors"
      >
        <ChevronDown
          size={11}
          className="transition-transform duration-200"
          style={{ transform: isExpanded ? "rotate(0)" : "rotate(-90deg)" }}
        />
        {isExpanded ? "Hide thread" : "Show thread"}
        <span className="text-[#444]">({sorted.length})</span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: prefersReduced ? { duration: 0 } : { duration: 0.2, ease: EASE_SMOOTH } }}
            exit={{ opacity: 0, transition: prefersReduced ? { duration: 0 } : { duration: 0.15, ease: EASE_SMOOTH } }}
            className="mt-2 space-y-3"
          >
            {visible.map((excerpt, i) => (
              <div key={i} className="flex gap-2">
                <span
                  className="font-mohave text-[11px] flex-shrink-0 mt-0.5 select-none"
                  style={{
                    color: excerpt.direction === "inbound" ? "#6F94B0" : "#555",
                  }}
                >
                  {excerpt.direction === "inbound" ? "←" : "→"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mohave text-[11px] text-[#999]">
                      {excerpt.fromName}
                    </span>
                    <span className="font-mohave text-[10px] text-[#444]">
                      {formatRelativeDate(excerpt.date)}
                    </span>
                  </div>
                  <p className="font-mohave text-[11px] text-[#777] leading-[1.5] whitespace-pre-wrap break-words">
                    {excerpt.body}
                  </p>
                </div>
              </div>
            ))}

            {!showAll && hiddenCount > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="font-mohave text-[10px] text-[#6F94B0] hover:text-[#6A88A5] transition-colors ml-4"
              >
                Show older messages ({hiddenCount} more)
              </button>
            )}

            <a
              href={gmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mohave text-[10px] text-[#6F94B0] hover:text-[#6A88A5] transition-colors ml-4"
            >
              View full thread in Gmail
              <ExternalLink size={9} />
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  const months = Math.floor(diffDays / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}
```

- [ ] **Step 2: Verify the component compiles**

Run: `npx tsc --noEmit src/components/settings/wizard-steps/email-thread-view.tsx` or check for red squiggles in editor.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/wizard-steps/email-thread-view.tsx
git commit -m "feat(import-wizard): add shared EmailThreadView component"
```

---

## Task 3: Card Carousel Component

**Files:**
- Create: `src/components/settings/wizard-steps/card-carousel.tsx`

The core UI primitive. Handles keyboard navigation, focus management, card transitions, progress counter, and skip button. Render prop pattern lets each sub-step provide its own card content and action buttons.

- [ ] **Step 1: Create `card-carousel.tsx`**

```typescript
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

export interface CarouselItem<T> {
  id: string;
  data: T;
  /** AI-suggested default action key (e.g. "1", "2", "3") */
  defaultAction: string;
  /** Label shown on compressed previous card after decision */
  decisionLabel?: string;
}

interface CardCarouselProps<T> {
  /** Title shown at top left */
  title: string;
  /** Items to cycle through */
  items: CarouselItem<T>[];
  /** Render the focused card content */
  renderCard: (item: CarouselItem<T>, isFocused: boolean) => React.ReactNode;
  /** Render the compressed preview (previous/next peek) */
  renderPreview: (item: CarouselItem<T>) => React.ReactNode;
  /** Map of action key → handler. Keys: "1", "2", "3", "Backspace" */
  actions: Record<string, (item: CarouselItem<T>) => void>;
  /** Called when all items have been processed or user clicks skip */
  onComplete: () => void;
  /** Label for the skip button */
  skipLabel?: string;
}

export function CardCarousel<T>({
  title,
  items,
  renderCard,
  renderPreview,
  actions,
  onComplete,
  skipLabel = "SKIP TO NEXT STEP",
}: CardCarouselProps<T>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();

  // Handle empty items — trigger onComplete via useEffect, not during render
  useEffect(() => {
    if (items.length === 0) onComplete();
  }, [items.length, onComplete]);

  const current = items[currentIndex];
  const prev = currentIndex > 0 ? items[currentIndex - 1] : null;
  const next = currentIndex < items.length - 1 ? items[currentIndex + 1] : null;

  const advance = useCallback(() => {
    if (currentIndex < items.length - 1) {
      setDirection(1);
      setCurrentIndex((i) => i + 1);
    } else {
      onComplete();
    }
  }, [currentIndex, items.length, onComplete]);

  const goBack = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  const handleAction = useCallback(
    (key: string) => {
      if (!current) return;
      const handler = actions[key];
      if (handler) {
        handler(current);
        advance();
      }
    },
    [current, actions, advance]
  );

  // Accept default on Enter/ArrowDown, go back on ArrowUp
  const acceptDefault = useCallback(() => {
    if (!current) return;
    const handler = actions[current.defaultAction];
    if (handler) {
      handler(current);
      advance();
    }
  }, [current, actions, advance]);

  // Keyboard handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case "ArrowDown":
        case "Enter":
          e.preventDefault();
          acceptDefault();
          break;
        case "ArrowUp":
          e.preventDefault();
          goBack();
          break;
        case "Backspace":
          e.preventDefault();
          handleAction("Backspace");
          break;
        case "1":
        case "2":
        case "3":
          e.preventDefault();
          handleAction(e.key);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [acceptDefault, goBack, handleAction]);

  // Focus container on mount for keyboard capture
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  if (items.length === 0) return null;

  const dur = prefersReduced ? 0 : 0.2;
  const slideVariants = {
    enter: (dir: number) => ({ y: prefersReduced ? 0 : (dir > 0 ? 40 : -40), opacity: 0 }),
    center: { y: 0, opacity: 1, transition: { duration: dur, ease: EASE_SMOOTH } },
    exit: (dir: number) => ({
      y: prefersReduced ? 0 : (dir > 0 ? -40 : 40),
      opacity: 0,
      transition: { duration: prefersReduced ? 0 : 0.15, ease: EASE_SMOOTH },
    }),
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex flex-col outline-none"
      style={{ maxHeight: "calc(85vh - 180px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-kosugi text-[10px] tracking-[0.15em] uppercase text-[#999]">
          {title}
        </h3>
        <span className="font-mohave text-[12px] text-[#555]">
          {currentIndex + 1} of {items.length}
        </span>
      </div>

      {/* Previous card peek */}
      <div className="h-10 mb-2">
        {prev && (
          <motion.div
            key={`prev-${prev.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            className="px-3 py-2 border border-white/5 overflow-hidden"
            style={{ borderRadius: 2, background: "rgba(10, 10, 10, 0.70)", backdropFilter: "blur(20px) saturate(1.2)" }}
          >
            {renderPreview(prev)}
          </motion.div>
        )}
      </div>

      {/* Focused card */}
      <div className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait" custom={direction}>
          {current && (
            <motion.div
              key={current.id}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="border border-white/8 p-4"
              style={{
                borderRadius: 3,
                background: "rgba(10, 10, 10, 0.70)",
                backdropFilter: "blur(20px) saturate(1.2)",
                WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              }}
            >
              {renderCard(current, true)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Next card peek */}
      <div className="h-10 mt-2">
        {next && (
          <motion.div
            key={`next-${next.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            className="px-3 py-2 border border-white/5 overflow-hidden"
            style={{ borderRadius: 2, background: "rgba(10, 10, 10, 0.70)", backdropFilter: "blur(20px) saturate(1.2)" }}
          >
            {renderPreview(next)}
          </motion.div>
        )}
      </div>

      {/* Footer: keyboard hints + skip */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
        <div className="flex items-center gap-3">
          <span className="font-mohave text-[10px] text-[#444]">
            ↑↓ navigate · 1/2/3 select · ⏎ accept · ⌫ discard
          </span>
        </div>
        <button
          onClick={onComplete}
          className="font-kosugi text-[9px] tracking-[0.1em] uppercase text-[#555] hover:text-[#999] transition-colors"
        >
          {skipLabel} →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

Check TypeScript — generics, motion types, callback types should all resolve.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/wizard-steps/card-carousel.tsx
git commit -m "feat(import-wizard): add CardCarousel component with keyboard navigation"
```

---

## Task 4: Stepper Rail Component

**Files:**
- Create: `src/components/settings/wizard-steps/stepper-rail.tsx`

- [ ] **Step 1: Create `stepper-rail.tsx`**

```typescript
"use client";

import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface Step {
  key: string;
  label: string;
  subSteps?: Array<{ key: string; label: string }>;
}

interface StepperRailProps {
  steps: Step[];
  currentStep: string;
  currentSubStep?: string;
  completedSteps: Set<string>;
  completedSubSteps: Set<string>;
  /** Whether to show sub-steps (only when in the step that has them) */
  showSubSteps: boolean;
}

export function StepperRail({
  steps,
  currentStep,
  currentSubStep,
  completedSteps,
  completedSubSteps,
  showSubSteps,
}: StepperRailProps) {
  const prefersReduced = useReducedMotion();

  return (
    <nav className="flex flex-col gap-0.5 w-[160px] flex-shrink-0 pr-4 border-r border-white/5">
      {steps.map((step) => {
        const isCurrent = step.key === currentStep;
        const isCompleted = completedSteps.has(step.key);
        const isPast = isCompleted && !isCurrent;
        const isFuture = !isCompleted && !isCurrent;

        return (
          <div key={step.key}>
            {/* Main step */}
            <div className="flex items-center gap-2 py-1.5">
              {/* Indicator */}
              <div
                className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0"
                style={{ borderRadius: 2 }}
              >
                {isCompleted ? (
                  <Check size={10} className="text-[#6F94B0]" />
                ) : isCurrent ? (
                  <div
                    className="w-2 h-2"
                    style={{ background: "#6F94B0", borderRadius: 1 }}
                  />
                ) : (
                  <div
                    className="w-2 h-2 border border-white/15"
                    style={{ borderRadius: 1 }}
                  />
                )}
              </div>

              {/* Label */}
              <span
                className="font-kosugi text-[9px] tracking-[0.15em] uppercase"
                style={{
                  color: isCurrent
                    ? "#E5E5E5"
                    : isPast
                      ? "#6F94B0"
                      : "#444",
                }}
              >
                {step.label}
              </span>
            </div>

            {/* Sub-steps (only visible when in this step) */}
            {showSubSteps && isCurrent && step.subSteps && (
              <motion.div
                initial={prefersReduced ? false : { opacity: 0 }}
                animate={{ opacity: 1, transition: prefersReduced ? { duration: 0 } : { duration: 0.2, ease: EASE_SMOOTH } }}
                className="ml-5 flex flex-col gap-0.5"
              >
                {step.subSteps.map((sub) => {
                  const isSubCurrent = sub.key === currentSubStep;
                  const isSubCompleted = completedSubSteps.has(sub.key);

                  return (
                    <div key={sub.key} className="flex items-center gap-2 py-1">
                      <div className="w-2.5 h-2.5 flex items-center justify-center flex-shrink-0">
                        {isSubCompleted ? (
                          <Check size={8} className="text-[#6F94B0]" />
                        ) : isSubCurrent ? (
                          <div
                            className="w-1.5 h-1.5"
                            style={{ background: "#6F94B0", borderRadius: 1 }}
                          />
                        ) : (
                          <div
                            className="w-1.5 h-1.5 border border-white/10"
                            style={{ borderRadius: 1 }}
                          />
                        )}
                      </div>
                      <span
                        className="font-kosugi text-[8px] tracking-[0.12em] uppercase"
                        style={{
                          color: isSubCurrent
                            ? "#E5E5E5"
                            : isSubCompleted
                              ? "#6F94B0"
                              : "#444",
                        }}
                      >
                        {sub.label}
                      </span>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/wizard-steps/stepper-rail.tsx
git commit -m "feat(import-wizard): add vertical StepperRail component"
```

---

## Task 5: Filter Flagged Step (Sub-step 1)

**Files:**
- Create: `src/components/settings/wizard-steps/filter-flagged-step.tsx`

- [ ] **Step 1: Create `filter-flagged-step.tsx`**

Uses `CardCarousel` to present flagged leads. Each card shows the flag reason, client info, and Import/Discard buttons. Implements AI default selection per flag type.

Key points:
- Import from `CardCarousel` and `EmailThreadView`
- Filter `leads` to those with `needsReview === true`
- Map flag reasons to AI defaults: `legal` → discard, `job_seeker` → discard, others → import
- On action: set `lead.enabled = false` for discards, `true` for imports
- Call `onLeadsChanged` with updated leads array
- Call `onComplete` when carousel finishes or user skips

Props interface:
```typescript
interface FilterFlaggedStepProps {
  leads: AnalyzedLead[];
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  onComplete: () => void;
}
```

The card render should show: flag icon + reason label + description, client name, email, correspondence count, last email subject, relative date, expandable `EmailThreadView`, and two action buttons `[1: IMPORT]` `[2: DISCARD]`.

- [ ] **Step 2: Verify component compiles and renders with mock data**

Start dev server (`npm run dev`), navigate to settings → integrations → import wizard. Verify the component renders without errors using the existing scan data.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/wizard-steps/filter-flagged-step.tsx
git commit -m "feat(import-wizard): add FilterFlaggedStep with carousel + keyboard nav"
```

---

## Task 6: Consolidate Contacts Step (Sub-step 2)

**Files:**
- Create: `src/components/settings/wizard-steps/consolidate-contacts-step.tsx`

- [ ] **Step 1: Create `consolidation-utils.ts` as a standalone utility**

Create `src/components/settings/wizard-steps/consolidation-utils.ts` — this is imported by both the consolidate step AND the main wizard (for skip-detection logic).

```typescript
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import type { AnalyzedLead, ConsolidationGroup } from "@/lib/types/email-import";

/** Build consolidation groups from leads sharing a company domain or name */
export function buildConsolidationGroups(leads: AnalyzedLead[]): ConsolidationGroup[] {
  const domainMap = new Map<string, AnalyzedLead[]>();
  const nameMap = new Map<string, AnalyzedLead[]>();

  for (const lead of leads) {
    if (!lead.enabled) continue;
    // Group by non-public domain
    const domain = lead.client.email.split("@")[1]?.toLowerCase();
    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const existing = domainMap.get(domain) || [];
      existing.push(lead);
      domainMap.set(domain, existing);
    }
    // Group by exact name match
    const nameKey = lead.client.name.toLowerCase().trim();
    const existingName = nameMap.get(nameKey) || [];
    existingName.push(lead);
    nameMap.set(nameKey, existingName);
  }

  const groups: ConsolidationGroup[] = [];
  const processedLeadIds = new Set<string>();

  // Domain groups first (higher confidence)
  for (const [domain, domainLeads] of domainMap) {
    if (domainLeads.length < 2) continue;
    const companyName = domain.split(".")[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    groups.push({
      id: `domain-${domain}`,
      companyName,
      domain,
      contacts: domainLeads.map((l) => ({
        leadId: l.id,
        name: l.client.name,
        email: l.client.email,
        phone: l.client.phone,
      })),
      leads: domainLeads.map((l) => ({
        leadId: l.id,
        title: "",
        primaryContactEmail: l.client.email,
        correspondenceCount: l.correspondenceCount,
        lastMessageDate: l.lastMessageDate,
      })),
      decision: null,
    });
    domainLeads.forEach((l) => processedLeadIds.add(l.id));
  }

  // Name groups (lower confidence, skip already-grouped leads)
  for (const [, nameLeads] of nameMap) {
    const ungrouped = nameLeads.filter((l) => !processedLeadIds.has(l.id));
    if (ungrouped.length < 2) continue;

    groups.push({
      id: `name-${ungrouped[0].client.name.toLowerCase()}`,
      companyName: ungrouped[0].client.name,
      domain: null,
      contacts: ungrouped.map((l) => ({
        leadId: l.id,
        name: l.client.name,
        email: l.client.email,
        phone: l.client.phone,
      })),
      leads: ungrouped.map((l) => ({
        leadId: l.id,
        title: "",
        primaryContactEmail: l.client.email,
        correspondenceCount: l.correspondenceCount,
        lastMessageDate: l.lastMessageDate,
      })),
      decision: null,
    });
  }

  return groups;
}
```

- [ ] **Step 2: Create the full `consolidate-contacts-step.tsx` component**

Uses `CardCarousel` but with a custom card that shows:
- Editable company name field
- Contact list with remove (X) buttons
- Lead list with editable title fields and primary contact info
- Expandable `EmailThreadView` per lead
- Two action buttons: `[1: CONFIRM]` `[2: MERGE INTO 1 LEAD]`

Props interface:
```typescript
interface ConsolidateContactsStepProps {
  leads: AnalyzedLead[];
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  consolidationGroups: ConsolidationGroup[];
  onGroupsChanged: (groups: ConsolidationGroup[]) => void;
  onComplete: () => void;
}
```

When "Confirm" is chosen: mark the group's `decision: 'confirm'`. All leads remain separate but will share a client.

When "Merge" is chosen: mark the group's `decision: 'merge'`. The primary lead absorbs the others; secondary leads get `enabled: false`.

When a contact is removed (X button): eject that lead from the group back to standalone.

- [ ] **Step 3: Verify with dev server**

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/wizard-steps/consolidate-contacts-step.tsx
git commit -m "feat(import-wizard): add ConsolidateContactsStep with domain grouping"
```

---

## Task 7: Triage Step (Sub-step 3)

**Files:**
- Create: `src/components/settings/wizard-steps/triage-step.tsx`

- [ ] **Step 1: Implement client-side terminal detection heuristics**

**Note:** The spec describes heuristics in terms of email content analysis (e.g., "quote/price language", "scheduling/booking language"). The scan data does NOT contain full email bodies — only metadata (dates, counts, direction) and `estimatedValue`. The heuristics below are approximations using available data. `estimatedValue` is a proxy for "quote was sent" and `outboundCount >= 2` is a proxy for "ongoing engagement that likely concluded."

At the top of the file, implement `computeTriageDefault`:

```typescript
function computeTriageDefault(lead: AnalyzedLead): TriageDecision {
  // High confidence: AI terminal flags
  if (lead.terminalFlag === "likely_won" || lead.stage === "won") return "won";
  if (lead.terminalFlag === "likely_lost" || lead.stage === "lost") return "lost";

  // Medium confidence: time-based heuristics
  const lastDate = new Date(lead.lastMessageDate);
  const daysSinceLast = Math.floor(
    (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceLast > 30) {
    // Old thread with outbound quote → likely won (silence = acceptance in trades)
    if (lead.outboundCount > 0 && lead.estimatedValue) return "won";
    // Old thread, last message inbound, no reply → likely lost
    const lastExcerpt = lead.emailExcerpts?.[0]; // most recent
    if (lastExcerpt?.direction === "inbound") return "lost";
  }

  if (daysSinceLast > 21 && lead.outboundCount >= 2) {
    return "won"; // likely booked and completed
  }

  return "active";
}
```

- [ ] **Step 2: Create the full `triage-step.tsx` component**

Uses `CardCarousel`. Each card shows:
- Client name (+ title if from a consolidated group)
- Email, correspondence count, estimated value, relative date
- Expandable `EmailThreadView`
- Three action buttons: `[1: WON]` `[2: LOST]` `[3: ACTIVE]`
- Backspace for discard

The carousel items are all leads that passed sub-steps 1 and 2 (i.e., `lead.enabled === true` and not a flagged discard).

Props interface:
```typescript
interface TriageStepProps {
  leads: AnalyzedLead[];
  triageDecisions: Map<string, TriageDecision>;
  onTriageDecision: (leadId: string, decision: TriageDecision) => void;
  consolidationGroups: ConsolidationGroup[];
  onComplete: () => void;
}
```

- [ ] **Step 3: Verify with dev server**

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/wizard-steps/triage-step.tsx
git commit -m "feat(import-wizard): add TriageStep with time-based terminal heuristics"
```

---

## Task 8: Confirm Pipeline Step (Sub-step 4)

**Files:**
- Create: `src/components/settings/wizard-steps/confirm-pipeline-step.tsx`

- [ ] **Step 1: Create `confirm-pipeline-step.tsx`**

This is a scrollable list view (NOT a carousel). Active leads grouped by stage, with collapsible sections, stage dropdowns, and expandable email threads.

Key sections:
- Stage groups (collapsible): new_lead, qualifying, quoting, quoted, follow_up, negotiation
- Per lead row: client name (+ title), stage dropdown (ALL stages including won/lost), expand chevron for `EmailThreadView`
- Summary bar (sticky bottom): "{N} active · {N} won · {N} lost · {N} discarded"
- Back button → returns to sub-step 3
- Import button → triggers import with count

Props interface:
```typescript
interface ConfirmPipelineStepProps {
  leads: AnalyzedLead[];
  triageDecisions: Map<string, TriageDecision>;
  consolidationGroups: ConsolidationGroup[];
  onStageChange: (leadId: string, stage: string) => void;
  onBack: () => void;
  onImport: () => void;
}
```

Stage dropdown must include won/lost as options — user may reclassify during final review.

Summary counts are computed from `triageDecisions` map:
- Active = leads with decision "active" (or no decision, meaning they were never in triage)
- Won = leads with decision "won"
- Lost = leads with decision "lost"
- Discarded = leads with `enabled === false`

Import count = active + won + lost.

- [ ] **Step 2: Verify with dev server**

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/wizard-steps/confirm-pipeline-step.tsx
git commit -m "feat(import-wizard): add ConfirmPipelineStep with stage editing and summary"
```

---

## Task 9: Wire Sub-steps into Main Wizard

**Files:**
- Modify: `src/components/settings/import-pipeline-wizard.tsx`

This is the most complex task — integrating all new components into the existing wizard flow.

- [ ] **Step 1: Add new imports and state**

At the top of the file, add imports for:
- `StepperRail` from `./wizard-steps/stepper-rail`
- `FilterFlaggedStep` from `./wizard-steps/filter-flagged-step`
- `ConsolidateContactsStep` from `./wizard-steps/consolidate-contacts-step`
- `TriageStep` from `./wizard-steps/triage-step`
- `ConfirmPipelineStep` from `./wizard-steps/confirm-pipeline-step`
- `ConsolidationGroup`, `TriageDecision` from `@/lib/types/email-import`

Add new state variables:
```typescript
const [reviewSubStep, setReviewSubStep] = useState<1 | 2 | 3 | 4>(1);
const [consolidationGroups, setConsolidationGroups] = useState<ConsolidationGroup[]>([]);
const [triageDecisions, setTriageDecisions] = useState<Map<string, TriageDecision>>(new Map());

// Stepper rail state — computed from current step/substep
const stepKeyMap: Record<number, string> = { 1: "connect", 2: "scan", 3: "sources", 4: "review", 5: "activate" };
const subStepKeyMap: Record<number, string> = { 1: "filter", 2: "consolidate", 3: "triage", 4: "confirm" };

const completedSteps = useMemo(() => {
  const set = new Set<string>();
  if (step > 1) set.add("connect");
  if (step > 2) set.add("scan");
  if (step > 3) set.add("sources");
  if (step > 4) set.add("review");
  return set;
}, [step]);

const completedSubSteps = useMemo(() => {
  const set = new Set<string>();
  if (step === 4) {
    if (reviewSubStep > 1) set.add("filter");
    if (reviewSubStep > 2) set.add("consolidate");
    if (reviewSubStep > 3) set.add("triage");
  }
  return set;
}, [step, reviewSubStep]);
```

- [ ] **Step 2: Replace horizontal dot progress bar with `StepperRail`**

Find the current 5-dot progress indicator (around line 691-710 in the original file). Replace it with:

```typescript
<StepperRail
  steps={[
    { key: "connect", label: dict.steps.connect },
    { key: "scan", label: dict.steps.scan },
    { key: "sources", label: dict.steps.sources },
    {
      key: "review",
      label: dict.steps.review,
      subSteps: [
        { key: "filter", label: dict.subSteps.filter },
        { key: "consolidate", label: dict.subSteps.consolidate },
        { key: "triage", label: dict.subSteps.triage },
        { key: "confirm", label: dict.subSteps.confirm },
      ],
    },
    { key: "activate", label: dict.steps.activate },
  ]}
  currentStep={stepKeyMap[step]}
  currentSubStep={step === 4 ? subStepKeyMap[reviewSubStep] : undefined}
  completedSteps={completedSteps}
  completedSubSteps={completedSubSteps}
  showSubSteps={step === 4}
/>
```

Change the wizard layout from vertical (dots on top, content below) to horizontal (rail on left, content on right):

```tsx
<div className="flex gap-0 min-h-0 flex-1">
  <StepperRail ... />
  <div className="flex-1 min-w-0 pl-4">
    <AnimatePresence mode="wait" custom={direction}>
      {/* step content */}
    </AnimatePresence>
  </div>
</div>
```

- [ ] **Step 3: Replace step 4 rendering with sub-step routing**

Find where `ReviewImportStep` and `ResolveDuplicatesStep` are currently rendered (inside the step 4 case). Replace with sub-step routing:

```typescript
{step === 4 && (
  <>
    {reviewSubStep === 1 && (
      <FilterFlaggedStep
        leads={confirmedLeads}
        onLeadsChanged={setConfirmedLeads}
        onComplete={() => {
          // Check if consolidation needed, skip if not
          const groups = buildConsolidationGroups(
            confirmedLeads.filter((l) => l.enabled)
          );
          setConsolidationGroups(groups);
          setReviewSubStep(groups.length > 0 ? 2 : 3);
        }}
      />
    )}
    {reviewSubStep === 2 && (
      <ConsolidateContactsStep
        leads={confirmedLeads}
        onLeadsChanged={setConfirmedLeads}
        consolidationGroups={consolidationGroups}
        onGroupsChanged={setConsolidationGroups}
        onComplete={() => setReviewSubStep(3)}
      />
    )}
    {reviewSubStep === 3 && (
      <TriageStep
        leads={confirmedLeads}
        triageDecisions={triageDecisions}
        onTriageDecision={(id, decision) => {
          setTriageDecisions((prev) => new Map(prev).set(id, decision));
        }}
        consolidationGroups={consolidationGroups}
        onComplete={() => setReviewSubStep(4)}
      />
    )}
    {reviewSubStep === 4 && (
      <ConfirmPipelineStep
        leads={confirmedLeads}
        triageDecisions={triageDecisions}
        consolidationGroups={consolidationGroups}
        onStageChange={(id, stage) => {
          setConfirmedLeads((prev) =>
            prev.map((l) => (l.id === id ? { ...l, stage } : l))
          );
        }}
        onBack={() => setReviewSubStep(3)}
        onImport={handleImport}
      />
    )}
  </>
)}
```

- [ ] **Step 4: Update the `handleImport` function**

Modify the existing import handler to build the payload with the new `title` and `actualCloseDate` fields. In the `leads.map()` call inside `handleImport`, add these fields:

```typescript
// Build a title lookup from consolidation groups
const titleMap = new Map<string, string>();
for (const group of consolidationGroups) {
  if (group.leads.length > 1) {
    for (const gl of group.leads) {
      if (gl.title) titleMap.set(gl.leadId, gl.title);
    }
  }
}

// Reconcile triage decisions with lead state
const importLeads = confirmedLeads
  .filter((lead) => {
    const decision = triageDecisions.get(lead.id);
    return lead.enabled && decision !== "discard";
  })
  .map((lead) => {
    const decision = triageDecisions.get(lead.id);
    const isTerminal = decision === "won" || decision === "lost";
    const stage = isTerminal ? decision : lead.stage;

    return {
      // ... existing fields (id, threadId, clientName, etc.) ...
      stage,
      title: titleMap.get(lead.id) || null,
      actualCloseDate: isTerminal ? lead.lastMessageDate : null,
    };
  });
```

- [ ] **Step 5: Remove old imports**

Remove imports and references to `ReviewImportStep` and `ResolveDuplicatesStep`. Do NOT delete the files yet (that's the next task).

- [ ] **Step 6: Handle sub-step skipping logic**

When entering step 4, determine the starting sub-step:
- If no flagged leads → skip to sub-step 2
- If no flagged AND no consolidation groups → skip to sub-step 3

```typescript
const enterReview = useCallback(() => {
  const flagged = confirmedLeads.filter((l) => l.needsReview);
  if (flagged.length === 0) {
    const groups = buildConsolidationGroups(confirmedLeads);
    setConsolidationGroups(groups);
    setReviewSubStep(groups.length > 0 ? 2 : 3);
  } else {
    setReviewSubStep(1);
  }
}, [confirmedLeads]);
```

- [ ] **Step 7: Verify full flow with dev server**

Start dev server, navigate to settings → integrations. Open import wizard with existing scan data. Walk through all 5 steps including the 4 new sub-steps. Verify:
- Stepper rail renders correctly with sub-steps
- Each sub-step carousel works with keyboard
- Decisions persist across sub-steps
- Back navigation works
- Import triggers correctly

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/import-pipeline-wizard.tsx
git commit -m "feat(import-wizard): integrate stepper rail and 4 review sub-steps"
```

---

## Task 10: Import API Changes

**Files:**
- Modify: `src/app/api/integrations/email/import/route.ts`

- [ ] **Step 1: Accept `title` field**

Find where opportunities are created (search for `title:` in the opportunity insert). Change to use `lead.title` when provided:

```typescript
title: lead.title || lead.description || `Email inquiry from ${lead.clientName}`,
```

- [ ] **Step 2: Accept `actualCloseDate` field**

Find the line setting `actualCloseDate` (currently `new Date()` for terminal leads — the code uses camelCase, Supabase column is `actual_close_date`). Change:

```typescript
actual_close_date: isTerminal
  ? (lead.actualCloseDate ? new Date(lead.actualCloseDate) : new Date())
  : null,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/integrations/email/import/route.ts
git commit -m "fix(import): accept title and actualCloseDate from wizard payload"
```

---

## Task 11: AI Classifier Terminal Detection Improvement

**Files:**
- Modify: `src/lib/api/services/email-ai-classifier.ts`

- [ ] **Step 1: Add time-based terminal detection to classification prompts**

Find the thread classification system prompt (search for `TERMINAL DETECTION` or the `flag:` instruction). Add the following text to the prompt, after the existing terminal flag instructions:

```
TERMINAL DETECTION — apply these rules IN ADDITION to content signals:
- If the thread's last activity was >30 days ago AND the last outbound message contained pricing/quote language → flag as "likely_won" (most quoted jobs that go silent were accepted and completed)
- If the thread's last activity was >30 days ago AND the last message was inbound with no outbound reply → flag as "likely_lost" (dropped lead)
- If the thread's last activity was >21 days ago AND outbound messages contained scheduling/booking language ("booked for", "scheduled", "see you on") → flag as "likely_won"
- Trade industry context: silence after a quote is more often acceptance than rejection. Err toward "likely_won" for old quoted threads.
```

This applies to all four classification functions that produce terminal flags:
1. `classifySingleThreadBatch` (~line 459) — thread-level batch with excerpts
2. `classifySingleBatch` (~line 586) — single-email legacy batch
3. `analyzeThreadBatch` (~line 668) — full thread content analysis
4. `deepExtractSingleBatch` (~line 827) — deep extraction with terminal flags at line 906

- [ ] **Step 2: Commit**

```bash
git add src/lib/api/services/email-ai-classifier.ts
git commit -m "feat(ai-classifier): add time-based terminal detection heuristics"
```

---

## Task 12: Cleanup and Final Verification

**Files:**
- Delete: `src/components/settings/wizard-steps/review-import-step.tsx`
- Delete: `src/components/settings/wizard-steps/resolve-duplicates-step.tsx`

- [ ] **Step 1: Search for remaining references to removed components**

```bash
grep -r "ReviewImportStep\|review-import-step\|ResolveDuplicatesStep\|resolve-duplicates-step\|confirm-import-step" src/ --include="*.tsx" --include="*.ts"
```

Remove any remaining imports or references. The main wizard file should already have been cleaned in Task 9.

- [ ] **Step 2: Delete the old files**

```bash
git rm src/components/settings/wizard-steps/review-import-step.tsx
git rm src/components/settings/wizard-steps/resolve-duplicates-step.tsx
git rm src/components/settings/wizard-steps/confirm-import-step.tsx
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 4: Run linter**

```bash
npm run lint
```

Fix any lint warnings/errors.

- [ ] **Step 5: Full flow verification with dev server**

Start dev server. Walk through the complete wizard flow:
1. Connect → Scan → Sources → Review
2. In Review: Filter → Consolidate → Triage → Confirm
3. Verify keyboard navigation in all carousel steps
4. Verify stage dropdowns include won/lost in Confirm step
5. Verify email thread views expand correctly
6. Verify summary counts are accurate
7. Execute import and verify ImportProgress shows
8. Verify Activate step works after import

- [ ] **Step 6: Commit cleanup**

```bash
git add -A
git commit -m "chore(import-wizard): remove old review/resolve steps, fix type errors"
```

---

## Task Order and Dependencies

```
Task 1 (types + i18n)
  ↓
Task 2 (EmailThreadView)  ─┐
Task 3 (CardCarousel)      ├── foundations (sequential)
Task 4 (StepperRail)       ─┘
  ↓
Tasks 5, 6, 7, 8 (four sub-steps — can be parallelized, but Task 6 must finish before Task 9)
  ↓
Task 9 (wire into main wizard — depends on all above)
Task 13 (review state persistence — alongside Task 9, both modify wizard)
  ↓
Task 10 (API changes — can parallel with Task 9)
Task 11 (AI classifier — independent, can parallel with Task 9-10)
  ↓
Task 12 (cleanup — must be last)
```

Tasks 5-8 are independent of each other and can be dispatched as parallel subagents (but note Task 6 creates `consolidation-utils.ts` which Task 9 imports — Task 6 must complete before Task 9 begins). Tasks 10-11 are independent and can parallel with Task 9. Task 13 should be done alongside Task 9 (it modifies the wizard's save/restore logic).

---

## Task 13: Review State Persistence

**Files:**
- Modify: `src/components/settings/import-pipeline-wizard.tsx`

The spec requires that sub-step decisions survive wizard close and browser refresh. Currently the wizard only persists `wizardStep` and job IDs to `connection.sync_filters`. We need to also persist review decisions.

- [ ] **Step 1: Define the reviewState shape**

```typescript
interface ReviewState {
  subStep: 1 | 2 | 3 | 4;
  /** Lead IDs that were discarded in sub-step 1 (filter) */
  filteredOutIds: string[];
  /** Consolidation group decisions */
  consolidationDecisions: Array<{ groupId: string; decision: 'confirm' | 'merge' }>;
  /** Triage decisions per lead */
  triageDecisions: Array<{ leadId: string; decision: TriageDecision }>;
  /** Stage overrides from sub-step 4 */
  stageOverrides: Array<{ leadId: string; stage: string }>;
  /** Timestamp for staleness check */
  savedAt: string;
}
```

- [ ] **Step 2: Save reviewState on sub-step transitions and wizard close**

Add a `saveReviewState` function that writes to `connection.sync_filters.reviewState`:

```typescript
const saveReviewState = useCallback(async () => {
  if (!connectionId) return;
  const reviewState: ReviewState = {
    subStep: reviewSubStep,
    filteredOutIds: confirmedLeads.filter((l) => !l.enabled && l.needsReview).map((l) => l.id),
    consolidationDecisions: consolidationGroups
      .filter((g) => g.decision)
      .map((g) => ({ groupId: g.id, decision: g.decision! })),
    triageDecisions: Array.from(triageDecisions.entries())
      .map(([leadId, decision]) => ({ leadId, decision })),
    stageOverrides: confirmedLeads
      .filter((l) => l.stage !== /* original stage from scan */)
      .map((l) => ({ leadId: l.id, stage: l.stage })),
    savedAt: new Date().toISOString(),
  };

  await fetch("/api/integrations/email/connection", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionId,
      syncFilters: { ...existingSyncFilters, reviewState },
    }),
  });
}, [connectionId, reviewSubStep, confirmedLeads, consolidationGroups, triageDecisions]);
```

Call `saveReviewState` on:
- Every sub-step transition (sub-step N → N+1)
- Wizard close (in the dialog's `onOpenChange` handler)

- [ ] **Step 3: Restore reviewState on wizard reopen**

In the wizard's state restoration logic (where it checks `connection.syncFilters.lastScanJobId`), add reviewState restoration:

```typescript
// After loading scan result and confirmedLeads...
const reviewState = connection.syncFilters?.reviewState as ReviewState | undefined;
if (reviewState) {
  const savedAt = new Date(reviewState.savedAt);
  const hoursSinceSave = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);

  if (hoursSinceSave < 24) {
    // Restore sub-step
    setReviewSubStep(reviewState.subStep);

    // Restore filter decisions
    for (const id of reviewState.filteredOutIds) {
      const lead = confirmedLeads.find((l) => l.id === id);
      if (lead) lead.enabled = false;
    }

    // Restore triage decisions
    const restoredTriage = new Map<string, TriageDecision>();
    for (const { leadId, decision } of reviewState.triageDecisions) {
      restoredTriage.set(leadId, decision);
    }
    setTriageDecisions(restoredTriage);

    // Restore stage overrides
    for (const { leadId, stage } of reviewState.stageOverrides) {
      const lead = confirmedLeads.find((l) => l.id === leadId);
      if (lead) lead.stage = stage;
    }

    // Advance wizard to step 4
    setStep(4);
  }
  // If stale (>24h), ignore — start fresh from sub-step 1
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/import-pipeline-wizard.tsx
git commit -m "feat(import-wizard): persist and restore review sub-step decisions"
```
