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
//    region is a keyed mount-fade (no exit gating — see the shell's MOTION
//    note). Reduced motion → opacity-only.
//
// VOICE: `//` mono slash titles, [brackets] for instructional micro-text, sentence
// case content, UPPERCASE authority. Never "AI" (guided setup), never "contractor"
// (the trades). Strings via useDictionary("catalog-setup").

import { useCallback, useRef, useState } from "react";

/**
 * Hard ceiling on an uploaded file. A trades price list is small (KBs); this
 * rejects a tens-of-MB vendor export BEFORE file.text()/parse pull it into memory
 * and stage a card per row — which would freeze or OOM the tab with no bound.
 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_MB = 5;
import {
  AlertTriangle,
  ArrowUpFromLine,
  Check,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { Surface } from "@/components/ui/surface";
import { ScrollFade } from "@/components/dashboard/widgets/shared/scroll-fade";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { UploadReadColumns } from "@/lib/catalog-setup/upload-stage";

const MONO_NUM: React.CSSProperties = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

/**
 * The outcome the route hands back after parsing + staging a dropped file. The
 * pane is presentational — it never parses or reads the catalog; it renders what
 * the route's `onUpload` resolves to.
 */
export type UploadPaneOutcome =
  /** Rows mapped + staged onto the canvas (some may have matched live rows). */
  | {
      kind: "staged";
      staged: number;
      merged: number;
      rowsRead: number;
      /** Which headers were read + any dropped columns (disclosure). */
      read?: UploadReadColumns;
    }
  /** The deterministic mapper found problems — nothing staged. */
  | { kind: "errors"; errors: string[] }
  /** File over the size ceiling — rejected before parse to protect the tab. */
  | { kind: "too_large"; maxMb: number }
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
      if (file.size > MAX_FILE_BYTES) {
        // Reject the oversized file up front — never read/parse it.
        setOutcome({ kind: "too_large", maxMb: MAX_FILE_MB });
        setPhase("result");
        return;
      }
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
      <Surface variant="default" className="flex min-h-0 flex-1 flex-col">
        {/* Header — panel title in mono, // slash in text-mute (decorative). */}
        <header className="px-2 pb-1.5 pt-2">
          <h2 className="font-mono text-micro uppercase tracking-wider text-text-3">
            <span className="text-text-mute">{"//"}</span>
            <span className="ml-1.5">
              {t("upload.title", "// UPLOAD").replace(/^\/\/\s*/, "")}
            </span>
          </h2>
          <p className="mt-1.5 max-w-[42ch] font-mohave text-body-sm text-text-2">
            {t(
              "upload.lead",
              "Hand over a price list — it lands on the canvas, and nothing saves until you build it.",
            )}
          </p>
        </header>

        {/* Body — dropzone OR result, a keyed mount (no exit gating; see the
            shell's MOTION note), inside a ScrollFade for discoverable overflow. */}
        <ScrollFade className="px-2 pb-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            data-testid="upload-input"
            className="sr-only"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />

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
        </ScrollFade>

        {/* Footer — back to the source picker. Bracket micro-text. */}
        <footer className="border-t border-glass-border px-2 py-1.5">
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
          "flex w-full flex-col items-start gap-1.5 rounded-panel border border-dashed px-2 py-4 text-left transition-colors duration-150",
          dragActive
            ? "border-border-strong bg-surface-hover"
            : "border-glass-border bg-surface-hover-subtle hover:border-line-hi hover:bg-surface-hover",
          working && "cursor-wait opacity-70",
        )}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded bg-surface-input text-text-3">
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
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className="flex flex-col gap-4"
    >
      {outcome.kind === "staged" ? (
        <StagedSummary t={t} outcome={outcome} />
      ) : outcome.kind === "errors" ? (
        <ErrorsSummary t={t} errors={outcome.errors} />
      ) : outcome.kind === "too_large" ? (
        <Notice
          t={t}
          tone="tan"
          testid="upload-too-large"
          message={t(
            "upload.tooLarge",
            "That file's too big — keep it under {max}MB, or split it.",
          ).replace("{max}", String(outcome.maxMb))}
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
      {outcome.read ? <ReadColumns t={t} read={outcome.read} /> : null}
    </div>
  );
}

/**
 * DISCLOSURE: which headers the auto-map read into name/price/quantity, plus any
 * dropped column. There's no column-confirm step on web, so this is how the owner
 * catches a wrong-column mis-map or a silently-skipped inventory column before
 * BUILD IT. Left-aligned, neutral; the dropped note rides tan (a heads-up, not an
 * error). Values quoted so a header like "Customer Name" reads as a clear flag.
 */
function ReadColumns({ t, read }: { t: Tt; read: UploadReadColumns }) {
  const cols: string[] = [];
  if (read.name) cols.push(`${t("upload.col.name", "name")} ← "${read.name}"`);
  if (read.price) cols.push(`${t("upload.col.price", "price")} ← "${read.price}"`);
  if (read.quantity)
    cols.push(`${t("upload.col.quantity", "quantity")} ← "${read.quantity}"`);
  return (
    <div className="flex flex-col gap-1 border-t border-glass-border pt-2 text-left">
      {cols.length > 0 ? (
        <span data-testid="upload-read-cols" className="font-mono text-micro tracking-wide text-text-3">
          {t("upload.readCols", "[ read: {cols} ]").replace("{cols}", cols.join("  ·  "))}
        </span>
      ) : null}
      {read.dropped && read.dropped.length > 0 ? (
        <span data-testid="upload-dropped-cols" className="font-mohave text-micro text-tan">
          {t("upload.dropped", "Skipped {cols} — not imported as inventory").replace(
            "{cols}",
            read.dropped.map((c) => `"${c}"`).join(", "),
          )}
        </span>
      ) : null}
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
