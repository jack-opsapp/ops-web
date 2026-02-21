"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Database,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
  UserPlus,
  Trash2,
  Shield,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { getIdToken } from "@/lib/firebase/auth";

const LAST_SYNC_KEY = "ops_migration_last_sync";

interface MigrationResult {
  success: boolean;
  stats?: {
    syncMode: "full" | "incremental";
    syncedAt: string;
    companies: number;
    users: number;
    clients: number;
    subClients: number;
    taskTypes: number;
    projects: number;
    calendarEvents: number;
    projectTasks: number;
    opsContacts: number;
    pipelineRefsUpdated: number;
    errorCount: number;
    errors: string[];
  };
  error?: string;
}

type FirebaseStatus = "provisioned" | "needs_setup" | "no_email";

interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  bubbleId: string | null;
  firebaseUid: string | null;
  firebaseStatus: FirebaseStatus;
  createdAt: string;
}

interface UserStats {
  total: number;
  provisioned: number;
  needsSetup: number;
  noEmail: number;
}

export function DeveloperTab() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [confirmMode, setConfirmMode] = useState<"full" | "incremental" | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  useEffect(() => {
    setLastSyncAt(localStorage.getItem(LAST_SYNC_KEY));
  }, []);

  const handleMigrate = async (mode: "full" | "incremental") => {
    if (!currentUser?.id) return;

    setConfirmMode(null);
    setIsRunning(true);
    setResult(null);

    try {
      const idToken = await getIdToken();

      if (!idToken) {
        setResult({ success: false, error: "Could not get auth token. Please re-login." });
        setIsRunning(false);
        return;
      }

      const body: Record<string, string> = {};
      if (mode === "incremental") {
        // Use stored timestamp or default to 7 days ago
        const since = lastSyncAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        body.sinceDate = since;
      }

      const resp = await fetch("/api/admin/migrate-bubble", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });

      const data: MigrationResult = await resp.json();
      setResult(data);

      // Store sync timestamp for next incremental run
      if (data.success && data.stats?.syncedAt) {
        localStorage.setItem(LAST_SYNC_KEY, data.stats.syncedAt);
        setLastSyncAt(data.stats.syncedAt);
      }
    } catch (e) {
      setResult({
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const formattedLastSync = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString()
    : null;

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-lg font-semibold text-[#E5E5E5]">Developer Tools</h2>
        <p className="text-sm text-[#999] mt-1">
          These tools are only visible to users with developer permissions.
        </p>
      </div>

      {/* Migration Section */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5">
        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 text-[#417394] mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-[#E5E5E5]">
              Migrate Bubble → Supabase
            </h3>
            <p className="text-sm text-[#999] mt-1">
              Imports data from Bubble.io into Supabase. Safe to re-run —
              existing records are updated, not duplicated.
            </p>
            {formattedLastSync && (
              <p className="text-xs text-[#666] mt-1">
                Last synced: {formattedLastSync}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {!confirmMode && !isRunning && (
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Sync Changes — incremental, only modified records */}
                  <button
                    onClick={() => setConfirmMode("incremental")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Sync Changes
                  </button>
                  {/* Full Migration — always available */}
                  <button
                    onClick={() => setConfirmMode("full")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[rgba(255,255,255,0.15)] text-[#999] text-sm font-medium hover:text-[#E5E5E5] hover:border-[rgba(255,255,255,0.3)] transition-colors"
                  >
                    <Play className="h-4 w-4" />
                    Full Migration
                  </button>
                </div>
              )}

              {confirmMode && !isRunning && (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-sm text-[#C4A868]">
                    {confirmMode === "incremental"
                      ? `Sync records modified since ${formattedLastSync ?? "7 days ago"}?`
                      : "Fetch ALL data from Bubble and overwrite Supabase. Continue?"}
                  </p>
                  <button
                    onClick={() => handleMigrate(confirmMode)}
                    className="px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                  >
                    Yes, {confirmMode === "incremental" ? "sync" : "migrate"}
                  </button>
                  <button
                    onClick={() => setConfirmMode(null)}
                    className="px-4 py-2 rounded-md border border-[rgba(255,255,255,0.15)] text-[#999] text-sm hover:text-[#E5E5E5] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {isRunning && (
                <div className="flex items-center gap-3 text-sm text-[#999]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#417394]" />
                  {confirmMode === "incremental"
                    ? "Syncing recent changes from Bubble..."
                    : "Migrating all data from Bubble... This may take a few minutes."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Migration Results */}
      {result && (
        <div
          className={`rounded-lg border p-5 ${
            result.success
              ? "border-green-500/30 bg-green-500/5"
              : "border-red-500/30 bg-red-500/5"
          }`}
        >
          <div className="flex items-start gap-3">
            {result.success ? (
              <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <h3 className="text-sm font-medium text-[#E5E5E5]">
                {result.success ? "Migration Complete" : "Migration Failed"}
              </h3>

              {result.error && (
                <p className="text-sm text-red-400 mt-1">{result.error}</p>
              )}

              {result.stats && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                  {Object.entries(result.stats)
                    .filter(([key]) => !["errorCount", "errors", "syncedAt"].includes(key))
                    .map(([key, value]) => (
                      <div key={key} className="text-sm">
                        <span className="text-[#999]">{formatLabel(key)}:</span>{" "}
                        <span className="text-[#E5E5E5] font-medium">{String(value)}</span>
                      </div>
                    ))}
                </div>
              )}

              {result.stats && result.stats.errorCount > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-[#C4A868]">
                    {result.stats.errorCount} error{result.stats.errorCount === 1 ? "" : "s"}:
                  </p>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded bg-black/50 p-3">
                    {result.stats.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-300/80 font-mono">
                        {err}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Management Section */}
      <UserManagementSection />
    </div>
  );
}

// ─── User Management ──────────────────────────────────────────────────────────

function UserManagementSection() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [provisioningAll, setProvisioningAll] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{
    provisioned: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [provisioningSingle, setProvisioningSingle] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create user form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createRole, setCreateRole] = useState("Field Crew");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setError("Could not get auth token");
        return;
      }
      const resp = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(data.error || "Failed to fetch users");
        return;
      }
      const data = await resp.json();
      setUsers(data.users);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleProvisionAll = async () => {
    setProvisioningAll(true);
    setProvisionResult(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      const resp = await fetch("/api/admin/users/provision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ mode: "all" }),
      });
      const data = await resp.json();
      setProvisionResult(data);
      fetchUsers(); // Refresh list
    } catch {
      setProvisionResult({ provisioned: 0, failed: 0, errors: ["Network error"] });
    } finally {
      setProvisioningAll(false);
    }
  };

  const handleProvisionSingle = async (userId: string) => {
    setProvisioningSingle(userId);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      await fetch("/api/admin/users/provision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ mode: "single", userId }),
      });
      fetchUsers();
    } finally {
      setProvisioningSingle(null);
    }
  };

  const handleDelete = async (userId: string) => {
    setDeletingUser(userId);
    setConfirmDelete(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      fetchUsers();
    } finally {
      setDeletingUser(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createEmail || !createFirstName || !createLastName) return;
    setCreating(true);
    setCreateError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      const resp = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          email: createEmail,
          firstName: createFirstName,
          lastName: createLastName,
          role: createRole,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setCreateError(data.error || "Failed to create user");
        return;
      }
      // Reset form and refresh
      setCreateEmail("");
      setCreateFirstName("");
      setCreateLastName("");
      setCreateRole("Field Crew");
      setShowCreateForm(false);
      fetchUsers();
    } catch {
      setCreateError("Network error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      {/* Provisioning Overview */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-[#417394] mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-[#E5E5E5]">
              Firebase User Provisioning
            </h3>
            <p className="text-sm text-[#999] mt-1">
              Creates Firebase Auth accounts for migrated Bubble users and sends password reset emails.
            </p>

            {stats && (
              <div className="mt-3 flex items-center gap-4 flex-wrap">
                <span className="text-sm">
                  <span className="text-[#999]">Total:</span>{" "}
                  <span className="text-[#E5E5E5] font-medium">{stats.total}</span>
                </span>
                <span className="text-sm">
                  <span className="text-green-400">Provisioned:</span>{" "}
                  <span className="text-[#E5E5E5] font-medium">{stats.provisioned}</span>
                </span>
                <span className="text-sm">
                  <span className="text-[#C4A868]">Needs Setup:</span>{" "}
                  <span className="text-[#E5E5E5] font-medium">{stats.needsSetup}</span>
                </span>
                {stats.noEmail > 0 && (
                  <span className="text-sm">
                    <span className="text-[#666]">No Email:</span>{" "}
                    <span className="text-[#E5E5E5] font-medium">{stats.noEmail}</span>
                  </span>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {stats && stats.needsSetup > 0 && !provisioningAll && (
                <button
                  onClick={handleProvisionAll}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                >
                  <Users className="h-4 w-4" />
                  Provision All ({stats.needsSetup})
                </button>
              )}
              {provisioningAll && (
                <div className="flex items-center gap-2 text-sm text-[#999]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#417394]" />
                  Provisioning users...
                </div>
              )}
            </div>

            {provisionResult && (
              <div className="mt-3 text-sm">
                <span className="text-green-400">
                  {provisionResult.provisioned} provisioned
                </span>
                {provisionResult.failed > 0 && (
                  <span className="text-red-400 ml-3">
                    {provisionResult.failed} failed
                  </span>
                )}
                {provisionResult.errors.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto rounded bg-black/50 p-2">
                    {provisionResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-300/80 font-mono">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create User */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5">
        <div className="flex items-start gap-3">
          <UserPlus className="h-5 w-5 text-[#417394] mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[#E5E5E5]">Create User</h3>
              {!showCreateForm && (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  New User
                </button>
              )}
            </div>

            {showCreateForm && (
              <form onSubmit={handleCreate} className="mt-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="First Name"
                    value={createFirstName}
                    onChange={(e) => setCreateFirstName(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-md bg-black/50 border border-[rgba(255,255,255,0.1)] text-[#E5E5E5] text-sm placeholder-[#666] focus:border-[#417394] focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={createLastName}
                    onChange={(e) => setCreateLastName(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-md bg-black/50 border border-[rgba(255,255,255,0.1)] text-[#E5E5E5] text-sm placeholder-[#666] focus:border-[#417394] focus:outline-none"
                  />
                </div>
                <input
                  type="email"
                  placeholder="Email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-md bg-black/50 border border-[rgba(255,255,255,0.1)] text-[#E5E5E5] text-sm placeholder-[#666] focus:border-[#417394] focus:outline-none"
                />
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-black/50 border border-[rgba(255,255,255,0.1)] text-[#E5E5E5] text-sm focus:border-[#417394] focus:outline-none"
                >
                  <option value="Field Crew">Field Crew</option>
                  <option value="Admin">Admin</option>
                  <option value="Manager">Manager</option>
                </select>

                {createError && (
                  <p className="text-sm text-red-400">{createError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={creating}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors disabled:opacity-50"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Create User
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setCreateError(null);
                    }}
                    className="px-4 py-2 rounded-md border border-[rgba(255,255,255,0.15)] text-[#999] text-sm hover:text-[#E5E5E5] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* User List */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-[#417394] shrink-0" />
            <h3 className="text-sm font-medium text-[#E5E5E5]">All Users</h3>
          </div>
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[rgba(255,255,255,0.15)] text-[#999] text-sm hover:text-[#E5E5E5] hover:border-[rgba(255,255,255,0.3)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && users.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-[#999] py-4">
            <Loader2 className="h-4 w-4 animate-spin text-[#417394]" />
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-[#666] py-4">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.1)]">
                  <th className="text-left py-2 pr-4 text-[#999] font-medium">Name</th>
                  <th className="text-left py-2 pr-4 text-[#999] font-medium">Email</th>
                  <th className="text-left py-2 pr-4 text-[#999] font-medium">Role</th>
                  <th className="text-left py-2 pr-4 text-[#999] font-medium">Firebase</th>
                  <th className="text-right py-2 text-[#999] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.02)]"
                  >
                    <td className="py-2.5 pr-4 text-[#E5E5E5]">
                      {user.firstName} {user.lastName}
                    </td>
                    <td className="py-2.5 pr-4 text-[#999] font-mono text-xs">
                      {user.email || "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-[#999]">{user.role || "—"}</td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={user.firebaseStatus} />
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {user.firebaseStatus === "needs_setup" && (
                          <button
                            onClick={() => handleProvisionSingle(user.id)}
                            disabled={provisioningSingle === user.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[#417394]/20 text-[#417394] hover:bg-[#417394]/30 transition-colors disabled:opacity-50"
                          >
                            {provisioningSingle === user.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Shield className="h-3 w-3" />
                            )}
                            Provision
                          </button>
                        )}
                        {confirmDelete === user.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleDelete(user.id)}
                              disabled={deletingUser === user.id}
                              className="px-2.5 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                            >
                              {deletingUser === user.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Confirm"
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="px-2.5 py-1 rounded text-xs text-[#999] hover:text-[#E5E5E5] transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(user.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-[#666] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: FirebaseStatus }) {
  const config = {
    provisioned: {
      label: "Provisioned",
      className: "bg-green-500/15 text-green-400 border-green-500/30",
    },
    needs_setup: {
      label: "Needs Setup",
      className: "bg-[#C4A868]/15 text-[#C4A868] border-[#C4A868]/30",
    },
    no_email: {
      label: "No Email",
      className: "bg-[rgba(255,255,255,0.05)] text-[#666] border-[rgba(255,255,255,0.1)]",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
