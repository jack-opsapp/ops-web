"use client";

import { useState } from "react";
import { UserPlus, Mail, Shield } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { getUserFullName, getInitials } from "@/lib/types/models";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function TeamTab() {
  const { data: teamData, isLoading } = useTeamMembers();
  const members = teamData?.users ?? [];

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"field-crew" | "admin">("field-crew");

  function handleInvite() {
    if (!inviteEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }
    toast.success("Invitation sent", {
      description: `Invite sent to ${inviteEmail}`,
    });
    setInviteEmail("");
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Invite Team Member</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            label="Email Address"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@company.com"
            prefixIcon={<Mail className="w-[16px] h-[16px]" />}
          />
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
            <Button onClick={handleInvite} className="gap-[6px]">
              <UserPlus className="w-[16px] h-[16px]" />
              Send Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-tertiary py-2">
              No team members yet. Send an invite to get started.
            </p>
          ) : (
            <div className="space-y-0">
              {members.map((member) => {
                const fullName = getUserFullName(member);
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
                        <p className="font-mohave text-body text-text-primary">{fullName}</p>
                        <p className="font-mono text-[10px] text-text-disabled">{member.email ?? "No email"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-[6px]">
                      {member.isCompanyAdmin && (
                        <Shield className="w-[14px] h-[14px] text-ops-amber" />
                      )}
                      <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                        {member.isCompanyAdmin ? "Admin" : member.role || "Field Crew"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
