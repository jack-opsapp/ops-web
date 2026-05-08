"use client";

/**
 * Public preview of the redesigned lockout — used during the 2026-05-07
 * redesign for visual QA without needing to manipulate database state.
 * Renders all 4 state shells inline. Not linked from anywhere; reach
 * via `/lockout-preview` directly.
 */

import { LockoutShell } from "@/components/lockout/lockout-shell";
import { PricingRow } from "@/components/lockout/pricing-row";
import { Button } from "@/components/ui/button";

const SAMPLE_DATE = "Apr 28, 2027";
const SAMPLE_ISO = "2027-04-28";

export default function LockoutPreviewPage() {
  return (
    <div className="min-h-screen bg-background py-12 px-4 space-y-12">
      <h1 className="font-cakemono font-light text-[20px] uppercase tracking-tight text-text text-center">
        {"// "}LOCKOUT PREVIEW · 4 STATES
      </h1>

      {/* State 1 — expired admin */}
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 text-center mb-3">
          [STATE 1] EXPIRED · ADMIN
        </p>
        <LockoutShell
          variant="page"
          tag={{ tone: "rose", label: `SUBSCRIPTION ENDED · ${SAMPLE_DATE}` }}
          heading="SUBSCRIPTION LAPSED"
          body={`Your team's subscription ended on ${SAMPLE_DATE}. Pick a plan below to bring your crew back online.`}
          sectionLabel="PICK A PLAN"
          fingerprint={`SYS :: SUB-EXP · ${SAMPLE_ISO}`}
          showSwitchAccount={false}
        >
          <PricingRow companyId={undefined} />
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            30-day money-back · cancel any time
          </p>
        </LockoutShell>
      </section>

      {/* State 2 — expired member */}
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 text-center mb-3">
          [STATE 2] EXPIRED · MEMBER
        </p>
        <LockoutShell
          variant="page"
          tag={{ tone: "rose", label: "SUBSCRIPTION ENDED" }}
          heading="SUBSCRIPTION LAPSED"
          body="Your team's subscription ended. Only an admin can turn it back on."
          sectionLabel="NOTIFY ADMIN"
          fingerprint={`SYS :: SUB-EXP · ${SAMPLE_ISO}`}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 mb-3">
            <span className="text-text-mute">{"// "}</span>
            ADMIN <span className="text-text-mute">::</span>{" "}
            <span className="text-text">JACKSON SWEET</span>
            <span className="text-text-3"> (+2 OTHERS)</span>
          </p>
          <Button variant="primary" size="sm" className="flex" style={{ width: "100%" }}>
            Ask admin to reactivate
          </Button>
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            Your admins will get a notification. They can reactivate from settings.
          </p>
        </LockoutShell>
      </section>

      {/* State 3 — unseated admin */}
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 text-center mb-3">
          [STATE 3] UNSEATED · ADMIN
        </p>
        <LockoutShell
          variant="page"
          tag={{ tone: "tan", label: "NO SEAT" }}
          heading="NO SEAT ASSIGNED"
          body="You don't have a seat in this company. Add yourself from the team page."
          sectionLabel="MANAGE TEAM"
          fingerprint="SYS :: SEAT-NULL"
          showSwitchAccount={false}
        >
          <Button variant="primary" size="sm" className="flex" style={{ width: "100%" }}>
            Open team page
          </Button>
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            Owners and admins can give themselves a seat from the team page.
          </p>
        </LockoutShell>
      </section>

      {/* State 4 — unseated member */}
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 text-center mb-3">
          [STATE 4] UNSEATED · MEMBER
        </p>
        <LockoutShell
          variant="page"
          tag={{ tone: "tan", label: "NO SEAT" }}
          heading="NO SEAT ASSIGNED"
          body="Your admin needs to give you a seat before you can use OPS."
          sectionLabel="NOTIFY ADMIN"
          fingerprint="SYS :: SEAT-PEND"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 mb-3">
            <span className="text-text-mute">{"// "}</span>
            ADMIN <span className="text-text-mute">::</span>{" "}
            <span className="text-text">JACKSON SWEET</span>
          </p>
          <Button variant="primary" size="sm" className="flex" style={{ width: "100%" }}>
            Ask admin for a seat
          </Button>
          <p className="font-mohave text-[13px] text-text-3 mt-3">
            Your admin will get a notification to add you from the team page.
          </p>
        </LockoutShell>
      </section>
    </div>
  );
}
