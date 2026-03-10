"use client";

import { MapPin, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/ops/user-avatar";
import type { UserRole as AvatarUserRole } from "@/components/ops/user-avatar";
import type { User } from "@/lib/types/models";
import { UserRole, getUserFullName } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

function toAvatarRole(role: UserRole): AvatarUserRole {
  switch (role) {
    case UserRole.Admin:
    case UserRole.Owner:
      return "admin";
    case UserRole.Office:
    case UserRole.OfficeCrew:
    case UserRole.Operator:
      return "manager";
    case UserRole.Crew:
    case UserRole.FieldCrew:
    default:
      return "field-crew";
  }
}

interface CrewWidgetProps {
  size: WidgetSize;
  teamMembers: User[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

export function CrewWidget({
  size,
  teamMembers,
  isLoading,
  onNavigate,
}: CrewWidgetProps) {
  const { t } = useDictionary("dashboard");
  const activeCount = teamMembers.filter((m) => m.isActive).length;

  // sm: avatar row
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("crew.titleShort")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {t("crew.activeCount").replace("{count}", String(activeCount))}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            </div>
          ) : (
            <div className="flex -space-x-1.5">
              {teamMembers.slice(0, 6).map((member) => (
                <div key={member.id} onClick={() => onNavigate("/team")} className="cursor-pointer">
                  <UserAvatar
                    name={getUserFullName(member)}
                    role={toAvatarRole(member.role)}
                    online={member.isActive ?? false}
                    color={member.userColor ?? undefined}
                    size="sm"
                  />
                </div>
              ))}
              {teamMembers.length > 6 && (
                <div className="w-[28px] h-[28px] rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center">
                  <span className="font-mono text-[9px] text-text-disabled">
                    +{teamMembers.length - 6}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // lg: name + status + locations
  if (size === "lg") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("crew.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">
              {t("crew.activeCount").replace("{count}", String(activeCount))}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">{t("crew.loading")}</span>
            </div>
          ) : teamMembers.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">
              {t("crew.noMembers")}
            </p>
          ) : (
            <div className="space-y-[6px]">
              {teamMembers.slice(0, 7).map((member) => {
                const fullName = getUserFullName(member);
                const isOnline = member.isActive ?? false;
                const statusLabel = isOnline ? t("crew.active") : t("crew.offDuty");

                return (
                  <div
                    key={member.id}
                    onClick={() => onNavigate("/team")}
                    className="flex items-center gap-1.5 px-[6px] py-1 rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
                  >
                    <UserAvatar
                      name={fullName}
                      role={toAvatarRole(member.role)}
                      online={isOnline}
                      color={member.userColor ?? undefined}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-mohave text-body-sm text-text-primary truncate">
                          {fullName}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-[9px] px-[5px] py-[1px] rounded-sm uppercase tracking-wider",
                            isOnline
                              ? "bg-[rgba(107,143,113,0.15)] text-[#6B8F71]"
                              : "bg-[rgba(255,255,255,0.04)] text-text-disabled"
                          )}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <p className="font-kosugi text-[10px] text-text-tertiary truncate">
                        {member.role}
                      </p>
                    </div>
                    {member.locationName && (
                      <div className="flex items-center gap-[3px] shrink-0">
                        <MapPin className="w-[10px] h-[10px] text-text-disabled" />
                        <span className="font-mono text-[9px] text-text-disabled">
                          {member.locationName}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {teamMembers.length > 7 && (
                <span className="font-mono text-[11px] text-text-disabled block px-1">
                  {t("crew.more").replace("{count}", String(teamMembers.length - 7))}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // md: name + status (current default)
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("crew.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {t("crew.activeCount").replace("{count}", String(activeCount))}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">{t("crew.loading")}</span>
          </div>
        ) : teamMembers.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("crew.noMembers")}
          </p>
        ) : (
          <div className="space-y-[6px]">
            {teamMembers.slice(0, 3).map((member) => {
              const fullName = getUserFullName(member);
              const isOnline = member.isActive ?? false;
              const statusLabel = isOnline ? t("crew.active") : t("crew.offDuty");

              return (
                <div
                  key={member.id}
                  onClick={() => onNavigate("/team")}
                  className="flex items-center gap-1.5 px-[6px] py-1 rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
                >
                  <UserAvatar
                    name={fullName}
                    role={toAvatarRole(member.role)}
                    online={isOnline}
                    color={member.userColor ?? undefined}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-mohave text-body-sm text-text-primary truncate">
                        {fullName}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[9px] px-[5px] py-[1px] rounded-sm uppercase tracking-wider",
                          isOnline
                            ? "bg-[rgba(107,143,113,0.15)] text-[#6B8F71]"
                            : "bg-[rgba(255,255,255,0.04)] text-text-disabled"
                        )}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <p className="font-kosugi text-[10px] text-text-tertiary truncate">
                      {member.role}
                    </p>
                  </div>
                  {member.locationName && (
                    <div className="flex items-center gap-[3px] shrink-0">
                      <MapPin className="w-[10px] h-[10px] text-text-disabled" />
                      <span className="font-mono text-[9px] text-text-disabled">
                        {member.locationName}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {teamMembers.length > 3 && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                {t("crew.more").replace("{count}", String(teamMembers.length - 3))}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
