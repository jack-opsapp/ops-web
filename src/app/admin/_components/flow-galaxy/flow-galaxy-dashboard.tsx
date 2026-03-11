/* ── src/app/admin/_components/flow-galaxy/flow-galaxy-dashboard.tsx ── */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  GalaxyQueryParams, GalaxyId, GalaxyCamera, GalaxyNode,
  UniverseData, TraceState, ContextMenuState,
} from './types';
import { DEFAULT_ZOOM, LANDING_CENTER, APP_CENTER } from './types';
import type { FlowData } from '@/lib/admin/flow-types';
import { buildUniverse } from './transform';
import { FlowGalaxyCanvas, navigateToGalaxy, navigateToNode } from './flow-galaxy-canvas';
import { FlowGalaxyControls } from './flow-galaxy-controls';
import { FlowGalaxyOverlay } from './flow-galaxy-overlay';
import { FlowGalaxyBreadcrumb } from './flow-galaxy-breadcrumb';
import { FlowGalaxyContextMenu } from './flow-galaxy-context-menu';

export function FlowGalaxyDashboard() {
  const [params, setParams] = useState<GalaxyQueryParams>({ days: 30, device: 'all' });
  const [activeGalaxy, setActiveGalaxy] = useState<GalaxyId | 'all'>('all');
  const [universe, setUniverse] = useState<UniverseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [overlayPos, setOverlayPos] = useState({ x: 0, y: 0 });
  const [overlayDeviceFilter, setOverlayDeviceFilter] = useState('all');

  // Trace
  const [trace, setTrace] = useState<TraceState | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, screenX: 0, screenY: 0, nodeId: '', items: [],
  });

  // Camera ref for imperative navigation
  const cameraRef = useRef<GalaxyCamera>({
    x: 0, y: 0, zoom: DEFAULT_ZOOM,
    targetX: 0, targetY: 0, targetZoom: DEFAULT_ZOOM,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  /* ── Data fetching ── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({
      days: String(params.days),
      device: params.device,
    });

    Promise.all([
      fetch(`/api/admin/analytics/flow?${qs}&variant=all`)
        .then(r => r.ok ? r.json() as Promise<FlowData> : null)
        .catch(() => null),
      fetch(`/api/admin/analytics/app-flow?${qs}`)
        .then(r => r.ok ? r.json() as Promise<FlowData> : null)
        .catch(() => null),
    ]).then(([landingData, appData]) => {
      if (cancelled) return;
      const uni = buildUniverse(landingData, appData);
      setUniverse(uni);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [params]);

  /* ── Galaxy navigation ── */
  const handleGalaxySelect = useCallback((id: GalaxyId | 'all') => {
    setActiveGalaxy(id);
    navigateToGalaxy(cameraRef, id);
    setSelectedNodeId(null);
    setTrace(null);
  }, []);

  /* ── Node click ── */
  const handleNodeClick = useCallback((nodeId: string, sx: number, sy: number) => {
    setSelectedNodeId(nodeId);
    setOverlayPos({ x: sx, y: sy });
    setOverlayDeviceFilter('all');
    setContextMenu(prev => ({ ...prev, visible: false }));

    // Navigate camera to node
    if (universe) {
      const allNodes = universe.galaxies.flatMap(g => g.nodes);
      const node = allNodes.find(n => n.id === nodeId);
      if (node) navigateToNode(cameraRef, node);
    }
  }, [universe]);

  /* ── Node right-click ── */
  const handleNodeRightClick = useCallback((nodeId: string, sx: number, sy: number) => {
    setContextMenu({
      visible: true,
      screenX: sx,
      screenY: sy,
      nodeId,
      items: [
        { label: 'Trace flow from here', action: () => activateTrace(nodeId, 'downstream') },
        { label: 'Trace flow to here', action: () => activateTrace(nodeId, 'upstream') },
        {
          label: 'Reset position', action: () => {
            if (!universe) return;
            const allNodes = universe.galaxies.flatMap(g => g.nodes);
            const node = allNodes.find(n => n.id === nodeId);
            if (node) { node.dragOffsetX = 0; node.dragOffsetY = 0; }
          },
        },
      ],
    });
  }, [universe]);

  /* ── Empty click ── */
  const handleEmptyClick = useCallback(() => {
    setSelectedNodeId(null);
    setTrace(null);
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  /* ── Trace mode ── */
  const activateTrace = useCallback((nodeId: string, direction: 'downstream' | 'upstream') => {
    if (!universe) return;

    const allNodes = universe.galaxies.flatMap(g => g.nodes);
    const allEdges = [...universe.galaxies.flatMap(g => g.edges), ...universe.bridgeEdges];
    const sourceNode = allNodes.find(n => n.id === nodeId);
    if (!sourceNode) return;

    const highlightedEdgeIds = new Set<string>();
    const highlightedNodeIds = new Set<string>([nodeId]);
    const nodeMetrics = new Map<string, TraceState['nodeMetrics'] extends Map<string, infer V> ? V : never>();
    const edgeLabels = new Map<string, { count: number; pct: number }>();

    // BFS to find all connected paths
    const queue = [nodeId];
    const visited = new Set<string>([nodeId]);
    const sourceViews = sourceNode.views || 1;

    while (queue.length > 0) {
      const current = queue.shift()!;
      const connectedEdges = direction === 'downstream'
        ? allEdges.filter(e => e.sourceId === current)
        : allEdges.filter(e => e.targetId === current);

      for (const edge of connectedEdges) {
        highlightedEdgeIds.add(edge.id);
        const nextId = direction === 'downstream' ? edge.targetId : edge.sourceId;
        highlightedNodeIds.add(nextId);

        edgeLabels.set(edge.id, {
          count: edge.count,
          pct: (edge.count / sourceViews) * 100,
        });

        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);

          const nextNode = allNodes.find(n => n.id === nextId);
          if (nextNode) {
            nodeMetrics.set(nextId, {
              reached: nextNode.views,
              reachedPct: (nextNode.views / sourceViews) * 100,
              converted: Math.round(nextNode.conversionRate * nextNode.views),
              convertedPct: nextNode.conversionRate * 100,
              droppedOff: nextNode.dropoffCount,
              droppedOffPct: nextNode.dropoffRate * 100,
              avgDwellMs: nextNode.avgDwellMs,
            });
          }
        }
      }
    }

    setTrace({
      active: true,
      sourceNodeId: nodeId,
      direction,
      highlightedEdgeIds,
      highlightedNodeIds,
      nodeMetrics,
      edgeLabels,
    });
  }, [universe]);

  /* ── Selected node ── */
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !universe) return null;
    return universe.galaxies.flatMap(g => g.nodes).find(n => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, universe]);

  /* ── Breadcrumb segments ── */
  const breadcrumbs = useMemo(() => {
    const segments = [
      { label: 'Universe', onClick: () => handleGalaxySelect('all') },
    ];

    if (selectedNode) {
      const galaxyLabel = selectedNode.galaxyId === 'landing' ? 'Landing Page' : 'App Usage';
      segments.push({
        label: galaxyLabel,
        onClick: () => handleGalaxySelect(selectedNode.galaxyId),
      });
      if (selectedNode.parentId) {
        const parent = universe?.galaxies.flatMap(g => g.nodes).find(n => n.id === selectedNode.parentId);
        if (parent) {
          segments.push({
            label: parent.label,
            onClick: () => handleNodeClick(parent.id, overlayPos.x, overlayPos.y),
          });
        }
      }
      segments.push({ label: selectedNode.label, onClick: () => {} });
    } else if (activeGalaxy !== 'all') {
      segments.push({
        label: activeGalaxy === 'landing' ? 'Landing Page' : 'App Usage',
        onClick: () => {},
      });
    }

    return segments;
  }, [selectedNode, activeGalaxy, universe, handleGalaxySelect, handleNodeClick, overlayPos]);

  /* ── Container size for overlay positioning ── */
  const containerSize = useMemo(() => {
    const el = containerRef.current;
    if (!el) return { width: 800, height: 600 };
    return { width: el.clientWidth, height: el.clientHeight };
  }, [selectedNodeId]); // re-read when overlay shows

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0">
      <FlowGalaxyControls
        params={params}
        onChange={setParams}
        activeGalaxy={activeGalaxy}
        onGalaxySelect={handleGalaxySelect}
      />

      <div className="flex-1 relative min-h-0">
        <FlowGalaxyCanvas
          universe={universe}
          loading={loading}
          error={error}
          onNodeClick={handleNodeClick}
          onNodeRightClick={handleNodeRightClick}
          onEmptyClick={handleEmptyClick}
          selectedNodeId={selectedNodeId}
          trace={trace}
        />

        {/* Overlay */}
        {selectedNode && (
          <FlowGalaxyOverlay
            node={selectedNode}
            screenX={overlayPos.x}
            screenY={overlayPos.y}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            onClose={() => setSelectedNodeId(null)}
            onTraceDownstream={(id) => { activateTrace(id, 'downstream'); setSelectedNodeId(null); }}
            onTraceUpstream={(id) => { activateTrace(id, 'upstream'); setSelectedNodeId(null); }}
            deviceFilter={overlayDeviceFilter}
            onDeviceFilterChange={setOverlayDeviceFilter}
          />
        )}

        {/* Context menu */}
        <FlowGalaxyContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(prev => ({ ...prev, visible: false }))}
        />

        {/* Breadcrumb */}
        <FlowGalaxyBreadcrumb segments={breadcrumbs} />

        {/* Error retry */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <button
              onClick={() => setParams({ ...params })}
              className="pointer-events-auto font-mohave text-[12px] uppercase tracking-wider text-[#597794] hover:text-[#E5E5E5] transition-colors mt-16"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
