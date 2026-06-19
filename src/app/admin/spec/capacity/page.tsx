import { getCapacityEditRows } from "@/lib/admin/spec-capacity-queries";
import { CapacityEditorHeader } from "./_components/capacity-editor-header";
import { CapacityTierForm } from "./_components/capacity-tier-form";

export const dynamic = "force-dynamic";

/**
 * /admin/spec/capacity — operator config editor.
 *
 * Operator gate: inherited from `/admin/spec/layout.tsx` (Stage F.1), which
 * runs `isSpecOperator()` against the Firebase-resolved user before this RSC
 * ever fires. The save server action re-asserts the gate so a stolen action
 * payload cannot bypass it.
 *
 * Save flow (per tier):
 *   form submit → save-capacity server action → spec_capacity UPDATE →
 *   audit_log INSERT → public.refresh_spec_board_snapshot() → revalidatePath.
 *
 * Mutating any tier refreshes the public /spec OPS BOARD snapshot in seconds
 * (don't wait for the 5-min pg_cron); the read-only overview panel at
 * /admin/spec also picks up the change on next nav via the `spec-capacity`
 * tag invalidation.
 */
export default async function SpecCapacityEditorPage() {
  let rows;
  try {
    rows = await getCapacityEditRows();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      <div className="flex min-h-screen flex-col bg-black">
        <CapacityEditorHeader />
        <div className="m-8 rounded-[10px] border border-rose/40 bg-rose/8 p-6">
          <h2 className="font-cakemono text-[15px] font-light uppercase text-rose">
            <span aria-hidden="true" className="mr-2 font-mono text-text-mute">
              {"//"}
            </span>
            CAPACITY READ FAILED
          </h2>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] text-text">
            {msg}
          </pre>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
            [check supabase service-role + spec_capacity row presence]
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <CapacityEditorHeader />
      <div className="grid grid-cols-1 gap-6 px-8 py-8 xl:grid-cols-3">
        {rows.map((row) => (
          <CapacityTierForm key={row.tier} row={row} />
        ))}
      </div>
    </div>
  );
}
