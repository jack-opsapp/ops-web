"use client";

import { useState, useCallback } from "react";
import {
  UserPlus,
  Mail,
  Phone,
  Loader2,
  X,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useSendInvite, useCompany, useRoles } from "@/lib/hooks";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Invite Modal ─────────────────────────────────────────────────────────────

export function InviteModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useDictionary("settings");
  const sendInvite = useSendInvite();
  const { data: rolesData } = useRoles();
  const { data: company } = useCompany();
  const roles = rolesData ?? [];

  const [inviteMode, setInviteMode] = useState<"email" | "sms">("email");
  const [inputValue, setInputValue] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [codeCopied, setCodeCopied] = useState(false);

  const companyCode = company?.companyCode || "";
  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  const resetForm = useCallback(() => {
    setInputValue("");
    setEntries([]);
    setSelectedRoleId("");
    setInviteMode("email");
    setCodeCopied(false);
  }, []);

  function addEntry() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

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

  function handleCopyCode() {
    navigator.clipboard.writeText(companyCode);
    setCodeCopied(true);
    toast.success(t("team.toast.codeCopied"));
    setTimeout(() => setCodeCopied(false), 2000);
  }

  function handleSend() {
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
        const count = result.invitesSent ?? 0;
        if (count === 0) {
          toast.error(t("team.toast.inviteFailed"), {
            description: t("team.toast.inviteFailedDescription"),
          });
          return;
        }
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
          {/* Company code */}
          {companyCode && (
            <div className="flex flex-col gap-0.5">
              <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                {t("team.companyCode")}
              </label>
              <div className="flex items-center gap-1">
                <div className="flex-1 flex items-center gap-1 px-1.5 py-[8px] rounded-sm border border-border bg-background-elevated">
                  <span className="font-mono text-body-sm text-text-primary tracking-wider">
                    {companyCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="p-[8px] rounded-sm border border-border bg-background-input hover:bg-background-elevated transition-colors"
                >
                  {codeCopied ? (
                    <Check className="w-[14px] h-[14px] text-status-success" />
                  ) : (
                    <Copy className="w-[14px] h-[14px] text-text-tertiary" />
                  )}
                </button>
              </div>
              <p className="font-kosugi text-[10px] text-text-disabled">
                {t("team.companyCodeHint")}
              </p>
            </div>
          )}

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
            {/* Role description */}
            {selectedRole?.description ? (
              <p className="font-kosugi text-[10px] text-text-tertiary mt-[2px]">
                {selectedRole.description}
              </p>
            ) : (
              <p className="font-kosugi text-[10px] text-text-disabled">
                {t("team.roleAssignHint")}
              </p>
            )}
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
