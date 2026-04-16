"use client";

import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useRoles,
  useCompany,
  useTeamMembers,
  useAddSeatedEmployee,
  useAllUserRoles,
} from "@/lib/hooks";
import { useAssignMemberRole } from "@/lib/hooks/use-assign-member-role";
import { AssignRoleModalSeatBanner } from "./assign-role-modal-seat-banner";

interface AssignRoleModalProps {
  memberId: string;
  open: boolean;
  onClose: () => void;
  onManageSeats?: () => void;
}

export function AssignRoleModal({
  memberId,
  open,
  onClose,
  onManageSeats,
}: AssignRoleModalProps) {
  const { data: rolesData } = useRoles();
  const { data: company } = useCompany();
  const { data: membersData } = useTeamMembers();
  const { data: userRolesData } = useAllUserRoles();
  const addSeat = useAddSeatedEmployee();
  const assignRole = useAssignMemberRole();

  const roles = rolesData ?? [];
  const users = membersData?.users ?? [];
  const member = users.find((u) => u.id === memberId);

  const seatedIds = company?.seatedEmployeeIds ?? [];
  const maxSeats = company?.maxSeats ?? 0;
  const isSeated = seatedIds.includes(memberId);
  const seatsAvailable = Math.max(0, maxSeats - seatedIds.length);

  // Resolve the member's current role_id from user_roles (not the legacy
  // users.role enum, which doesn't map to custom company roles).
  const currentRoleId = useMemo(() => {
    return userRolesData?.find((ur) => ur.userId === memberId)?.roleId ?? null;
  }, [userRolesData, memberId]);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(currentRoleId);

  // Sync when currentRoleId resolves after async fetch.
  useEffect(() => {
    setSelectedRoleId(currentRoleId);
  }, [currentRoleId]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId),
    [roles, selectedRoleId]
  );

  const firstName = member?.firstName ?? "This member";
  const fullName =
    [member?.firstName, member?.lastName].filter(Boolean).join(" ") ||
    member?.email ||
    "This member";

  const canSave = !!selectedRoleId && selectedRoleId !== currentRoleId;

  function handleAssignSeat() {
    if (!member) return;
    addSeat.mutate(memberId, {
      onSuccess: () => {
        toast.success(`${firstName} is now seated.`);
      },
      onError: (err) => {
        toast.error(`Couldn't assign seat: ${err.message}`);
      },
    });
  }

  function handleManageSeats() {
    onClose();
    onManageSeats?.();
  }

  function handleSave() {
    if (!selectedRoleId || !member) return;
    assignRole.mutate(
      { userId: memberId, roleId: selectedRoleId },
      {
        onSuccess: (result) => {
          toast.success(`${firstName} is on as ${result.roleName}.`);
          onClose();
        },
        onError: (err) => {
          toast.error(`Couldn't assign role: ${err.message}`);
        },
      }
    );
  }

  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-kosugi text-micro uppercase tracking-wider text-text-2">
            Assign role
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 py-2">
          <div className="w-12 h-12 rounded-full border border-border-subtle bg-fill-neutral-dim flex items-center justify-center font-mohave text-body-lg text-text">
            {firstName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mohave text-body-lg text-text truncate">
              {fullName}
            </p>
            {member.email && (
              <p className="font-kosugi text-micro text-text-3 truncate">
                {member.email}
              </p>
            )}
          </div>
        </div>

        <AssignRoleModalSeatBanner
          firstName={firstName}
          isSeated={isSeated}
          seatsAvailable={seatsAvailable}
          onAssignSeat={handleAssignSeat}
          onManageSeats={handleManageSeats}
          isAssigning={addSeat.isPending}
        />

        <div className="flex flex-col gap-1 mt-2">
          <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
            Role
          </label>
          <div className="flex flex-wrap items-center gap-1">
            {roles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelectedRoleId(role.id)}
                className={cn(
                  "px-1.5 py-[6px] rounded border font-mohave text-body-sm transition-all",
                  selectedRoleId === role.id
                    ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                    : "bg-surface-input border-border text-text-3 hover:text-text-2"
                )}
              >
                {role.name}
              </button>
            ))}
          </div>
          {selectedRole?.description ? (
            <p className="font-kosugi text-[10px] text-text-3 mt-[4px]">
              {selectedRole.description}
            </p>
          ) : (
            <p className="font-kosugi text-[10px] text-text-mute mt-[4px]">
              The role {firstName} receives when active on jobs.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave || assignRole.isPending}
          >
            {assignRole.isPending ? "Saving…" : "Save role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
