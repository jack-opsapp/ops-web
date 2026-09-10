import "server-only";
import { applyProposal, type ApplyProposalRecord } from "./apply";
import { createEngineAdminHandlers } from "./admin";
import { createGoogleGateway, googleGatewayAvailable } from "./google-gateway";
import { createEngineRepository } from "./repository";
import { isRehearsal } from "./worker-runtime";

/** Composition root for the admin review routes. */
export function engineAdminHandlers() {
  const repository = createEngineRepository();
  const now = () => new Date();
  const gateway = googleGatewayAvailable() ? createGoogleGateway() : null;
  const rehearsal = isRehearsal();
  return createEngineAdminHandlers({
    repository,
    now,
    apply: gateway ? (proposal: ApplyProposalRecord) => applyProposal(proposal, { gateway, repository, now, rehearsal, appliedBy: "operator" }) : null,
    googleAvailable: gateway !== null,
    rehearsal,
  });
}
