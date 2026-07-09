"use client";

import { useState, useEffect, useRef } from "react";
import { Camera, Save, Loader2, Lock, ShieldCheck, Eye, EyeOff, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCurrentUser, useUpdateUser, useImageUpload } from "@/lib/hooks";
import { getUserFullName } from "@/lib/types/models";
import { isEmailPasswordUser, getAuthProvider, changePassword } from "@/lib/firebase/auth";
import { useResetPassword } from "@/lib/hooks/use-users";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Section header (// TITLE) — canonical settings/register grammar
// ---------------------------------------------------------------------------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Password input with toggle visibility
// ---------------------------------------------------------------------------
function PasswordInput({
  label,
  value,
  onChange,
  placeholder,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      label={label}
      type={visible ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      suffixIcon={
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="text-text-mute hover:text-text-3 transition-colors cursor-pointer"
        >
          {visible ? <EyeOff className="w-[14px] h-[14px]" /> : <Eye className="w-[14px] h-[14px]" />}
        </button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Change Password Section — only shown for email/password auth users
// ---------------------------------------------------------------------------
function ChangePasswordSection() {
  const { t } = useDictionary("settings");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEmailUser, setIsEmailUser] = useState<boolean | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);

  // Detect auth provider on mount
  useEffect(() => {
    setIsEmailUser(isEmailPasswordUser());
    const provider = getAuthProvider();
    if (provider === "google.com") setProviderName("Google");
    else if (provider === "apple.com") setProviderName("Apple");
    else if (provider && provider !== "password") setProviderName(provider);
  }, []);

  // Don't render anything until we know the provider
  if (isEmailUser === null) return null;

  // SSO users see a notice instead of the password form
  if (!isEmailUser) {
    return (
      <Card>
        <CardContent className="p-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-[18px] h-[18px] text-text-mute shrink-0" />
            <p className="font-mohave text-body-sm text-text-3">
              {t("password.ssoNotice").replace("{provider}", providerName ?? "SSO")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function handleChangePassword() {
    // Validate
    if (newPassword.length < 6) {
      toast.error(t("password.toast.tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("password.toast.mismatch"));
      return;
    }

    setIsUpdating(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success(t("password.toast.updated"));
      // Clear fields on success
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        toast.error(t("password.toast.wrongCurrent"));
      } else if (code === "auth/too-many-requests") {
        toast.error(t("password.toast.tooManyAttempts"));
      } else {
        toast.error(t("password.toast.updateFailed"), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-0.5 pb-2">
        <div className="flex items-center gap-[6px]">
          <Lock className="w-[16px] h-[16px] text-text-2" />
          <SectionTitle>{t("password.title")}</SectionTitle>
        </div>
        <CardDescription>{t("password.description")}</CardDescription>
      </div>
      <CardContent className="space-y-2 p-2 pt-0">
        <PasswordInput
          label={t("password.currentPassword")}
          value={currentPassword}
          onChange={setCurrentPassword}
          placeholder={t("password.currentPasswordPlaceholder")}
          disabled={isUpdating}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <PasswordInput
            label={t("password.newPassword")}
            value={newPassword}
            onChange={setNewPassword}
            placeholder={t("password.newPasswordPlaceholder")}
            disabled={isUpdating}
          />
          <PasswordInput
            label={t("password.confirmPassword")}
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder={t("password.confirmPasswordPlaceholder")}
            disabled={isUpdating}
          />
        </div>
        <div className="pt-1">
          <Button
            onClick={handleChangePassword}
            loading={isUpdating}
            disabled={!currentPassword || !newPassword || !confirmPassword}
            className="gap-[6px]"
          >
            {!isUpdating && <Lock className="w-[16px] h-[16px]" />}
            {t("password.update")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfileTab() {
  const { t } = useDictionary("settings");
  const { currentUser } = useAuthStore();
  const { data: freshUser, isLoading: isUserLoading } = useCurrentUser();
  const updateUser = useUpdateUser();

  const user = freshUser ?? currentUser;

  const imageUpload = useImageUpload({
    onSuccess: (url) => {
      if (user) {
        updateUser.mutate(
          { id: user.id, data: { profileImageURL: url } },
          { onSuccess: () => toast.success(t("profile.toast.photoUpdated")) }
        );
      }
    },
    onError: () => toast.error(t("profile.toast.photoFailed")),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (user) {
      setName(getUserFullName(user));
      setEmail(user.email ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user]);

  async function handleSave() {
    if (!user) return;

    const trimmedName = name.trim();
    const parts = trimmedName.split(/\s+/);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";

    updateUser.mutate(
      {
        id: user.id,
        data: {
          firstName,
          lastName,
          phone: phone.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t("profile.toast.updated"));
        },
        onError: (error) => {
          toast.error(t("profile.toast.updateFailed"), {
            description: error instanceof Error ? error.message : t("profile.toast.tryAgain"),
          });
        },
      }
    );
  }

  if (isUserLoading && !user) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-text-2 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <Card>
        <CardContent className="space-y-2 p-2">
          {/* Avatar + Name row */}
          <div className="flex items-center gap-2 pb-1 border-b border-[rgba(255,255,255,0.04)]">
            <div className="relative">
              <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center overflow-hidden border-2 border-[rgba(255,255,255,0.18)]">
                {user?.profileImageURL ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={user.profileImageURL}
                    alt=""
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="font-mohave text-display text-text-2">
                    {name?.charAt(0)?.toUpperCase() || "U"}
                  </span>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 w-[24px] h-[24px] rounded bg-[rgba(255,255,255,0.18)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.25)] transition-colors"
              >
                <Camera className="w-[14px] h-[14px] text-text" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) imageUpload.selectFile(file);
                }}
              />
            </div>
            <div>
              <h3 className="font-mohave text-card-title text-text">{name || t("profile.defaultName")}</h3>
              <p className="font-mono text-data-sm text-text-3">{email}</p>
            </div>
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <Input
              label={t("profile.fullName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("profile.namePlaceholder")}
            />
            <Input
              label={t("profile.email")}
              value={email}
              disabled
              helperText={t("profile.emailHelper")}
            />
            <Input
              label={t("profile.phone")}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("profile.phonePlaceholder")}
            />
            <Input
              label={t("profile.role")}
              value={useAuthStore.getState().role}
              disabled
              helperText={t("profile.roleHelper")}
            />
          </div>
          <div className="pt-1">
            <Button onClick={handleSave} loading={updateUser.isPending} className="gap-[6px]">
              <Save className="w-[16px] h-[16px]" />
              {t("profile.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password — only for email/password users */}
      <ChangePasswordSection />

      {/* Reset Password via Email — only for email/password users */}
      <ResetPasswordSection userEmail={user?.email ?? null} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reset Password via Email — sends a Firebase password reset link
// ---------------------------------------------------------------------------
function ResetPasswordSection({ userEmail }: { userEmail: string | null }) {
  const { t } = useDictionary("settings");
  const [isEmailUser, setIsEmailUser] = useState<boolean | null>(null);
  const resetPassword = useResetPassword();
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setIsEmailUser(isEmailPasswordUser());
  }, []);

  if (!isEmailUser || !userEmail) return null;

  async function handleReset() {
    if (!userEmail) return;
    try {
      await resetPassword.mutateAsync(userEmail);
      setSent(true);
      toast.success(t("password.reset.sent"));
    } catch {
      // Always show success to prevent email enumeration
      setSent(true);
      toast.success(t("password.reset.sent"));
    }
  }

  return (
    <Card>
      <CardContent className="p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-mohave text-body-sm text-text-2">
              {t("password.reset.title")}
            </p>
            <p className="font-mohave text-body-sm text-text-mute mt-0.5">
              {t("password.reset.description")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            loading={resetPassword.isPending}
            disabled={sent}
            className="gap-[6px] shrink-0"
          >
            {!resetPassword.isPending && <Mail className="w-[14px] h-[14px]" />}
            {sent ? t("password.reset.sentButton") : t("password.reset.send")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
