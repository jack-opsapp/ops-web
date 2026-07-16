import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const databaseTypes = readFileSync(
  resolve(process.cwd(), "src/lib/types/database.types.ts"),
  "utf8"
);

type FieldContract = Record<string, { optional: boolean; type: string }>;

function extractBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(
    start,
    `missing generated contract block: ${marker}`
  ).toBeGreaterThanOrEqual(0);

  const openingBrace = source.indexOf("{", start);
  expect(
    openingBrace,
    `missing opening brace for: ${marker}`
  ).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`unterminated generated contract block: ${marker}`);
}

function fields(
  block: string,
  section: "Row" | "Insert" | "Update"
): FieldContract {
  const sectionBlock = extractBlock(block, `${section}: {`);
  const result: FieldContract = {};

  for (const line of sectionBlock.split("\n").slice(1, -1)) {
    const match = line.match(/^\s+([a-z][a-z0-9_]*)(\?)?:\s+(.+)$/);
    if (!match) continue;
    result[match[1]] = {
      optional: match[2] === "?",
      type: match[3].trim().replace(/;$/, ""),
    };
  }

  return result;
}

function expectGeneratedTable(input: {
  name: string;
  row: Record<string, string>;
  requiredInsert: string[];
}): string {
  const table = extractBlock(databaseTypes, `      ${input.name}: {`);
  const row = fields(table, "Row");
  const insert = fields(table, "Insert");
  const update = fields(table, "Update");
  const required = new Set(input.requiredInsert);

  expect(row).toEqual(
    Object.fromEntries(
      Object.entries(input.row).map(([name, type]) => [
        name,
        { optional: false, type },
      ])
    )
  );
  expect(insert).toEqual(
    Object.fromEntries(
      Object.entries(input.row).map(([name, type]) => [
        name,
        { optional: !required.has(name), type },
      ])
    )
  );
  expect(update).toEqual(
    Object.fromEntries(
      Object.entries(input.row).map(([name, type]) => [
        name,
        { optional: true, type },
      ])
    )
  );

  return table;
}

describe("canonical email attachment database types", () => {
  it("matches the durable mailbox-scoped attachment and inspection tables", () => {
    const attachments = expectGeneratedTable({
      name: "email_attachments",
      requiredInsert: [
        "company_id",
        "connection_id",
        "provider_thread_id",
        "message_id",
        "attachment_id",
      ],
      row: {
        activity_id: "string | null",
        attachment_id: "string",
        attribution_status: "string",
        company_id: "string",
        connection_id: "string",
        content_id: "string | null",
        content_sha256: "string | null",
        created_at: "string",
        detected_mime_type: "string | null",
        filename: "string | null",
        from_email: "string | null",
        id: "string",
        ingest_attempts: "number",
        ingest_status: "string",
        is_inline: "boolean",
        last_error: "string | null",
        last_seen_at: "string",
        message_id: "string",
        mime_type: "string | null",
        next_retry_at: "string | null",
        occurred_at: "string | null",
        opportunity_id: "string | null",
        provider_kind: "string",
        provider_part_id: "string | null",
        provider_thread_id: "string",
        size_bytes: "number | null",
        source_url: "string | null",
        storage_backend: "string | null",
        storage_path: "string | null",
        stored_at: "string | null",
        updated_at: "string",
        verified_size_bytes: "number | null",
      },
    });
    const inspections = expectGeneratedTable({
      name: "attachment_inspections",
      requiredInsert: ["company_id", "message_id", "attachment_id"],
      row: {
        attachment_id: "string",
        company_id: "string",
        connection_id: "string | null",
        email_attachment_id: "string | null",
        facts: "Json",
        id: "string",
        inspected_at: "string",
        is_signed_estimate: "boolean",
        message_id: "string",
        model: "string | null",
        provider_thread_id: "string | null",
        summary: "string | null",
      },
    });

    for (const obsoleteName of [
      "storage_bucket",
      "storage_key",
      "stored_size_bytes",
      "message_date",
    ]) {
      expect(attachments).not.toContain(obsoleteName);
    }

    expect(attachments).toContain('referencedRelation: "activities"');
    expect(attachments).toContain('referencedRelation: "email_connections"');
    expect(attachments).toContain('referencedRelation: "opportunities"');
    expect(inspections).toContain('referencedRelation: "email_attachments"');
    expect(inspections).toContain('referencedRelation: "email_connections"');
  });

  it("matches the durable exact-message scan queue", () => {
    const scans = expectGeneratedTable({
      name: "email_attachment_scans",
      requiredInsert: [
        "company_id",
        "connection_id",
        "activity_id",
        "provider_thread_id",
        "message_id",
      ],
      row: {
        activity_id: "string",
        attempts: "number",
        available_at: "string",
        company_id: "string",
        connection_id: "string",
        created_at: "string",
        exception_notified_at: "string | null",
        generation: "number",
        id: "string",
        last_error: "string | null",
        lease_expires_at: "string | null",
        lease_owner: "string | null",
        message_id: "string",
        provider_thread_id: "string",
        scanned_at: "string | null",
        status: "string",
        updated_at: "string",
      },
    });

    expect(scans).toContain('referencedRelation: "activities"');
    expect(scans).toContain('referencedRelation: "email_connections"');
  });

  it("matches the independent durable attachment inspection queue", () => {
    const jobs = expectGeneratedTable({
      name: "email_attachment_inspection_jobs",
      requiredInsert: ["company_id", "connection_id", "email_attachment_id"],
      row: {
        attempts: "number",
        available_at: "string",
        company_id: "string",
        connection_id: "string",
        created_at: "string",
        email_attachment_id: "string",
        generation: "number",
        id: "string",
        inspected_at: "string | null",
        last_error: "string | null",
        lease_expires_at: "string | null",
        lease_owner: "string | null",
        skip_reason: "string | null",
        status: "string",
        updated_at: "string",
      },
    });

    expect(jobs).toContain('referencedRelation: "email_attachments"');
    expect(jobs).toContain('referencedRelation: "email_connections"');
  });

  it("exposes attachment worker, projection, merge, and reassignment RPC contracts", () => {
    const claim = extractBlock(
      databaseTypes,
      "      claim_email_attachment_scans: {"
    );
    expect(claim).toContain("p_worker_id: string");
    expect(claim).toContain("p_limit?: number");
    expect(claim).toContain("p_lease_seconds?: number");
    expect(claim).toContain(
      'Returns: Database["public"]["Tables"]["email_attachment_scans"]["Row"][]'
    );
    expect(claim).toContain("isSetofReturn: true");

    const exactClaim = extractBlock(
      databaseTypes,
      "      claim_email_attachment_scan: {"
    );
    for (const fragment of [
      "p_company_id: string",
      "p_connection_id: string",
      "p_activity_id: string",
      "p_message_id: string",
      "p_worker_id: string",
      "p_lease_seconds?: number",
    ]) {
      expect(exactClaim).toContain(fragment);
    }
    expect(exactClaim).toContain(
      'Returns: Database["public"]["Tables"]["email_attachment_scans"]["Row"][]'
    );
    expect(exactClaim).toContain("isSetofReturn: true");

    for (const functionName of [
      "claim_email_attachment_inspection_job",
      "claim_email_attachment_inspection_jobs",
    ]) {
      const inspectionClaim = extractBlock(
        databaseTypes,
        `      ${functionName}: {`
      );
      expect(inspectionClaim).toContain("p_worker_id: string");
      expect(inspectionClaim).toContain("p_lease_seconds?: number");
      expect(inspectionClaim).toContain(
        'Returns: Database["public"]["Tables"]["email_attachment_inspection_jobs"]["Row"][]'
      );
      expect(inspectionClaim).toContain("isSetofReturn: true");
    }

    const refresh = extractBlock(
      databaseTypes,
      "      refresh_email_activity_attachments: {"
    );
    expect(refresh).toContain("Args: { p_activity_id: string }");
    expect(refresh).toContain("Returns: undefined");

    const notifyException = extractBlock(
      databaseTypes,
      "      notify_email_attachment_scan_exception: {"
    );
    for (const fragment of [
      "p_scan_id: string",
      "p_company_id: string",
      "p_user_id: string",
      "p_title: string",
      "p_body: string",
      "Returns: boolean",
    ]) {
      expect(notifyException).toContain(fragment);
    }

    const notifyExceptionAsSystem = extractBlock(
      databaseTypes,
      "      notify_email_attachment_scan_exception_as_system: {"
    );
    expect(notifyExceptionAsSystem).toContain(
      "Args: { p_scan_id: string }"
    );
    expect(notifyExceptionAsSystem).toContain("Returns: boolean");

    const markReconnect = extractBlock(
      databaseTypes,
      "      mark_email_attachment_connection_needs_reconnect: {"
    );
    expect(markReconnect).toContain("p_company_id: string");
    expect(markReconnect).toContain("p_connection_id: string");
    expect(markReconnect).toContain("Returns: number");

    const markReconnectAsSystem = extractBlock(
      databaseTypes,
      "      mark_email_connection_needs_reconnect_as_system: {"
    );
    expect(markReconnectAsSystem).toContain(
      "Args: { p_connection_id: string }"
    );
    expect(markReconnectAsSystem).toContain("Returns: number");

    const reassign = extractBlock(
      databaseTypes,
      "      reassign_opportunity_email_thread_guarded: {"
    );
    for (const fragment of [
      "p_company_id: string",
      "p_connection_id: string",
      "p_kind?: string",
      "p_provider_thread_id: string",
      "p_target_opportunity_id: string",
      "Returns: Json",
    ]) {
      expect(reassign).toContain(fragment);
    }

    for (const functionName of [
      "execute_opportunity_merge_guarded",
      "execute_opportunity_merge_guarded_internal",
    ]) {
      const merge = extractBlock(databaseTypes, `      ${functionName}: {`);
      expect(merge).toContain("p_company_id: string");
      expect(merge).toContain("p_winner_id: string");
      expect(merge).toContain("p_loser_id: string");
      expect(merge).toContain("p_merge_key: string");
      expect(merge).toContain("p_review_id?: string");
      expect(merge).toContain("Returns: Json");
    }
  });
});
