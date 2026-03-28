"use client";

import { MapPin, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { getUserFullName, UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { useTeamMembers } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CrewLocationsWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleLabel(role: UserRole, t: (key: string) => string): string {
  switch (role) {
    case UserRole.Admin:
    case UserRole.Owner:
      return t("crewLocations.roleAdmin");
    case UserRole.Operator:
      return t("crewLocations.roleOperator");
    case UserRole.Crew:
      return t("crewLocations.roleField");
    case UserRole.Unassigned:
      return "Unassigned";
    default:
      return role;
  }
}

function roleBadgeClasses(role: UserRole): string {
  switch (role) {
    case UserRole.Admin:
    case UserRole.Owner:
      return "bg-ops-accent/15 text-ops-accent";
    case UserRole.Operator:
      return "bg-[rgba(255,255,255,0.06)] text-text-secondary";
    case UserRole.Crew:
      return "bg-[rgba(107,143,113,0.15)] text-[#6B8F71]";
    case UserRole.Unassigned:
    default:
      return "bg-[rgba(255,255,255,0.04)] text-text-disabled";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CrewLocationsWidget({ size }: CrewLocationsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data, isLoading } = useTeamMembers();
  const members = data?.users ?? [];

  const maxItems = size === "lg" ? 7 : 3;

  // ── MD: Name + location status ────────────────────────────────────────
  if (size === "md") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("crewLocations.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {isLoading ? "..." : `${members.length} ${t("crewLocations.members")}`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">
                {t("crewLocations.loading")}
              </span>
            </div>
          ) : members.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">
              {t("crewLocations.empty")}
            </p>
          ) : (
            <div className="space-y-[6px]">
              {members.slice(0, maxItems).map((member) => (
                <MemberLocationRow key={member.id} member={member} />
              ))}
              {members.length > maxItems && (
                <span className="font-mono text-[11px] text-text-disabled block px-1">
                  +{members.length - maxItems} {t("crewLocations.more")}
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
          <CardTitle className="text-card-subtitle">{t("crewLocations.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${members.length} ${t("crewLocations.members")}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("crewLocations.loading")}
            </span>
          </div>
        ) : members.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("crewLocations.empty")}
          </p>
        ) : (
          <div className="space-y-[6px]">
            {members.slice(0, maxItems).map((member) => (
              <MemberLocationRowLg key={member.id} member={member} />
            ))}
            {members.length > maxItems && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{members.length - maxItems} {t("crewLocations.more")}
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
  const { t } = useDictionary("dashboard");
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
        {location ?? t("crewLocations.locationUnavailable")}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LG row — name + location + role badge
// ---------------------------------------------------------------------------

function MemberLocationRowLg({ member }: { member: User }) {
  const { t } = useDictionary("dashboard");
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
            {roleLabel(member.role, t)}
          </span>
        </div>
        <p className="font-kosugi text-[10px] text-text-tertiary truncate">
          {location ?? t("crewLocations.locationUnavailable")}
        </p>
      </div>
    </div>
  );
}
