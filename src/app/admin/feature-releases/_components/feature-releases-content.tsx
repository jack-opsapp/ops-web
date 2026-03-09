"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Trash2, X, Edit2, Check } from "lucide-react";
import { PERMISSION_CATEGORIES } from "@/lib/types/permissions";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FeatureFlag {
  slug: string;
  label: string;
  description: string | null;
  enabled: boolean;
  routes: string[];
  permissions: string[];
  overrideCount: number;
  created_at: string;
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

  const showMessage = useCallback((text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }, []);

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
  }, [showMessage]);

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
      showMessage(`${slug} is now ${enabled ? "ENABLED for all" : "GATED"}`, "success");
    } catch {
      showMessage("Failed to toggle flag", "error");
    }
  };

  const updateDefinitions = async (slug: string, routes: string[], permissions: string[]) => {
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, routes, permissions }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setFlags((prev) =>
        prev.map((f) => (f.slug === slug ? { ...f, routes, permissions } : f))
      );
      showMessage("Definitions updated", "success");
    } catch {
      showMessage("Failed to update definitions", "error");
    }
  };

  const createFlag = async (
    slug: string,
    label: string,
    description: string,
    routes: string[],
    permissions: string[]
  ) => {
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          label,
          description: description || null,
          routes,
          permissions,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create");
      }
      setShowNewFlag(false);
      fetchFlags();
      showMessage(`Created "${label}" — starts gated (OFF)`, "success");
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
    <div className="space-y-4">
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
          onUpdateDefinitions={updateDefinitions}
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
          <span className="font-mohave text-[13px] uppercase tracking-wider">Define New Feature Flag</span>
        </button>
      )}
    </div>
  );
}

// ─── Flag Card ───────────────────────────────────────────────────────────────

function FlagCard({
  flag,
  onToggle,
  onUpdateDefinitions,
  onOverrideChange,
  showMessage,
}: {
  flag: FeatureFlag;
  onToggle: (slug: string, enabled: boolean) => void;
  onUpdateDefinitions: (slug: string, routes: string[], permissions: string[]) => void;
  onOverrideChange: () => void;
  showMessage: (text: string, type: "success" | "error") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingDefs, setEditingDefs] = useState(false);
  const [draftRoutes, setDraftRoutes] = useState<string[]>(flag.routes);
  const [draftPermissions, setDraftPermissions] = useState<string[]>(flag.permissions);
  const [routeInput, setRouteInput] = useState("");
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
    if (expanded) fetchOverrides();
  }, [expanded, fetchOverrides]);

  const saveDefinitions = () => {
    onUpdateDefinitions(flag.slug, draftRoutes, draftPermissions);
    setEditingDefs(false);
  };

  const cancelEditDefs = () => {
    setDraftRoutes(flag.routes);
    setDraftPermissions(flag.permissions);
    setEditingDefs(false);
  };

  const addRoute = () => {
    const r = routeInput.trim();
    if (!r || draftRoutes.includes(r)) return;
    setDraftRoutes((prev) => [...prev, r]);
    setRouteInput("");
  };

  const togglePermission = (perm: string) => {
    setDraftPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/admin/feature-flags/overrides?q=${encodeURIComponent(searchQuery)}`
      );
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
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
      showMessage("Access granted", "success");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to grant access", "error");
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
      showMessage("Access revoked", "success");
    } catch {
      showMessage("Failed to revoke access", "error");
    }
  };

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      {/* ── Card header ── */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors flex-shrink-0"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-mohave text-[16px] font-semibold uppercase text-[#E5E5E5]">
                {flag.label}
              </h3>
              <span className="font-mono text-[11px] text-[#6B6B6B] bg-white/[0.05] px-2 py-0.5 rounded">
                {flag.slug}
              </span>
            </div>
            {flag.description && (
              <p className="font-kosugi text-[12px] text-[#6B6B6B] mt-0.5">{flag.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Status label */}
          <span
            className={`font-mohave text-[11px] uppercase tracking-widest ${
              flag.enabled ? "text-[#9DB582]" : "text-[#C4A868]"
            }`}
          >
            {flag.enabled ? "Live" : `Gated${flag.overrideCount > 0 ? ` · ${flag.overrideCount} override${flag.overrideCount !== 1 ? "s" : ""}` : ""}`}
          </span>
          <ToggleSwitch
            checked={flag.enabled}
            onChange={(val) => onToggle(flag.slug, val)}
          />
        </div>
      </div>

      {/* ── Route / permission chips (always visible) ── */}
      {(flag.routes.length > 0 || flag.permissions.length > 0) && !editingDefs && (
        <div className="px-6 pb-4 flex flex-wrap gap-3 items-start">
          {flag.routes.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">Routes:</span>
              {flag.routes.map((r) => (
                <span
                  key={r}
                  className="font-mono text-[11px] text-[#8195B5] bg-[#597794]/10 border border-[#597794]/20 px-2 py-0.5 rounded"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
          {flag.permissions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">Permissions:</span>
              {flag.permissions.map((p) => (
                <span
                  key={p}
                  className="font-mono text-[11px] text-[#A0A0A0] bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => { setEditingDefs(true); setExpanded(true); }}
            className="flex items-center gap-1 text-[#6B6B6B] hover:text-[#597794] transition-colors ml-auto"
            title="Edit routes & permissions"
          >
            <Edit2 className="w-3 h-3" />
            <span className="font-mohave text-[10px] uppercase tracking-widest">Edit</span>
          </button>
        </div>
      )}

      {/* Empty state for no definitions */}
      {flag.routes.length === 0 && flag.permissions.length === 0 && !editingDefs && (
        <div className="px-6 pb-4 flex items-center gap-2">
          <span className="font-kosugi text-[12px] text-[#6B6B6B]">No routes or permissions defined.</span>
          <button
            onClick={() => { setEditingDefs(true); setExpanded(true); }}
            className="flex items-center gap-1 text-[#597794] hover:text-[#8195B5] transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span className="font-mohave text-[10px] uppercase tracking-widest">Define</span>
          </button>
        </div>
      )}

      {/* ── Expanded section ── */}
      {expanded && (
        <div className="border-t border-white/[0.08]">
          {/* Definition editor */}
          {editingDefs && (
            <div className="px-6 py-5 border-b border-white/[0.06] space-y-5">
              <div className="flex items-center justify-between">
                <span className="font-mohave text-[12px] uppercase tracking-widest text-[#E5E5E5]">
                  Edit Definitions
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelEditDefs}
                    className="px-3 py-1.5 font-mohave text-[11px] uppercase text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveDefinitions}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#9DB582]/20 border border-[#9DB582]/30 rounded font-mohave text-[11px] uppercase text-[#9DB582] hover:bg-[#9DB582]/30 transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    Save
                  </button>
                </div>
              </div>

              {/* Routes editor */}
              <div className="space-y-2">
                <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                  Gated Routes
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={routeInput}
                    onChange={(e) => setRouteInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addRoute()}
                    placeholder="/route-path"
                    className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-3 py-1.5 font-mono text-[12px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
                  />
                  <button
                    onClick={addRoute}
                    disabled={!routeInput.trim()}
                    className="px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded font-mohave text-[11px] uppercase text-[#A0A0A0] hover:text-[#E5E5E5] transition-colors disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {draftRoutes.map((r) => (
                    <span
                      key={r}
                      className="flex items-center gap-1 font-mono text-[11px] text-[#8195B5] bg-[#597794]/10 border border-[#597794]/20 px-2 py-0.5 rounded"
                    >
                      {r}
                      <button
                        onClick={() => setDraftRoutes((prev) => prev.filter((x) => x !== r))}
                        className="text-[#597794]/60 hover:text-[#93321A] transition-colors ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {draftRoutes.length === 0 && (
                    <span className="font-kosugi text-[11px] text-[#6B6B6B]">No routes — add one above</span>
                  )}
                </div>
              </div>

              {/* Permission picker */}
              <div className="space-y-2">
                <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                  Gated Permissions ({draftPermissions.length} selected)
                </span>
                <PermissionPicker
                  selected={draftPermissions}
                  onToggle={togglePermission}
                />
              </div>
            </div>
          )}

          {/* Access management */}
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B]">
                {flag.enabled
                  ? "Override Access (flag is live — all eligible users have access)"
                  : "Override Access — grant early access to specific users"}
              </span>
            </div>

            {/* User search — always shown */}
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
                    Search Results — Click Grant to Add Override
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
                    Users with Override Access ({overrides.length})
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
                      title="Revoke override"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-kosugi text-[12px] text-[#6B6B6B]">
                {flag.enabled
                  ? "No overrides. Feature is available to all eligible users."
                  : "No overrides. Feature is hidden from all users."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Permission Picker ────────────────────────────────────────────────────────

function PermissionPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (perm: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  const filtered = PERMISSION_CATEGORIES.map((cat) => ({
    ...cat,
    modules: cat.modules.map((mod) => ({
      ...mod,
      actions: mod.actions.filter(
        (a) =>
          !search ||
          a.id.toLowerCase().includes(search.toLowerCase()) ||
          a.label.toLowerCase().includes(search.toLowerCase())
      ),
    })).filter((mod) => mod.actions.length > 0),
  })).filter((cat) => cat.modules.length > 0);

  return (
    <div className="border border-white/[0.06] rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter permissions..."
          className="w-full bg-transparent font-kosugi text-[12px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none"
        />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.map((cat) => (
          <div key={cat.id}>
            {/* Category header */}
            <button
              onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)}
              className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.03] hover:bg-white/[0.05] transition-colors"
            >
              <span className="font-mohave text-[11px] uppercase tracking-widest text-[#A0A0A0]">
                {cat.label}
              </span>
              <div className="flex items-center gap-2">
                {cat.modules.flatMap((m) => m.actions).filter((a) => selected.includes(a.id)).length > 0 && (
                  <span className="font-mono text-[10px] text-[#9DB582]">
                    {cat.modules.flatMap((m) => m.actions).filter((a) => selected.includes(a.id)).length} selected
                  </span>
                )}
                {(expandedCat === cat.id || search) ? (
                  <ChevronDown className="w-3 h-3 text-[#6B6B6B]" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-[#6B6B6B]" />
                )}
              </div>
            </button>

            {/* Module actions */}
            {(expandedCat === cat.id || search) && cat.modules.map((mod) => (
              <div key={mod.id}>
                <div className="px-3 py-1.5 bg-white/[0.01]">
                  <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">
                    {mod.label}
                  </span>
                </div>
                {mod.actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => onToggle(action.id)}
                    className={`w-full flex items-center justify-between px-4 py-2 hover:bg-white/[0.03] transition-colors text-left ${
                      selected.includes(action.id) ? "bg-[#9DB582]/5" : ""
                    }`}
                  >
                    <div>
                      <span className={`font-kosugi text-[12px] ${
                        selected.includes(action.id) ? "text-[#E5E5E5]" : "text-[#A0A0A0]"
                      }`}>
                        {action.label}
                      </span>
                      <span className="font-mono text-[10px] text-[#6B6B6B] ml-2">{action.id}</span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        selected.includes(action.id)
                          ? "bg-[#9DB582] border-[#9DB582]"
                          : "border-white/[0.15] bg-transparent"
                      }`}
                    >
                      {selected.includes(action.id) && (
                        <Check className="w-2.5 h-2.5 text-[#1D1D1D]" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center">
            <span className="font-kosugi text-[12px] text-[#6B6B6B]">No permissions match &ldquo;{search}&rdquo;</span>
          </div>
        )}
      </div>
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
  onSubmit: (slug: string, label: string, description: string, routes: string[], permissions: string[]) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [description, setDescription] = useState("");
  const [routes, setRoutes] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [routeInput, setRouteInput] = useState("");
  const [step, setStep] = useState<"basics" | "definitions">("basics");

  const handleLabelChange = (val: string) => {
    setLabel(val);
    if (!slugManual) {
      setSlug(val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
    }
  };

  const addRoute = () => {
    const r = routeInput.trim();
    if (!r || routes.includes(r)) return;
    setRoutes((prev) => [...prev, r]);
    setRouteInput("");
  };

  const togglePermission = (perm: string) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  return (
    <div className="border border-[#597794]/30 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <span className="font-mohave text-[15px] uppercase tracking-wider text-[#E5E5E5]">
          New Feature Flag
        </span>
        <div className="flex items-center gap-3">
          {/* Step indicator */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setStep("basics")}
              className={`font-mohave text-[11px] uppercase tracking-widest px-2 py-1 rounded transition-colors ${
                step === "basics" ? "text-[#E5E5E5] bg-white/[0.06]" : "text-[#6B6B6B] hover:text-[#A0A0A0]"
              }`}
            >
              1. Basics
            </button>
            <span className="text-[#6B6B6B] text-[11px]">→</span>
            <button
              onClick={() => setStep("definitions")}
              disabled={!slug || !label}
              className={`font-mohave text-[11px] uppercase tracking-widest px-2 py-1 rounded transition-colors ${
                step === "definitions" ? "text-[#E5E5E5] bg-white/[0.06]" : "text-[#6B6B6B] hover:text-[#A0A0A0]"
              } disabled:opacity-30`}
            >
              2. Routes & Permissions
            </button>
          </div>
          <button onClick={onCancel} className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {step === "basics" ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1.5">
                  Label
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => handleLabelChange(e.target.value)}
                  placeholder="Pipeline CRM"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-4 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
                />
              </div>
              <div>
                <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1.5">
                  Slug <span className="normal-case text-[10px]">(auto-generated)</span>
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugManual(true);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
                  }}
                  placeholder="pipeline-crm"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-4 py-2 font-mono text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
                />
              </div>
            </div>
            <div>
              <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1.5">
                Description <span className="normal-case text-[10px]">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this flag controls..."
                className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-4 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setStep("definitions")}
                disabled={!slug || !label}
                className="px-5 py-2 bg-[#597794] rounded-lg font-mohave text-[12px] uppercase tracking-wider text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Routes */}
            <div className="space-y-2">
              <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                Gated Routes
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={routeInput}
                  onChange={(e) => setRouteInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRoute()}
                  placeholder="/route-path"
                  className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-3 py-1.5 font-mono text-[12px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
                />
                <button
                  onClick={addRoute}
                  disabled={!routeInput.trim()}
                  className="px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded font-mohave text-[11px] uppercase text-[#A0A0A0] hover:text-[#E5E5E5] transition-colors disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {routes.map((r) => (
                  <span
                    key={r}
                    className="flex items-center gap-1 font-mono text-[11px] text-[#8195B5] bg-[#597794]/10 border border-[#597794]/20 px-2 py-0.5 rounded"
                  >
                    {r}
                    <button
                      onClick={() => setRoutes((prev) => prev.filter((x) => x !== r))}
                      className="text-[#597794]/60 hover:text-[#93321A] transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {routes.length === 0 && (
                  <span className="font-kosugi text-[11px] text-[#6B6B6B]">No routes added</span>
                )}
              </div>
            </div>

            {/* Permissions */}
            <div className="space-y-2">
              <label className="block font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                Gated Permissions ({permissions.length} selected)
              </label>
              <PermissionPicker selected={permissions} onToggle={togglePermission} />
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setStep("basics")}
                className="font-mohave text-[12px] uppercase text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
              >
                ← Back
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onSubmit(slug, label, description, routes, permissions)}
                  disabled={!slug || !label}
                  className="px-5 py-2 bg-[#597794] rounded-lg font-mohave text-[12px] uppercase tracking-wider text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-40"
                >
                  Create Flag
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
