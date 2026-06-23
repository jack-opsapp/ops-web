"use client";

import { useState, useCallback, useEffect } from "react";
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
import { normalizePhoneE164, formatPhoneNational, InvalidPhoneError } from "@/lib/sms/phone-utils";

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
  const unassignedRoleId = roles.find((r) => r.name.toLowerCase() === "unassigned")?.id ?? "";

  const [inviteMode, setInviteMode] = useState<"email" | "sms">("email");
  const [inputValue, setInputValue] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  // Maps the national-format display string in `entries` to its E.164 value.
  // Only populated when inviteMode === "sms". The display string is what the
  // user sees in the chip; the E.164 string is what submits to the API.
  const [phonesE164, setPhonesE164] = useState<Record<string, string>>({});
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [codeCopied, setCodeCopied] = useState(false);

  const companyCode = company?.companyCode || "";
  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  // Default to "unassigned" role when roles load
  useEffect(() => {
    if (unassignedRoleId && !selectedRoleId) {
      setSelectedRoleId(unassignedRoleId);
    }
  }, [unassignedRoleId, selectedRoleId]);

  const resetForm = useCallback(() => {
    setInputValue("");
    setEntries([]);
    setPhonesE164({});
    setSelectedRoleId(unassignedRoleId);
    setInviteMode("email");
    setCodeCopied(false);
  }, [unassignedRoleId]);

  function addEntry() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    const newPhoneMap: Record<string, string> = {};

    if (inviteMode === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const p of parts) {
        if (emailRegex.test(p)) {
          if (!entries.includes(p)) valid.push(p);
        } else {
          invalid.push(p);
        }
      }
      if (invalid.length > 0) {
        toast.error(`Invalid email${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`);
      }
    } else {
      // SMS mode: normalize to E.164, display as national format in the chip
      for (const raw of parts) {
        try {
          const e164 = normalizePhoneE164(raw);
          const display = formatPhoneNational(e164);
          if (!entries.includes(display)) {
            valid.push(display);
            newPhoneMap[display] = e164;
          }
        } catch (err) {
          if (err instanceof InvalidPhoneError) {
            invalid.push(raw);
          } else {
            invalid.push(raw);
          }
        }
      }
      if (invalid.length > 0) {
        toast.error(
          invalid.length > 1
            ? `${t("team.toast.invalidPhoneMulti")}: ${invalid.join(", ")}`
            : `${t("team.toast.invalidPhone")}: ${invalid[0]}`
        );
      }
    }

    if (valid.length > 0) {
      setEntries((prev) => [...prev, ...valid]);
      if (inviteMode === "sms") {
        setPhonesE164((prev) => ({ ...prev, ...newPhoneMap }));
      }
    }
    setInputValue("");
  }

  function removeEntry(entry: string) {
    setEntries((prev) => prev.filter((e) => e !== entry));
    if (inviteMode === "sms") {
      setPhonesE164((prev) => {
        const next = { ...prev };
        delete next[entry];
        return next;
      });
    }
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
    // Flush any pending input, then re-compute the fresh list locally — we
    // can't rely on setEntries to be applied before the mutate call fires.
    const trimmed = inputValue.trim();
    if (trimmed) addEntry();

    const allDisplays = [...entries];
    const freshPhoneMap: Record<string, string> = {};

    if (trimmed) {
      const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
      for (const raw of parts) {
        if (inviteMode === "email") {
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && !allDisplays.includes(raw)) {
            allDisplays.push(raw);
          }
        } else {
          try {
            const e164 = normalizePhoneE164(raw);
            const display = formatPhoneNational(e164);
            if (!allDisplays.includes(display)) {
              allDisplays.push(display);
              freshPhoneMap[display] = e164;
            }
          } catch {
            // already toasted by addEntry
          }
        }
      }
    }

    if (allDisplays.length === 0) {
      toast.error(inviteMode === "email" ? t("team.toast.enterEmail") : t("team.toast.enterPhone"));
      return;
    }

    let data: { emails?: string[]; phones?: string[]; roleId?: string };

    if (inviteMode === "email") {
      data = { emails: allDisplays, roleId: selectedRoleId || undefined };
    } else {
      // Resolve E.164 for each display chip. Preference order:
      //   1. phonesE164 state (populated by addEntry)
      //   2. freshPhoneMap (populated just above for unflushed input)
      //   3. re-normalize on the fly as a last resort
      const e164List: string[] = [];
      for (const display of allDisplays) {
        const mapped = phonesE164[display] ?? freshPhoneMap[display];
        if (mapped) {
          e164List.push(mapped);
        } else {
          try {
            e164List.push(normalizePhoneE164(display));
          } catch {
            // already surfaced as a toast earlier
          }
        }
      }
      data = { phones: e164List, roleId: selectedRoleId || undefined };
    }

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
              <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
                {t("team.companyCode")}
              </label>
              <div className="flex items-center gap-1">
                <div className="flex-1 flex items-center gap-1 px-1.5 py-[8px] rounded-sm border border-border bg-fill-neutral-dim">
                  <span className="font-mono text-body-sm text-text tracking-wider">
                    {companyCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="p-[8px] rounded-sm border border-border bg-surface-input hover:bg-fill-neutral-dim transition-colors"
                >
                  {codeCopied ? (
                    <Check className="w-[14px] h-[14px] text-status-success" />
                  ) : (
                    <Copy className="w-[14px] h-[14px] text-text-3" />
                  )}
                </button>
              </div>
              <p className="font-mono text-micro text-text-mute">
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
                    ? "bg-[rgba(255,255,255,0.08)] text-text border-[rgba(255,255,255,0.18)]"
                    : "bg-surface-input border-border text-text-3 hover:text-text-2"
                )}
              >
                <mode.icon className="w-[14px] h-[14px]" />
                {mode.label}
              </button>
            ))}
          </div>

          {/* Multi-entry input with chips */}
          <div>
            <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest mb-0.5 block">
              {inviteMode === "email" ? t("team.emailAddress") : t("team.phoneNumber")}
            </label>
            <div
              className={cn(
                "flex flex-wrap items-center gap-[6px] p-1 rounded-sm border bg-surface-input min-h-[40px]",
                "border-border focus-within:border-[rgba(255,255,255,0.20)] transition-colors"
              )}
            >
              {entries.map((entry) => (
                <span
                  key={entry}
                  className="inline-flex items-center gap-[6px] px-2 py-[3px] rounded-bar border border-white/15 bg-white/[0.02] font-mohave text-[12px] text-white/15"
                >
                  {entry}
                  <button
                    onClick={() => removeEntry(entry)}
                    className="hover:text-text transition-colors"
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
                className="flex-1 min-w-[120px] bg-transparent outline-none font-mohave text-body-sm text-text placeholder:text-text-mute"
              />
            </div>
            <p className="font-mono text-micro text-text-mute mt-[4px]">
              {t("team.multiInviteHint")}
            </p>
          </div>

          {/* RBAC Role picker */}
          <div className="flex flex-col gap-0.5">
            <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
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
                      ? "bg-[rgba(255,255,255,0.08)] text-text border-[rgba(255,255,255,0.18)]"
                      : "bg-surface-input border-border text-text-3 hover:text-text-2"
                  )}
                >
                  {role.name}
                </button>
              ))}
            </div>
            {/* Role description */}
            {selectedRole?.description ? (
              <p className="font-mono text-micro text-text-3 mt-[2px]">
                {selectedRole.description}
              </p>
            ) : (
              <p className="font-mono text-micro text-text-mute">
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
              <span className="bg-[rgba(255,255,255,0.15)] px-[6px] py-[1px] rounded-full text-micro">
                {entries.length}
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
