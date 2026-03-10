"use client";

/**
 * Employee Setup Page — 4-step onboarding for invited employees
 *
 * Steps: Profile → Phone → Emergency Contact → Notifications
 *
 * Design system: glass surfaces, UPPERCASE titles, [bracket] captions,
 * 56dp touch targets, 8dp grid, borders-only depth, accent on primary CTA only
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ops/image-upload";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEmployeeSetupStore } from "@/stores/employee-setup-store";
import { getIdToken } from "@/lib/firebase/auth";
import { cn } from "@/lib/utils/cn";

// ─── Constants ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: "profile", label: "PROFILE" },
  { id: "phone", label: "PHONE" },
  { id: "emergency", label: "EMERGENCY" },
  { id: "notifications", label: "NOTIFICATIONS" },
] as const;

const RELATIONSHIP_OPTIONS = [
  "Spouse",
  "Parent",
  "Sibling",
  "Partner",
  "Friend",
  "Other",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function saveProgress(fields: Record<string, unknown>) {
  const token = await getIdToken();
  if (!token) return;
  await fetch("/api/employee-setup/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token, ...fields }),
  });
}

async function completeSetupRequest(): Promise<{ needsRole: boolean }> {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch("/api/employee-setup/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  if (!res.ok) throw new Error("Failed to complete setup");
  return res.json();
}

// ─── Toggle Component ───────────────────────────────────────────────────────

function OpsToggle({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "w-[44px] h-[24px] rounded-full transition-colors duration-150 relative flex-shrink-0",
        "border",
        enabled
          ? "border-[rgba(255,255,255,0.12)]"
          : "border-[rgba(255,255,255,0.08)]"
      )}
    >
      <div
        className={cn(
          "w-[18px] h-[18px] rounded-full absolute top-[2px] transition-all duration-150",
          enabled
            ? "translate-x-[21px] bg-text-primary"
            : "translate-x-[2px] bg-text-disabled"
        )}
      />
    </button>
  );
}

// ─── Relationship Dropdown ──────────────────────────────────────────────────

function RelationshipSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <label className="font-mohave text-caption-sm text-text-tertiary uppercase tracking-[0.08em] mb-1 block">
        RELATIONSHIP
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center justify-between",
          "bg-background-input text-text-primary font-mohave text-body",
          "px-2 py-1.5 rounded-sm min-h-[56px]",
          "border border-[rgba(255,255,255,0.08)]",
          "transition-all duration-150",
          "focus:border-ops-accent focus:outline-none",
          !value && "text-text-disabled"
        )}
      >
        <span>{value || "Select relationship"}</span>
        <ChevronDown
          className={cn(
            "w-5 h-5 text-text-tertiary transition-transform flex-shrink-0",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[rgba(10,10,10,0.85)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] rounded-sm overflow-hidden">
          {RELATIONSHIP_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-2 min-h-[56px] flex items-center",
                "font-mohave text-body-sm transition-colors border-b border-[rgba(255,255,255,0.04)]",
                value === r
                  ? "bg-[rgba(255,255,255,0.08)] text-text-primary"
                  : "text-text-secondary hover:bg-[rgba(255,255,255,0.04)] hover:text-text-primary"
              )}
            >
              <span className="flex-1">{r}</span>
              {value === r && <Check className="w-4 h-4 text-text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function EmployeeSetupPage() {
  const router = useRouter();
  const { currentUser, setUser } = useAuthStore();
  const store = useEmployeeSetupStore();

  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Pre-populate from auth store
  useEffect(() => {
    if (currentUser && !store.firstName) {
      store.setProfile({
        firstName: currentUser.firstName || "",
        lastName: currentUser.lastName || "",
        profileImageURL: currentUser.profileImageURL || null,
      });
      if (currentUser.phone) store.setPhone(currentUser.phone);
    }
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect if not authenticated
  useEffect(() => {
    if (!currentUser) router.push("/login");
  }, [currentUser, router]);

  // Redirect if already completed employee onboarding
  useEffect(() => {
    if (currentUser?.setupProgress?.steps?.employee_onboarding) {
      router.push("/dashboard");
    }
  }, [currentUser, router]);

  const step = STEPS[currentStep];

  async function handleNext() {
    setIsSaving(true);
    try {
      switch (step.id) {
        case "profile":
          await saveProgress({
            firstName: store.firstName,
            lastName: store.lastName,
            profileImageURL: store.profileImageURL,
          });
          break;
        case "phone":
          await saveProgress({ phone: store.phone });
          break;
        case "emergency":
          await saveProgress({
            emergencyContactName: store.emergencyContactName,
            emergencyContactPhone: store.emergencyContactPhone,
            emergencyContactRelationship: store.emergencyContactRelationship,
          });
          break;
        case "notifications":
          await completeSetupRequest();
          // Update auth store so useSetupGate sees the completed state
          // before dashboard renders — prevents redirect loop
          if (currentUser) {
            setUser({
              ...currentUser,
              firstName: store.firstName || currentUser.firstName,
              lastName: store.lastName || currentUser.lastName,
              phone: store.phone || currentUser.phone,
              setupProgress: {
                ...currentUser.setupProgress,
                steps: {
                  ...currentUser.setupProgress?.steps,
                  employee_onboarding: true,
                },
              },
            });
          }
          store.reset();
          router.push("/dashboard");
          return;
      }
      setCurrentStep((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to save step:", err);
    } finally {
      setIsSaving(false);
    }
  }

  function handleBack() {
    if (currentStep > 0) setCurrentStep((prev) => prev - 1);
  }

  function isStepValid(): boolean {
    switch (step.id) {
      case "profile":
        return !!store.firstName.trim() && !!store.lastName.trim();
      case "phone":
        return !!store.phone.trim();
      case "emergency":
        return true; // optional
      case "notifications":
        return true;
      default:
        return false;
    }
  }

  if (!currentUser) return null;

  return (
    <div className="w-full max-w-[480px] mx-auto">
      {/* Logo */}
      <h1 className="font-mohave text-display-lg text-text-primary tracking-[0.25em] uppercase mb-4">
        OPS
      </h1>

      {/* Glass surface card */}
      <div className="bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] backdrop-saturate-[1.2] border border-[rgba(255,255,255,0.08)] rounded-sm">
        {/* Progress header */}
        <div className="p-3 pb-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mohave text-caption-sm text-text-tertiary uppercase tracking-[0.08em]">
              STEP {currentStep + 1} OF {STEPS.length}
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled uppercase tracking-[0.08em]">
              {step.label}
            </span>
          </div>

          {/* Segmented progress bar */}
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 h-[2px] transition-all duration-200",
                  i <= currentStep ? "bg-text-primary" : "bg-[rgba(255,255,255,0.08)]"
                )}
              />
            ))}
          </div>
        </div>

        {/* Separator */}
        <div className="border-t border-[rgba(255,255,255,0.08)] mx-3 mt-3" />

        {/* Step content */}
        <div className="p-3 animate-fade-in" key={step.id}>
          {step.id === "profile" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary uppercase">
                YOUR PROFILE
              </h2>
              <p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5 mb-3">
                [confirm your name and add a photo]
              </p>

              <div className="mb-3">
                <ImageUpload
                  value={store.profileImageURL}
                  onChange={(url) =>
                    store.setProfile({
                      firstName: store.firstName,
                      lastName: store.lastName,
                      profileImageURL: url,
                    })
                  }
                  size="md"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="First Name"
                  placeholder="John"
                  value={store.firstName}
                  onChange={(e) =>
                    store.setProfile({
                      firstName: e.target.value,
                      lastName: store.lastName,
                      profileImageURL: store.profileImageURL,
                    })
                  }
                  autoFocus
                />
                <Input
                  label="Last Name"
                  placeholder="Smith"
                  value={store.lastName}
                  onChange={(e) =>
                    store.setProfile({
                      firstName: store.firstName,
                      lastName: e.target.value,
                      profileImageURL: store.profileImageURL,
                    })
                  }
                />
              </div>
            </>
          )}

          {step.id === "phone" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary uppercase">
                PHONE NUMBER
              </h2>
              <p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5 mb-3">
                [helps your team reach you in the field]
              </p>
              <Input
                label="Phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={store.phone}
                onChange={(e) => store.setPhone(e.target.value)}
                autoFocus
              />
            </>
          )}

          {step.id === "emergency" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary uppercase">
                EMERGENCY CONTACT
              </h2>
              <p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5 mb-3">
                [optional — recommended for field safety]
              </p>
              <div className="space-y-2">
                <Input
                  label="Contact Name"
                  placeholder="Jane Smith"
                  value={store.emergencyContactName}
                  onChange={(e) =>
                    store.setEmergencyContact({
                      name: e.target.value,
                      phone: store.emergencyContactPhone,
                      relationship: store.emergencyContactRelationship,
                    })
                  }
                  autoFocus
                />
                <Input
                  label="Contact Phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={store.emergencyContactPhone}
                  onChange={(e) =>
                    store.setEmergencyContact({
                      name: store.emergencyContactName,
                      phone: e.target.value,
                      relationship: store.emergencyContactRelationship,
                    })
                  }
                />
                <RelationshipSelect
                  value={store.emergencyContactRelationship}
                  onChange={(val) =>
                    store.setEmergencyContact({
                      name: store.emergencyContactName,
                      phone: store.emergencyContactPhone,
                      relationship: val,
                    })
                  }
                />
              </div>
            </>
          )}

          {step.id === "notifications" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary uppercase">
                NOTIFICATIONS
              </h2>
              <p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5 mb-3">
                [how you want to hear about updates]
              </p>

              <div className="space-y-0">
                {/* Push notifications row */}
                <div className="flex items-center justify-between min-h-[56px] border-b border-[rgba(255,255,255,0.08)]">
                  <div>
                    <p className="font-mohave text-body text-text-primary">
                      PUSH NOTIFICATIONS
                    </p>
                    <p className="font-kosugi text-caption-sm text-text-disabled">
                      [schedule changes, task assignments]
                    </p>
                  </div>
                  <OpsToggle
                    enabled={store.pushEnabled}
                    onToggle={() =>
                      store.setNotifications({
                        push: !store.pushEnabled,
                        email: store.emailEnabled,
                      })
                    }
                    label="Toggle push notifications"
                  />
                </div>

                {/* Email notifications row */}
                <div className="flex items-center justify-between min-h-[56px]">
                  <div>
                    <p className="font-mohave text-body text-text-primary">
                      EMAIL NOTIFICATIONS
                    </p>
                    <p className="font-kosugi text-caption-sm text-text-disabled">
                      [weekly summaries, important alerts]
                    </p>
                  </div>
                  <OpsToggle
                    enabled={store.emailEnabled}
                    onToggle={() =>
                      store.setNotifications({
                        push: store.pushEnabled,
                        email: !store.emailEnabled,
                      })
                    }
                    label="Toggle email notifications"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between p-3 pt-2 border-t border-[rgba(255,255,255,0.08)]">
          <button
            onClick={handleBack}
            disabled={currentStep === 0 || isSaving}
            className="flex items-center gap-0.5 font-mohave text-body-sm uppercase text-text-secondary hover:text-text-primary disabled:opacity-0 disabled:pointer-events-none transition-all duration-150 min-h-[56px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <button
            onClick={handleNext}
            disabled={!isStepValid() || isSaving}
            className="flex items-center gap-0.5 font-mohave text-button uppercase bg-ops-accent text-text-primary px-3 min-h-[56px] rounded-sm border border-ops-accent hover:bg-ops-accent-hover disabled:opacity-40 disabled:pointer-events-none transition-all duration-150"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : currentStep === STEPS.length - 1 ? (
              <>
                GET STARTED
                <Check className="w-4 h-4" />
              </>
            ) : (
              <>
                NEXT
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
