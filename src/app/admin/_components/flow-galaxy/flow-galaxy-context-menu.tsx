/* ── src/app/admin/_components/flow-galaxy/flow-galaxy-context-menu.tsx ── */

'use client';

import { useEffect, useRef } from 'react';
import type { ContextMenuState } from './types';

interface FlowGalaxyContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
}

export function FlowGalaxyContextMenu({ state, onClose }: FlowGalaxyContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [state.visible, onClose]);

  if (!state.visible) return null;

  return (
    <div
      ref={ref}
      className="absolute z-40"
      style={{
        left: state.screenX,
        top: state.screenY,
        width: 180,
      }}
    >
      <div
        className="rounded-[3px] py-1 overflow-hidden"
        style={{
          background: 'rgba(10,10,10,0.80)',
          backdropFilter: 'blur(20px) saturate(1.2)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {state.items.map((item, i) => (
          <button
            key={i}
            onClick={() => { item.action(); onClose(); }}
            className="w-full text-left px-3 py-2 font-mohave text-[11px] uppercase tracking-wider text-[#E5E5E5] hover:bg-white/[0.05] transition-colors"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
