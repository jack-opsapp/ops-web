"use client";

import { useState, useEffect, useRef } from "react";
import {
  User,
  Building2,
  CreditCard,
  SlidersHorizontal,
  Keyboard,
  Camera,
  Save,
  Upload,
  Shield,
  Check,
  Loader2,
  Mail,
  Copy,
  ExternalLink,
  Inbox,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useCurrentUser,
  useUpdateUser,
  useCompany,
  useUpdateCompany,
  useImageUpload,
} from "@/lib/hooks";
import {
  getUserFullName,
  SUBSCRIPTION_PLAN_INFO,
  getDaysRemainingInTrial,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/lib/types/models";
import { toast } from "sonner";

type SettingsTab = "profile" | "company" | "subscription" | "integrations" | "preferences" | "shortcuts";

const tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "company", label: "Company", icon: Building2 },
  { id: "subscription", label: "Subscription", icon: CreditCard },
  { id: "integrations", label: "Integrations", icon: Mail },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
];

function ProfileTab() {
  const { currentUser } = useAuthStore();
  const { data: freshUser, isLoading: isUserLoading } = useCurrentUser();
  const updateUser = useUpdateUser();

  // Use fresh query data if available, fall back to auth store
  const user = freshUser ?? currentUser;

  const imageUpload = useImageUpload({
    onSuccess: (url) => {
      if (user) {
        updateUser.mutate(
          { id: user.id, data: { profileImageURL: url } },
          { onSuccess: () => toast.success("Profile photo updated") }
        );
      }
    },
    onError: () => toast.error("Failed to upload photo"),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Sync form state when user data loads
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
          toast.success("Profile updated successfully");
        },
        onError: (error) => {
          toast.error("Failed to update profile", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        },
      }
    );
  }

  if (isUserLoading && !user) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      {/* Avatar */}
      <Card>
        <CardContent className="flex items-center gap-2 p-2">
          <div className="relative">
            <div className="w-[72px] h-[72px] rounded-full bg-ops-accent-muted flex items-center justify-center overflow-hidden">
              {user?.profileImageURL ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={user.profileImageURL}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="font-mohave text-display text-ops-accent">
                  {name?.charAt(0)?.toUpperCase() || "U"}
                </span>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-0 right-0 w-[24px] h-[24px] rounded-full bg-ops-accent flex items-center justify-center hover:bg-ops-accent-hover transition-colors"
            >
              <Camera className="w-[14px] h-[14px] text-white" />
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
            <h3 className="font-mohave text-card-title text-text-primary">{name || "Your Name"}</h3>
            <p className="font-mono text-data-sm text-text-tertiary">{email}</p>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            label="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
          <Input
            label="Email"
            value={email}
            disabled
            helperText="Email cannot be changed"
          />
          <Input
            label="Phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
          />
          <Input
            label="Role"
            value={useAuthStore.getState().role}
            disabled
            helperText="Role is managed by your company admin"
          />
          <div className="pt-1">
            <Button onClick={handleSave} loading={updateUser.isPending} className="gap-[6px]">
              <Save className="w-[16px] h-[16px]" />
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CompanyTab() {
  const { data: company, isLoading: isCompanyLoading } = useCompany();
  const updateCompany = useUpdateCompany();

  const logoUpload = useImageUpload({
    onSuccess: (url) => {
      if (company) {
        updateCompany.mutate(
          { id: company.id, data: { logoURL: url } },
          { onSuccess: () => toast.success("Company logo updated") }
        );
      }
    },
    onError: () => toast.error("Failed to upload logo"),
  });
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [openHour, setOpenHour] = useState("");
  const [closeHour, setCloseHour] = useState("");

  // Sync form state when company data loads
  useEffect(() => {
    if (company) {
      setCompanyName(company.name ?? "");
      setCompanyAddress(company.address ?? "");
      setCompanyPhone(company.phone ?? "");
      setCompanyEmail(company.email ?? "");
      setCompanyWebsite(company.website ?? "");
      setCompanyDescription(company.companyDescription ?? "");
      setOpenHour(company.openHour ?? "");
      setCloseHour(company.closeHour ?? "");
    }
  }, [company]);

  async function handleSave() {
    if (!company) return;

    updateCompany.mutate(
      {
        id: company.id,
        data: {
          name: companyName.trim(),
          address: companyAddress.trim() || null,
          phone: companyPhone.trim() || null,
          email: companyEmail.trim() || null,
          website: companyWebsite.trim() || null,
          companyDescription: companyDescription.trim() || null,
          openHour: openHour.trim() || null,
          closeHour: closeHour.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Company details updated successfully");
        },
        onError: (error) => {
          toast.error("Failed to update company", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        },
      }
    );
  }

  if (isCompanyLoading && !company) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Company Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Company logo */}
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              Company Logo
            </label>
            <div className="flex items-center gap-1.5">
              <div className="w-[56px] h-[56px] rounded-lg bg-background-elevated border border-border flex items-center justify-center overflow-hidden">
                {company?.logoURL ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={company.logoURL}
                    alt="Company logo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 className="w-[24px] h-[24px] text-text-disabled" />
                )}
              </div>
              <Button variant="secondary" size="sm" className="gap-[6px]" onClick={() => logoInputRef.current?.click()}>
                <Upload className="w-[14px] h-[14px]" />
                Upload
              </Button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) logoUpload.selectFile(file);
                }}
              />
            </div>
          </div>

          <Input
            label="Company Name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <Input
            label="Company Address"
            value={companyAddress}
            onChange={(e) => setCompanyAddress(e.target.value)}
          />
          <Input
            label="Company Phone"
            type="tel"
            value={companyPhone}
            onChange={(e) => setCompanyPhone(e.target.value)}
            placeholder="(555) 123-4567"
          />
          <Input
            label="Company Email"
            type="email"
            value={companyEmail}
            onChange={(e) => setCompanyEmail(e.target.value)}
            placeholder="info@company.com"
          />
          <Input
            label="Website"
            type="url"
            value={companyWebsite}
            onChange={(e) => setCompanyWebsite(e.target.value)}
            placeholder="https://company.com"
          />
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              Company Description
            </label>
            <Textarea
              value={companyDescription}
              onChange={(e) => setCompanyDescription(e.target.value)}
              placeholder="Brief description of your company..."
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              Business Hours
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                value={openHour}
                onChange={(e) => setOpenHour(e.target.value)}
                placeholder="8:00 AM"
                className="flex-1"
              />
              <span className="font-mohave text-body text-text-tertiary shrink-0">to</span>
              <Input
                value={closeHour}
                onChange={(e) => setCloseHour(e.target.value)}
                placeholder="5:00 PM"
                className="flex-1"
              />
            </div>
          </div>

          <div className="pt-1">
            <Button onClick={handleSave} loading={updateCompany.isPending} className="gap-[6px]">
              <Save className="w-[16px] h-[16px]" />
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SubscriptionTab() {
  const { data: company, isLoading: isCompanyLoading } = useCompany();

  if (isCompanyLoading && !company) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
      </div>
    );
  }

  const plan = company?.subscriptionPlan ?? SubscriptionPlan.Trial;
  const planInfo = SUBSCRIPTION_PLAN_INFO[plan];
  const seatedCount = company?.seatedEmployeeIds?.length ?? 0;
  const maxSeats = company?.maxSeats ?? planInfo.maxSeats;
  const seatPercentage = maxSeats > 0 ? Math.min(100, Math.round((seatedCount / maxSeats) * 100)) : 0;
  const seatsRemaining = Math.max(0, maxSeats - seatedCount);

  const isTrial = company?.subscriptionStatus === SubscriptionStatus.Trial || plan === SubscriptionPlan.Trial;
  const trialDaysRemaining = company ? getDaysRemainingInTrial(company) : 0;

  // Build features list from plan info
  const features = [
    "Unlimited projects",
    `${maxSeats} team seat${maxSeats !== 1 ? "s" : ""}`,
    "Calendar & scheduling",
    "Client management",
    ...(plan === SubscriptionPlan.Team || plan === SubscriptionPlan.Business
      ? ["Priority support"]
      : []),
    ...(plan === SubscriptionPlan.Business ? ["API access"] : []),
  ];

  const priceDisplay = planInfo.monthlyPrice === 0
    ? "Free"
    : `$${planInfo.monthlyPrice}/month`;

  return (
    <div className="space-y-3 max-w-[600px]">
      {/* Current Plan */}
      <Card variant="accent">
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                Current Plan
              </span>
              <h3 className="font-mohave text-heading text-text-primary">{planInfo.displayName}</h3>
              <p className="font-mono text-data text-ops-accent">{priceDisplay}</p>
              {isTrial && trialDaysRemaining > 0 && (
                <p className="font-kosugi text-[11px] text-ops-amber mt-[4px]">
                  {trialDaysRemaining} day{trialDaysRemaining !== 1 ? "s" : ""} remaining in trial
                </p>
              )}
            </div>
            <div className="w-[48px] h-[48px] rounded-lg bg-ops-accent-muted flex items-center justify-center">
              <Shield className="w-[24px] h-[24px] text-ops-accent" />
            </div>
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
            <span className="font-mohave text-body text-text-secondary">Active Members</span>
            <span className="font-mono text-data text-text-primary">{seatedCount} / {maxSeats}</span>
          </div>
          <div className="h-[6px] bg-background-elevated rounded-full overflow-hidden">
            <div className="h-full bg-ops-accent rounded-full" style={{ width: `${seatPercentage}%` }} />
          </div>
          <p className="font-kosugi text-[11px] text-text-tertiary mt-[6px]">
            {seatsRemaining} seat{seatsRemaining !== 1 ? "s" : ""} remaining on your plan
          </p>
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Plan Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-[8px]">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-1">
                <Check className="w-[16px] h-[16px] text-ops-accent shrink-0" />
                <span className="font-mohave text-body-sm text-text-secondary">{feature}</span>
              </div>
            ))}
          </div>
          <Button variant="accent" className="mt-2 w-full" onClick={() => toast.info("Contact support to upgrade your plan", { description: "Email support@opsapp.co for subscription changes." })}>
            Upgrade Plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PreferencesTab() {
  const [dashboardLayout, setDashboardLayout] = useState<"default" | "compact" | "data-dense">("default");
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, boolean>>({
    "Task assignments": true,
    "Project updates": true,
    "Team activity": true,
    "Sync alerts": false,
  });

  const layouts = [
    { id: "default" as const, label: "Default", description: "Balanced overview with cards" },
    { id: "compact" as const, label: "Compact", description: "More items, less detail" },
    { id: "data-dense" as const, label: "Data Dense", description: "Maximum information density" },
  ];

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard Layout</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {layouts.map((layout) => (
              <button
                key={layout.id}
                onClick={() => setDashboardLayout(layout.id)}
                className={cn(
                  "w-full flex items-center justify-between px-1.5 py-1 rounded border transition-all",
                  dashboardLayout === layout.id
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-background-input border-border hover:border-border-medium"
                )}
              >
                <div>
                  <p className="font-mohave text-body text-text-primary text-left">{layout.label}</p>
                  <p className="font-kosugi text-[11px] text-text-tertiary">{layout.description}</p>
                </div>
                {dashboardLayout === layout.id && (
                  <div className="w-[20px] h-[20px] rounded-full bg-ops-accent flex items-center justify-center">
                    <Check className="w-[12px] h-[12px] text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {Object.entries(notificationPrefs).map(([item, enabled]) => (
            <div key={item} className="flex items-center justify-between py-[6px]">
              <span className="font-mohave text-body text-text-secondary">{item}</span>
              <button
                onClick={() => {
                  const newValue = !enabled;
                  setNotificationPrefs((prev) => ({ ...prev, [item]: newValue }));
                  toast.success(`${item} notifications ${newValue ? "enabled" : "disabled"}`);
                }}
                className={cn(
                  "w-[40px] h-[22px] rounded-full transition-colors relative",
                  enabled ? "bg-ops-accent" : "bg-background-elevated"
                )}
              >
                <span
                  className={cn(
                    "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                    enabled ? "right-[2px]" : "left-[2px]"
                  )}
                />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const shortcutGroups = [
  {
    category: "Navigation",
    shortcuts: [
      { keys: ["1"], description: "Dashboard" },
      { keys: ["2"], description: "Projects" },
      { keys: ["3"], description: "Calendar" },
      { keys: ["4"], description: "Clients" },
      { keys: ["5"], description: "Job Board" },
      { keys: ["6"], description: "Team" },
      { keys: ["7"], description: "Map" },
      { keys: ["8"], description: "Pipeline" },
      { keys: ["9"], description: "Invoices" },
      { keys: ["⌘", "K"], description: "Open command palette" },
    ],
  },
  {
    category: "Actions",
    shortcuts: [
      { keys: ["⌘", "⇧", "P"], description: "New project" },
      { keys: ["⌘", "⇧", "C"], description: "New client" },
    ],
  },
  {
    category: "Interface",
    shortcuts: [
      { keys: ["⌘", "B"], description: "Toggle sidebar" },
    ],
  },
];

function ShortcutsTab() {
  return (
    <div className="space-y-3 max-w-[600px]">
      {shortcutGroups.map((group) => (
        <Card key={group.category}>
          <CardHeader>
            <CardTitle>{group.category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            {group.shortcuts.map((shortcut) => (
              <div
                key={shortcut.description}
                className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
              >
                <span className="font-mohave text-body text-text-secondary">
                  {shortcut.description}
                </span>
                <div className="flex items-center gap-[4px]">
                  {shortcut.keys.map((key, i) => (
                    <kbd
                      key={i}
                      className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-[6px] rounded bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] font-mono text-[11px] text-text-tertiary"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="font-kosugi text-[11px] text-text-disabled">
        On Windows/Linux, use Ctrl instead of ⌘
      </p>
    </div>
  );
}

function IntegrationsTab() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const [gmailConnected, setGmailConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check URL params for connection status (after OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "integrations" && params.get("status") === "connected") {
      setGmailConnected(true);
      toast.success("Gmail connected successfully");
      // Clean up URL params
      window.history.replaceState({}, "", "/settings?tab=integrations");
    }
  }, []);

  const forwardingAddress = companyId
    ? `leads-${companyId.slice(0, 8)}@inbound.opsapp.co`
    : "";

  function handleConnectGmail() {
    window.location.href = `/api/integrations/gmail?companyId=${companyId}`;
  }

  function handleCopyForwardingAddress() {
    navigator.clipboard.writeText(forwardingAddress).then(() => {
      setCopied(true);
      toast.success("Forwarding address copied");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      {/* Gmail Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Gmail Integration</CardTitle>
            {gmailConnected && (
              <span className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-kosugi text-[10px] uppercase tracking-wider bg-[rgba(107,143,113,0.15)] text-[#6B8F71]">
                <Check className="w-[12px] h-[12px]" />
                Connected
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Connect your Gmail account to automatically import leads from incoming emails.
          </p>
          {gmailConnected ? (
            <div className="flex items-center gap-1.5 px-1.5 py-1 bg-[rgba(107,143,113,0.08)] border border-[rgba(107,143,113,0.2)] rounded">
              <Mail className="w-[16px] h-[16px] text-[#6B8F71]" />
              <span className="font-mono text-data-sm text-[#6B8F71]">Gmail account connected</span>
            </div>
          ) : (
            <Button onClick={handleConnectGmail} className="gap-[6px]">
              <ExternalLink className="w-[14px] h-[14px]" />
              Connect Gmail
            </Button>
          )}
          <p className="font-kosugi text-[11px] text-text-disabled">
            Requires a Google Workspace or Gmail account. Only reads incoming emails.
          </p>
        </CardContent>
      </Card>

      {/* Email Forwarding */}
      <Card>
        <CardHeader>
          <CardTitle>Email Forwarding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Forward emails to your unique OPS address to automatically create leads in your pipeline.
          </p>
          <div className="flex items-center gap-1">
            <div className="flex-1 bg-background-input border border-border rounded px-1.5 py-[8px]">
              <div className="flex items-center gap-[6px]">
                <Inbox className="w-[14px] h-[14px] text-text-disabled shrink-0" />
                <span className="font-mono text-data-sm text-ops-accent truncate">
                  {forwardingAddress || "Loading..."}
                </span>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="gap-[4px] shrink-0"
              onClick={handleCopyForwardingAddress}
              disabled={!forwardingAddress}
            >
              <Copy className="w-[14px] h-[14px]" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled">
            Set this as a forwarding address in your email client to auto-create RFQ leads.
          </p>
        </CardContent>
      </Card>

      {/* Follow-ups (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Follow-up Monitoring</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1.5 py-2">
            <MessageCircle className="w-[24px] h-[24px] text-text-disabled" />
            <div>
              <p className="font-mohave text-body text-text-secondary">Coming Soon</p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                Automatically track email threads with leads and get reminded about follow-ups.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Read tab from URL params (e.g., /settings?tab=integrations)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as SettingsTab | null;
    if (tab && tabs.some((t) => t.id === tab)) {
      setActiveTab(tab);
    }
  }, []);

  return (
    <div className="space-y-3 max-w-[1000px]">
      {/* Title handled by top-bar */}

      {/* Tabs */}
      <div className="border-b border-[rgba(255,255,255,0.15)]">
        <SegmentedPicker
          options={tabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Tab Content */}
      <div className="animate-fade-in" key={activeTab}>
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "company" && <CompanyTab />}
        {activeTab === "subscription" && <SubscriptionTab />}
        {activeTab === "integrations" && <IntegrationsTab />}
        {activeTab === "preferences" && <PreferencesTab />}
        {activeTab === "shortcuts" && <ShortcutsTab />}
      </div>
    </div>
  );
}
