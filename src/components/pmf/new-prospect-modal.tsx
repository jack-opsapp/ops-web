"use client";

/**
 * OPS Admin — PMF NewProspectModal
 *
 * Form for creating a new prospect. Posts to /api/admin/pmf/prospects
 * which atomically inserts a pmf_prospects row + an initial pmf_deals
 * row at stage="contacted" (see route.ts header for the compensating
 * delete behaviour).
 *
 * Key conventions:
 *   - first_contact_direction is DERIVED from source, not asked of the
 *     user. outbound_cold + warm_network → "outbound"; everything else
 *     (paid_ad, organic_search, referral, direct) → "inbound".
 *   - The route's success envelope is { data: prospect } (corrected in
 *     Task 15 fix-up dfd406b — NOT { prospect }).
 *   - On 400 the route returns Zod issues; we surface the first message
 *     instead of a generic "SAVE FAILED" so the user can self-correct.
 */
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PmfCard } from "@/components/pmf/ui/card";
import { PmfButton } from "@/components/pmf/ui/button";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import type { ProspectSource, DealType } from "@/lib/pmf/types";

type Direction = "inbound" | "outbound";

function deriveDirection(source: ProspectSource): Direction {
  return source === "outbound_cold" || source === "warm_network"
    ? "outbound"
    : "inbound";
}

const SOURCE_OPTIONS: { value: ProspectSource; label: string }[] = [
  { value: "referral", label: "REFERRAL" },
  { value: "organic_search", label: "ORGANIC SEARCH" },
  { value: "direct", label: "DIRECT" },
  { value: "paid_ad", label: "PAID AD" },
  { value: "warm_network", label: "WARM NETWORK" },
  { value: "outbound_cold", label: "OUTBOUND COLD" },
];

const DEAL_TYPE_OPTIONS: { value: DealType; label: string }[] = [
  { value: "tier_a", label: "TIER A" },
  { value: "base_saas", label: "BASE SAAS" },
];

interface ZodFlattened {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}

interface ZodIssue {
  path?: (string | number)[];
  message?: string;
}

interface ErrorEnvelope {
  error?: string | ZodFlattened;
  issues?: ZodIssue[];
}

function extractErrorMessage(json: ErrorEnvelope): string {
  // Prefer the first Zod issue message — it names the offending field.
  if (Array.isArray(json.issues) && json.issues.length > 0) {
    const first = json.issues[0];
    const field = first.path?.join(".") ?? "";
    const msg = first.message ?? "invalid";
    return field ? `${field}: ${msg}` : msg;
  }
  if (typeof json.error === "string") return json.error;
  if (json.error && typeof json.error === "object") {
    const flat = json.error;
    const fieldErrs = flat.fieldErrors
      ? Object.entries(flat.fieldErrors)
          .flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))
      : [];
    if (fieldErrs.length > 0) return fieldErrs[0];
    if (flat.formErrors && flat.formErrors.length > 0) return flat.formErrors[0];
  }
  return "save failed";
}

export function NewProspectModal() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Field state — controlled inputs.
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dealType, setDealType] = useState<DealType>("tier_a");
  const [source, setSource] = useState<ProspectSource>("referral");
  // datetime-local format yyyy-MM-ddTHH:mm; default to now (local) so
  // the user can submit without touching the field.
  const [firstContactAt, setFirstContactAt] = useState(() => {
    const now = new Date();
    const off = now.getTimezoneOffset();
    const local = new Date(now.getTime() - off * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    const body = {
      name: name.trim(),
      company: company.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      source,
      deal_type: dealType,
      first_contact_at: new Date(firstContactAt).toISOString(),
      first_contact_direction: deriveDirection(source),
      notes: notes.trim() || undefined,
    };

    try {
      const res = await fetch("/api/admin/pmf/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let msg = `request failed: ${res.status}`;
        try {
          const json = (await res.json()) as ErrorEnvelope;
          msg = extractErrorMessage(json);
        } catch {
          // body wasn't JSON — keep the status-only message
        }
        setError(msg);
        setSubmitting(false);
        return;
      }

      const json = (await res.json()) as { data?: { id?: string } };
      const id = json.data?.id;
      if (!id) {
        setError("save succeeded but response missing id");
        setSubmitting(false);
        return;
      }
      router.push(`/admin/pmf/prospects/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
      setSubmitting(false);
    }
  }

  return (
    <PmfCard className="p-6 max-w-[640px]">
      <SlashHeader variant="panel-title">PROSPECT DETAILS</SlashHeader>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="NAME" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="pmf-input"
            required
            placeholder="Jane Foreman"
          />
        </Field>

        <Field label="COMPANY">
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="pmf-input"
            placeholder="Acme Roofing"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="EMAIL">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pmf-input"
              placeholder="jane@acme.test"
            />
          </Field>

          <Field label="PHONE">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="pmf-input"
              placeholder="+1 555 0100"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="DEAL TYPE" required>
            <select
              value={dealType}
              onChange={(e) => setDealType(e.target.value as DealType)}
              className="pmf-input"
              required
            >
              {DEAL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="SOURCE" required>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as ProspectSource)}
              className="pmf-input"
              required
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="FIRST CONTACT" required>
          <input
            type="datetime-local"
            value={firstContactAt}
            onChange={(e) => setFirstContactAt(e.target.value)}
            className="pmf-input"
            required
          />
        </Field>

        <Field label="NOTES">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="pmf-input"
            rows={4}
            placeholder="Context, intro, what they need…"
          />
        </Field>

        {error && (
          <div
            role="alert"
            className="font-mono text-[11px] text-[color:var(--rose)]"
          >
            {"// ERROR — "}{error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <PmfButton
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={submitting}
          >
            CANCEL
          </PmfButton>
          <PmfButton type="submit" variant="primary" disabled={submitting}>
            {submitting ? "SAVING…" : "CREATE PROSPECT"}
          </PmfButton>
        </div>
      </form>
    </PmfCard>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

function Field({ label, required, children }: FieldProps) {
  return (
    <label className="block">
      <span className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] block mb-1">
        {label}
        {required && (
          <span className="ml-1 text-[color:var(--ops-accent)]">*</span>
        )}
      </span>
      {children}
    </label>
  );
}
