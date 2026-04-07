"use client";

import { create } from "zustand";

// ── Constants ──
export const POPOVER_DEFAULT_WIDTH = 440;
export const POPOVER_DEFAULT_HEIGHT = 520;
export const POPOVER_MIN_WIDTH = 360;
export const POPOVER_MIN_HEIGHT = 320;
export const POPOVER_Z_BASE = 2000;
const CARD_OFFSET_X = 220;
const CASCADE_OFFSET = 30;

// ── Types ──
export type InvoicePopoverTab = "overview" | "payments" | "activity";

export interface InvoiceDetailPopoverState {
  id: string;
  title: string;
  color: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  isMinimized: boolean;
  activeTab: InvoicePopoverTab;
}

interface InvoiceDetailPopoverStoreState {
  popovers: Map<string, InvoiceDetailPopoverState>;
  nextZIndex: number;

  openPopover: (invoiceId: string, screenPosition: { x: number; y: number }, title: string, color: string) => void;
  closePopover: (id: string) => void;
  closeAllPopovers: () => void;
  focusPopover: (id: string) => void;
  minimizePopover: (id: string) => void;
  restorePopover: (id: string) => void;
  updatePosition: (id: string, position: { x: number; y: number }) => void;
  updateSize: (id: string, size: { width: number; height: number }) => void;
  setActiveTab: (id: string, tab: InvoicePopoverTab) => void;
}

function clampPosition(
  x: number,
  y: number,
  width: number = POPOVER_DEFAULT_WIDTH,
  height: number = POPOVER_DEFAULT_HEIGHT,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, globalThis.innerWidth - width)),
    y: Math.max(0, Math.min(y, globalThis.innerHeight - height)),
  };
}

function findNonOverlappingPosition(
  baseX: number,
  baseY: number,
  existing: Map<string, InvoiceDetailPopoverState>
): { x: number; y: number } {
  let x = baseX;
  let y = baseY;
  const visible = Array.from(existing.values()).filter((p) => !p.isMinimized);

  for (let i = 0; i < visible.length; i++) {
    const overlaps = visible.some(
      (p) =>
        Math.abs(p.position.x - x) < 40 && Math.abs(p.position.y - y) < 40
    );
    if (!overlaps) break;
    x += CASCADE_OFFSET;
    y += CASCADE_OFFSET;
  }

  return clampPosition(x, y);
}

export const useInvoiceDetailPopoverStore = create<InvoiceDetailPopoverStoreState>()(
  (set, get) => ({
    popovers: new Map(),
    nextZIndex: POPOVER_Z_BASE,

    openPopover: (invoiceId, screenPosition, title, color) => {
      const { popovers, nextZIndex } = get();
      const existing = popovers.get(invoiceId);

      if (existing) {
        const updated = new Map(popovers);
        updated.set(invoiceId, {
          ...existing,
          isMinimized: false,
          zIndex: nextZIndex,
        });
        set({ popovers: updated, nextZIndex: nextZIndex + 1 });
        return;
      }

      const baseX = screenPosition.x + CARD_OFFSET_X;
      const baseY = screenPosition.y;
      const position = findNonOverlappingPosition(baseX, baseY, popovers);

      const updated = new Map(popovers);
      updated.set(invoiceId, {
        id: invoiceId,
        title,
        color,
        position,
        size: { width: POPOVER_DEFAULT_WIDTH, height: POPOVER_DEFAULT_HEIGHT },
        zIndex: nextZIndex,
        isMinimized: false,
        activeTab: "overview",
      });
      set({ popovers: updated, nextZIndex: nextZIndex + 1 });
    },

    closePopover: (id) => {
      const updated = new Map(get().popovers);
      updated.delete(id);
      set({ popovers: updated });
    },

    closeAllPopovers: () => {
      set({ popovers: new Map() });
    },

    focusPopover: (id) => {
      const { popovers, nextZIndex } = get();
      const existing = popovers.get(id);
      if (!existing) return;
      const updated = new Map(popovers);
      updated.set(id, { ...existing, zIndex: nextZIndex });
      set({ popovers: updated, nextZIndex: nextZIndex + 1 });
    },

    minimizePopover: (id) => {
      const { popovers } = get();
      const existing = popovers.get(id);
      if (!existing) return;
      const updated = new Map(popovers);
      updated.set(id, { ...existing, isMinimized: true });
      set({ popovers: updated });
    },

    restorePopover: (id) => {
      const { popovers, nextZIndex } = get();
      const existing = popovers.get(id);
      if (!existing) return;
      const updated = new Map(popovers);
      updated.set(id, { ...existing, isMinimized: false, zIndex: nextZIndex });
      set({ popovers: updated, nextZIndex: nextZIndex + 1 });
    },

    updatePosition: (id, position) => {
      const { popovers } = get();
      const existing = popovers.get(id);
      if (!existing) return;
      const updated = new Map(popovers);
      updated.set(id, { ...existing, position });
      set({ popovers: updated });
    },

    updateSize: (id, size) => {
      const { popovers } = get();
      const existing = popovers.get(id);
      if (!existing) return;
      const clamped = {
        width: Math.max(POPOVER_MIN_WIDTH, Math.min(size.width, globalThis.innerWidth - existing.position.x)),
        height: Math.max(POPOVER_MIN_HEIGHT, Math.min(size.height, globalThis.innerHeight - existing.position.y)),
      };
      const updated = new Map(popovers);
      updated.set(id, { ...existing, size: clamped });
      set({ popovers: updated });
    },

    setActiveTab: (id, tab) => {
      const { popovers } = get();
      const existing = popovers.get(id);
      if (!existing) return;
      const updated = new Map(popovers);
      updated.set(id, { ...existing, activeTab: tab });
      set({ popovers: updated });
    },
  })
);
