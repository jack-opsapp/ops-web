"use client";

// UploadPane — the file-upload source lane (spec §8, §11; plan Phase 2 / Phase 6
// deferred source lanes). Mounts in the LEFT pane (master-detail) when the owner
// picks "Upload a file" in the source picker.
//
// ── DESIGN JUDGMENT (root CLAUDE.md law — every element justified) ─────────────
//  • One job: hand over a file. A trades owner already keeps a price list (an
//    export from their old tool, a vendor sheet). The pane is a single dropzone
//    that says "give it here, I've got it" — not a column-mapping wizard. The
//    canvas on the right IS the review surface: every uploaded row lands there as
//    a proposed card the owner accepts/edits/rejects, so a separate confirm-your-
//    columns step would just duplicate the canvas. Auto-map, stage, review there.
//  • No accent. The steel #6F94B0 is the one BUILD IT element on the deck; the
//    dropzone, browse, and every result chip stay neutral. State meaning rides on
//    earth tones only — olive (staged/done), rose (rows need a fix), tan (heads-up:
//    unsupported file / couldn't read).
//  • The lane is never a dead end. A file it can't read doesn't vanish — it tells
//    the owner exactly what to do next (save as CSV with a name + price, or add by
//    hand) and offers that escape inline.
//
// ── MOTION (animation-architect → web-animations; EASE_SMOOTH, no spring) ──────
//  • Beat: TRANSITION (pane swaps in) + DISCOVERY (drag-over rewards instantly) +
//    a restrained ACHIEVEMENT (the staged readout — a stamp, the parade is the
//    cards cascading onto the canvas). Drag-over is Tier-1 CSS (150ms color
//    transition on the dropzone) — instant feedback, no JS animation. The result
//    region crossfades via AnimatePresence. Reduced motion → opacity-only.
//
// VOICE: `//` mono slash titles, [brackets] for instructional micro-text, sentence
// case content, UPPERCASE authority. Never "AI" (guided setup), never "contractor"
// (the trades). Strings via useDictionary("catalog-setup").

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpFromLine,
  Check,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

const MONO_NUM: React.CSSProperties = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

/**
 * The outcome the route hands back after parsing + staging a dropped file. The
 * pane is presentational — it never parses or reads the catalog; it renders what
 * the route's `onUpload` resolves to.
 */
export type UploadPaneOutcome =
  /** Rows mapped + staged onto the canvas (some may have matched live rows). */
  | { kind: "staged"; staged: number; merged: number; rowsRead: number }
  /** The deterministic mapper found problems — nothing staged. */
  | { kind: "errors"; errors: string[] }
  /** An .xlsx/.xls binary — CSV-first ship can't read it yet. */
  | { kind: "unsupported_binary"; ext: string }
  /** Couldn't auto-read (a PDF/photo/odd sheet) and guided extraction is off. */
  | { kind: "cant_read" };

export interface UploadPaneProps {
  /** Parse + route + stage a dropped file; resolves to what the pane renders. */
  onUpload: (file: File) => Promise<UploadPaneOutcome>;
  /** Escape from a can't-read outcome straight into manual entry. */
  onAddManually?: () => void;
  /** Return to the source picker. */
  onBack?: () => void;
  className?: string;
}

type Phase = "idle" | "working" | "result";

export function UploadPane({
  onUpload,
  onAddManually,
  onBack,
  className,
}: UploadPaneProps) {
  const { t } = useDictionary("catalog-setup");
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<UploadPaneOutcome | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || phase === "working") return;
      setPhase("working");
      try {
        const result = await onUpload(file);
        setOutcome(result);
      } catch {
        // A read/parse failure is surfaced as the same honest can't-read state —
        // the lane never dead-ends on an exception.
        setOutcome({ kind: "cant_read" });
      } finally {
        setPhase("result");
      }
    },
    [onUpload, phase],
  );

  const reset = useCallback(() => {
    setOutcome(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      void handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile],
  );

  // Entry beat (ARRIVAL): lands with precision, no bounce; reduced motion fades.
  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.aside
      aria-label={t("upload.title", "// UPLOAD")}
      data-testid="upload-pane"
      initial={enter.initial}
      animate={enter.animate}
      transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE_SMOOTH }}
      className={cn("flex h-full flex-col", className)}
    >
      <Surface variant="default" className="flex h-full flex-col p-[30px]">
        {/* Header — panel title in mono, // slash in text-mute (decorative). */}
        <header>
          <h2 className="font-mono text-micro uppercase tracking-wider text-text-3">
            <span className="text-text-mute">//</span>
            <span className="ml-1.5">
              {t("upload.title", "// UPLOAD").replace(/^\/\/\s*/, "")}
            </span>
          </h2>
          <p className="mt-4 max-w-[42ch] font-mohave text-body-sm text-text-2">
            {t(
              "upload.lead",
              "Hand over a price list — it lands on the canvas, and nothing saves until you build it.",
            )}
          </p>
        </header>

        {/* Body — dropzone OR result, crossfaded (TRANSITION beat). */}
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto scrollbar-hide">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            data-testid="upload-input"
            className="sr-only"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />

          <AnimatePresence mode="wait" initial={false}>
            {phase === "result" && outcome ? (
              <Result
                key="result"
                t={t}
                reduced={!!reduced}
                outcome={outcome}
                onAnother={reset}
                onAddManually={onAddManually}
              />
            ) : (
              <Dropzone
                key="dropzone"
                t={t}
                reduced={!!reduced}
                working={phase === "working"}
                dragActive={dragActive}
                onBrowse={() => inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragActive) setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Footer — back to the source picker. Bracket micro-text. */}
        <footer className="mt-6">
          <button
            type="button"
            onClick={onBack}
            data-testid="upload-back"
            className="self-start font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
          >
            {t("upload.back", "[ back ]")}
          </button>
        </footer>
      </Surface>
    </motion.aside>
  );
}

export default UploadPane;

type Tt = (key: string, fb?: string) => string;

// ── dropzone ───────────────────────────────────────────────────────────────────

function Dropzone({
  t,
  reduced,
  working,
  dragActive,
  onBrowse,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  t: Tt;
  reduced: boolean;
  working: boolean;
  dragActive: boolean;
  onBrowse: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
}) {
  return (
    <motion.div
      data-testid="upload-dropzone-region"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
    >
      <button
        type="button"
        data-testid="upload-dropzone"
        data-drag-active={dragActive ? "true" : undefined}
        disabled={working}
        onClick={onBrowse}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          // DISCOVERY beat: the border + tint brighten the instant a file is over
          // the zone — Tier-1 CSS, 150ms, no spring.
          "flex w-full flex-col items-center gap-3 rounded-panel border border-dashed px-5 py-10 text-center transition-colors duration-150",
          dragActive
            ? "border-[rgba(255,255,255,0.22)] bg-surface-hover"
            : "border-glass-border bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.18)] hover:bg-surface-hover",
          working && "cursor-wait opacity-70",
        )}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[rgba(255,255,255,0.04)] text-text-3">
          {working ? (
            <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          ) : dragActive ? (
            <ArrowUpFromLine size={20} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <FileSpreadsheet size={20} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
        <span className="font-mohave text-body-sm text-text">
          {working
            ? t("upload.working", "Reading your file…")
            : dragActive
              ? t("upload.dropActive", "Drop it in")
              : t("upload.drop", "Drop a price list here, or click to browse")}
        </span>
        <span className="font-mono text-micro tracking-wide text-text-3">
          {t("upload.hint", "[ CSV or Excel with a name and a price column ]")}
        </span>
      </button>
    </motion.div>
  );
}

// ── result ───────────────────────────────────────────────────────────────────

function Result({
  t,
  reduced,
  outcome,
  onAnother,
  onAddManually,
}: {
  t: Tt;
  reduced: boolean;
  outcome: UploadPaneOutcome;
  onAnother: () => void;
  onAddManually?: () => void;
}) {
  return (
    <motion.div
      data-testid="upload-result"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className="flex flex-col gap-4"
    >
      {outcome.kind === "staged" ? (
        <StagedSummary t={t} outcome={outcome} />
      ) : outcome.kind === "errors" ? (
        <ErrorsSummary t={t} errors={outcome.errors} />
      ) : outcome.kind === "unsupported_binary" ? (
        <Notice
          t={t}
          tone="tan"
          testid="upload-unsupported"
          message={t(
            "upload.xlsx",
            "Excel files aren't supported yet — save it as CSV and upload that",
          )}
        />
      ) : (
        <CantReadNotice t={t} onAddManually={onAddManually} />
      )}

      <button
        type="button"
        data-testid="upload-another"
        onClick={onAnother}
        className="self-start font-mono text-micro tracking-wide text-text-3 transition-colors duration-150 hover:text-text-2"
      >
        {t("upload.another", "[ upload another file ]")}
      </button>
    </motion.div>
  );
}

function StagedSummary({
  t,
  outcome,
}: {
  t: Tt;
  outcome: Extract<UploadPaneOutcome, { kind: "staged" }>;
}) {
  return (
    <div
      data-testid="upload-staged"
      className="flex flex-col gap-2 rounded-panel border border-olive-line bg-olive-soft px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Check size={15} strokeWidth={2} className="text-olive" aria-hidden="true" />
        <span className="font-mohave text-body-sm text-text" style={MONO_NUM}>
          {t("upload.staged", "Staged {count} — review them on the right").replace(
            "{count}",
            String(outcome.staged),
          )}
        </span>
      </div>
      {outcome.merged > 0 ? (
        <span
          data-testid="upload-merged"
          className="font-mohave text-micro text-tan"
          style={MONO_NUM}
        >
          {t(
            "upload.merged",
            "{count} already in your catalog — merge or skip on each",
          ).replace("{count}", String(outcome.merged))}
        </span>
      ) : null}
      <span className="font-mono text-micro tracking-wide text-text-3" style={MONO_NUM}>
        {t("upload.rowsRead", "[ read {count} rows ]").replace(
          "{count}",
          String(outcome.rowsRead),
        )}
      </span>
    </div>
  );
}

function ErrorsSummary({ t, errors }: { t: Tt; errors: string[] }) {
  return (
    <div
      data-testid="upload-errors"
      className="flex flex-col gap-2 rounded-panel border border-rose-line bg-rose-soft px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} strokeWidth={1.75} className="text-rose" aria-hidden="true" />
        <span className="font-mono text-micro uppercase tracking-wider text-rose">
          {t("upload.errorsTitle", "// some rows need a fix first").replace(/^\/\/\s*/, "// ")}
        </span>
      </div>
      <ul className="flex flex-col gap-1" role="list">
        {errors.map((reason, i) => (
          <li
            key={i}
            data-testid="upload-error-row"
            className="font-mohave text-micro leading-relaxed text-text-2"
          >
            {reason}
          </li>
        ))}
      </ul>
      <span className="font-mono text-micro tracking-wide text-text-3">
        {t("upload.errorsHint", "[ fix them in your file, then upload again ]")}
      </span>
    </div>
  );
}

function CantReadNotice({
  t,
  onAddManually,
}: {
  t: Tt;
  onAddManually?: () => void;
}) {
  return (
    <div
      data-testid="upload-cant-read"
      className="flex flex-col gap-3 rounded-panel border border-tan-line bg-tan-soft px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={15}
          strokeWidth={1.75}
          className="mt-[2px] shrink-0 text-tan"
          aria-hidden="true"
        />
        <span className="font-mohave text-body-sm text-text-2">
          {t(
            "upload.cantRead",
            "Couldn't read that one — save it as a CSV with a name and a price, or add items by hand",
          )}
        </span>
      </div>
      {onAddManually ? (
        <button
          type="button"
          data-testid="upload-add-manually"
          onClick={onAddManually}
          className="self-start font-mono text-micro tracking-wide text-text-2 transition-colors duration-150 hover:text-text"
        >
          {t("upload.addManually", "[ add it yourself ]")}
        </button>
      ) : null}
    </div>
  );
}

function Notice({
  t: _t,
  tone,
  message,
  testid,
}: {
  t: Tt;
  tone: "tan" | "rose";
  message: string;
  testid: string;
}) {
  const toneClass =
    tone === "tan"
      ? "border-tan-line bg-tan-soft text-tan"
      : "border-rose-line bg-rose-soft text-rose";
  return (
    <div
      data-testid={testid}
      className={cn(
        "flex items-start gap-2 rounded-panel border px-4 py-3",
        toneClass,
      )}
    >
      <AlertTriangle
        size={15}
        strokeWidth={1.75}
        className="mt-[2px] shrink-0"
        aria-hidden="true"
      />
      <span className="font-mohave text-body-sm text-text-2">{message}</span>
    </div>
  );
}
