/* ── src/app/admin/_components/flow-galaxy/flow-galaxy-legend.tsx ── */

'use client';

import { useState } from 'react';

export function FlowGalaxyLegend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-4 right-4 z-20">
      <div
        className="rounded-[3px] overflow-hidden"
        style={{
          background: 'rgba(10,10,10,0.60)',
          backdropFilter: 'blur(12px) saturate(1.2)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.03] transition-colors"
        >
          <span className="font-kosugi text-[9px] uppercase tracking-wider text-[#6B6B6B]">
            Legend
          </span>
          <span className="font-kosugi text-[9px] text-[#6B6B6B]">
            {collapsed ? '+' : '-'}
          </span>
        </button>

        {!collapsed && (
          <div className="px-3 pb-2 space-y-1.5">
            {/* Health colors */}
            <div className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#597794' }} />
              <span className="font-kosugi text-[9px] text-[#A0A0A0]">Healthy (&lt;25% drop)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#C4A868' }} />
              <span className="font-kosugi text-[9px] text-[#A0A0A0]">Moderate (25-55%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full" style={{ background: 'rgb(147,65,55)' }} />
              <span className="font-kosugi text-[9px] text-[#A0A0A0]">Critical (&gt;55% drop)</span>
            </div>

            <div className="border-t border-white/[0.05] my-1" />

            {/* Visual encoding */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-[2px]">
                <div className="w-[4px] h-[4px] rounded-full bg-[#597794]/60" />
                <div className="w-[6px] h-[6px] rounded-full bg-[#597794]/80" />
                <div className="w-[4px] h-[4px] rounded-full bg-[#597794]/60" />
              </div>
              <span className="font-kosugi text-[9px] text-[#A0A0A0]">Size = traffic</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full bg-[#597794]/30 ring-1 ring-[#597794]/20" />
              <span className="font-kosugi text-[9px] text-[#A0A0A0]">Glow = engagement</span>
            </div>

            <div className="border-t border-white/[0.05] my-1" />

            {/* Interaction hints */}
            <span className="font-kosugi text-[8px] text-[#6B6B6B] block">Scroll to zoom / Drag to pan</span>
            <span className="font-kosugi text-[8px] text-[#6B6B6B] block">Click node for details</span>
            <span className="font-kosugi text-[8px] text-[#6B6B6B] block">Right-click to trace flow</span>
          </div>
        )}
      </div>
    </div>
  );
}
