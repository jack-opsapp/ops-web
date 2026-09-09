"use client";

/**
 * The live-account console (design spec §6). Two mounts on the ads page: the
 * top carries what needs Jackson, the funnel and the tests; the bottom carries
 * the ledger and the engine's health, below the existing KPI tiles and tables.
 * Proposals are shown whenever the account can have them; the readouts only
 * once the account is live.
 */
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  useEngineChanges,
  useEngineFunnel,
  useEngineHealth,
  useEngineProposals,
  useEngineSettings,
  useEngineTests,
  useReviewProposal,
  useUpdateEngineSettings,
} from "@/lib/hooks/use-ads-engine";
import { ChangeLedger } from "./change-ledger";
import { EngineHealth } from "./engine-health";
import { FunnelTable } from "./funnel-table";
import { ProposalPanel } from "./proposal-panel";
import { TestsPanel } from "./tests-panel";
import { ERROR } from "./copy";

export interface EngineConsoleProps {
  section: "top" | "bottom";
  live: boolean;
}

function Reveal({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.div initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE_SMOOTH }}>
      {children}
    </motion.div>
  );
}

function TopSection({ live }: { live: boolean }) {
  const proposals = useEngineProposals("proposed");
  const review = useReviewProposal();
  const funnel = useEngineFunnel();
  const tests = useEngineTests();
  return (
    <div className="space-y-4">
      <Reveal>
        <ProposalPanel
          proposals={proposals.data?.proposals}
          isPending={proposals.isPending}
          error={proposals.error}
          onReview={(input) => review.mutateAsync(input)}
          onRetry={() => void proposals.refetch()}
        />
      </Reveal>
      {live && (
        <>
          <Reveal>
            <FunnelTable rows={funnel.data?.rows} available={funnel.data?.available ?? false} isPending={funnel.isPending} error={funnel.error} onRetry={() => void funnel.refetch()} />
          </Reveal>
          <Reveal>
            <TestsPanel tests={tests.data?.tests} isPending={tests.isPending} error={tests.error} onRetry={() => void tests.refetch()} />
          </Reveal>
        </>
      )}
    </div>
  );
}

function BottomSection() {
  const changes = useEngineChanges();
  const health = useEngineHealth();
  const settings = useEngineSettings();
  const update = useUpdateEngineSettings();
  return (
    <div className="space-y-4">
      <Reveal>
        <ChangeLedger changes={changes.data?.changes} isPending={changes.isPending} error={changes.error} onRetry={() => void changes.refetch()} />
      </Reveal>
      <Reveal>
        <EngineHealth
          health={health.data}
          settings={settings.data?.settings}
          humanOnlyKinds={settings.data?.human_only_kinds ?? []}
          kinds={settings.data?.kinds ?? []}
          isPending={health.isPending || settings.isPending}
          error={health.error ?? settings.error}
          saving={update.isPending}
          saveError={update.error ? update.error.message || ERROR.settings : null}
          onSave={(patch) => update.mutate(patch)}
          onRetry={() => {
            void health.refetch();
            void settings.refetch();
          }}
        />
      </Reveal>
    </div>
  );
}

export function EngineConsole({ section, live }: EngineConsoleProps) {
  return <div className="px-8">{section === "top" ? <TopSection live={live} /> : <BottomSection />}</div>;
}
