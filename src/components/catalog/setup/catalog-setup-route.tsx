"use client";

/**
 * CatalogSetupRoute — the client surface behind /catalog/setup. Mounts the real,
 * Jackson-approved SetupWizardShell and wires it to live data + the commit
 * pipeline:
 *
 *  • permission: gated on catalog.run_setup — renders `// NO ACCESS` otherwise
 *    (defense-in-depth; the route's layout gate + the RPC scope guard also apply).
 *  • inventoryTracked: read from company_inventory_settings (STOCK module is
 *    state-aware — hidden until inventory is on).
 *  • onBuild: commits the accepted cards via catalog_setup_save, toasts the
 *    result, resets the canvas, and returns to the now-populated /catalog.
 *  • onSetupLater: the ghost exit → back to /catalog.
 *  • sources: scoped to the lanes wired end-to-end. This slice ships MANUAL
 *    (add a row, fill it, accept); QuickBooks / file upload / template / the
 *    guided agent land in their own phases and appear in the picker as they do.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import { useInventoryMode } from "@/lib/hooks/use-inventory-mode";
import {
  CommitError,
  useCommitCatalogSetup,
} from "@/lib/hooks/use-commit-catalog-setup";
import { catalogCommitToastMessage } from "@/lib/catalog-setup/commit/completion-notification";
import { SetupWizardShell } from "@/components/catalog-setup/setup-wizard-shell";
import type { SetupSource } from "@/components/catalog-setup/DriverPane";
import type { StepContext } from "@/lib/catalog-setup/step-machine";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";

/** Lanes wired end-to-end in this slice. Expand as each source phase lands. */
const AVAILABLE_SOURCES: SetupSource[] = ["manual"];

const SESSION_KEY = "ops-catalog-setup-session-id";

/**
 * Stable per-tab session id → a replay-safe idempotency key for the commit.
 * sessionStorage survives a refresh, so retrying the same accepted set reuses
 * the key (the RPC dedupes) rather than minting a fresh one per click.
 */
function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let v = window.sessionStorage.getItem(SESSION_KEY);
  if (!v) {
    v = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, v);
  }
  return v;
}

/** A fresh, empty price-book row the operator fills via the item editor. */
function blankSellCard(): StagingCard {
  return {
    id: crypto.randomUUID(),
    source: "manual",
    state: "proposed",
    module: "sell",
    fields: {
      name: "",
      defaultPrice: null,
      unitCost: null,
      isTaxable: true,
      kind: "service",
      type: "LABOR",
    },
  };
}

export function CatalogSetupRoute() {
  const { t } = useDictionary("catalog-setup");
  const router = useRouter();
  const can = usePermissionStore((s) => s.can);
  const cards = useCatalogSetupStore((s) => s.cards);
  const dispatch = useCatalogSetupStore((s) => s.dispatch);
  const reset = useCatalogSetupStore((s) => s.reset);
  const { data: inventory } = useInventoryMode();
  const commit = useCommitCatalogSetup();
  const [driverMode, setDriverMode] = useState<"picker" | "conversation">(
    "picker",
  );

  const onPickSource = useCallback(
    (source: SetupSource) => {
      if (source === "manual") {
        dispatch({ type: "ADD_CARDS", cards: [blankSellCard()] });
        // Leave the picker — the canvas now holds a row to fill + accept.
        setDriverMode("conversation");
      }
    },
    [dispatch],
  );

  const onBuild = useCallback(() => {
    if (commit.isPending) return;
    commit.mutate(
      { sessionId: getSessionId(), cards },
      {
        onSuccess: (res) => {
          toast.success(catalogCommitToastMessage(res.counts));
          reset();
          window.sessionStorage.removeItem(SESSION_KEY);
          router.push("/catalog");
        },
        onError: (err) => {
          const detail =
            err instanceof CommitError && err.blockers.length
              ? err.blockers
                  .map((b) => b.message ?? b.code)
                  .filter(Boolean)
                  .join(" · ")
              : err.message;
          toast.error(detail || t("commitError", "Catalog commit failed"));
        },
      },
    );
  }, [commit, cards, reset, router, t]);

  const onSetupLater = useCallback(() => router.push("/catalog"), [router]);

  // Permission gate — defense-in-depth. The tactical denied state mirrors
  // catalog-page.tsx's no-access treatment.
  if (!can("catalog.run_setup")) {
    return (
      <div
        data-testid="catalog-setup-denied"
        className="flex flex-col items-start px-[44px] py-12"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("denied", "NO ACCESS")}
        </span>
      </div>
    );
  }

  const tracked = inventory?.tracked ?? false;
  const context: StepContext = {
    inventoryTracked: tracked,
    canSell: can("products.manage"),
    canStock: can("inventory.manage"),
    canTypes: can("products.manage"),
  };

  return (
    <SetupWizardShell
      context={context}
      inventoryTracked={tracked}
      driverMode={driverMode}
      availableSources={AVAILABLE_SOURCES}
      onPickSource={onPickSource}
      onSwitchToGuided={() => setDriverMode("picker")}
      onBuild={onBuild}
      onSetupLater={onSetupLater}
    />
  );
}

export default CatalogSetupRoute;
