'use client';

import { useMemo } from 'react';
import type { GalaxyNode } from './types';

interface FlowGalaxyOverlayProps {
  node: GalaxyNode;
  screenX: number;
  screenY: number;
  containerWidth: number;
  containerHeight: number;
  onClose: () => void;
  onTraceDownstream: (nodeId: string) => void;
  onTraceUpstream: (nodeId: string) => void;
  deviceFilter: string;
  onDeviceFilterChange: (device: string) => void;
}

export function FlowGalaxyOverlay({
  node, screenX, screenY,
  containerWidth, containerHeight,
  onClose, onTraceDownstream, onTraceUpstream,
  deviceFilter, onDeviceFilterChange,
}: FlowGalaxyOverlayProps) {
  // Position: right of node by default, flip if near edge
  const position = useMemo(() => {
    const flipX = screenX > containerWidth - 320;
    const flipY = screenY < 200;
    const x = flipX ? screenX - 300 : screenX + 20;
    const y = flipY ? screenY : screenY - 60;
    return { x: Math.max(8, x), y: Math.max(8, y) };
  }, [screenX, screenY, containerWidth, containerHeight]);

  const maxH = Math.min(400, containerHeight - 100);

  const col = node.healthTier === 'healthy' ? '#597794'
    : node.healthTier === 'moderate' ? '#C4A868'
    : 'rgb(147,65,55)';

  const formatDwell = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  const formatPct = (v: number) => `${Math.round(v * 100)}%`;
  const formatViews = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);

  // Sparkline SVG
  const sparklinePath = useMemo(() => {
    if (!node.sparkline || node.sparkline.length < 2) return null;
    const vals = node.sparkline.map(s => s.value);
    const max = Math.max(1, ...vals);
    const min = Math.min(...vals);
    const range = max - min || 1;
    const w = 248;
    const h = 50;
    const points = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    });
    return {
      line: `M${points.join(' L')}`,
      area: `M0,${h} L${points.join(' L')} L${w},${h} Z`,
    };
  }, [node.sparkline]);

  return (
    <div
      className="absolute z-30 pointer-events-auto"
      style={{
        left: position.x,
        top: position.y,
        width: 280,
        maxHeight: maxH,
      }}
    >
      <div
        className="overflow-y-auto scrollbar-hide rounded-[3px] p-4"
        style={{
          background: 'rgba(10,10,10,0.70)',
          backdropFilter: 'blur(20px) saturate(1.2)',
          border: '1px solid rgba(255,255,255,0.08)',
          maxHeight: maxH,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: col }} />
            <span className="font-mohave text-[14px] uppercase text-[#E5E5E5] tracking-wider">
              {node.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors font-mohave text-[12px]"
          >
            ×
          </button>
        </div>

        <p className="font-kosugi text-[11px] text-[#6B6B6B] mb-3">
          {node.type} · {formatViews(node.views)} views
        </p>

        {/* Sparkline */}
        {sparklinePath && (
          <div className="mb-3 border-t border-b border-white/[0.05] py-2">
            <svg width="248" height="50" viewBox="0 0 248 50" className="w-full">
              <defs>
                <linearGradient id={`grad-${node.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(89,119,148,0.15)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
              <path d={sparklinePath.area} fill={`url(#grad-${node.id})`} />
              <path d={sparklinePath.line} fill="none" stroke="#597794" strokeWidth="1.5" />
            </svg>
          </div>
        )}

        {/* Device toggle */}
        <div className="flex items-center gap-2 mb-3">
          <span className="font-kosugi text-[10px] uppercase text-[#6B6B6B]">Device</span>
          <div className="flex gap-0 border border-white/[0.08] rounded-[2px] overflow-hidden">
            {['all', 'mobile', 'desktop', 'tablet'].map(d => (
              <button
                key={d}
                onClick={() => onDeviceFilterChange(d)}
                className={`px-2 py-0.5 font-kosugi text-[9px] uppercase transition-colors
                  ${deviceFilter === d ? 'bg-[#597794]/20 text-[#E5E5E5]' : 'text-[#6B6B6B] hover:text-[#A0A0A0]'}
                `}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Metrics */}
        <div className="space-y-1.5 mb-3 border-t border-white/[0.05] pt-3">
          <MetricRow label="Avg Dwell" value={formatDwell(node.avgDwellMs)} />
          <MetricRow
            label="Dropoff"
            value={formatPct(node.dropoffRate)}
            color={node.dropoffRate > 0.5 ? 'rgb(147,65,55)' : undefined}
          />
          <MetricRow
            label="Conversion"
            value={formatPct(node.conversionRate)}
            color={node.conversionRate > 0.1 ? '#597794' : undefined}
          />
        </div>

        {/* Click breakdown */}
        {node.clickBreakdown.length > 0 && (
          <div className="border-t border-white/[0.05] pt-3 mb-3">
            <p className="font-kosugi text-[10px] uppercase text-[#6B6B6B] tracking-wider mb-2">
              Click Breakdown
            </p>
            <div className="space-y-1">
              {node.clickBreakdown.slice(0, 6).map(cb => (
                <div key={cb.elementId} className="flex items-center justify-between">
                  <span className="font-kosugi text-[10px] text-[#A0A0A0] truncate flex-1 mr-2">
                    {cb.elementId.replace(/-/g, ' ')}
                  </span>
                  <span className="font-mohave text-[11px] text-[#E5E5E5]">{cb.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Device breakdown */}
        {node.deviceBreakdown.length > 0 && (
          <div className="border-t border-white/[0.05] pt-3 mb-3">
            <p className="font-kosugi text-[10px] uppercase text-[#6B6B6B] tracking-wider mb-2">
              Devices
            </p>
            <div className="space-y-1">
              {node.deviceBreakdown.map(db => (
                <div key={db.device} className="flex items-center justify-between">
                  <span className="font-kosugi text-[10px] text-[#A0A0A0]">{db.device}</span>
                  <span className="font-mohave text-[11px] text-[#E5E5E5]">{db.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trace actions */}
        <div className="flex gap-2 border-t border-white/[0.05] pt-3">
          <button
            onClick={() => onTraceDownstream(node.id)}
            className="flex-1 py-1.5 border border-[#597794]/30 rounded-[2px] font-mohave text-[10px] uppercase tracking-wider text-[#597794] hover:bg-[#597794]/10 transition-colors"
          >
            Trace Flow ↓
          </button>
          <button
            onClick={() => onTraceUpstream(node.id)}
            className="flex-1 py-1.5 border border-[#597794]/30 rounded-[2px] font-mohave text-[10px] uppercase tracking-wider text-[#597794] hover:bg-[#597794]/10 transition-colors"
          >
            Trace Upstream ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-kosugi text-[11px] text-[#6B6B6B]">{label}</span>
      <span className="font-mohave text-[13px]" style={{ color: color ?? '#E5E5E5' }}>{value}</span>
    </div>
  );
}
