"use client";

// ---------------------------------------------------------------------------
// NodeInfo — progressive disclosure panel for selected entity nodes.
//
// Tier 2 (borderless): shows when a node is selected (clicked). Displays
// entity-type-specific summary info near the node. No card chrome.
//
// Tier 3 (frosted card): shows when "MORE" is clicked. Expands in-place
// with full detail loaded via the drill-down API.
//
// All text uses the dark-halo legibility treatment. Dismiss on click-outside
// or Escape. Camera stays still during drill-down.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { useIntelStore } from "@/stores/intel-store";
import { useIntelEntity } from "@/lib/hooks/use-intel-entity";
import { useAuthStore } from "@/lib/store/auth-store";
import { useDictionary } from "@/i18n/client";
import type { IntelEntity } from "@/lib/hooks/use-intel-graph";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NodeInfoProps {
  entities: IntelEntity[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NodeInfo({ entities }: NodeInfoProps) {
  const { t } = useDictionary("intel");
  const { company } = useAuthStore();

  const selectedNodeId = useIntelStore((s) => s.selectedNodeId);
  const expandedNodeId = useIntelStore((s) => s.expandedNodeId);
  const expandNode = useIntelStore((s) => s.expandNode);
  const dismissSelection = useIntelStore((s) => s.dismissSelection);

  const selectedEntity = selectedNodeId
    ? entities.find((e) => e.id === selectedNodeId)
    : null;

  // Tier 3: fetch full detail when expanded
  const { data: entityDetail, isLoading: detailLoading } = useIntelEntity(
    expandedNodeId || undefined,
    selectedEntity?.type || undefined,
    company?.id || undefined
  );

  // Escape key handling is unified in GalaxyScene (dismiss → back priority)

  if (!selectedEntity) return null;

  const isExpanded = expandedNodeId === selectedNodeId;

  return (
    <div
      className="absolute z-10 pointer-events-auto"
      style={{
        // Position in the center-right area of the viewport
        // In a production version, this would track the node's screen position
        top: "50%",
        right: "24px",
        transform: "translateY(-50%)",
        maxWidth: "320px",
      }}
    >
      {isExpanded ? (
        // Tier 3: Frosted-glass card with full detail
        <div
          className="space-y-3 px-5 py-4"
          style={{
            background: "var(--surface-glass-dense)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "3px",
          }}
        >
          {/* Header */}
          <div>
            <div className="font-mohave text-sm text-white">
              {selectedEntity.name}
            </div>
            <div className="font-mono text-micro uppercase tracking-wider text-[#999]">
              {selectedEntity.type}
              {selectedEntity.cluster !== selectedEntity.type && (
                <span className="ml-2 text-[#666]">{selectedEntity.cluster}</span>
              )}
            </div>
          </div>

          {/* Properties summary */}
          <div className="space-y-1">
            {typeof selectedEntity.properties.email === "string" && (
              <InfoRow label="Email" value={selectedEntity.properties.email} />
            )}
            {typeof selectedEntity.properties.status === "string" && (
              <InfoRow label="Status" value={selectedEntity.properties.status} />
            )}
            {selectedEntity.properties.total !== undefined && (
              <InfoRow
                label={t("node.value")}
                value={`$${Number(selectedEntity.properties.total).toLocaleString()}`}
              />
            )}
            {selectedEntity.properties.taskCount !== undefined && (
              <InfoRow
                label={t("node.tasks")}
                value={String(selectedEntity.properties.taskCount)}
              />
            )}
          </div>

          {/* Expanded detail from drill-down API */}
          {detailLoading ? (
            <div className="font-mono text-micro uppercase tracking-wider text-[#666] animate-pulse">
              [ loading ]
            </div>
          ) : entityDetail ? (
            <div className="space-y-2">
              {/* Facts */}
              {entityDetail.facts && entityDetail.facts.length > 0 && (
                <div>
                  <div className="font-mono text-micro uppercase tracking-wider text-[#666] mb-1">
                    {t("node.facts")}
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-hide">
                    {entityDetail.facts.slice(0, 8).map((fact: { content: string; category: string }, i: number) => (
                      <div key={i} className="font-mohave text-[11px] text-[#999] leading-snug">
                        <span className="text-[#666] mr-1">{fact.category}</span>
                        {fact.content}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Connections */}
              {entityDetail.edges && entityDetail.edges.length > 0 && (
                <div>
                  <div className="font-mono text-micro uppercase tracking-wider text-[#666] mb-1">
                    {t("node.edges")}
                  </div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto scrollbar-hide">
                    {entityDetail.edges.slice(0, 6).map((edge: { predicate: string; sourceEntityId: string; targetEntityId: string }, i: number) => (
                      <div key={i} className="font-mohave text-[11px] text-[#999]">
                        {edge.predicate.replace(/_/g, " ")}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Dismiss */}
          <button
            onClick={dismissSelection}
            className="font-mono text-micro uppercase tracking-wider text-[#666] hover:text-white transition-colors"
          >
            {t("node.dismiss")}
          </button>
        </div>
      ) : (
        // Tier 2: Borderless inline info
        <div
          className="space-y-1.5"
          style={{
            background: "radial-gradient(ellipse at center, var(--surface-glass) 0%, transparent 70%)",
            padding: "12px 20px",
          }}
        >
          <div className="font-mohave text-sm text-white">
            {selectedEntity.name}
          </div>
          <div className="font-mono text-micro uppercase tracking-wider text-[#999]">
            {selectedEntity.type}
          </div>

          {/* Type-specific summary */}
          {typeof selectedEntity.properties.email === "string" && (
            <div className="font-mohave text-[11px] text-[#999]">
              {selectedEntity.properties.email}
            </div>
          )}
          {typeof selectedEntity.properties.status === "string" && (
            <div className="font-mohave text-[11px] text-[#999]">
              {selectedEntity.properties.status}
            </div>
          )}
          {selectedEntity.properties.total !== undefined && (
            <div className="font-mohave text-[11px] text-white">
              ${Number(selectedEntity.properties.total).toLocaleString()}
            </div>
          )}

          {/* Expand button */}
          <button
            onClick={() => expandNode(selectedNodeId)}
            className="font-mono text-micro uppercase tracking-wider text-[#6F94B0] hover:text-white transition-colors mt-1"
          >
            [ {t("node.more")} ]
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InfoRow helper
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-micro uppercase tracking-wider text-[#666] flex-shrink-0">
        {label}
      </span>
      <span className="font-mohave text-[11px] text-white text-right truncate">
        {value}
      </span>
    </div>
  );
}
