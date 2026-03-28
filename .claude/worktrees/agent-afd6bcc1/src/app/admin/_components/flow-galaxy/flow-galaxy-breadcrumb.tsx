/* ── src/app/admin/_components/flow-galaxy/flow-galaxy-breadcrumb.tsx ── */

'use client';

interface BreadcrumbSegment {
  label: string;
  onClick: () => void;
}

interface FlowGalaxyBreadcrumbProps {
  segments: BreadcrumbSegment[];
}

export function FlowGalaxyBreadcrumb({ segments }: FlowGalaxyBreadcrumbProps) {
  if (segments.length <= 1) return null;

  return (
    <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="font-kosugi text-[10px] text-[#6B6B6B]">›</span>}
          <button
            onClick={seg.onClick}
            className={`font-mohave text-[11px] uppercase tracking-wider transition-colors
              ${i === segments.length - 1
                ? 'text-[#E5E5E5]'
                : 'text-[#6B6B6B] hover:text-[#A0A0A0]'
              }
            `}
          >
            {seg.label}
          </button>
        </span>
      ))}
    </div>
  );
}
