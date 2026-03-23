# Duplicate Resolution Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a card-by-card duplicate resolution step (Step 4.5) to the pipeline import wizard, letting users choose merge/sub-contact/keep-both/discard for each matched lead before import.

**Architecture:** Replace `ConfirmImportStep` with `ResolveDuplicatesStep`. The new component calls `verify-leads`, separates matched vs unmatched leads, presents matched leads one-by-one for resolution, then updates each lead's `action` field before handing off to the existing `handleImport`. Non-matched leads pass through automatically. The import endpoint gains three new action handlers: `merge`, `discard`, and `discard_existing`.

**Tech Stack:** React, TypeScript, Framer Motion, Supabase, TanStack Query

**Design System:** OPS Web — frosted glass surfaces, Mohave/Kosugi typography, `#597794` accent, sharp 2-4px radii, left-aligned text. Follow `.interface-design/system.md`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/types/email-import.ts` | Modify | Extend `action` union + add `mergeMode` field |
| `src/lib/api/services/client-service.ts` | Modify | Add `softDeleteClient` method |
| `src/components/settings/wizard-steps/resolve-duplicates-step.tsx` | Create | New duplicate resolution UI component |
| `src/components/settings/import-pipeline-wizard.tsx` | Modify | Replace `ConfirmImportStep` with `ResolveDuplicatesStep`, update `handleImport` payload mapping |
| `src/app/api/integrations/email/import/route.ts` | Modify | Handle `merge`, `discard`, `discard_existing` actions |

---

## Task 1: Extend Types

**Files:**
- Modify: `src/lib/types/email-import.ts:85-95`

- [ ] **Step 1: Update the ImportPayload lead action union and add mergeMode**

In `src/lib/types/email-import.ts`, find the `ImportPayload` interface (line 80). The leads array item has `action` at line 95. Change:

```typescript
// Line 95 — current:
action: 'create_new' | 'link' | 'create_subclient';

// Replace with:
action: 'create_new' | 'link' | 'create_subclient' | 'merge' | 'discard' | 'discard_existing';
mergeMode?: 'fill_blanks' | 'overwrite';
```

Also update the `AnalyzedLead.matchResult.action` type at line 68:

```typescript
// Line 68 — current:
action: 'link' | 'create_subclient' | 'review' | 'create_new';

// Replace with:
action: 'link' | 'create_subclient' | 'review' | 'create_new' | 'merge' | 'discard' | 'discard_existing';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (existing code uses compatible subset of the union).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/email-import.ts
git commit -m "feat(import): extend action types for duplicate resolution"
```

---

## Task 2: Add softDeleteClient to ClientService

**Files:**
- Modify: `src/lib/api/services/client-service.ts:182` (after `updateClient`)

- [ ] **Step 1: Add softDeleteClient method**

After the `updateClient` method (ends at line 182), add:

```typescript
  async softDeleteClient(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("clients")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to soft-delete client: ${error.message}`);
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/services/client-service.ts
git commit -m "feat(clients): add softDeleteClient method"
```

---

## Task 3: Create ResolveDuplicatesStep Component

**Files:**
- Create: `src/components/settings/wizard-steps/resolve-duplicates-step.tsx`

This is the largest task. The component:
1. Calls `verify-leads` on mount (same as current `ConfirmImportStep`)
2. Separates leads into matched (have `existingClientId`) and unmatched (pass through)
3. If no matches → show summary and "Import" button immediately
4. If matches → present them one-by-one for resolution
5. After all resolved → show final summary and "Import" button

- [ ] **Step 1: Create the component file**

Create `src/components/settings/wizard-steps/resolve-duplicates-step.tsx` with the full implementation below.

**Props interface** (matches current `ConfirmImportStep` props + `onLeadsChanged`):

```typescript
interface ResolveDuplicatesStepProps {
  leads: AnalyzedLead[];
  companyId: string;
  onBack: () => void;
  onImport: () => Promise<void>;
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  importing: boolean;
}
```

**Key state:**

```typescript
// Verification
const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

// Resolution
const [currentIndex, setCurrentIndex] = useState(0);
const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
const [mergeMode, setMergeMode] = useState<'fill_blanks' | 'overwrite'>('fill_blanks');
const [showDiscardExistingConfirm, setShowDiscardExistingConfirm] = useState(false);
const [allResolved, setAllResolved] = useState(false);
```

Where `Resolution` is:

```typescript
interface Resolution {
  action: 'merge' | 'create_subclient' | 'create_new' | 'discard' | 'discard_existing';
  mergeMode?: 'fill_blanks' | 'overwrite';
}
```

**Core logic:**

```typescript
// Separate matched vs unmatched
const enabledLeads = leads.filter((l) => l.enabled);
const matchedLeads = enabledLeads.filter(
  (l) => verifyResult?.matches[l.id]?.existingClientId
);
const unmatchedLeads = enabledLeads.filter(
  (l) => !verifyResult?.matches[l.id]?.existingClientId
);

// Current lead being resolved
const currentLead = matchedLeads[currentIndex];
const currentMatch = currentLead ? verifyResult?.matches[currentLead.id] : null;

// Apply resolution to a lead
const resolve = (leadId: string, resolution: Resolution) => {
  setResolutions((prev) => new Map(prev).set(leadId, resolution));
  if (currentIndex < matchedLeads.length - 1) {
    setCurrentIndex((i) => i + 1);
  } else {
    setAllResolved(true);
  }
};

// Batch resolve all remaining
const resolveAllRemaining = (resolution: Resolution) => {
  const newResolutions = new Map(resolutions);
  matchedLeads.forEach((lead, i) => {
    if (i >= currentIndex && !newResolutions.has(lead.id)) {
      newResolutions.set(lead.id, resolution);
    }
  });
  setResolutions(newResolutions);
  setAllResolved(true);
};

// Apply resolutions to leads before import
const handleImport = async () => {
  const updatedLeads = leads.map((lead) => {
    const resolution = resolutions.get(lead.id);
    if (!resolution) return lead; // unmatched — pass through unchanged
    return {
      ...lead,
      matchResult: {
        ...lead.matchResult,
        action: resolution.action,
      },
    };
  });
  onLeadsChanged(updatedLeads);
  // Small delay to let state propagate before import
  await new Promise((r) => setTimeout(r, 50));
  await onImport();
};
```

**Verify-leads call on mount** (reuse from `ConfirmImportStep` lines 72-110):

```typescript
useEffect(() => {
  async function verify() {
    try {
      const res = await fetch("/api/integrations/email/verify-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          leads: enabledLeads.map((l) => ({
            id: l.id,
            clientEmail: l.client.email,
            clientName: l.client.name,
            existingClientId: l.matchResult.existingClientId,
          })),
        }),
      });
      if (!res.ok) throw new Error("Verification failed");
      const data = await res.json();
      setVerifyResult(data);

      // If no matches, skip resolution entirely
      const hasMatches = Object.values(data.matches as Record<string, { existingClientId: string | null }>)
        .some((m) => m.existingClientId);
      if (!hasMatches) setAllResolved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }
  verify();
}, [companyId, enabledLeads]);
```

**Render structure:**

```
Loading state → spinner
Error state → retry button
No matches → summary + Import button (allResolved = true from mount)
Has matches + not all resolved → card-by-card resolution UI
All resolved → final summary + Import button
```

**Card-by-card UI** (the core visual):

```tsx
{/* Progress */}
<p className="font-kosugi text-[9px] tracking-[0.15em] uppercase text-[#999]">
  Match {currentIndex + 1} of {matchedLeads.length}
</p>
<div className="flex gap-1 mt-1 mb-4">
  {matchedLeads.map((_, i) => (
    <div
      key={i}
      className="h-[3px] flex-1 rounded-[1px]"
      style={{
        background: i < currentIndex ? '#597794'
          : i === currentIndex ? '#597794'
          : 'rgba(255,255,255,0.1)',
        opacity: i === currentIndex ? 1 : 0.5,
      }}
    />
  ))}
</div>

{/* Side-by-side comparison */}
<div className="grid grid-cols-2 gap-3 mb-4">
  {/* Importing card */}
  <div className="p-3 border border-[rgba(89,119,148,0.3)] bg-[rgba(89,119,148,0.04)]"
    style={{ borderRadius: 2 }}>
    <p className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#597794] mb-2">
      Importing
    </p>
    <p className="font-mohave text-[15px] text-text-primary">{currentLead.client.name}</p>
    <p className="font-mohave text-[12px] text-[#999]">{currentLead.client.email}</p>
    {currentLead.client.phone && (
      <p className="font-mohave text-[12px] text-[#999]">{currentLead.client.phone}</p>
    )}
    <p className="font-mohave text-[11px] text-[#666] mt-1">
      {currentLead.correspondenceCount} emails · {currentLead.stage}
    </p>
  </div>

  {/* Existing card */}
  <div className="p-3 border border-[rgba(255,255,255,0.12)] bg-[#111]"
    style={{ borderRadius: 2 }}>
    <p className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#999] mb-2">
      In Database
    </p>
    <p className="font-mohave text-[15px] text-text-primary">
      {currentMatch?.existingClientName || '—'}
    </p>
    <p className="font-mohave text-[12px] text-[#999]">{currentLead.client.email}</p>
    {currentMatch?.hasOpenOpp && (
      <p className="font-mohave text-[11px] text-[#C4A868] mt-1">
        Has open opportunity
      </p>
    )}
  </div>
</div>

{/* Merge mode toggle */}
<div className="flex items-center gap-3 mb-3">
  <span className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#666]">
    Merge mode
  </span>
  <button
    onClick={() => setMergeMode('fill_blanks')}
    className="font-mohave text-[12px] px-2 py-[3px]"
    style={{
      borderRadius: 2,
      background: mergeMode === 'fill_blanks' ? 'rgba(89,119,148,0.15)' : 'transparent',
      color: mergeMode === 'fill_blanks' ? '#597794' : '#666',
      border: `1px solid ${mergeMode === 'fill_blanks' ? 'rgba(89,119,148,0.3)' : 'rgba(255,255,255,0.08)'}`,
    }}
  >
    Fill blanks only
  </button>
  <button
    onClick={() => setMergeMode('overwrite')}
    className="font-mohave text-[12px] px-2 py-[3px]"
    style={{
      borderRadius: 2,
      background: mergeMode === 'overwrite' ? 'rgba(89,119,148,0.15)' : 'transparent',
      color: mergeMode === 'overwrite' ? '#597794' : '#666',
      border: `1px solid ${mergeMode === 'overwrite' ? 'rgba(89,119,148,0.3)' : 'rgba(255,255,255,0.08)'}`,
    }}
  >
    Overwrite existing
  </button>
</div>

{/* Action buttons */}
<div className="flex flex-wrap gap-2 mb-4">
  <ActionButton label="Merge" onClick={() => resolve(currentLead.id, { action: 'merge', mergeMode })} />
  <ActionButton label="Sub-contact" onClick={() => resolve(currentLead.id, { action: 'create_subclient' })} />
  <ActionButton label="Keep Both" onClick={() => resolve(currentLead.id, { action: 'create_new' })} />
  <ActionButton label="Discard New" onClick={() => resolve(currentLead.id, { action: 'discard' })} variant="muted" />
  <ActionButton
    label="Discard Existing"
    onClick={() => setShowDiscardExistingConfirm(true)}
    variant="danger"
  />
</div>

{/* Batch actions */}
<div className="border-t border-white/5 pt-3">
  <p className="font-kosugi text-[8px] tracking-[0.15em] uppercase text-[#666] mb-2">
    Apply to all remaining
  </p>
  <div className="flex flex-wrap gap-2">
    <BatchButton label="Merge All" onClick={() => resolveAllRemaining({ action: 'merge', mergeMode })} />
    <BatchButton label="Sub-contact All" onClick={() => resolveAllRemaining({ action: 'create_subclient' })} />
    <BatchButton label="Discard All New" onClick={() => resolveAllRemaining({ action: 'discard' })} />
  </div>
</div>
```

**ActionButton and BatchButton** are thin styled wrappers:

```tsx
function ActionButton({ label, onClick, variant = 'default' }: {
  label: string; onClick: () => void; variant?: 'default' | 'muted' | 'danger';
}) {
  const styles = {
    default: 'bg-[rgba(89,119,148,0.12)] border-[rgba(89,119,148,0.25)] text-[#597794] hover:bg-[rgba(89,119,148,0.2)]',
    muted: 'bg-transparent border-[rgba(255,255,255,0.08)] text-[#666] hover:text-[#999] hover:border-[rgba(255,255,255,0.15)]',
    danger: 'bg-[rgba(147,50,26,0.08)] border-[rgba(147,50,26,0.2)] text-[#93321A] hover:bg-[rgba(147,50,26,0.15)]',
  };
  return (
    <button
      onClick={onClick}
      className={cn("font-kosugi text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border transition-colors", styles[variant])}
      style={{ borderRadius: 2 }}
    >
      {label}
    </button>
  );
}
```

**Discard Existing confirmation dialog:**

```tsx
{showDiscardExistingConfirm && (
  <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60">
    <div className="bg-[#0D0D0D] border border-[rgba(255,255,255,0.12)] p-4 max-w-sm" style={{ borderRadius: 3 }}>
      <p className="font-mohave text-[15px] text-text-primary mb-1">
        Soft-delete existing client?
      </p>
      <p className="font-mohave text-[12px] text-[#999] mb-4">
        "{currentMatch?.existingClientName}" will be soft-deleted (recoverable).
        The imported lead will create a new client record.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setShowDiscardExistingConfirm(false)}>
          Cancel
        </Button>
        <Button
          className="bg-[#93321A] hover:bg-[#A83D20] text-white"
          onClick={() => {
            resolve(currentLead.id, { action: 'discard_existing' });
            setShowDiscardExistingConfirm(false);
          }}
        >
          Delete Existing
        </Button>
      </div>
    </div>
  </div>
)}
```

**Final summary** (shown when `allResolved === true`):

```tsx
const discardCount = Array.from(resolutions.values()).filter((r) => r.action === 'discard').length;
const totalToImport = enabledLeads.length - discardCount;

// Show resolution summary + Import button
<div className="space-y-3">
  <p className="font-mohave text-[15px] text-[#999]">
    {totalToImport} lead{totalToImport !== 1 ? 's' : ''} ready to import
  </p>
  {/* Summary counts by resolution type */}
  {/* ... */}
  <div className="sticky bottom-0 -mx-6 px-6 py-3 flex items-center justify-between border-t border-white/8"
    style={{ background: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(20px) saturate(1.2)', zIndex: 10 }}>
    <Button variant="ghost" onClick={onBack} disabled={importing}>
      Back
    </Button>
    <Button
      onClick={handleImport}
      loading={importing}
      disabled={totalToImport === 0}
      className="font-kosugi text-[11px] tracking-[0.1em] uppercase bg-[#597794] hover:bg-[#6A88A5] text-white px-6 py-2"
      style={{ borderRadius: 3 }}
    >
      Import {totalToImport} Lead{totalToImport !== 1 ? 's' : ''}
    </Button>
  </div>
</div>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/wizard-steps/resolve-duplicates-step.tsx
git commit -m "feat(import): add ResolveDuplicatesStep for card-by-card duplicate resolution"
```

---

## Task 4: Wire ResolveDuplicatesStep into Wizard

**Files:**
- Modify: `src/components/settings/import-pipeline-wizard.tsx`

- [ ] **Step 1: Replace ConfirmImportStep import with ResolveDuplicatesStep**

At the top of the file, find the import (around line 20-40 area — search for `ConfirmImportStep`):

```typescript
// Remove:
import { ConfirmImportStep } from "@/components/settings/wizard-steps/confirm-import-step";

// Add:
import { ResolveDuplicatesStep } from "@/components/settings/wizard-steps/resolve-duplicates-step";
```

- [ ] **Step 2: Replace ConfirmImportStep rendering with ResolveDuplicatesStep**

Find the Step 4 rendering block (around line 780-810). The current `confirmed` sub-state renders `ConfirmImportStep`. Replace:

```typescript
// Current (around line 790):
) : confirmed ? (
  <ConfirmImportStep
    leads={confirmedLeads}
    companyId={companyId}
    onBack={() => setConfirmed(false)}
    onImport={handleImport}
    importing={importStarting}
  />
) : (

// Replace with:
) : confirmed ? (
  <ResolveDuplicatesStep
    leads={confirmedLeads}
    companyId={companyId}
    onBack={() => setConfirmed(false)}
    onImport={handleImport}
    onLeadsChanged={setConfirmedLeads}
    importing={importStarting}
  />
) : (
```

- [ ] **Step 3: Update handleImport to map the new action types into the payload**

In `handleImport` (around line 430-489), find where the payload maps lead actions. Currently at approximately line 457:

```typescript
// Current:
action: lead.matchResult.action as "create_new" | "link" | "create_subclient",

// Replace with:
action: lead.matchResult.action as ImportPayload['leads'][number]['action'],
mergeMode: (lead as unknown as { mergeMode?: 'fill_blanks' | 'overwrite' }).mergeMode,
```

Wait — the `mergeMode` isn't on `AnalyzedLead`. The resolution sets it via `matchResult.action` but we also need to carry `mergeMode`. Better approach: in `ResolveDuplicatesStep.handleImport`, inject `mergeMode` onto each lead's resolution data. Let me revise:

In `ResolveDuplicatesStep`, update the `handleImport` to set mergeMode on the lead before calling `onLeadsChanged`:

```typescript
const handleImport = async () => {
  const updatedLeads = leads.map((lead) => {
    const resolution = resolutions.get(lead.id);
    if (!resolution) return lead;
    return {
      ...lead,
      matchResult: {
        ...lead.matchResult,
        action: resolution.action,
      },
      // Carry mergeMode through a temporary field for the import payload
      _mergeMode: resolution.mergeMode,
    } as AnalyzedLead & { _mergeMode?: 'fill_blanks' | 'overwrite' };
  });
  onLeadsChanged(updatedLeads as AnalyzedLead[]);
  await new Promise((r) => setTimeout(r, 50));
  await onImport();
};
```

And in `handleImport` in the wizard, extract `_mergeMode`:

```typescript
// In the payload leads mapping:
mergeMode: (lead as Record<string, unknown>)._mergeMode as ImportPayload['leads'][number]['mergeMode'],
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/import-pipeline-wizard.tsx
git commit -m "feat(import): wire ResolveDuplicatesStep into wizard flow"
```

---

## Task 5: Update Import Endpoint for New Actions

**Files:**
- Modify: `src/app/api/integrations/email/import/route.ts`

- [ ] **Step 1: Add ClientService import if not present**

Check imports at top of file. `ClientService` is already imported (line 20). Good.

- [ ] **Step 2: Add new action handlers in the per-lead processing loop**

Find the per-lead client resolution section (around lines 190-252). Currently handles: merge-with-lead (dedup), link, create_subclient, and create_new (default).

Add handlers for the three new actions. Insert BEFORE the existing `if (lead.existingClientId)` block (around line 198):

```typescript
// ── Handle discard — skip this lead entirely ─────────────────────────
if (lead.action === 'discard') {
  console.log(`[email-import] DISCARD: Skipping lead "${lead.clientName}" (${lead.clientEmail})`);
  continue;
}

// ── Handle discard_existing — soft-delete existing, create new ───────
if (lead.action === 'discard_existing' && lead.existingClientId) {
  console.log(`[email-import] DISCARD_EXISTING: Soft-deleting client ${lead.existingClientId}, creating new for "${lead.clientName}"`);
  await ClientService.softDeleteClient(lead.existingClientId);
  // Fall through to create_new logic below (clear existingClientId so it creates fresh)
  lead.existingClientId = null;
  lead.action = 'create_new';
}

// ── Handle merge — update existing client with imported data ─────────
if (lead.action === 'merge' && lead.existingClientId) {
  console.log(`[email-import] MERGE (${lead.mergeMode || 'fill_blanks'}): "${lead.clientName}" → existing client ${lead.existingClientId}`);

  // Fetch existing client to check which fields are blank
  const { data: existingClient } = await supabase
    .from("clients")
    .select("*")
    .eq("id", lead.existingClientId)
    .single();

  if (existingClient) {
    const updates: Record<string, unknown> = {};

    if (lead.mergeMode === 'overwrite') {
      // Overwrite: always set imported values if present
      if (lead.clientName) updates.name = lead.clientName;
      if (lead.clientEmail) updates.email = lead.clientEmail;
      if (lead.clientPhone) updates.phone_number = lead.clientPhone;
    } else {
      // Fill blanks: only set if existing field is null/empty
      if (!existingClient.name && lead.clientName) updates.name = lead.clientName;
      if (!existingClient.email && lead.clientEmail) updates.email = lead.clientEmail;
      if (!existingClient.phone_number && lead.clientPhone) updates.phone_number = lead.clientPhone;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabase
        .from("clients")
        .update(updates)
        .eq("id", lead.existingClientId);

      if (updateErr) {
        console.error(`[email-import] Failed to merge client: ${updateErr.message}`);
      }
    }
  }

  clientId = lead.existingClientId;
  // Skip to opportunity handling (don't create a new client)
}
```

The existing `if/else` chain for link, create_subclient, create_new needs adjustment. The merge handler above sets `clientId` and should skip the rest of the client resolution. Wrap the existing logic:

```typescript
if (!clientId) {
  // ... existing link / create_subclient / create_new logic ...
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/integrations/email/import/route.ts
git commit -m "feat(import): handle merge, discard, discard_existing actions"
```

---

## Task 6: Verify End-to-End

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2: Verify the ConfirmImportStep is no longer imported anywhere**

Run: `grep -r "ConfirmImportStep" src/`
Expected: Only the file itself and possibly test files. Not imported in import-pipeline-wizard.tsx.

- [ ] **Step 3: Manual smoke test checklist**

1. Open Import Pipeline wizard
2. Connect Gmail, run analysis
3. Confirm sources → Review leads → Confirm
4. If duplicates found: verify card-by-card UI appears
5. Test each action: Merge, Sub-contact, Keep Both, Discard New
6. Test Discard Existing (verify confirmation dialog appears)
7. Test batch actions: Merge All, Sub-contact All, Discard All New
8. Verify import completes with correct client/opportunity creation
9. If no duplicates: verify it skips straight to import summary

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(import): complete duplicate resolution step with merge, sub-contact, keep-both, and discard actions"
```
