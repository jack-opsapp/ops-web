"use client";

import { MapPin, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { getUserFullName, UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { useTeamMembers } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CrewLocationsWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleLabel(role: UserRole): string {
  switch (role) {
    case UserRole.Admin:
      return "Admin";
    case UserRole.OfficeCrew:
      return "Office";
    case UserRole.FieldCrew:
      return "Field";
    default:
      return role;
  }
}

function roleBadgeClasses(role: UserRole): string {
  switch (role) {
    case UserRole.Admin:
      return "bg-ops-accent/15 text-ops-accent";
    case UserRole.OfficeCrew:
      return "bg-[rgba(255,255,255,0.06)] text-text-secondary";
    case UserRole.FieldCrew:
      return "bg-[rgba(107,143,113,0.15)] text-[#6B8F71]";
    default:
      return "bg-[rgba(255,255,255,0.04)] text-text-disabled";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CrewLocationsWidget({ size }: CrewLocationsWidgetProps) {
  const { data, isLoading } = useTeamMembers();
  const members = data?.users ?? [];

  const maxItems = size === "lg" ? 12 : 6;

  // ── MD: Name + location status ────────────────────────────────────────
  if (size === "md") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">Crew Locations</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {isLoading ? "..." : `${members.length} members`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">
                Loading crew...
              </span>
            </div>
          ) : members.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">
              No team members found
            </p>
          ) : (
            <div className="space-y-[6px]">
              {members.slice(0, maxItems).map((member) => (
                <MemberLocationRow key={member.id} member={member} />
              ))}
              {members.length > maxItems && (
                <span className="font-mono text-[11px] text-text-disabled block px-1">
                  +{members.length - maxItems} more
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── LG: Name + location + role badge ──────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Crew Locations</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${members.length} members`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading crew...
            </span>
          </div>
        ) : members.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No team members found
          </p>
        ) : (
          <div className="space-y-[6px]">
            {members.slice(0, maxItems).map((member) => (
              <MemberLocationRowLg key={member.id} member={member} />
            ))}
            {members.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{members.length - maxItems} more
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MD row — name + location
// ---------------------------------------------------------------------------

function MemberLocationRow({ member }: { member: User }) {
  const fullName = getUserFullName(member);
  const location = member.locationName ?? null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors">
      <MapPin className="w-[14px] h-[14px] text-text-disabled shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">
          {fullName}
        </p>
      </div>

      <span className="font-mono text-[11px] text-text-tertiary shrink-0">
        {location ?? "Location unavailable"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LG row — name + location + role badge
// ---------------------------------------------------------------------------

function MemberLocationRowLg({ member }: { member: User }) {
  const fullName = getUserFullName(member);
  const location = member.locationName ?? null;

  return (
    <div className="flex items-center gap-1.5 px-[6px] py-1 rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors">
      <MapPin className="w-[14px] h-[14px] text-text-disabled shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-mohave text-body-sm text-text-primary truncate">
            {fullName}
          </span>
          <span
            className={cn(
              "font-mono text-[9px] px-[5px] py-[1px] rounded-sm uppercase tracking-wider shrink-0",
              roleBadgeClasses(member.role)
            )}
          >
            {roleLabel(member.role)}
          </span>
        </div>
        <p className="font-kosugi text-[10px] text-text-tertiary truncate">
          {location ?? "Location unavailable"}
        </p>
      </div>
    </div>
  );
}
