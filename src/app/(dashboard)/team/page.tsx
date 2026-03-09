"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Search,
  Phone,
  Mail,
  Shield,
  ShieldCheck,
  HardHat,
  MoreVertical,
  UserMinus,
  UserCog,
  Users,
  Clock,
  Send,
  X,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { trackScreenView } from "@/lib/analytics/analytics";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import {
  useTeamMembers,
  useUpdateUserRole,
  useRemoveSeatedEmployee,
  useSendInvite,
} from "@/lib/hooks";
import { useAuthStore, selectIsAdmin } from "@/lib/store/auth-store";
import { UserRole, getUserFullName } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = "admin" | "owner" | "office" | "operator" | "crew";
type MemberStatus = "active" | "inactive";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  avatar?: string;
  status: MemberStatus;
  lastActive: string;
  userColor?: string;
}

// ─── Role Mapping Helpers ────────────────────────────────────────────────────

/** Map UserRole enum to the internal lowercase format used by the page */
function userRoleToDisplayRole(role: UserRole): Role {
  switch (role) {
    case UserRole.Admin:
      return "admin";
    case UserRole.Owner:
      return "owner";
    case UserRole.Office:
    case UserRole.OfficeCrew:
      return "office";
    case UserRole.Operator:
      return "operator";
    case UserRole.Crew:
    case UserRole.FieldCrew:
      return "crew";
    default:
      return "crew";
  }
}

/** Map internal lowercase format back to UserRole enum */
function displayRoleToUserRole(role: Role): UserRole {
  switch (role) {
    case "admin":
      return UserRole.Admin;
    case "owner":
      return UserRole.Owner;
    case "office":
      return UserRole.Office;
    case "operator":
      return UserRole.Operator;
    case "crew":
      return UserRole.Crew;
    default:
      return UserRole.Crew;
  }
}

/** Map a User model to the TeamMember display format */
function userToTeamMember(user: User): TeamMember {
  const lastSynced = user.lastSyncedAt;
  let lastActive: string;
  if (lastSynced) {
    lastActive =
      typeof lastSynced === "string"
        ? lastSynced
        : (lastSynced as Date).toISOString();
  } else {
    lastActive = new Date(0).toISOString();
  }

  return {
    id: user.id,
    name: getUserFullName(user),
    email: user.email ?? "",
    phone: user.phone ?? undefined,
    role: userRoleToDisplayRole(user.role),
    avatar: user.profileImageURL ?? undefined,
    status: user.isActive ? "active" : "inactive",
    lastActive,
    userColor: user.userColor ?? undefined,
  };
}

// ─── Config ──────────────────────────────────────────────────────────────────

const roleStyleConfig: Record<
  Role,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bg: string;
    borderColor: string;
  }
> = {
  admin: {
    icon: ShieldCheck,
    color: "text-ops-amber",
    bg: "bg-ops-amber-muted",
    borderColor: "border-l-[#C4A868]",
  },
  owner: {
    icon: ShieldCheck,
    color: "text-ops-amber",
    bg: "bg-ops-amber-muted",
    borderColor: "border-l-[#C4A868]",
  },
  office: {
    icon: Shield,
    color: "text-ops-accent",
    bg: "bg-ops-accent-muted",
    borderColor: "border-l-[#417394]",
  },
  operator: {
    icon: Shield,
    color: "text-ops-accent",
    bg: "bg-ops-accent-muted",
    borderColor: "border-l-[#417394]",
  },
  crew: {
    icon: HardHat,
    color: "text-text-secondary",
    bg: "bg-background-elevated",
    borderColor: "border-l-[#555555]",
  },
};

const ROLE_LABEL_KEYS: Record<Role, string> = {
  admin: "team.role.admin",
  owner: "team.role.owner",
  office: "team.role.office",
  operator: "team.role.operator",
  crew: "team.role.crew",
};

const roleOptions: Role[] = ["admin", "owner", "office", "operator", "crew"];

// ─── Role Badge ──────────────────────────────────────────────────────────────

function RoleBadge({ role, t }: { role: Role; t: (key: string) => string }) {
  const config = roleStyleConfig[role];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-kosugi text-[10px] uppercase tracking-wider",
        config.color,
        config.bg
      )}
    >
      <Icon className="w-[12px] h-[12px]" />
      {t(ROLE_LABEL_KEYS[role])}
    </span>
  );
}

// ─── Role Selector Dropdown ──────────────────────────────────────────────────

function RoleSelector({
  currentRole,
  onSelect,
  onClose,
  t,
}: {
  currentRole: Role;
  onSelect: (role: Role) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-[4px] w-[200px] bg-[rgba(13,13,13,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded shadow-floating z-50 animate-scale-in overflow-hidden">
        <div className="px-1.5 py-[6px] border-b border-border-subtle">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-widest">
            {t("team.changeRole")}
          </span>
        </div>
        {roleOptions.map((role) => {
          const config = roleStyleConfig[role];
          const Icon = config.icon;
          const isActive = role === currentRole;
          return (
            <button
              key={role}
              onClick={() => {
                onSelect(role);
                onClose();
              }}
              className={cn(
                "flex items-center gap-1 w-full px-1.5 py-[8px] transition-colors font-mohave text-body-sm",
                isActive
                  ? "bg-ops-accent-muted text-ops-accent"
                  : "text-text-secondary hover:text-text-secondary hover:bg-background-elevated"
              )}
            >
              <Icon className="w-[14px] h-[14px]" />
              <span className="flex-1 text-left">{t(ROLE_LABEL_KEYS[role])}</span>
              {isActive && <Check className="w-[13px] h-[13px]" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ─── Team Member Card ────────────────────────────────────────────────────────

function TeamMemberCard({
  member,
  isAdmin,
  onChangeRole,
  onRemove,
  t,
}: {
  member: TeamMember;
  isAdmin: boolean;
  onChangeRole: (memberId: string, role: Role) => void;
  onRemove: (memberId: string) => void;
  t: (key: string) => string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showRoleSelector, setShowRoleSelector] = useState(false);
  const { locale } = useLocale();

  const config = roleStyleConfig[member.role];
  const isInactive = member.status === "inactive";

  function formatLastActive(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime()) || date.getTime() === 0) return t("team.never");
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return t("team.justNow");
    if (diffHours < 24) return `${diffHours}${t("card.hoursAgo")}`;
    if (diffDays === 1) return t("card.yesterday");
    if (diffDays < 7) return `${diffDays}${t("card.daysAgoFull")}`;
    return date.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" });
  }

  return (
    <Card
      className={cn(
        "p-0 overflow-hidden relative border-l-[3px]",
        config.borderColor,
        isInactive && "opacity-60"
      )}
    >
      <div className="p-2">
        <div className="flex items-start gap-1.5">
          {/* Avatar */}
          <div className="relative">
            <div
              className={cn(
                "w-[48px] h-[48px] rounded-full flex items-center justify-center shrink-0",
                isInactive ? "bg-background-elevated" : "bg-ops-accent-muted"
              )}
              style={
                member.userColor && !isInactive
                  ? { backgroundColor: `${member.userColor}20` }
                  : undefined
              }
            >
              <span
                className={cn(
                  "font-mohave text-body-lg",
                  isInactive ? "text-text-disabled" : "text-ops-accent"
                )}
                style={
                  member.userColor && !isInactive
                    ? { color: member.userColor }
                    : undefined
                }
              >
                {member.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </span>
            </div>
            {/* Online indicator */}
            {member.status === "active" && (
              <span className="absolute -bottom-[1px] -right-[1px] h-[8px] w-[8px] rounded-full bg-[#6B8F71] border-2 border-background-card" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h3
                className={cn(
                  "font-mohave text-card-title truncate",
                  isInactive ? "text-text-disabled" : "text-text-primary"
                )}
              >
                {member.name}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 mt-[2px]">
              <RoleBadge role={member.role} t={t} />
            </div>
          </div>

          {/* Actions menu (admin only) */}
          {isAdmin && (
            <div className="relative">
              <button
                onClick={() => {
                  setMenuOpen(!menuOpen);
                  setShowRoleSelector(false);
                }}
                className="p-[6px] rounded text-text-tertiary hover:text-text-secondary hover:bg-background-elevated transition-colors"
              >
                <MoreVertical className="w-[16px] h-[16px]" />
              </button>
              {menuOpen && !showRoleSelector && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-[4px] w-[180px] bg-[rgba(13,13,13,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded shadow-floating z-50 animate-scale-in overflow-hidden">
                    <button
                      onClick={() => {
                        setShowRoleSelector(true);
                      }}
                      className="flex items-center gap-1 w-full px-1.5 py-[8px] text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors font-mohave text-body-sm"
                    >
                      <UserCog className="w-[14px] h-[14px]" />
                      {t("team.changeRole")}
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onRemove(member.id);
                      }}
                      className="flex items-center gap-1 w-full px-1.5 py-[8px] text-ops-error hover:bg-ops-error-muted transition-colors font-mohave text-body-sm"
                    >
                      <UserMinus className="w-[14px] h-[14px]" />
                      {t("team.removeMember")}
                    </button>
                  </div>
                </>
              )}
              {menuOpen && showRoleSelector && (
                <RoleSelector
                  currentRole={member.role}
                  onSelect={(role) => {
                    onChangeRole(member.id, role);
                    setMenuOpen(false);
                    setShowRoleSelector(false);
                  }}
                  onClose={() => {
                    setMenuOpen(false);
                    setShowRoleSelector(false);
                  }}
                  t={t}
                />
              )}
            </div>
          )}
        </div>

        {/* Contact info */}
        <div className="mt-1.5 space-y-[6px]">
          <div className="flex items-center gap-[6px] text-text-tertiary">
            <Mail className="w-[13px] h-[13px] shrink-0" />
            <a
              href={`mailto:${member.email}`}
              className="font-mono text-[11px] truncate hover:text-ops-accent transition-colors"
            >
              {member.email}
            </a>
          </div>
          {member.phone && (
            <div className="flex items-center gap-[6px] text-text-tertiary">
              <Phone className="w-[13px] h-[13px] shrink-0" />
              <a
                href={`tel:${member.phone}`}
                className="font-mono text-[11px] hover:text-ops-accent transition-colors"
              >
                {member.phone}
              </a>
            </div>
          )}
        </div>

        {/* Last active */}
        <div className="flex items-center gap-[6px] mt-1.5 pt-1 border-t border-border-subtle">
          <Clock className="w-[12px] h-[12px] text-text-disabled" />
          <span className="font-mono text-[10px] text-text-disabled">
            {formatLastActive(member.lastActive)}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ─── Invite Form ─────────────────────────────────────────────────────────────

function InviteForm({
  onInvite,
  onClose,
  t,
}: {
  onInvite: (email: string) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sendInvite = useSendInvite();

  async function handleInvite() {
    if (!email.trim()) {
      setError(t("team.emailRequired"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t("team.invalidEmail"));
      return;
    }
    setError(null);

    sendInvite.mutate({ emails: [email.trim()] }, {
      onSuccess: (result) => {
        if (result.success) {
          onInvite(email);
          setEmail("");
        } else {
          setError(t("team.failedInvite"));
        }
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : t("team.failedInvite"));
      },
    });
  }

  return (
    <div className="bg-background-card border border-ops-accent/30 rounded-lg p-2 space-y-1.5 animate-slide-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[6px]">
          <Send className="w-[14px] h-[14px] text-ops-accent" />
          <h3 className="font-mohave text-card-title text-text-primary">
            {t("team.inviteTitle")}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-[4px] rounded text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X className="w-[16px] h-[16px]" />
        </button>
      </div>
      <p className="font-kosugi text-caption-sm text-text-tertiary">
        {t("team.inviteDesc")}
      </p>
      <div className="flex items-start gap-1">
        <div className="flex-1">
          <Input
            type="email"
            placeholder={t("team.invitePlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            prefixIcon={<Mail className="w-[16px] h-[16px]" />}
            error={error || undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleInvite();
              }
            }}
          />
        </div>
        <Button
          onClick={handleInvite}
          loading={sendInvite.isPending}
          className="gap-[6px] shrink-0"
        >
          <Send className="w-[14px] h-[14px]" />
          {t("team.sendInvite")}
        </Button>
      </div>
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-background-card border border-border rounded-lg p-2 space-y-1.5 animate-pulse border-l-[3px] border-l-background-elevated"
        >
          <div className="flex items-start gap-1.5">
            <div className="w-[48px] h-[48px] rounded-full bg-background-elevated" />
            <div className="flex-1 space-y-1">
              <div className="h-[16px] bg-background-elevated rounded w-3/4" />
              <div className="h-[14px] bg-background-elevated rounded w-1/2" />
            </div>
          </div>
          <div className="h-[14px] bg-background-elevated rounded w-full" />
          <div className="h-[14px] bg-background-elevated rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { t } = useDictionary("schedule");
  const [searchQuery, setSearchQuery] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  // Track screen view
  useEffect(() => { trackScreenView("team"); }, []);

  // ─── Data hooks ──────────────────────────────────────────────────────────
  const { data: teamData, isLoading } = useTeamMembers();
  const updateRoleMutation = useUpdateUserRole();
  const removeEmployeeMutation = useRemoveSeatedEmployee();

  // ─── Auth store ──────────────────────────────────────────────────────────
  const { company } = useAuthStore();
  const isCurrentUserAdmin = useAuthStore(selectIsAdmin);

  // ─── Map API users to display format ─────────────────────────────────────
  const team: TeamMember[] = useMemo(() => {
    const users = teamData?.users ?? [];
    return users
      .filter((u) => !u.deletedAt)
      .map(userToTeamMember);
  }, [teamData]);

  const maxSeats = company?.maxSeats ?? 10;

  const activeCount = team.filter((m) => m.status === "active").length;
  const adminCount = team.filter((m) => m.role === "admin" || m.role === "owner").length;
  const officeCount = team.filter((m) => m.role === "office" || m.role === "operator").length;
  const fieldCount = team.filter((m) => m.role === "crew").length;

  const filteredTeam = useMemo(() => {
    if (!searchQuery.trim()) return team;
    const query = searchQuery.toLowerCase();
    return team.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.email.toLowerCase().includes(query) ||
        m.phone?.includes(query) ||
        t(ROLE_LABEL_KEYS[m.role]).toLowerCase().includes(query)
    );
  }, [team, searchQuery]);

  // Group by role for display
  const admins = filteredTeam.filter((m) => m.role === "admin" || m.role === "owner");
  const officeCrew = filteredTeam.filter((m) => m.role === "office" || m.role === "operator");
  const fieldCrew = filteredTeam.filter((m) => m.role === "crew");

  function handleChangeRole(memberId: string, newRole: Role) {
    const userRole = displayRoleToUserRole(newRole);
    const member = team.find((m) => m.id === memberId);
    updateRoleMutation.mutate(
      { id: memberId, role: userRole },
      {
        onSuccess: () => {
          toast.success(
            `${member?.name ?? "Member"} ${t("team.roleUpdated")} ${t(ROLE_LABEL_KEYS[newRole])}`
          );
        },
        onError: (error) => {
          toast.error(
            `${t("team.roleUpdateFailed")}: ${error instanceof Error ? error.message : ""}`
          );
        },
      }
    );
  }

  function handleRemoveMember() {
    if (!removeTarget) return;
    const member = team.find((m) => m.id === removeTarget);
    removeEmployeeMutation.mutate(removeTarget, {
      onSuccess: () => {
        toast.success(
          `${member?.name ?? "Member"} ${t("team.removeSuccess")}`
        );
        setRemoveTarget(null);
      },
      onError: (error) => {
        toast.error(
          `${t("team.removeFailed")}: ${error instanceof Error ? error.message : ""}`
        );
        setRemoveTarget(null);
      },
    });
  }

  function handleInvite(email: string) {
    setShowInviteForm(false);
    toast.success(`${t("team.inviteSent")} ${email}`);
  }

  const memberForRemoval = team.find((m) => m.id === removeTarget);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mt-[4px] flex-wrap">
            <span className="font-kosugi text-caption-sm text-text-tertiary">
              {team.length} {t("team.members")}
            </span>

            {/* Seat indicator */}
            <div className="flex items-center gap-[6px]">
              <div className="w-[80px] h-[4px] bg-background-elevated rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    activeCount / maxSeats > 0.85
                      ? "bg-ops-error"
                      : "bg-ops-accent"
                  )}
                  style={{ width: `${(activeCount / maxSeats) * 100}%` }}
                />
              </div>
              <span className="font-mono text-[11px] text-text-tertiary">
                {activeCount}/{maxSeats} {t("team.seats")}
              </span>
            </div>

            {/* Role breakdown */}
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-text-disabled font-mono text-[10px]">|</span>
              <span className="font-mono text-[10px] text-ops-amber">
                {adminCount} {t("team.admin")}
              </span>
              <span className="font-mono text-[10px] text-ops-accent">
                {officeCount} {t("team.officeCrew")}
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">
                {fieldCount} {t("team.fieldCrew")}
              </span>
            </div>
          </div>
        </div>
        <Button
          className="gap-[6px]"
          onClick={() => setShowInviteForm(!showInviteForm)}
        >
          {showInviteForm ? (
            <>
              <X className="w-[16px] h-[16px]" />
              {t("team.close")}
            </>
          ) : (
            <>
              <Plus className="w-[16px] h-[16px]" />
              {t("team.inviteMember")}
            </>
          )}
        </Button>
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <InviteForm
          onInvite={handleInvite}
          onClose={() => setShowInviteForm(false)}
          t={t}
        />
      )}

      {/* Search */}
      <div className="max-w-[400px]">
        <Input
          placeholder={t("team.search")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          prefixIcon={<Search className="w-[16px] h-[16px]" />}
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : filteredTeam.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8">
          <Users className="w-[48px] h-[48px] text-text-disabled mb-2" />
          <h3 className="font-mohave text-heading text-text-primary">
            {searchQuery ? t("team.noResults") : t("team.empty")}
          </h3>
          <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
            {searchQuery
              ? t("team.noResultsHelper")
              : t("team.emptyHelper")}
          </p>
          {!searchQuery && (
            <Button
              className="mt-3 gap-[6px]"
              onClick={() => setShowInviteForm(true)}
            >
              <Plus className="w-[16px] h-[16px]" />
              {t("team.inviteMember")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Admins Section */}
          {admins.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <ShieldCheck className="w-[14px] h-[14px] text-ops-amber" />
                <h2 className="font-kosugi text-caption-bold text-ops-amber uppercase tracking-widest">
                  {t("team.sections.admins")}
                </h2>
                <Badge variant="warning" className="text-[10px] px-[6px] py-[1px]">
                  {admins.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {admins.map((member) => (
                  <TeamMemberCard
                    key={member.id}
                    member={member}
                    isAdmin={isCurrentUserAdmin}
                    onChangeRole={handleChangeRole}
                    onRemove={(id) => setRemoveTarget(id)}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Office Crew Section */}
          {officeCrew.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Shield className="w-[14px] h-[14px] text-ops-accent" />
                <h2 className="font-kosugi text-caption-bold text-ops-accent uppercase tracking-widest">
                  {t("team.sections.officeCrew")}
                </h2>
                <Badge variant="info" className="text-[10px] px-[6px] py-[1px]">
                  {officeCrew.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {officeCrew.map((member) => (
                  <TeamMemberCard
                    key={member.id}
                    member={member}
                    isAdmin={isCurrentUserAdmin}
                    onChangeRole={handleChangeRole}
                    onRemove={(id) => setRemoveTarget(id)}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Field Crew Section */}
          {fieldCrew.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <HardHat className="w-[14px] h-[14px] text-text-secondary" />
                <h2 className="font-kosugi text-caption-bold text-text-secondary uppercase tracking-widest">
                  {t("team.sections.fieldCrew")}
                </h2>
                <Badge variant="info" className="text-[10px] px-[6px] py-[1px] opacity-60">
                  {fieldCrew.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {fieldCrew.map((member) => (
                  <TeamMemberCard
                    key={member.id}
                    member={member}
                    isAdmin={isCurrentUserAdmin}
                    onChangeRole={handleChangeRole}
                    onRemove={(id) => setRemoveTarget(id)}
                    t={t}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Remove Confirmation Dialog */}
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t("team.removeConfirmTitle")}
        description={
          memberForRemoval
            ? t("team.removeConfirmDesc")
            : ""
        }
        confirmLabel={t("team.removeMember")}
        variant="destructive"
        onConfirm={handleRemoveMember}
        loading={removeEmployeeMutation.isPending}
      />
    </div>
  );
}
