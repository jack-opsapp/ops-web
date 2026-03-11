/* ── src/app/admin/_components/flow-galaxy/flow-galaxy-controls.tsx ── */

'use client';

import type { GalaxyQueryParams, GalaxyId } from './types';

interface FlowGalaxyControlsProps {
  params: GalaxyQueryParams;
  onChange: (params: GalaxyQueryParams) => void;
  activeGalaxy: GalaxyId | 'all';
  onGalaxySelect: (id: GalaxyId | 'all') => void;
}

const GALAXY_OPTIONS: { id: GalaxyId | 'all'; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'landing', label: 'LANDING PAGE' },
  { id: 'app', label: 'APP USAGE' },
];

const DEVICE_OPTIONS = ['all', 'mobile', 'desktop', 'tablet'] as const;
const PERIOD_OPTIONS = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
  { value: 9999, label: 'ALL' },
] as const;

export function FlowGalaxyControls({
  params, onChange, activeGalaxy, onGalaxySelect,
}: FlowGalaxyControlsProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.08]">
      {/* Galaxy segmented picker */}
      <div className="flex items-center gap-0 border border-white/[0.08] rounded-[3px] overflow-hidden">
        {GALAXY_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => onGalaxySelect(opt.id)}
            className={`
              px-4 py-1.5 font-mohave text-[11px] uppercase tracking-wider transition-colors
              ${activeGalaxy === opt.id
                ? 'bg-[#597794]/20 text-[#E5E5E5]'
                : 'text-[#6B6B6B] hover:text-[#A0A0A0]'
              }
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4">
        {/* Device filter */}
        <div className="flex items-center gap-2">
          <span className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B]">
            Device
          </span>
          <select
            value={params.device}
            onChange={(e) => onChange({ ...params, device: e.target.value })}
            className="bg-transparent border border-white/[0.08] rounded-[3px] px-2 py-1 font-mohave text-[11px] uppercase text-[#E5E5E5] outline-none cursor-pointer"
          >
            {DEVICE_OPTIONS.map(d => (
              <option key={d} value={d} className="bg-[#0D0D0D]">
                {d.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* Period filter */}
        <div className="flex items-center gap-0 border border-white/[0.08] rounded-[3px] overflow-hidden">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onChange({ ...params, days: opt.value })}
              className={`
                px-3 py-1.5 font-mohave text-[11px] uppercase tracking-wider transition-colors
                ${params.days === opt.value
                  ? 'bg-[#597794]/20 text-[#E5E5E5]'
                  : 'text-[#6B6B6B] hover:text-[#A0A0A0]'
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
