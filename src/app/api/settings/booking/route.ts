/**
 * GET/PUT /api/settings/booking — the company's public booking policy
 * (PUBLIC API P2-4, design §4.1 and §8).
 *
 * Gate: `settings.company`. The company comes from the authenticated session,
 * never from the request. `GET` also reports whether the company's website is
 * wired to OPS at all; the settings shell hides the whole section when it is
 * not, so a business with nothing public never meets configuration it cannot
 * use.
 *
 * 503 `booking_settings_unavailable` when the policy store cannot answer —
 * including before the P2-1 migration lands — so the section says nothing
 * rather than claiming the company has booking switched off.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  authorizeBookingSettings,
  bookingSettingsUnavailable,
  parsePolicyRequest,
  readBookingPolicy,
  readCompanyBookingContext,
  writeBookingPolicy,
} from "@/lib/booking/policy-server";

export async function GET(request: NextRequest) {
  const authorization = await authorizeBookingSettings(request);
  if (!authorization.ok) return authorization.response;

  try {
    const company = await readCompanyBookingContext(authorization.actor);
    const policy = await readBookingPolicy(authorization.actor, company.timezone);
    return NextResponse.json({
      available: true,
      publicIntegration: company.publicIntegration,
      policy,
    });
  } catch {
    return bookingSettingsUnavailable();
  }
}

export async function PUT(request: NextRequest) {
  const authorization = await authorizeBookingSettings(request);
  if (!authorization.ok) return authorization.response;

  const body = await request.json().catch(() => null);

  let companyTimezone: string;
  try {
    companyTimezone = (await readCompanyBookingContext(authorization.actor)).timezone;
  } catch {
    return bookingSettingsUnavailable();
  }

  const parsed = parsePolicyRequest(body, companyTimezone);
  if (!parsed.ok) return NextResponse.json({ error: parsed.problem }, { status: 400 });

  try {
    const policy = await writeBookingPolicy(
      authorization.actor,
      parsed.policy,
      companyTimezone
    );
    return NextResponse.json({ policy });
  } catch {
    return bookingSettingsUnavailable();
  }
}
