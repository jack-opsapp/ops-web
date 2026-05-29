"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, ArrowRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDictionary } from "@/i18n/client";

/**
 * Inline prompt for entering an invite code on the login/register pages.
 * Collapsed state: a single text link.
 * Expanded state: code input + join button.
 */
export function JoinTeamPrompt() {
  const { t } = useDictionary("auth");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [code, setCode] = useState("");

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push(`/join?code=${encodeURIComponent(trimmed)}`);
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center gap-2 min-h-[36px] px-2 py-1.5 rounded-sm border border-[rgba(255,255,255,0.08)] bg-transparent font-mohave text-body-sm text-text-3 hover:border-[rgba(255,255,255,0.18)] hover:text-text-2 transition-all"
      >
        <Users className="w-[18px] h-[18px] shrink-0" />
        <span className="flex-1 text-left">
          {t("joinTeam.prompt")}{" "}
          <span className="underline underline-offset-4">{t("joinTeam.cta")}</span>
        </span>
      </button>
    );
  }

  return (
    <form onSubmit={handleJoin} className="animate-fade-in space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-text-mute uppercase tracking-widest">
          {t("joinTeam.prompt")}
        </span>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setCode("");
          }}
          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-text-mute hover:text-text-3 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder={t("joinTeam.placeholder")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          prefixIcon={<Users className="w-4 h-4" />}
          autoFocus
          className="flex-1"
        />
        <button
          type="submit"
          disabled={!code.trim()}
          className="shrink-0 px-3 min-h-[36px] rounded-sm bg-ops-accent border border-ops-accent text-text font-mohave text-body-sm uppercase tracking-[0.08em] hover:bg-ops-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
        >
          {t("joinTeam.join")}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  );
}
