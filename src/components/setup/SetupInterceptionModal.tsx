"use client";

/**
 * SetupInterceptionModal
 *
 * When a user tries to create a project/estimate/invoice/etc. but hasn't
 * completed their profile, this modal intercepts and collects the missing
 * identity and/or company data before allowing the action to proceed.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { getAuth } from "firebase/auth";
import { Loader2 } from "lucide-react";
import {
  trackInterceptionShown,
  trackInterceptionStepCompleted,
  trackInterceptionCompleted,
  trackInterceptionDismissed,
} from "@/lib/analytics/analytics";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IdentityStep1, IdentityStep2 } from "./SetupIdentityStep";
import { useAuthStore } from "@/lib/store/auth-store";

// ─── Props ──────────────────────────────────────────────────────────────────

interface SetupInterceptionModalProps {
  isOpen: boolean;
  onComplete: () => void;
  onDismiss: () => void;
  missingSteps: ("identity" | "company")[];
  triggerAction: string; // e.g. "projects", "estimates", "invoices"
}

// ─── Auth helper ────────────────────────────────────────────────────────────

const getAuthToken = async (): Promise<string | null> => {
  const auth = getAuth();
  const user = auth.currentUser;
  return user ? await user.getIdToken() : null;
};

// ─── Component ──────────────────────────────────────────────────────────────

export function SetupInterceptionModal({
  isOpen,
  onComplete,
  onDismiss,
  missingSteps,
  triggerAction,
}: SetupInterceptionModalProps) {
  const { currentUser, setUser } = useAuthStore();

  // Internal step index (tracks which of the missingSteps we're on)
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  // ── Identity form state ──────────────────────────────────────────────
  const [firstName, setFirstName] = useState(currentUser?.firstName ?? "");
  const [lastName, setLastName] = useState(currentUser?.lastName ?? "");
  const [phone, setPhone] = useState(currentUser?.phone ?? "");

  // ── Company form state ───────────────────────────────────────────────
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [companyAge, setCompanyAge] = useState("");

  const currentStep = missingSteps[stepIndex] as "identity" | "company" | undefined;
  const totalSteps = missingSteps.length;
  const isLastStep = stepIndex === totalSteps - 1;

  // ── Analytics ──────────────────────────────────────────────────────────
  const modalStartRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      modalStartRef.current = Date.now();
      trackInterceptionShown(triggerAction, [...missingSteps]);
    }
  }, [isOpen, triggerAction, missingSteps]);

  // ── Save step to server ──────────────────────────────────────────────

  const saveStep = useCallback(
    async (step: "identity" | "company") => {
      setSaving(true);
      try {
        const token = await getAuthToken();
        if (!token) {
          setSaving(false);
          return false;
        }

        const data =
          step === "identity"
            ? { firstName, lastName, phone }
            : { companyName, industry, companySize, companyAge };

        const res = await fetch("/api/setup/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, step, data }),
        });

        if (!res.ok) {
          setSaving(false);
          return false;
        }

        // Update local auth store so the gate re-evaluates
        if (currentUser) {
          const updatedSteps = {
            ...currentUser.setupProgress?.steps,
            [step]: true,
          };
          setUser({
            ...currentUser,
            ...(step === "identity" ? { firstName, lastName, phone } : {}),
            setupProgress: {
              ...currentUser.setupProgress,
              steps: updatedSteps,
            },
          });
        }

        setSaving(false);
        return true;
      } catch {
        setSaving(false);
        return false;
      }
    },
    [firstName, lastName, phone, companyName, industry, companySize, companyAge, currentUser, setUser]
  );

  // ── Handle continue ──────────────────────────────────────────────────

  const handleContinue = useCallback(async () => {
    if (!currentStep) return;

    const success = await saveStep(currentStep);
    if (!success) return;

    const remaining = totalSteps - stepIndex - 1;
    trackInterceptionStepCompleted(currentStep, remaining);

    if (isLastStep) {
      const totalDuration = Date.now() - modalStartRef.current;
      trackInterceptionCompleted(totalSteps, triggerAction, totalDuration);
      setStepIndex(0);
      onComplete();
    } else {
      setStepIndex((prev) => prev + 1);
    }
  }, [currentStep, isLastStep, saveStep, onComplete, totalSteps, stepIndex, triggerAction]);

  // ── Handle dismiss ───────────────────────────────────────────────────

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        trackInterceptionDismissed(currentStep ?? "unknown", triggerAction);
        setStepIndex(0);
        onDismiss();
      }
    },
    [onDismiss, currentStep, triggerAction]
  );

  // ── Validation ───────────────────────────────────────────────────────

  const isIdentityValid = firstName.trim().length > 0 && lastName.trim().length > 0;
  const isCompanyValid = companyName.trim().length > 0;

  const canContinue =
    currentStep === "identity" ? isIdentityValid : isCompanyValid;

  // ── Button label ─────────────────────────────────────────────────────

  const buttonLabel = isLastStep ? "Done. Let\u2019s go." : "Next";

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          {totalSteps > 1 && (
            <p className="font-mono text-[10px] text-text-disabled tracking-widest uppercase mb-0.5">
              Step {stepIndex + 1} of {totalSteps}
            </p>
          )}
          <DialogTitle className="uppercase tracking-wider">
            {currentStep === "identity" ? "Before you start" : "Create your company"}
          </DialogTitle>
          <DialogDescription>
            {currentStep === "identity"
              ? "We need a name on the account"
              : `Set up your company to start creating ${triggerAction}`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-1">
          {currentStep === "identity" && (
            <IdentityStep1
              firstName={firstName}
              lastName={lastName}
              phone={phone}
              onUpdate={(data) => {
                if (data.firstName !== undefined) setFirstName(data.firstName);
                if (data.lastName !== undefined) setLastName(data.lastName);
                if (data.phone !== undefined) setPhone(data.phone);
              }}
            />
          )}

          {currentStep === "company" && (
            <IdentityStep2
              companyName={companyName}
              industry={industry}
              companySize={companySize}
              companyAge={companyAge}
              onUpdate={(data) => {
                if (data.companyName !== undefined) setCompanyName(data.companyName);
                if (data.industry !== undefined) setIndustry(data.industry);
                if (data.companySize !== undefined) setCompanySize(data.companySize);
                if (data.companyAge !== undefined) setCompanyAge(data.companyAge);
              }}
            />
          )}
        </div>

        <div className="flex justify-end pt-1 border-t border-border">
          <Button
            variant="primary"
            onClick={handleContinue}
            disabled={!canContinue || saving}
            loading={saving}
          >
            {saving ? "Saving..." : buttonLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
