"use client";

import { useState } from "react";
import {
  User,
  Building2,
  CreditCard,
  SlidersHorizontal,
  Camera,
  Save,
  Upload,
  Shield,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth-store";

type SettingsTab = "profile" | "company" | "subscription" | "preferences";

const tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "company", label: "Company", icon: Building2 },
  { id: "subscription", label: "Subscription", icon: CreditCard },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
];

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.displayName || "");
  const [email] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setIsSaving(false);
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      {/* Avatar */}
      <Card>
        <CardContent className="flex items-center gap-2 p-2">
          <div className="relative">
            <div className="w-[72px] h-[72px] rounded-full bg-ops-accent-muted flex items-center justify-center overflow-hidden">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
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
            <button className="absolute bottom-0 right-0 w-[24px] h-[24px] rounded-full bg-ops-accent flex items-center justify-center hover:bg-ops-accent-hover transition-colors">
              <Camera className="w-[14px] h-[14px] text-white" />
            </button>
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
          <div className="pt-1">
            <Button onClick={handleSave} loading={isSaving} className="gap-[6px]">
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
  const [companyName, setCompanyName] = useState("Smith Contracting LLC");
  const [companyAddress, setCompanyAddress] = useState("456 Business Blvd, Springfield, IL 62701");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    setIsSaving(false);
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
              <div className="w-[56px] h-[56px] rounded-lg bg-background-elevated border border-border flex items-center justify-center">
                <Building2 className="w-[24px] h-[24px] text-text-disabled" />
              </div>
              <Button variant="secondary" size="sm" className="gap-[6px]">
                <Upload className="w-[14px] h-[14px]" />
                Upload
              </Button>
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

          {/* Default project color */}
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              Default Project Color
            </label>
            <div className="flex items-center gap-1">
              {["#417394", "#C4A868", "#9DB582", "#8195B5", "#B58289", "#7B68A6"].map((color) => (
                <button
                  key={color}
                  className="w-[32px] h-[32px] rounded border border-border hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="pt-1">
            <Button onClick={handleSave} loading={isSaving} className="gap-[6px]">
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
              <h3 className="font-mohave text-heading text-text-primary">Pro</h3>
              <p className="font-mono text-data text-ops-accent">$49/month</p>
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
            <span className="font-mono text-data text-text-primary">4 / 10</span>
          </div>
          <div className="h-[6px] bg-background-elevated rounded-full overflow-hidden">
            <div className="h-full bg-ops-accent rounded-full" style={{ width: "40%" }} />
          </div>
          <p className="font-kosugi text-[11px] text-text-tertiary mt-[6px]">
            6 seats remaining on your plan
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
            {[
              "Unlimited projects",
              "10 team seats",
              "Calendar & scheduling",
              "Client management",
              "Invoice generation",
              "Priority support",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-1">
                <Check className="w-[16px] h-[16px] text-ops-accent shrink-0" />
                <span className="font-mohave text-body-sm text-text-secondary">{feature}</span>
              </div>
            ))}
          </div>
          <Button variant="accent" className="mt-2 w-full">
            Upgrade Plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PreferencesTab() {
  const [dashboardLayout, setDashboardLayout] = useState<"default" | "compact" | "data-dense">("default");

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
          {["Task assignments", "Project updates", "Team activity", "Sync alerts"].map((item) => (
            <div key={item} className="flex items-center justify-between py-[6px]">
              <span className="font-mohave text-body text-text-secondary">{item}</span>
              <button
                className={cn(
                  "w-[40px] h-[22px] rounded-full transition-colors relative",
                  "bg-ops-accent"
                )}
              >
                <span className="absolute right-[2px] top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  return (
    <div className="space-y-3 max-w-[1000px]">
      <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">SETTINGS</h1>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex items-center gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-[6px] px-2 py-1 border-b-2 transition-all font-mohave text-body",
                activeTab === tab.id
                  ? "border-b-ops-accent text-ops-accent"
                  : "border-b-transparent text-text-tertiary hover:text-text-secondary"
              )}
            >
              <tab.icon className="w-[16px] h-[16px]" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="animate-fade-in" key={activeTab}>
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "company" && <CompanyTab />}
        {activeTab === "subscription" && <SubscriptionTab />}
        {activeTab === "preferences" && <PreferencesTab />}
      </div>
    </div>
  );
}
