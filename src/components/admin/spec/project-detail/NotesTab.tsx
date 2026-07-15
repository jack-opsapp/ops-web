"use client";

import { useEffect, useRef, useState } from "react";
import { saveNotes } from "@/app/admin/spec/[id]/_actions/save-notes";
import type { SpecInternalNoteRow, SpecNotesTab } from "@/lib/admin/spec-types";
import { formatDateTime } from "./format";

interface NotesTabProps {
  data: SpecNotesTab;
  projectId: string;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 1000;

export function NotesTab({ data, projectId }: NotesTabProps) {
  const latest = data.rows[0] ?? null;
  const [body, setBody] = useState<string>(latest?.body ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [showHistory, setShowHistory] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(latest?.body ?? "");
  const errorRef = useRef<string | null>(null);

  // Persist the dirty body across re-renders triggered by revalidatePath.
  // When the server returns a fresh snapshot, `latest.body` may equal the
  // value the operator just typed — we accept it and reset state to "saved".
  useEffect(() => {
    if (latest && latest.body !== lastSavedRef.current) {
      lastSavedRef.current = latest.body;
    }
  }, [latest]);

  const queueSave = (next: string) => {
    setBody(next);
    setState("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void performSave(next);
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const performSave = async (text: string) => {
    if (text === lastSavedRef.current) {
      setState("saved");
      return;
    }
    setState("saving");
    try {
      const fd = new FormData();
      fd.set("project_id", projectId);
      fd.set("body", text);
      await saveNotes(fd);
      lastSavedRef.current = text;
      errorRef.current = null;
      setState("saved");
    } catch (err) {
      errorRef.current = err instanceof Error ? err.message : "save failed";
      setState("error");
    }
  };

  const flushOnBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void performSave(body);
  };

  return (
    <div className="space-y-6">
      <section
        aria-label="Internal notes"
        className="glass-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-text">
            <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
              {"//"}
            </span>
            INTERNAL NOTES
          </h2>
          <SaveIndicator state={state} error={errorRef.current} />
        </div>

        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          <span className="text-text-mute">[</span>
          OPERATOR-ONLY · NEVER VISIBLE TO CUSTOMER · MARKDOWN SUPPORTED · AUTOSAVES ON BLUR + EVERY 1 SEC
          <span className="text-text-mute">]</span>
        </p>

        <textarea
          aria-label="Internal note body"
          value={body}
          onChange={(e) => queueSave(e.target.value)}
          onBlur={flushOnBlur}
          rows={14}
          placeholder="What you saw, what you decided, what comes next. Markdown supported — # headers, **bold**, `code`, lists."
          className="mt-4 w-full resize-y rounded border border-white/[0.10] bg-black px-4 py-3 font-mono text-[13px] leading-relaxed text-text outline-none transition-colors duration-150 ease-smooth focus:border-ops-accent"
        />
      </section>

      {data.rows.length > 1 && (
        <section
          aria-label="Note revision history"
          className="glass-surface p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-cakemono text-[12px] font-light uppercase leading-none text-text">
              <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
                {"//"}
              </span>
              REVISIONS · {data.rows.length - 1}
            </h3>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3 transition-colors duration-150 ease-smooth hover:text-text"
            >
              {showHistory ? "[HIDE]" : "[SHOW]"}
            </button>
          </div>

          {showHistory && (
            <ol className="mt-4 space-y-3">
              {data.rows.slice(1).map((rev) => (
                <RevisionRow key={rev.id} rev={rev} />
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function RevisionRow({ rev }: { rev: SpecInternalNoteRow }) {
  return (
    <li className="rounded border border-white/[0.06] bg-black/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.04] pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3">
          {rev.createdByLabel ?? "OPERATOR"}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-text-mute">
          {formatDateTime(rev.createdAt)}
        </span>
      </div>
      <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-2">
        {rev.body}
      </pre>
    </li>
  );
}

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  let label: string;
  let toneClass: string;
  switch (state) {
    case "idle":
      label = "IDLE";
      toneClass = "text-text-mute";
      break;
    case "dirty":
      label = "UNSAVED";
      toneClass = "text-tan";
      break;
    case "saving":
      label = "SAVING…";
      toneClass = "text-tan";
      break;
    case "saved":
      label = "SAVED";
      toneClass = "text-olive";
      break;
    case "error":
      label = error ? `ERROR · ${error}` : "ERROR";
      toneClass = "text-rose";
      break;
  }
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${toneClass}`}>
      <span className="text-text-mute">[</span>
      {label}
      <span className="text-text-mute">]</span>
    </span>
  );
}
