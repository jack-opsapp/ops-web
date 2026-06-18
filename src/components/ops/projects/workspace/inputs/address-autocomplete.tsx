"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import {
  GeocodingService,
  type GeocodingResult,
  type GeocodingProximity,
} from "@/lib/api/services/geocoding-service";
import { useDictionary } from "@/i18n/client";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;
const STALE_TIME_MS = 5 * 60_000;

export interface AddressSelection {
  address: string;
  latitude: number;
  longitude: number;
}

interface AddressAutocompleteProps {
  /** Currently selected address (controlled). */
  value: string;
  /** Fires when the operator picks a result from the dropdown. */
  onChange: (selection: AddressSelection) => void;
  placeholder?: string;
  /** Optional label override. Defaults to "Address" for accessibility. */
  ariaLabel?: string;
  /** Disables the input. */
  disabled?: boolean;
  /** Biases Mapbox suggestions toward an existing coordinate. */
  proximity?: GeocodingProximity;
  /** Card-inline mode removes the boxed field treatment. */
  variant?: "default" | "inline";
  /** Portals suggestions outside clipped parent surfaces. */
  portalListbox?: boolean;
  /** Forwarded to the underlying input. */
  id?: string;
  className?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  proximity,
  variant = "default",
  portalListbox = false,
  id,
  className,
}: AddressAutocompleteProps) {
  const { t } = useDictionary("project-workspace");
  const resolvedPlaceholder = placeholder ?? t("identity.address.placeholder");
  const resolvedAriaLabel = ariaLabel ?? t("identity.address.aria");
  const [draft, setDraft] = React.useState(value);
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [listboxPosition, setListboxPosition] = React.useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const listboxRef = React.useRef<HTMLUListElement>(null);
  const justSelectedRef = React.useRef(false);
  const isInline = variant === "inline";

  // Sync draft when the parent pushes a new value (e.g. external reset).
  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  // Debounce — push the trimmed input into the query key after 300ms.
  React.useEffect(() => {
    if (justSelectedRef.current) {
      // Skip the next debounce tick after a selection so onChange doesn't
      // immediately re-trigger the dropdown for the value the user just chose.
      justSelectedRef.current = false;
      setDebouncedQuery("");
      return;
    }
    const trimmed = draft.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setDebouncedQuery("");
      return;
    }
    const handle = window.setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft]);

  const { data, isFetching } = useQuery({
    queryKey: [
      "geocode-forward",
      debouncedQuery,
      proximity?.latitude ?? null,
      proximity?.longitude ?? null,
    ],
    queryFn: ({ signal }) =>
      GeocodingService.forwardGeocode(debouncedQuery, {
        signal,
        proximity,
      }),
    enabled: debouncedQuery.length >= MIN_QUERY_LENGTH,
    staleTime: STALE_TIME_MS,
  });

  const results: GeocodingResult[] = data ?? [];
  const showDropdown = isOpen && results.length > 0;
  const listboxId = `${id ?? "address-autocomplete"}-listbox`;

  const updateListboxPosition = React.useCallback(() => {
    if (!portalListbox || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gutter = 8;
    const spaceBelow = viewportHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(260, Math.max(160, (openUp ? spaceAbove : spaceBelow) - 4));
    const top = openUp ? Math.max(gutter, rect.top - maxHeight - 4) : rect.bottom + 4;

    setListboxPosition({
      top,
      left: Math.max(gutter, rect.left),
      width: rect.width,
      maxHeight,
    });
  }, [portalListbox]);

  // Close dropdown on outside click.
  React.useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        if (listboxRef.current?.contains(event.target as Node)) return;
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [isOpen]);

  const handleSelect = (result: GeocodingResult) => {
    justSelectedRef.current = true;
    setDraft(result.fullAddress);
    setIsOpen(false);
    setActiveIndex(0);
    onChange({
      address: result.fullAddress,
      latitude: result.latitude,
      longitude: result.longitude,
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = results[activeIndex];
      if (choice) handleSelect(choice);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  React.useLayoutEffect(() => {
    if (!showDropdown || !portalListbox) return;
    updateListboxPosition();
    window.addEventListener("resize", updateListboxPosition);
    window.addEventListener("scroll", updateListboxPosition, true);
    return () => {
      window.removeEventListener("resize", updateListboxPosition);
      window.removeEventListener("scroll", updateListboxPosition, true);
    };
  }, [portalListbox, showDropdown, updateListboxPosition]);

  const listbox = showDropdown ? (
    <ul
      ref={listboxRef}
      id={listboxId}
      role="listbox"
      className={
        portalListbox
          ? "fixed z-[5000] overflow-y-auto rounded-modal border border-glass-border"
          : "absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto"
      }
      style={
        portalListbox && listboxPosition
          ? {
              top: listboxPosition.top,
              left: listboxPosition.left,
              width: listboxPosition.width,
              maxHeight: listboxPosition.maxHeight,
              background: "var(--glass-bg-dense)",
              backdropFilter:
                "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
              WebkitBackdropFilter:
                "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
              border: "1px solid var(--glass-border)",
              borderRadius: 12,
            }
          : {
              // --glass-dense (rgba(18,18,20,0.78)) is the design-system
              // dropdown surface; --glass-bg-opaque (0.92) is the off-spec
              // tier that keeps address rows readable over Mapbox tiles
              // below. Shadow stack uses the sanctioned floating-window
              // exception token (see uploads/system.md amendment).
              background: "var(--glass-bg-opaque)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid hsl(var(--border))",
              borderRadius: 5,
              // --shadow-dropdown: floating dropdown over Mapbox tiles.
              // Sanctioned exception per uploads/system.md 2026-05-07.
              boxShadow: "var(--shadow-dropdown)",
            }
      }
    >
      {results.map((result, index) => {
        const active = index === activeIndex;
        return (
          <li
            key={result.id}
            id={`${listboxId}-option-${index}`}
            role="option"
            aria-selected={active}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={(e) => {
              // mousedown beats blur so the dropdown still closes via
              // handleSelect rather than collapsing under the click.
              e.preventDefault();
              handleSelect(result);
            }}
            className="cursor-pointer transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid var(--surface-input)",
              background: active ? "var(--surface-active)" : "transparent",
            }}
          >
            <div
              className="font-mohave text-[13px]"
              style={{ color: "var(--text)" }}
            >
              {result.shortAddress}
            </div>
            <div
              className="font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ color: "var(--text-3)" }}
            >
              {result.fullAddress}
            </div>
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <div className="relative">
        {!isInline ? (
          <MapPin
            size={16}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-3)" }}
            aria-hidden="true"
          />
        ) : null}
        <input
          id={id}
          type="text"
          role="combobox"
          aria-label={resolvedAriaLabel}
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            showDropdown ? `${listboxId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={draft}
          placeholder={resolvedPlaceholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          className={
            isInline
              ? "block w-full min-w-0 bg-transparent font-mohave text-body-sm text-text outline-none transition-colors duration-150 placeholder:text-text-3 focus:outline-none"
              : "w-full bg-transparent font-mohave text-sm transition-colors focus:outline-none"
          }
          style={
            isInline
              ? {
                  color: "var(--text)",
                  padding: "1px 0",
                  border: 0,
                  borderBottom: "1px solid hsl(var(--border))",
                  borderRadius: 0,
                  background: "transparent",
                  outline: "none",
                }
              : {
                  color: "var(--text)",
                  paddingLeft: 36,
                  paddingRight: 12,
                  paddingTop: 9,
                  paddingBottom: 9,
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 5,
                  background: "var(--scrim-input-bg)",
                }
          }
        />
      </div>

      {portalListbox && listbox ? createPortal(listbox, document.body) : listbox}

      {isFetching && (
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: "var(--text-mute)" }}
          aria-live="polite"
        >
          ...
        </span>
      )}
    </div>
  );
}
