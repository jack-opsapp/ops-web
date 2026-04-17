"use client";

// ---------------------------------------------------------------------------
// SearchPill — frosted-glass search input for finding entities in the galaxy.
// Top-left HUD position. Filters entities by name (case-insensitive substring).
// Matching entity IDs are pushed to the intel store, which highlights them.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { useIntelStore } from "@/stores/intel-store";
import { useDictionary } from "@/i18n/client";
import type { IntelEntity } from "@/lib/hooks/use-intel-graph";

interface SearchPillProps {
  entities: IntelEntity[];
}

export function SearchPill({ entities }: SearchPillProps) {
  const { t } = useDictionary("intel");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchQuery = useIntelStore((s) => s.searchQuery);
  const setSearchQuery = useIntelStore((s) => s.setSearchQuery);
  const setSearchResults = useIntelStore((s) => s.setSearchResults);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);

      if (!query.trim()) {
        setSearchResults([]);
        return;
      }

      const lower = query.toLowerCase();
      const matches = entities
        .filter((ent) => ent.name.toLowerCase().includes(lower))
        .map((ent) => ent.id);
      setSearchResults(matches);
    },
    [entities, setSearchQuery, setSearchResults]
  );

  const handleClear = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    inputRef.current?.focus();
  }, [setSearchQuery, setSearchResults]);

  // Keyboard shortcut: Cmd/Ctrl+F focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        handleClear();
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClear]);

  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "3px",
      }}
    >
      <Search className="w-3.5 h-3.5 text-[#999] flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={handleChange}
        placeholder={t("search")}
        className="bg-transparent font-mohave text-xs text-white placeholder:text-[#666] outline-none w-40"
      />
      {searchQuery && (
        <button onClick={handleClear} className="text-[#999] hover:text-white transition-colors">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
