"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Phone,
  Heart,
  Bell,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ops/image-upload";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEmployeeSetupStore } from "@/stores/employee-setup-store";
import { getIdToken } from "@/lib/firebase/auth";
import { cn } from "@/lib/utils/cn";

// ─── Constants ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "phone", label: "Phone", icon: Phone },
  { id: "emergency", label: "Emergency Contact", icon: Heart },
  { id: "notifications", label: "Notifications", icon: Bell },
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

async function completeSetup(): Promise<{ needsRole: boolean }> {
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

// ─── Page ───────────────────────────────────────────────────────────────────

export default function EmployeeSetupPage() {
  const router = useRouter();
  const { currentUser } = useAuthStore();
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
          await completeSetup();
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
    <div className="w-full max-w-[480px] space-y-6">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-kosugi text-[11px] text-text-disabled uppercase tracking-wider">
            Step {currentStep + 1} of {STEPS.length}
          </span>
          <span className="font-kosugi text-[11px] text-text-tertiary">
            {step.label}
          </span>
        </div>
        <div className="h-[3px] bg-background-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-ops-accent rounded-full transition-all duration-500"
            style={{
              width: `${((currentStep + 1) / STEPS.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Step icons */}
      <div className="flex items-center justify-center gap-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone = i < currentStep;
          const isActive = i === currentStep;
          return (
            <div
              key={s.id}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                isDone && "bg-ops-accent/20",
                isActive && "bg-ops-accent-muted border-2 border-ops-accent",
                !isDone && !isActive && "bg-background-elevated"
              )}
            >
              {isDone ? (
                <Check className="w-4 h-4 text-ops-accent" />
              ) : (
                <Icon
                  className={cn(
                    "w-4 h-4",
                    isActive ? "text-ops-accent" : "text-text-disabled"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div
        className="bg-background-card border border-border rounded-lg p-6 space-y-4 animate-slide-up"
        key={step.id}
      >
        {step.id === "profile" && (
          <>
            <h2 className="font-mohave text-heading text-text-primary">
              Your Profile
            </h2>
            <p className="font-kosugi text-body-sm text-text-secondary">
              Set up your profile photo and confirm your name.
            </p>
            <div className="flex justify-center">
              <ImageUpload
                value={store.profileImageURL}
                onChange={(url) =>
                  store.setProfile({
                    firstName: store.firstName,
                    lastName: store.lastName,
                    profileImageURL: url,
                  })
                }
                size="lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="First Name"
                value={store.firstName}
                onChange={(e) =>
                  store.setProfile({
                    firstName: e.target.value,
                    lastName: store.lastName,
                    profileImageURL: store.profileImageURL,
                  })
                }
                prefixIcon={<User className="w-4 h-4" />}
              />
              <Input
                placeholder="Last Name"
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
            <h2 className="font-mohave text-heading text-text-primary">
              Phone Number
            </h2>
            <p className="font-kosugi text-body-sm text-text-secondary">
              Your phone number helps your team reach you in the field.
            </p>
            <Input
              type="tel"
              placeholder="(555) 123-4567"
              value={store.phone}
              onChange={(e) => store.setPhone(e.target.value)}
              prefixIcon={<Phone className="w-4 h-4" />}
            />
          </>
        )}

        {step.id === "emergency" && (
          <>
            <h2 className="font-mohave text-heading text-text-primary">
              Emergency Contact
            </h2>
            <p className="font-kosugi text-body-sm text-text-secondary">
              Optional but recommended for field safety.
            </p>
            <Input
              placeholder="Contact Name"
              value={store.emergencyContactName}
              onChange={(e) =>
                store.setEmergencyContact({
                  name: e.target.value,
                  phone: store.emergencyContactPhone,
                  relationship: store.emergencyContactRelationship,
                })
              }
              prefixIcon={<User className="w-4 h-4" />}
            />
            <Input
              type="tel"
              placeholder="Contact Phone"
              value={store.emergencyContactPhone}
              onChange={(e) =>
                store.setEmergencyContact({
                  name: store.emergencyContactName,
                  phone: e.target.value,
                  relationship: store.emergencyContactRelationship,
                })
              }
              prefixIcon={<Phone className="w-4 h-4" />}
            />
            <select
              value={store.emergencyContactRelationship}
              onChange={(e) =>
                store.setEmergencyContact({
                  name: store.emergencyContactName,
                  phone: store.emergencyContactPhone,
                  relationship: e.target.value,
                })
              }
              className="w-full bg-background-input border border-border rounded-lg px-3 py-2 font-kosugi text-body-sm text-text-primary focus:border-ops-accent focus:outline-none"
            >
              <option value="" className="text-text-disabled">
                Relationship
              </option>
              {RELATIONSHIP_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </>
        )}

        {step.id === "notifications" && (
          <>
            <h2 className="font-mohave text-heading text-text-primary">
              Notifications
            </h2>
            <p className="font-kosugi text-body-sm text-text-secondary">
              Choose how you'd like to be notified about schedule changes and
              updates.
            </p>
            <div className="space-y-3">
              <label className="flex items-center justify-between py-2 cursor-pointer">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-text-secondary" />
                  <div>
                    <p className="font-mohave text-body text-text-primary">
                      Push Notifications
                    </p>
                    <p className="font-kosugi text-[11px] text-text-disabled">
                      Schedule changes, task assignments
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    store.setNotifications({
                      push: !store.pushEnabled,
                      email: store.emailEnabled,
                    })
                  }
                  className={cn(
                    "w-11 h-6 rounded-full transition-colors relative",
                    store.pushEnabled
                      ? "bg-ops-accent"
                      : "bg-background-elevated"
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform",
                      store.pushEnabled
                        ? "translate-x-[22px]"
                        : "translate-x-0.5"
                    )}
                  />
                </button>
              </label>

              <label className="flex items-center justify-between py-2 cursor-pointer">
                <div className="flex items-center gap-3">
                  <svg
                    className="w-5 h-5 text-text-secondary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <div>
                    <p className="font-mohave text-body text-text-primary">
                      Email Notifications
                    </p>
                    <p className="font-kosugi text-[11px] text-text-disabled">
                      Weekly summaries, important alerts
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    store.setNotifications({
                      push: store.pushEnabled,
                      email: !store.emailEnabled,
                    })
                  }
                  className={cn(
                    "w-11 h-6 rounded-full transition-colors relative",
                    store.emailEnabled
                      ? "bg-ops-accent"
                      : "bg-background-elevated"
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform",
                      store.emailEnabled
                        ? "translate-x-[22px]"
                        : "translate-x-0.5"
                    )}
                  />
                </button>
              </label>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={currentStep === 0 || isSaving}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        <Button
          variant="primary"
          onClick={handleNext}
          disabled={!isStepValid() || isSaving}
          className="gap-2"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : currentStep === STEPS.length - 1 ? (
            <>
              Get Started
              <Check className="w-4 h-4" />
            </>
          ) : (
            <>
              Next
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
