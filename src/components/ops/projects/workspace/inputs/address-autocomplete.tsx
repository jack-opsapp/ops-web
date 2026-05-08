"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import {
  GeocodingService,
  type GeocodingResult,
} from "@/lib/api/services/geocoding-service";

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
  /** Forwarded to the underlying input. */
  id?: string;
  className?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Search address",
  ariaLabel = "Address",
  disabled,
  id,
  className,
}: AddressAutocompleteProps) {
  const [draft, setDraft] = React.useState(value);
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const justSelectedRef = React.useRef(false);

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
    queryKey: ["geocode-forward", debouncedQuery],
    queryFn: ({ signal }) => GeocodingService.forwardGeocode(debouncedQuery, { signal }),
    enabled: debouncedQuery.length >= MIN_QUERY_LENGTH,
    staleTime: STALE_TIME_MS,
  });

  const results: GeocodingResult[] = data ?? [];
  const showDropdown = isOpen && results.length > 0;

  // Close dropdown on outside click.
  React.useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
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

  const listboxId = `${id ?? "address-autocomplete"}-listbox`;

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <div className="relative">
        <MapPin
          size={14}
          strokeWidth={1.5}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-3)" }}
          aria-hidden="true"
        />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
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
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent font-mohave text-sm transition-colors focus:outline-none"
          style={{
            color: "var(--text)",
            paddingLeft: 32,
            paddingRight: 12,
            paddingTop: 9,
            paddingBottom: 9,
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 5,
            background: "rgba(0,0,0,0.45)",
          }}
        />
      </div>

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto"
          style={{
            // --glass-dense (rgba(18,18,20,0.78)) is the design-system
            // dropdown surface; raised to 0.92 here to keep address rows
            // readable over Mapbox tiles below.
            background: "rgba(18,18,20,0.92)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 5,
            boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
          }}
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
                className="cursor-pointer transition-colors"
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: active ? "var(--ops-accent-soft)" : "transparent",
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
      )}

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
