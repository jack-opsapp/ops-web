"use client";

import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { getUserFullName, getInitials, UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { toast } from "sonner";

const ROLES: { id: UserRole; label: string }[] = [
  { id: UserRole.Admin, label: "Admin" },
  { id: UserRole.OfficeCrew, label: "Office Crew" },
  { id: UserRole.FieldCrew, label: "Field Crew" },
];

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
        onSuccess: () => toast.success(`Role updated to ${role}`),
        onError: (err) => toast.error("Failed to update role", { description: err.message }),
      }
    );
  }

  function handleToggleSeat() {
    if (isSeated) {
      removeSeat.mutate(member.id, {
        onSuccess: () => toast.success("Seat removed"),
        onError: (err) => toast.error("Failed to remove seat", { description: err.message }),
      });
    } else {
      if (seatsFull) {
        toast.error("No seats available", { description: "Upgrade your plan or remove another member's seat." });
        return;
      }
      addSeat.mutate(member.id, {
        onSuccess: () => toast.success("Seat assigned"),
        onError: (err) => toast.error("Failed to assign seat", { description: err.message }),
      });
    }
  }

  function handleDeactivate() {
    deactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => {
          toast.success(`${getUserFullName(member)} has been deactivated`);
          setConfirmDeactivate(false);
        },
        onError: (err) => toast.error("Failed to deactivate", { description: err.message }),
      }
    );
  }

  function handleReactivate() {
    reactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => toast.success(`${getUserFullName(member)} has been reactivated`),
        onError: (err) => toast.error("Failed to reactivate", { description: err.message }),
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
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-[4px] z-50 min-w-[180px] bg-background-card border border-border rounded-lg shadow-lg overflow-hidden">
              {/* Role section */}
              <div className="px-1.5 py-[6px] border-b border-[rgba(255,255,255,0.04)]">
                <p className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider mb-[4px]">Role</p>
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
                    {role.label}
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
                {isSeated ? "Remove Seat" : "Assign Seat"}
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
                  Deactivate
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
                  Reactivate
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`Deactivate ${getUserFullName(member)}?`}
        description="This will revoke their access to OPS. They will no longer be able to log in or access company data. You can reactivate them later."
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={handleDeactivate}
        loading={deactivateUser.isPending}
      />
    </>
  );
}

export function TeamTab() {
  const { data: teamData, isLoading } = useTeamMembers();
  const { data: company } = useCompany();
  const currentUser = useAuthStore((s) => s.currentUser);
  const members = teamData?.users ?? [];
  const sendInvite = useSendInvite();

  const [inviteValue, setInviteValue] = useState("");
  const [inviteMode, setInviteMode] = useState<"email" | "sms">("email");
  const [inviteRole, setInviteRole] = useState<"field-crew" | "admin">("field-crew");

  const seatedIds = company?.seatedEmployeeIds ?? [];
  const maxSeats = company?.maxSeats ?? 10;
  const seatedCount = seatedIds.length;
  const seatsFull = seatedCount >= maxSeats;

  // Separate active and deactivated members
  const activeMembers = members.filter((m) => m.isActive !== false);
  const deactivatedMembers = members.filter((m) => m.isActive === false);

  function handleInvite() {
    if (!inviteValue.trim()) {
      toast.error(inviteMode === "email" ? "Please enter an email address" : "Please enter a phone number");
      return;
    }

    const data = inviteMode === "email"
      ? { emails: [inviteValue] }
      : { phones: [inviteValue] };

    sendInvite.mutate(data, {
      onSuccess: () => {
        toast.success("Invitation sent", {
          description: `${inviteMode === "email" ? "Email" : "SMS"} invite sent to ${inviteValue}`,
        });
        setInviteValue("");
      },
      onError: (err) => toast.error("Failed to send invite", { description: err.message }),
    });
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      {/* Invite Section */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Team Member</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Email / SMS toggle */}
          <div className="flex items-center gap-1">
            {([
              { id: "email" as const, label: "Email", icon: Mail },
              { id: "sms" as const, label: "SMS", icon: Phone },
            ]).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  setInviteMode(mode.id);
                  setInviteValue("");
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

          {inviteMode === "email" ? (
            <Input
              label="Email Address"
              type="email"
              value={inviteValue}
              onChange={(e) => setInviteValue(e.target.value)}
              placeholder="teammate@company.com"
              prefixIcon={<Mail className="w-[16px] h-[16px]" />}
            />
          ) : (
            <Input
              label="Phone Number"
              type="tel"
              value={inviteValue}
              onChange={(e) => setInviteValue(e.target.value)}
              placeholder="+1 (555) 123-4567"
              prefixIcon={<Phone className="w-[16px] h-[16px]" />}
            />
          )}

          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              Role
            </label>
            <div className="flex items-center gap-1">
              {([
                { id: "field-crew" as const, label: "Field Crew" },
                { id: "admin" as const, label: "Admin" },
              ]).map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setInviteRole(role.id)}
                  className={cn(
                    "px-1.5 py-[8px] rounded border font-mohave text-body-sm transition-all",
                    inviteRole === role.id
                      ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                      : "bg-background-input border-border text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {role.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pt-1">
            <Button onClick={handleInvite} className="gap-[6px]" disabled={sendInvite.isPending}>
              {sendInvite.isPending ? (
                <Loader2 className="w-[16px] h-[16px] animate-spin" />
              ) : (
                <UserPlus className="w-[16px] h-[16px]" />
              )}
              Send Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Seat Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Seat Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-1">
            <span className="font-mohave text-body text-text-secondary">Active Seats</span>
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
              All seats are in use. Upgrade your plan to add more members.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Active Team Members */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members ({activeMembers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : activeMembers.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-tertiary py-2">
              No team members yet. Send an invite to get started.
            </p>
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
                      <div className="w-[32px] h-[32px] rounded-full bg-ops-accent-muted flex items-center justify-center">
                        <span className="font-mohave text-body-sm text-ops-accent">
                          {getInitials(fullName)}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-[6px]">
                          <p className="font-mohave text-body text-text-primary">{fullName}</p>
                          {isCurrentUser && (
                            <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                              You
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
                          Seated
                        </span>
                      )}
                      {member.isCompanyAdmin && (
                        <Shield className="w-[14px] h-[14px] text-ops-amber" />
                      )}
                      <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                        {member.isCompanyAdmin ? "Admin" : member.role || "Field Crew"}
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
            <CardTitle>Deactivated ({deactivatedMembers.length})</CardTitle>
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
                      <div className="w-[32px] h-[32px] rounded-full bg-background-elevated flex items-center justify-center">
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
    </div>
  );
}
