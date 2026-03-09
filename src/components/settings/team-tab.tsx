"use client";

import { useState, useCallback } from "react";
import {
  UserPlus,
  Mail,
  Phone,
  Shield,
  MoreHorizontal,
  UserX,
  UserCheck,
  Armchair,
  Loader2,
  X,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import {
  useTeamMembers,
  useUpdateUserRole,
  useDeactivateUser,
  useReactivateUser,
  useAddSeatedEmployee,
  useRemoveSeatedEmployee,
  useCompany,
  useSendInvite,
  useRoles,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { getUserFullName, getInitials, UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

const ROLES: { id: UserRole; labelKey: string }[] = [
  { id: UserRole.Admin, labelKey: "team.roleAdmin" },
  { id: UserRole.Owner, labelKey: "team.roleOwner" },
  { id: UserRole.Office, labelKey: "team.roleOffice" },
  { id: UserRole.Operator, labelKey: "team.roleOperator" },
  { id: UserRole.Crew, labelKey: "team.roleCrew" },
];

// ─── Member Actions Menu ──────────────────────────────────────────────────────

function MemberActions({
  member,
  isCurrentUser,
  isSeated,
  seatsFull,
}: {
  member: User;
  isCurrentUser: boolean;
  isSeated: boolean;
  seatsFull: boolean;
}) {
  const { t } = useDictionary("settings");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const updateRole = useUpdateUserRole();
  const deactivateUser = useDeactivateUser();
  const reactivateUser = useReactivateUser();
  const addSeat = useAddSeatedEmployee();
  const removeSeat = useRemoveSeatedEmployee();

  function handleRoleChange(role: UserRole) {
    updateRole.mutate(
      { id: member.id, role },
      {
        onSuccess: () => toast.success(`${t("team.toast.roleUpdated")} ${role}`),
        onError: (err) => toast.error(t("team.toast.roleUpdateFailed"), { description: err.message }),
      }
    );
  }

  function handleToggleSeat() {
    if (isSeated) {
      removeSeat.mutate(member.id, {
        onSuccess: () => toast.success(t("team.toast.seatRemoved")),
        onError: (err) => toast.error(t("team.toast.seatRemoveFailed"), { description: err.message }),
      });
    } else {
      if (seatsFull) {
        toast.error(t("team.toast.noSeats"), { description: t("team.toast.upgradeSeats") });
        return;
      }
      addSeat.mutate(member.id, {
        onSuccess: () => toast.success(t("team.toast.seatAssigned")),
        onError: (err) => toast.error(t("team.toast.seatAssignFailed"), { description: err.message }),
      });
    }
  }

  function handleDeactivate() {
    deactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => {
          toast.success(`${getUserFullName(member)} ${t("team.toast.deactivated")}`);
          setConfirmDeactivate(false);
        },
        onError: (err) => toast.error(t("team.toast.deactivateFailed"), { description: err.message }),
      }
    );
  }

  function handleReactivate() {
    reactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => toast.success(`${getUserFullName(member)} ${t("team.toast.reactivated")}`),
        onError: (err) => toast.error(t("team.toast.reactivateFailed"), { description: err.message }),
      }
    );
  }

  if (isCurrentUser) return null;

  const isActive = member.isActive !== false;

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-[6px] rounded hover:bg-background-elevated transition-colors"
        >
          <MoreHorizontal className="w-[16px] h-[16px] text-text-tertiary" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-[4px] z-50 min-w-[180px] bg-background-card border border-border rounded-lg shadow-lg overflow-hidden">
              {/* Role section */}
              <div className="px-1.5 py-[6px] border-b border-[rgba(255,255,255,0.04)]">
                <p className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider mb-[4px]">{t("team.role")}</p>
                {ROLES.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => {
                      handleRoleChange(role.id);
                      setMenuOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-1 py-[4px] rounded font-mohave text-body-sm transition-colors",
                      member.role === role.id
                        ? "text-ops-accent bg-ops-accent-muted"
                        : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
                    )}
                  >
                    {t(role.labelKey)}
                  </button>
                ))}
              </div>

              {/* Seat toggle */}
              <button
                onClick={() => {
                  handleToggleSeat();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-1 px-1.5 py-[8px] font-mohave text-body-sm text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors border-b border-[rgba(255,255,255,0.04)]"
              >
                <Armchair className="w-[14px] h-[14px]" />
                {isSeated ? t("team.removeSeat") : t("team.assignSeat")}
              </button>

              {/* Deactivate / Reactivate */}
              {isActive ? (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDeactivate(true);
                  }}
                  className="w-full flex items-center gap-1 px-1.5 py-[8px] font-mohave text-body-sm text-ops-error hover:bg-background-elevated transition-colors"
                >
                  <UserX className="w-[14px] h-[14px]" />
                  {t("team.deactivate")}
                </button>
              ) : (
                <button
                  onClick={() => {
                    handleReactivate();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-1 px-1.5 py-[8px] font-mohave text-body-sm text-status-success hover:bg-background-elevated transition-colors"
                >
                  <UserCheck className="w-[14px] h-[14px]" />
                  {t("team.reactivate")}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`${t("team.deactivateConfirmTitle")} ${getUserFullName(member)}?`}
        description={t("team.deactivateConfirmDesc")}
        confirmLabel={t("team.deactivate")}
        variant="destructive"
        onConfirm={handleDeactivate}
        loading={deactivateUser.isPending}
      />
    </>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useDictionary("settings");
  const sendInvite = useSendInvite();
  const { data: rolesData } = useRoles();
  const roles = rolesData ?? [];

  const [inviteMode, setInviteMode] = useState<"email" | "sms">("email");
  const [inputValue, setInputValue] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");

  const resetForm = useCallback(() => {
    setInputValue("");
    setEntries([]);
    setSelectedRoleId("");
    setInviteMode("email");
  }, []);

  function addEntry() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // Support comma/semicolon/space-separated values
    const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
    const newEntries = parts.filter((p) => !entries.includes(p));

    if (newEntries.length > 0) {
      setEntries((prev) => [...prev, ...newEntries]);
    }
    setInputValue("");
  }

  function removeEntry(entry: string) {
    setEntries((prev) => prev.filter((e) => e !== entry));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEntry();
    }
    if (e.key === "Backspace" && !inputValue && entries.length > 0) {
      setEntries((prev) => prev.slice(0, -1));
    }
  }

  function handleSend() {
    // Add any remaining input
    const allEntries = [...entries];
    const trimmed = inputValue.trim();
    if (trimmed) {
      const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
      parts.forEach((p) => {
        if (!allEntries.includes(p)) allEntries.push(p);
      });
    }

    if (allEntries.length === 0) {
      toast.error(inviteMode === "email" ? t("team.toast.enterEmail") : t("team.toast.enterPhone"));
      return;
    }

    const data = inviteMode === "email"
      ? { emails: allEntries, roleId: selectedRoleId || undefined }
      : { phones: allEntries, roleId: selectedRoleId || undefined };

    sendInvite.mutate(data, {
      onSuccess: (result) => {
        const count = result.invitesSent ?? allEntries.length;
        toast.success(t("team.toast.inviteSent"), {
          description: `${count} ${count === 1 ? t("team.toast.inviteSentSingular") : t("team.toast.inviteSentPlural")}`,
        });
        resetForm();
        onOpenChange(false);
      },
      onError: (err) => toast.error(t("team.toast.inviteFailed"), { description: err.message }),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) resetForm();
        onOpenChange(val);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("team.inviteTitle")}</DialogTitle>
          <DialogDescription>{t("team.inviteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {/* Email / SMS toggle */}
          <div className="flex items-center gap-1">
            {([
              { id: "email" as const, label: t("team.emailToggle"), icon: Mail },
              { id: "sms" as const, label: t("team.smsToggle"), icon: Phone },
            ]).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  setInviteMode(mode.id);
                  setEntries([]);
                  setInputValue("");
                }}
                className={cn(
                  "flex items-center gap-[6px] px-1.5 py-[8px] rounded border font-mohave text-body-sm transition-all",
                  inviteMode === mode.id
                    ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                    : "bg-background-input border-border text-text-tertiary hover:text-text-secondary"
                )}
              >
                <mode.icon className="w-[14px] h-[14px]" />
                {mode.label}
              </button>
            ))}
          </div>

          {/* Multi-entry input with chips */}
          <div>
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest mb-0.5 block">
              {inviteMode === "email" ? t("team.emailAddress") : t("team.phoneNumber")}
            </label>
            <div
              className={cn(
                "flex flex-wrap items-center gap-[6px] p-1 rounded-sm border bg-background-input min-h-[40px]",
                "border-border focus-within:border-ops-accent transition-colors"
              )}
            >
              {entries.map((entry) => (
                <span
                  key={entry}
                  className="inline-flex items-center gap-[4px] px-[8px] py-[2px] rounded-full bg-ops-accent-muted text-ops-accent font-mono text-[11px]"
                >
                  {entry}
                  <button
                    onClick={() => removeEntry(entry)}
                    className="hover:text-text-primary transition-colors"
                  >
                    <X className="w-[10px] h-[10px]" />
                  </button>
                </span>
              ))}
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={addEntry}
                placeholder={
                  entries.length === 0
                    ? inviteMode === "email"
                      ? t("team.emailPlaceholder")
                      : t("team.phonePlaceholder")
                    : t("team.addMore")
                }
                className="flex-1 min-w-[120px] bg-transparent outline-none font-mohave text-body-sm text-text-primary placeholder:text-text-disabled"
              />
            </div>
            <p className="font-kosugi text-[10px] text-text-disabled mt-[4px]">
              {t("team.multiInviteHint")}
            </p>
          </div>

          {/* RBAC Role picker */}
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              {t("team.assignRole")}
            </label>
            <div className="flex flex-wrap items-center gap-1">
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRoleId(selectedRoleId === role.id ? "" : role.id)}
                  className={cn(
                    "px-1.5 py-[6px] rounded border font-mohave text-body-sm transition-all",
                    selectedRoleId === role.id
                      ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                      : "bg-background-input border-border text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {role.name}
                </button>
              ))}
            </div>
            <p className="font-kosugi text-[10px] text-text-disabled">
              {t("team.roleAssignHint")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              resetForm();
              onOpenChange(false);
            }}
          >
            {t("team.cancel")}
          </Button>
          <Button
            onClick={handleSend}
            className="gap-[6px]"
            disabled={sendInvite.isPending || (entries.length === 0 && !inputValue.trim())}
          >
            {sendInvite.isPending ? (
              <Loader2 className="w-[16px] h-[16px] animate-spin" />
            ) : (
              <UserPlus className="w-[16px] h-[16px]" />
            )}
            {t("team.sendInvite")}
            {entries.length > 0 && (
              <span className="bg-[rgba(255,255,255,0.15)] px-[6px] py-[1px] rounded-full text-[10px]">
                {entries.length}
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────

export function TeamTab() {
  const { t } = useDictionary("settings");
  const { data: teamData, isLoading } = useTeamMembers();
  const { data: company } = useCompany();
  const currentUser = useAuthStore((s) => s.currentUser);
  const members = teamData?.users ?? [];

  const [inviteOpen, setInviteOpen] = useState(false);

  const seatedIds = company?.seatedEmployeeIds ?? [];
  const maxSeats = company?.maxSeats ?? 10;
  const seatedCount = seatedIds.length;
  const seatsFull = seatedCount >= maxSeats;

  // Separate active and deactivated members
  const activeMembers = members.filter((m) => m.isActive !== false);
  const deactivatedMembers = members.filter((m) => m.isActive === false);

  return (
    <div className="space-y-3">
      {/* Top section: Seat Usage */}
      <Card>
        <CardHeader>
          <CardTitle>{t("team.seatUsage")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-1">
            <span className="font-mohave text-body text-text-secondary">{t("team.activeSeats")}</span>
            <span className="font-mono text-data text-text-primary">
              {seatedCount} / {maxSeats}
            </span>
          </div>
          <div className="h-[6px] bg-background-elevated rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                seatsFull ? "bg-ops-error" : "bg-ops-accent"
              )}
              style={{ width: `${Math.min(100, Math.round((seatedCount / maxSeats) * 100))}%` }}
            />
          </div>
          {seatsFull && (
            <p className="font-kosugi text-[11px] text-ops-error mt-[6px]">
              {t("team.allSeatsUsed")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Active Team Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>{t("team.membersTitle")} ({activeMembers.length})</CardTitle>
            <Button
              size="sm"
              onClick={() => setInviteOpen(true)}
              className="gap-[6px]"
            >
              <Plus className="w-[14px] h-[14px]" />
              {t("team.addMember")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : activeMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-4 gap-1.5">
              <p className="font-mohave text-body-sm text-text-tertiary">
                {t("team.emptyState")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInviteOpen(true)}
                className="gap-[6px]"
              >
                <UserPlus className="w-[14px] h-[14px]" />
                {t("team.sendInvite")}
              </Button>
            </div>
          ) : (
            <div className="space-y-0">
              {activeMembers.map((member) => {
                const fullName = getUserFullName(member);
                const isCurrentUser = member.id === currentUser?.id;
                const isSeated = seatedIds.includes(member.id);

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-[32px] h-[32px] rounded-full flex items-center justify-center border-2 border-ops-accent">
                        <span className="font-mohave text-body-sm text-ops-accent">
                          {getInitials(fullName)}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-[6px]">
                          <p className="font-mohave text-body text-text-primary">{fullName}</p>
                          {isCurrentUser && (
                            <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                              {t("team.you")}
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-text-disabled">
                          {member.email ?? "No email"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-[6px]">
                      {isSeated && (
                        <span className="font-kosugi text-[9px] text-ops-accent bg-ops-accent-muted px-[6px] py-[2px] rounded-full">
                          {t("team.seated")}
                        </span>
                      )}
                      {member.isCompanyAdmin && (
                        <Shield className="w-[14px] h-[14px] text-ops-amber" />
                      )}
                      <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                        {member.isCompanyAdmin ? "Admin" : member.role || "Crew"}
                      </span>
                      <MemberActions
                        member={member}
                        isCurrentUser={isCurrentUser}
                        isSeated={isSeated}
                        seatsFull={seatsFull}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deactivated Members */}
      {deactivatedMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("team.deactivatedTitle")} ({deactivatedMembers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {deactivatedMembers.map((member) => {
                const fullName = getUserFullName(member);
                const isSeated = seatedIds.includes(member.id);

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0 opacity-60"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-[32px] h-[32px] rounded-full flex items-center justify-center border-2 border-border-subtle">
                        <span className="font-mohave text-body-sm text-text-disabled">
                          {getInitials(fullName)}
                        </span>
                      </div>
                      <div>
                        <p className="font-mohave text-body text-text-tertiary">{fullName}</p>
                        <p className="font-mono text-[10px] text-text-disabled">
                          {member.email ?? "No email"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-[6px]">
                      <span className="font-kosugi text-[9px] text-ops-error bg-ops-error-muted px-[6px] py-[2px] rounded-full">
                        Inactive
                      </span>
                      <MemberActions
                        member={member}
                        isCurrentUser={false}
                        isSeated={isSeated}
                        seatsFull={seatsFull}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Modal */}
      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
