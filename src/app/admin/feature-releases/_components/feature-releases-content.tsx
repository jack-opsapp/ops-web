"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Trash2, X } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FeatureFlag {
  slug: string;
  label: string;
  description: string | null;
  enabled: boolean;
  overrideCount: number;
  created_at: string;
  updated_at: string;
}

interface Override {
  id: string;
  flag_slug: string;
  user_id: string;
  created_at: string;
  user: { first_name: string; last_name: string; email: string };
}

interface SearchUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FeatureReleasesContent() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showNewFlag, setShowNewFlag] = useState(false);

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchFlags = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feature-flags");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setFlags(data);
    } catch {
      showMessage("Failed to load feature flags", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const toggleFlag = async (slug: string, enabled: boolean) => {
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      setFlags((prev) =>
        prev.map((f) => (f.slug === slug ? { ...f, enabled } : f))
      );
      showMessage(`${slug} is now ${enabled ? "ON" : "OFF"}`, "success");
    } catch {
      showMessage("Failed to toggle flag", "error");
    }
  };

  const createFlag = async (slug: string, label: string, description: string) => {
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, label, description: description || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create");
      }
      setShowNewFlag(false);
      fetchFlags();
      showMessage(`Created "${label}"`, "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to create flag", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="font-mohave text-[14px] uppercase tracking-widest text-[#6B6B6B] animate-pulse">
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Message toast */}
      {message && (
        <div
          className={`px-4 py-2 rounded-lg text-[13px] font-mohave ${
            message.type === "success"
              ? "bg-[#9DB582]/20 text-[#9DB582]"
              : "bg-[#93321A]/20 text-[#93321A]"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Flag cards */}
      {flags.map((flag) => (
        <FlagCard
          key={flag.slug}
          flag={flag}
          onToggle={toggleFlag}
          onOverrideChange={fetchFlags}
          showMessage={showMessage}
        />
      ))}

      {/* Add new flag */}
      {showNewFlag ? (
        <NewFlagForm onSubmit={createFlag} onCancel={() => setShowNewFlag(false)} />
      ) : (
        <button
          onClick={() => setShowNewFlag(true)}
          className="flex items-center gap-2 px-4 py-3 w-full border border-dashed border-white/[0.12] rounded-lg text-[#6B6B6B] hover:text-[#E5E5E5] hover:border-white/[0.2] transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="font-mohave text-[13px] uppercase tracking-wider">Add New Feature Flag</span>
        </button>
      )}
    </div>
  );
}

// ─── Flag Card ───────────────────────────────────────────────────────────────

function FlagCard({
  flag,
  onToggle,
  onOverrideChange,
  showMessage,
}: {
  flag: FeatureFlag;
  onToggle: (slug: string, enabled: boolean) => void;
  onOverrideChange: () => void;
  showMessage: (text: string, type: "success" | "error") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingOverrides, setLoadingOverrides] = useState(false);

  const fetchOverrides = useCallback(async () => {
    setLoadingOverrides(true);
    try {
      const res = await fetch(`/api/admin/feature-flags/overrides?flagSlug=${flag.slug}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setOverrides(data.overrides ?? []);
    } catch {
      showMessage("Failed to load overrides", "error");
    } finally {
      setLoadingOverrides(false);
    }
  }, [flag.slug, showMessage]);

  useEffect(() => {
    if (expanded && !flag.enabled) {
      fetchOverrides();
    }
  }, [expanded, flag.enabled, fetchOverrides]);

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/admin/feature-flags/overrides?q=${encodeURIComponent(searchQuery)}`
      );
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      // Filter out users who already have overrides
      const existingIds = new Set(overrides.map((o) => o.user_id));
      setSearchResults((data.users ?? []).filter((u: SearchUser) => !existingIds.has(u.id)));
    } catch {
      showMessage("Search failed", "error");
    } finally {
      setSearching(false);
    }
  };

  const addOverride = async (userId: string) => {
    try {
      const res = await fetch("/api/admin/feature-flags/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagSlug: flag.slug, userId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed");
      }
      setSearchResults((prev) => prev.filter((u) => u.id !== userId));
      fetchOverrides();
      onOverrideChange();
      showMessage("Override added", "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to add override", "error");
    }
  };

  const removeOverride = async (overrideId: string) => {
    try {
      const res = await fetch("/api/admin/feature-flags/overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: overrideId }),
      });
      if (!res.ok) throw new Error("Failed");
      setOverrides((prev) => prev.filter((o) => o.id !== overrideId));
      onOverrideChange();
      showMessage("Override removed", "success");
    } catch {
      showMessage("Failed to remove override", "error");
    }
  };

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div>
            <h3 className="font-mohave text-[16px] font-semibold uppercase text-[#E5E5E5]">
              {flag.label}
            </h3>
            {flag.description && (
              <p className="font-kosugi text-[12px] text-[#6B6B6B] mt-0.5">{flag.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!flag.enabled && flag.overrideCount > 0 && (
            <span className="font-kosugi text-[11px] text-[#597794]">
              {flag.overrideCount} override{flag.overrideCount !== 1 ? "s" : ""}
            </span>
          )}
          <ToggleSwitch
            checked={flag.enabled}
            onChange={(val) => onToggle(flag.slug, val)}
          />
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-white/[0.08] px-6 py-4">
          {flag.enabled ? (
            <p className="font-kosugi text-[12px] text-[#6B6B6B]">
              All users with the appropriate role can access this feature.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B]">
                  Override Access
                </span>
              </div>

              {/* User search */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6B6B]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchUsers()}
                    placeholder="Search users by name or email..."
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg pl-9 pr-4 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
                  />
                </div>
                <button
                  onClick={searchUsers}
                  disabled={searching || !searchQuery.trim()}
                  className="px-4 py-2 bg-[#597794] rounded-lg font-mohave text-[12px] uppercase tracking-wider text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50"
                >
                  {searching ? "..." : "Search"}
                </button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="border border-white/[0.06] rounded-lg overflow-hidden">
                  <div className="px-4 py-2 border-b border-white/[0.06]">
                    <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                      Add User
                    </span>
                  </div>
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <div>
                        <span className="font-mohave text-[13px] text-[#E5E5E5]">
                          {user.first_name} {user.last_name}
                        </span>
                        <span className="font-kosugi text-[11px] text-[#6B6B6B] ml-2">
                          {user.email}
                        </span>
                      </div>
                      <button
                        onClick={() => addOverride(user.id)}
                        className="px-3 py-1 bg-[#9DB582]/20 border border-[#9DB582]/30 rounded font-mohave text-[11px] uppercase text-[#9DB582] hover:bg-[#9DB582]/30 transition-colors"
                      >
                        Grant
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Current overrides */}
              {loadingOverrides ? (
                <p className="font-kosugi text-[12px] text-[#6B6B6B] animate-pulse">Loading overrides...</p>
              ) : overrides.length > 0 ? (
                <div className="border border-white/[0.06] rounded-lg overflow-hidden">
                  <div className="px-4 py-2 border-b border-white/[0.06]">
                    <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                      Users with override access ({overrides.length})
                    </span>
                  </div>
                  {overrides.map((override) => (
                    <div
                      key={override.id}
                      className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] last:border-0"
                    >
                      <div>
                        <span className="font-mohave text-[13px] text-[#E5E5E5]">
                          {override.user.first_name} {override.user.last_name}
                        </span>
                        <span className="font-kosugi text-[11px] text-[#6B6B6B] ml-2">
                          {override.user.email}
                        </span>
                      </div>
                      <button
                        onClick={() => removeOverride(override.id)}
                        className="p-1.5 text-[#6B6B6B] hover:text-[#93321A] transition-colors"
                        title="Remove override"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-kosugi text-[12px] text-[#6B6B6B]">
                  No user overrides. This feature is hidden from all users.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Toggle Switch ───────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-[44px] h-[24px] rounded-full transition-colors ${
        checked ? "bg-[#9DB582]" : "bg-white/[0.1]"
      }`}
    >
      <div
        className={`absolute top-[2px] w-[20px] h-[20px] rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        }`}
      />
      <span className="sr-only">{checked ? "ON" : "OFF"}</span>
    </button>
  );
}

// ─── New Flag Form ───────────────────────────────────────────────────────────

function NewFlagForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (slug: string, label: string, description: string) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="border border-white/[0.08] rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-mohave text-[14px] uppercase tracking-wider text-[#E5E5E5]">
          New Feature Flag
        </span>
        <button onClick={onCancel} className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1">
            Slug
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
            placeholder="feature-name"
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-4 py-2 font-mono text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
          />
        </div>
        <div>
          <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Feature Name"
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-4 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
          />
        </div>
      </div>

      <div>
        <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1">
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-4 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(slug, label, description)}
          disabled={!slug || !label}
          className="px-5 py-2 bg-[#597794] rounded-lg font-mohave text-[12px] uppercase tracking-wider text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </div>
  );
}
