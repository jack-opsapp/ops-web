"use client";

// ---------------------------------------------------------------------------
// FocusedNodeLabel — 3D-anchored info card for the focused entity.
// Rendered INSIDE the Canvas via drei <Html>. Tracks the focused node's
// position in 3D space so it stays near the node as the camera moves.
// ---------------------------------------------------------------------------

import { Html } from "@react-three/drei";
import { useIntelStore, liveNodePositions } from "@/stores/intel-store";
import type { IntelClientWithStatus } from "@/types/intel";
import type { IntelEntity } from "@/types/intel";

interface FocusedNodeLabelProps {
  clients: IntelClientWithStatus[];
  entities: IntelEntity[];
}

export function FocusedNodeLabel({ clients, entities }: FocusedNodeLabelProps) {
  const focusLevel = useIntelStore((s) => s.focusLevel);
  const focusedClientId = useIntelStore((s) => s.focusedClientId);
  const focusedProjectId = useIntelStore((s) => s.focusedProjectId);

  if (focusLevel < 2) return null;

  // Get focused client info + position
  const client = focusedClientId ? clients.find(c => c.id === focusedClientId) : null;
  const clientPos = focusedClientId ? liveNodePositions.get(focusedClientId) : null;

  if (!client || !clientPos) return null;

  // At L3, also get focused project info + position
  const project = focusedProjectId ? entities.find(e => e.id === focusedProjectId) : null;
  const projectPos = focusedProjectId ? liveNodePositions.get(focusedProjectId) : null;

  // Position the card below the focused node
  const focusPos = focusLevel === 3 && projectPos ? projectPos : clientPos;
  const focusEntity = focusLevel === 3 && project ? project : null;

  return (
    <>
      {/* Client label — always visible at L2+ */}
      <Html
        position={[clientPos.x, clientPos.y - 0.5, clientPos.z]}
        center
        distanceFactor={10}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="text-left whitespace-nowrap px-4 py-2.5"
          style={{
            background: "var(--surface-glass-dense)",
            backdropFilter: "blur(16px) saturate(1.2)",
            WebkitBackdropFilter: "blur(16px) saturate(1.2)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "3px",
          }}
        >
          <div className="font-mohave text-sm text-white leading-tight">
            {client.name}
          </div>
          {client.email && (
            <div className="font-mohave text-micro text-[#999] leading-tight mt-0.5">
              {client.email}
            </div>
          )}
          {client.address && (
            <div className="font-mohave text-micro text-[#666] leading-tight mt-0.5">
              {client.address}
            </div>
          )}
          <div className="font-mono text-micro uppercase tracking-wider text-[#6F94B0] mt-1">
            {client.mostActiveProjectStatus}
          </div>
        </div>
      </Html>

      {/* Project label — visible at L3 */}
      {focusLevel === 3 && project && projectPos && (
        <Html
          position={[projectPos.x, projectPos.y - 0.5, projectPos.z]}
          center
          distanceFactor={10}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="text-left whitespace-nowrap px-4 py-2.5"
            style={{
              background: "var(--surface-glass-dense)",
              backdropFilter: "blur(16px) saturate(1.2)",
              WebkitBackdropFilter: "blur(16px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "3px",
            }}
          >
            <div className="font-mohave text-sm text-white leading-tight">
              {project.name}
            </div>
            {typeof project.properties.address === "string" && (
              <div className="font-mohave text-micro text-[#999] leading-tight mt-0.5">
                {project.properties.address}
              </div>
            )}
            {typeof project.properties.status === "string" && (
              <div className="font-mono text-micro uppercase tracking-wider text-[#6F94B0] mt-1">
                {project.properties.status}
              </div>
            )}
          </div>
        </Html>
      )}
    </>
  );
}
