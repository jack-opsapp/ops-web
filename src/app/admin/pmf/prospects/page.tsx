/**
 * OPS Admin — PMF Prospect List
 *
 * Server-rendered table of every prospect (newest first by
 * first_contact_at). Auth is already enforced by /admin layout
 * (verifyFirebaseToken + isAdminEmail), so we hit the service-role
 * Supabase client directly without a per-page recheck.
 *
 * `force-dynamic` is set so navigating from the kanban or detail sheet
 * always shows freshly-inserted rows — no stale cache after a NEW
 * PROSPECT submit.
 *
 * Visual conventions reused from prospect-card so the table and the
 * kanban tags match: SOURCE_TAG_VARIANT colors the source pill (olive
 * for organic/referral/direct, tan for paid_ad, default for the cold/
 * warm outbound buckets) and SOURCE_LABEL gives each source its short
 * display label. fmtDateTime renders first_contact_at in the deck's
 * Vancouver timezone instead of leaking raw ISO into the UI.
 */
import Link from "next/link";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { PmfCard } from "@/components/pmf/ui/card";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import { Tag } from "@/components/pmf/ui/tag";
import { PmfButton } from "@/components/pmf/ui/button";
import { SOURCE_TAG_VARIANT, SOURCE_LABEL } from "@/components/pmf/prospect-card";
import { fmtDateTime } from "@/lib/pmf/formatters";
import type { ProspectSource, DealType } from "@/lib/pmf/types";

export const dynamic = "force-dynamic";

interface ProspectRow {
  id: string;
  name: string;
  company: string | null;
  source: ProspectSource;
  deal_type: DealType;
  first_contact_at: string;
  first_contact_direction: "inbound" | "outbound";
}

export default async function ProspectsListPage() {
  const sb = getAdminSupabase();
  const { data } = await sb
    .from("pmf_prospects")
    .select(
      "id, name, company, source, deal_type, first_contact_at, first_contact_direction",
    )
    .order("first_contact_at", { ascending: false });

  const rows = (data ?? []) as ProspectRow[];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <SlashHeader variant="page-title">PROSPECTS</SlashHeader>
        <Link href="/admin/pmf/prospects/new">
          <PmfButton variant="primary">NEW PROSPECT</PmfButton>
        </Link>
      </div>
      <PmfCard>
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left uppercase tracking-[0.16em] text-[color:var(--text-3)] border-b border-[color:var(--line)]">
              <th className="py-2">COMPANY / NAME</th>
              <th>TYPE</th>
              <th>SOURCE</th>
              <th>DIRECTION</th>
              <th>FIRST CONTACT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                className="hover:bg-[rgba(255,255,255,0.04)] border-b border-[color:var(--line)]"
              >
                <td className="py-2">
                  <Link
                    className="text-[color:var(--text)] hover:underline"
                    href={`/admin/pmf/prospects/${p.id}`}
                  >
                    {p.company ?? p.name}
                  </Link>
                </td>
                <td>{p.deal_type.toUpperCase()}</td>
                <td>
                  <Tag variant={SOURCE_TAG_VARIANT[p.source]}>
                    {SOURCE_LABEL[p.source]}
                  </Tag>
                </td>
                <td>{p.first_contact_direction.toUpperCase()}</td>
                <td>{fmtDateTime(p.first_contact_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PmfCard>
    </div>
  );
}
