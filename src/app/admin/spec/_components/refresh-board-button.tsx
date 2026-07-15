"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface RefreshBoardButtonProps {
  initialRefreshedAt: string | null;
}

function formatRefreshedAt(iso: string | null): string {
  if (!iso) return "[never]";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / 60 / 60_000)}h ago`;
  return `${Math.floor(ms / 24 / 60 / 60_000)}d ago`;
}

export function RefreshBoardButton({ initialRefreshedAt }: RefreshBoardButtonProps) {
  const router = useRouter();
  const [refreshedAt, setRefreshedAt] = useState<string | null>(initialRefreshedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleClick() {
    setError(null);
    try {
      const res = await fetch("/api/admin/spec/board/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { refreshed_at?: string };
      if (body.refreshed_at) setRefreshedAt(body.refreshed_at);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
        <span className="text-text-mute">[</span>UPDATED {formatRefreshedAt(refreshedAt)}
        <span className="text-text-mute">]</span>
      </span>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`inline-flex items-center gap-2 rounded border border-ops-accent bg-transparent px-3 py-[5px] font-mono text-[12px] uppercase tracking-[0.12em] text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-black focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-ops-accent focus-visible:outline-offset-2 ${pending ? "opacity-50" : ""}`}
      >
        {pending ? "REFRESHING…" : "REFRESH BOARD"}
      </button>
      {error && (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-rose">
          <span className="text-text-mute">[</span>ERR · {error}
          <span className="text-text-mute">]</span>
        </span>
      )}
    </div>
  );
}
