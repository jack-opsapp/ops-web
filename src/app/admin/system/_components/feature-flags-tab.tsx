"use client";

import { useState, useCallback } from "react";

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  role: string | null;
  company_id: string | null;
  special_permissions: string[] | null;
}

interface CompanyRow {
  id: string;
  name: string;
}

type Mode = "user" | "company";

export function FeatureFlagsTab() {
  const [mode, setMode] = useState<Mode>("user");
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyRow | null>(null);
  const [companyUsers, setCompanyUsers] = useState<UserRow[]>([]);
  const [knownPermissions, setKnownPermissions] = useState<string[]>([]);
  const [newPermission, setNewPermission] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchPermissions = useCallback(async () => {
    const res = await fetch("/api/admin/special-permissions?type=permissions");
    const data = await res.json();
    if (data.permissions) setKnownPermissions(data.permissions);
  }, []);

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/special-permissions?type=users&q=${encodeURIComponent(searchQuery)}`
      );
      const data = await res.json();
      setUsers(data.users ?? []);
      if (data.users?.length === 0) showMessage("No users found", "error");
    } catch {
      showMessage("Search failed", "error");
    }
    setLoading(false);
  };

  const searchCompanies = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/special-permissions?type=companies&q=${encodeURIComponent(searchQuery)}`
      );
      const data = await res.json();
      setCompanies(data.companies ?? []);
      if (data.companies?.length === 0) showMessage("No companies found", "error");
    } catch {
      showMessage("Search failed", "error");
    }
    setLoading(false);
  };

  const selectCompany = async (company: CompanyRow) => {
    setSelectedCompany(company);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/special-permissions?type=users&company_id=${company.id}`
      );
      const data = await res.json();
      setCompanyUsers(data.users ?? []);
    } catch {
      showMessage("Failed to load company users", "error");
    }
    setLoading(false);
  };

  const updatePermission = async (
    action: "add" | "remove",
    permission: string,
    opts: { userId?: string; companyId?: string }
  ) => {
    const key = `${action}-${permission}-${opts.userId ?? opts.companyId}`;
    setActionLoading(key);
    try {
      const res = await fetch("/api/admin/special-permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, permission, ...opts }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage(
          `${action === "add" ? "Added" : "Removed"} "${permission}" — ${data.count} user${data.count !== 1 ? "s" : ""} updated`,
          "success"
        );
        // Refresh the relevant data
        if (opts.userId) {
          // Refresh single user in list
          setUsers((prev) =>
            prev.map((u) =>
              u.id === opts.userId
                ? {
                    ...u,
                    special_permissions:
                      action === "add"
                        ? [...(u.special_permissions ?? []), permission]
                        : (u.special_permissions ?? []).filter((p) => p !== permission),
                  }
                : u
            )
          );
        }
        if (opts.companyId && selectedCompany) {
          await selectCompany(selectedCompany);
        }
        await fetchPermissions();
      } else {
        showMessage(data.error ?? "Update failed", "error");
      }
    } catch {
      showMessage("Request failed", "error");
    }
    setActionLoading(null);
  };

  const handleSearch = () => {
    if (mode === "user") searchUsers();
    else searchCompanies();
    fetchPermissions();
  };

  const handleAddNew = (opts: { userId?: string; companyId?: string }) => {
    const perm = newPermission.trim();
    if (!perm) return;
    updatePermission("add", perm, opts);
    setNewPermission("");
  };

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

      {/* Mode toggle + search */}
      <div className="flex items-center gap-4">
        <div className="flex border border-white/[0.08] rounded-lg overflow-hidden">
          <button
            onClick={() => { setMode("user"); setUsers([]); setCompanies([]); setSelectedCompany(null); setSearchQuery(""); }}
            className={`px-4 py-2 font-mohave text-[13px] uppercase tracking-wider transition-colors ${
              mode === "user" ? "bg-[#597794]/30 text-[#E5E5E5]" : "text-[#6B6B6B] hover:text-[#A0A0A0]"
            }`}
          >
            By User
          </button>
          <button
            onClick={() => { setMode("company"); setUsers([]); setCompanies([]); setSelectedCompany(null); setSearchQuery(""); }}
            className={`px-4 py-2 font-mohave text-[13px] uppercase tracking-wider transition-colors ${
              mode === "company" ? "bg-[#597794]/30 text-[#E5E5E5]" : "text-[#6B6B6B] hover:text-[#A0A0A0]"
            }`}
          >
            By Company
          </button>
        </div>

        <div className="flex-1 flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={mode === "user" ? "Search by name or email..." : "Search by company name..."}
            className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-lg px-4 py-2 font-kosugi text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-5 py-2 bg-[#597794] rounded-lg font-mohave text-[13px] uppercase tracking-wider text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Search"}
          </button>
        </div>
      </div>

      {/* Known permissions legend */}
      {knownPermissions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
            Active permissions:
          </span>
          {knownPermissions.map((p) => (
            <span
              key={p}
              className="px-2 py-0.5 bg-[#597794]/20 border border-[#597794]/30 rounded text-[12px] font-mono text-[#8195B5]"
            >
              {p}
            </span>
          ))}
        </div>
      )}

      {/* User results */}
      {mode === "user" && users.length > 0 && (
        <div className="border border-white/[0.08] rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_1fr_2fr] px-6 py-3 border-b border-white/[0.08]">
            {["NAME", "EMAIL", "ROLE", "SPECIAL PERMISSIONS"].map((h) => (
              <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
            ))}
          </div>
          {users.map((user) => (
            <UserPermissionRow
              key={user.id}
              user={user}
              knownPermissions={knownPermissions}
              newPermission={newPermission}
              setNewPermission={setNewPermission}
              onAdd={(perm) => updatePermission("add", perm, { userId: user.id })}
              onRemove={(perm) => updatePermission("remove", perm, { userId: user.id })}
              onAddNew={() => handleAddNew({ userId: user.id })}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}

      {/* Company results */}
      {mode === "company" && !selectedCompany && companies.length > 0 && (
        <div className="border border-white/[0.08] rounded-lg overflow-hidden">
          <div className="grid grid-cols-2 px-6 py-3 border-b border-white/[0.08]">
            {["COMPANY", ""].map((h) => (
              <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
            ))}
          </div>
          {companies.map((company) => (
            <div
              key={company.id}
              className="grid grid-cols-2 px-6 items-center h-14 border-b border-white/[0.05] last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => selectCompany(company)}
            >
              <span className="font-mohave text-[14px] text-[#E5E5E5]">{company.name}</span>
              <span className="font-mohave text-[12px] text-[#597794]">VIEW USERS →</span>
            </div>
          ))}
        </div>
      )}

      {/* Selected company view */}
      {mode === "company" && selectedCompany && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setSelectedCompany(null); setCompanyUsers([]); }}
                className="font-mohave text-[12px] text-[#597794] hover:text-[#8195B5] transition-colors"
              >
                ← BACK
              </button>
              <span className="font-mohave text-[16px] text-[#E5E5E5]">{selectedCompany.name}</span>
              <span className="font-kosugi text-[12px] text-[#6B6B6B]">
                {companyUsers.length} user{companyUsers.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Company-wide actions */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newPermission}
                onChange={(e) => setNewPermission(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddNew({ companyId: selectedCompany.id })}
                placeholder="Permission name..."
                className="bg-white/[0.05] border border-white/[0.08] rounded px-3 py-1.5 font-mono text-[12px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50 w-48"
              />
              <button
                onClick={() => handleAddNew({ companyId: selectedCompany.id })}
                disabled={!newPermission.trim() || !!actionLoading}
                className="px-3 py-1.5 bg-[#9DB582]/20 border border-[#9DB582]/30 rounded font-mohave text-[11px] uppercase text-[#9DB582] hover:bg-[#9DB582]/30 transition-colors disabled:opacity-30"
              >
                Add to all
              </button>
              {knownPermissions.map((p) => (
                <button
                  key={`remove-${p}`}
                  onClick={() => updatePermission("remove", p, { companyId: selectedCompany.id })}
                  disabled={!!actionLoading}
                  className="px-2 py-1.5 bg-[#93321A]/20 border border-[#93321A]/30 rounded font-mono text-[11px] text-[#93321A] hover:bg-[#93321A]/30 transition-colors disabled:opacity-30"
                  title={`Remove "${p}" from all users`}
                >
                  − {p}
                </button>
              ))}
            </div>
          </div>

          {/* Company users table */}
          <div className="border border-white/[0.08] rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_1fr_2fr] px-6 py-3 border-b border-white/[0.08]">
              {["NAME", "EMAIL", "ROLE", "SPECIAL PERMISSIONS"].map((h) => (
                <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
              ))}
            </div>
            {companyUsers.map((user) => (
              <UserPermissionRow
                key={user.id}
                user={user}
                knownPermissions={knownPermissions}
                newPermission={newPermission}
                setNewPermission={setNewPermission}
                onAdd={(perm) => updatePermission("add", perm, { userId: user.id })}
                onRemove={(perm) => updatePermission("remove", perm, { userId: user.id })}
                onAddNew={() => handleAddNew({ userId: user.id })}
                actionLoading={actionLoading}
              />
            ))}
            {companyUsers.length === 0 && !loading && (
              <div className="px-6 py-12 text-center">
                <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No users in this company</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── User Permission Row ──────────────────────────────────────────────────────

function UserPermissionRow({
  user,
  knownPermissions,
  newPermission,
  setNewPermission,
  onAdd,
  onRemove,
  onAddNew,
  actionLoading,
}: {
  user: UserRow;
  knownPermissions: string[];
  newPermission: string;
  setNewPermission: (v: string) => void;
  onAdd: (perm: string) => void;
  onRemove: (perm: string) => void;
  onAddNew: () => void;
  actionLoading: string | null;
}) {
  const perms = user.special_permissions ?? [];
  const [showAdd, setShowAdd] = useState(false);

  // Permissions user doesn't have yet (from known list)
  const available = knownPermissions.filter((p) => !perms.includes(p));

  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_2fr] px-6 items-center min-h-[56px] py-3 border-b border-white/[0.05] last:border-0">
      <span className="font-mohave text-[14px] text-[#E5E5E5]">
        {user.first_name} {user.last_name}
      </span>
      <span className="font-kosugi text-[12px] text-[#6B6B6B] truncate">{user.email ?? "—"}</span>
      <span className="font-mohave text-[13px] text-[#A0A0A0]">{user.role ?? "—"}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Current permissions as removable chips */}
        {perms.map((p) => (
          <button
            key={p}
            onClick={() => onRemove(p)}
            disabled={!!actionLoading}
            className="group flex items-center gap-1 px-2 py-0.5 bg-[#597794]/20 border border-[#597794]/30 rounded text-[12px] font-mono text-[#8195B5] hover:bg-[#93321A]/20 hover:border-[#93321A]/30 hover:text-[#93321A] transition-colors disabled:opacity-50"
            title={`Remove "${p}"`}
          >
            {p}
            <span className="text-[10px] opacity-50 group-hover:opacity-100">×</span>
          </button>
        ))}

        {/* Add button */}
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="w-6 h-6 flex items-center justify-center rounded border border-white/[0.08] text-[#6B6B6B] hover:text-[#E5E5E5] hover:border-white/[0.15] transition-colors text-[14px]"
            title="Add permission"
          >
            +
          </button>
        ) : (
          <div className="flex items-center gap-1">
            {/* Quick-add from known permissions */}
            {available.map((p) => (
              <button
                key={p}
                onClick={() => { onAdd(p); setShowAdd(false); }}
                disabled={!!actionLoading}
                className="px-2 py-0.5 bg-[#9DB582]/10 border border-[#9DB582]/20 rounded text-[11px] font-mono text-[#9DB582] hover:bg-[#9DB582]/20 transition-colors disabled:opacity-50"
              >
                + {p}
              </button>
            ))}
            {/* New permission input */}
            <input
              type="text"
              value={newPermission}
              onChange={(e) => setNewPermission(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { onAddNew(); setShowAdd(false); } if (e.key === "Escape") setShowAdd(false); }}
              placeholder="new..."
              className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-0.5 font-mono text-[11px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50 w-28"
              autoFocus
            />
            <button
              onClick={() => setShowAdd(false)}
              className="text-[#6B6B6B] hover:text-[#E5E5E5] text-[12px] transition-colors"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
