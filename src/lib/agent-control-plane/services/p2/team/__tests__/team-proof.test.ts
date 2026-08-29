import { describe, expect, it } from "vitest";

import {
  teamDirectoryCollectionProofRef,
  teamDirectoryEntityProofRef,
  teamDirectoryEvidenceRef,
  teamDirectoryProofContext,
} from "../team-proof";
import {
  TEAM_READ_AT,
  TEAM_SOURCE_REVISIONS,
  teamDirectoryAuthorization,
  teamMember,
} from "./team-fixtures";

describe("P2 team-directory proof material", () => {
  it("binds every item and the collection to full authority and snapshot state", async () => {
    const authorization = await teamDirectoryAuthorization({ limit: 20 });
    const item = teamMember();
    const context = teamDirectoryProofContext({
      authorization,
      cursor: null,
      readAt: TEAM_READ_AT,
      sourceRevisions: TEAM_SOURCE_REVISIONS,
      sourceInspected: 1,
      sourceHasMore: false,
    });
    const proofRef = teamDirectoryEntityProofRef({ context, item });
    const evidenceRef = teamDirectoryEvidenceRef({
      context,
      memberRef: item.member_ref,
    });
    const collectionRef = teamDirectoryCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          member_ref: item.member_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    });

    expect(context).toMatchObject({
      capability_id: "list_team_members",
      oauth_client_id: authorization.oauthClientId,
      grant_revision: authorization.grantRevision,
      team_scope: "all",
      item_limit: 20,
      source_revisions: TEAM_SOURCE_REVISIONS,
      source_inspected: 1,
      source_has_more: false,
    });
    expect(proofRef).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(evidenceRef).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(collectionRef).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
  });

  it("changes every digest when safe display data or pagination truth changes", async () => {
    const authorization = await teamDirectoryAuthorization();
    const item = teamMember();
    const base = teamDirectoryProofContext({
      authorization,
      cursor: null,
      readAt: TEAM_READ_AT,
      sourceRevisions: TEAM_SOURCE_REVISIONS,
      sourceInspected: 1,
      sourceHasMore: false,
    });
    const changed = teamDirectoryProofContext({
      authorization,
      cursor: null,
      readAt: TEAM_READ_AT,
      sourceRevisions: TEAM_SOURCE_REVISIONS,
      sourceInspected: 2,
      sourceHasMore: true,
    });
    expect(teamDirectoryEntityProofRef({ context: base, item })).not.toBe(
      teamDirectoryEntityProofRef({
        context: base,
        item: { ...item, display_name: "Alexandra Morgan" },
      })
    );
    expect(
      teamDirectoryEvidenceRef({ context: base, memberRef: item.member_ref })
    ).not.toBe(
      teamDirectoryEvidenceRef({ context: changed, memberRef: item.member_ref })
    );
  });
});
