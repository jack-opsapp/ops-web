import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { extractContactFormSubmission } from "@/lib/utils/email-parsing";

const gateMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260830113100_contact_form_enqueue_provenance_gate.sql"
);
const skipMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260830113200_contact_form_deterministic_source_invalid_skip.sql"
);
const parserPath = resolve(process.cwd(), "src/lib/utils/email-parsing.ts");

function gateMigration(): string {
  return readFileSync(gateMigrationPath, "utf8");
}

function skipMigration(): string {
  return readFileSync(skipMigrationPath, "utf8");
}

// ─── Fixtures ──────────────────────────────────────────────────────────────
// These are the exact shapes the SQL contract seeds
// (tests/sql/contact-form-provenance-gate-contract.sql). Asserting the
// authoritative TS parser's verdict here is what proves the fixtures are what
// they claim to be before the SQL mirror is judged against them.

// The 1d22512e shape: an ordinary message the operator forwarded into the
// mailbox. Forward markers, zero contact-form markers.
const ORDINARY_FORWARD_SUBJECT = "Fwd: Deck rebuild";
const ORDINARY_FORWARD_BODY = [
  "Passing this along.",
  "",
  "---------- Forwarded message ---------",
  "From: Jane Doe <jane.doe@example.com>",
  "Date: Wed, 20 Aug 2026 at 09:12",
  "Subject: Deck rebuild",
  "To: Victoria <victoria@canprodeckandrail.com>",
  "",
  "Hi, we are hoping to rebuild our back deck this fall. Are you taking new",
  "work in Langley? Thanks, Jane",
].join("\n");

// A platform notification: the body marker alone is sufficient provenance.
const PLATFORM_FORM_SUBJECT = "New contact form submission";
const PLATFORM_FORM_BODY = [
  "A site visitor just submitted your form.",
  "",
  "Submission Summary",
  "Name: Jane Doe",
  "Email: jane.doe@example.com",
  "Phone: 604-555-0134",
  "Message: Looking for a deck rebuild in Langley this fall.",
  "",
  "View Submissions",
].join("\n");

// A custom form with a generic subject: accepted only because the labeled
// submitter-email line is present alongside the subject marker.
const LABELED_FORM_SUBJECT = "Quote request";
const LABELED_FORM_BODY = [
  "Name: Bob Marsh",
  "Email: bob.marsh@example.com",
  "Message: Need a railing quote for a 24ft deck.",
].join("\n");

describe("contact-form fixture provenance (authoritative TS parser)", () => {
  it("refuses an ordinary forward", () => {
    expect(
      extractContactFormSubmission(
        ORDINARY_FORWARD_SUBJECT,
        ORDINARY_FORWARD_BODY
      )
    ).toBeNull();
  });

  it("accepts a platform notification on its body marker alone", () => {
    const identity = extractContactFormSubmission(
      PLATFORM_FORM_SUBJECT,
      PLATFORM_FORM_BODY
    );

    expect(identity?.email).toBe("jane.doe@example.com");
  });

  it("accepts a generic subject only with a labeled submitter email", () => {
    const identity = extractContactFormSubmission(
      LABELED_FORM_SUBJECT,
      LABELED_FORM_BODY
    );

    expect(identity?.email).toBe("bob.marsh@example.com");

    // Same body, a subject carrying no form marker: not a contact form.
    expect(
      extractContactFormSubmission("Deck rebuild", LABELED_FORM_BODY)
    ).toBeNull();
  });
});

describe("contact-form enqueue provenance gate migration", () => {
  it("adds an immutable marker helper that cannot be reached by an API role", () => {
    const sql = gateMigration();

    expect(sql).toMatch(
      /create or replace function private\.email_contact_form_source_markers_present\(\s*p_subject text,\s*p_body text\s*\) returns boolean/i
    );
    expect(sql).toMatch(/language sql\s+immutable\s+strict/i);
    expect(sql).toMatch(
      /revoke all on function private\.email_contact_form_source_markers_present\(\s*text,\s*text\s*\)\s+from public, anon, authenticated, service_role;/i
    );
  });

  it("mirrors every platform body marker the parser accepts", () => {
    const parser = readFileSync(parserPath, "utf8");
    const sql = gateMigration().toLowerCase();

    const markerBlock = parser
      .split("const FORM_SUBMISSION_BODY_MARKERS = [")[1]
      ?.split("];")[0];
    expect(markerBlock).toBeTruthy();

    const markers = Array.from(
      markerBlock!.matchAll(/\/\\b(.+?)\\b\/i/g),
      (match) => match[1].toLowerCase()
    );
    expect(markers.length).toBeGreaterThanOrEqual(7);

    for (const marker of markers) {
      expect(sql).toContain(marker);
    }
  });

  it("mirrors every generic subject marker the parser accepts", () => {
    const parser = readFileSync(parserPath, "utf8");
    const sql = gateMigration().toLowerCase();

    const subjectAlternation = parser
      .split("const FORM_SUBMISSION_SUBJECT_RE =")[1]
      ?.split(";")[0]
      ?.match(/\(\?:(.+?)\)/)?.[1];
    expect(subjectAlternation).toBeTruthy();

    for (const marker of subjectAlternation!.split("|")) {
      expect(sql).toContain(marker.toLowerCase());
    }
  });

  it("mirrors the reply guard and the labeled submitter-email requirement", () => {
    const sql = gateMigration();

    expect(sql).toMatch(/p_subject !~\* '\^\[\[:space:\]\]\*re\[\[:space:\]\]\*:'/i);
    expect(sql).toMatch(
      /\(email\|email address\|e-mail\|e-mail address\|your email\|reply-to\)/i
    );
  });

  it("refuses to enqueue an unmarked, unattested source", () => {
    const sql = gateMigration();

    // The gate runs before the queue insert and fails closed.
    const gateIndex = sql.search(
      /email_contact_form_source_markers_present\(\s*coalesce\(activity\.subject/i
    );
    const insertIndex = sql.search(
      /insert into public\.email_assignment_contact_form_draft_queue/i
    );
    expect(gateIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(gateIndex);

    expect(sql).toMatch(
      /if not coalesce\(\s*private\.email_contact_form_source_markers_present\([\s\S]*?\),\s*false\s*\)\s+and not exists \(\s*select 1\s+from private\.email_contact_form_recipient_attestations attestation/i
    );
  });

  it("keeps every existing enqueue guard intact", () => {
    const sql = gateMigration();

    expect(sql).toMatch(
      /private\.email_assignment_contact_form_draft_canonical_recipient\(/i
    );
    expect(sql).toMatch(
      /private\.email_assignment_contact_form_draft_has_reply\(/i
    );
    expect(sql).toMatch(/on conflict \(assignment_event_id\) do nothing/i);
    expect(sql).toMatch(
      /revoke all on function private\.enqueue_email_assignment_contact_form_draft\(/i
    );
  });
});

describe("contact-form deterministic source-invalid skip migration", () => {
  it("permits the new terminal skip reason on the queue", () => {
    const sql = skipMigration();

    expect(sql).toMatch(
      /alter table public\.email_assignment_contact_form_draft_queue\s+drop constraint if exists email_assignment_contact_form_draft_completion_shape,\s+add constraint email_assignment_contact_form_draft_completion_shape check/i
    );
    expect(sql).toMatch(/'not_contact_form'/);
    expect(sql).toMatch(/'autonomy_ineligible',\s*'draft_unavailable',\s*'lead_terminal',\s*'already_replied',\s*'not_contact_form'/i
    );
  });

  it("maps deterministic validation errors to an immediate skip", () => {
    const sql = skipMigration();

    expect(sql).toMatch(
      /btrim\(p_error\) in \(\s*'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_SOURCE_INVALID',\s*'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_CUSTOMER_MISMATCH'\s*\)/
    );
    expect(sql).toMatch(
      /when v_deterministic_source_invalid then 'skipped'/i
    );
    expect(sql).toMatch(
      /when v_next_status = 'skipped' then 'not_contact_form'/i
    );
  });

  it("never lets the skip outrank a durable provider-create attempt", () => {
    const sql = skipMigration();

    const providerArm = sql.search(
      /when queue\.provider_create_started_at is not null then\s+'reconciliation_required'/i
    );
    const skipArm = sql.search(/when v_deterministic_source_invalid then 'skipped'/i);
    const busyArm = sql.search(/when v_mailbox_busy then 'retrying'/i);
    const attemptsArm = sql.search(/when queue\.attempts >= 8 then 'failed'/i);

    expect(providerArm).toBeGreaterThan(-1);
    expect(skipArm).toBeGreaterThan(providerArm);
    expect(busyArm).toBeGreaterThan(skipArm);
    expect(attemptsArm).toBeGreaterThan(skipArm);
  });

  it("stamps the skip as terminal", () => {
    const sql = skipMigration();

    expect(sql).toMatch(
      /when v_next_status in \('reconciliation_required', 'skipped'\) then now\(\)/i
    );
  });
});
