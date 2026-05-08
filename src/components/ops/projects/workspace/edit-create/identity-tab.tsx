"use client";

import * as React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Search, Check } from "lucide-react";
import { useClients } from "@/lib/hooks/use-clients";
import type { Client } from "@/lib/types/models";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Field } from "@/components/ops/projects/workspace/atoms/field";
import { FieldRow } from "@/components/ops/projects/workspace/atoms/field-row";
import { TextInput } from "@/components/ops/projects/workspace/atoms/text-input";
import { TextArea } from "@/components/ops/projects/workspace/atoms/text-area";
import { Select } from "@/components/ops/projects/workspace/atoms/select";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { AddressAutocomplete } from "@/components/ops/projects/workspace/inputs/address-autocomplete";
import { cn } from "@/lib/utils/cn";
import type {
  EditCreateMode,
  ProjectEditCreateFormValues,
} from "./project-edit-create-body";

// `IdentityTab` — workspace edit/create identity surface.
//
// Reads the shared form context and registers five fields:
//   title                 → projects.title          (required)
//   clientId              → projects.client_id      (optional, picker)
//   trade                 → projects.trade          (required when creating,
//                            optional when editing legacy projects)
//   address + lat + lon   → projects.{address,latitude,longitude}
//                            written atomically by AddressAutocomplete
//   projectDescription    → projects.description    (multi-line)
//
// Trade values are lowercase (`roofing` / `hvac` / `plumbing`) to match
// the `projects_trade_check` constraint; the Select labels uppercase
// for the OPS tactical voice.

// ─── ClientPicker (tab-local) ────────────────────────────────────────────────

interface ClientPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
}

function ClientPicker({ value, onChange, required }: ClientPickerProps) {
  const { data, isLoading } = useClients();
  const clients = data?.clients ?? [];
  const linked = clients.find((c) => c.id === value) ?? null;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Outside-click closes the dropdown.
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Auto-focus the search box when the dropdown opens.
  React.useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const filtered = React.useMemo<Client[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, query]);

  const handlePick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <Field label="CLIENT" optional={!required} required={required}>
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          data-testid="client-picker-trigger"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full h-8 items-center justify-between gap-2 px-2",
            "font-mohave text-[14px] leading-[1.4]",
            "bg-[var(--surface-input)] rounded-[5px] border border-glass-border",
            "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "hover:border-glass-border-medium",
            "focus:outline-none focus:border-glass-border-strong",
            "cursor-pointer text-left",
            linked ? "text-text" : "text-text-mute",
          )}
        >
          {linked ? (
            <span className="truncate">{linked.name}</span>
          ) : (
            <span data-testid="client-picker-empty">No client linked</span>
          )}
          <Search size={12} strokeWidth={1.5} className="text-text-3 shrink-0" />
        </button>

        {open && (
          <div
            className={cn(
              "absolute left-0 right-0 z-50 mt-1 overflow-hidden",
              "glass-dense rounded-panel border border-glass-border",
            )}
          >
            <div className="relative border-b border-glass-border">
              <Search
                size={12}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-mute"
              />
              <input
                ref={searchRef}
                data-testid="client-picker-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  "w-full h-8 pl-7 pr-2 bg-transparent",
                  "font-mohave text-[14px] text-text",
                  "placeholder:text-text-mute focus:outline-none",
                )}
              />
            </div>
            <div className="max-h-[200px] overflow-y-auto p-0.5">
              {linked && (
                <button
                  type="button"
                  data-testid="client-picker-clear"
                  onClick={() => handlePick(null)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-chip py-1.5 pl-2 pr-2",
                    "font-mohave text-[14px] text-text-3",
                    "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    "hover:bg-[var(--surface-input)] hover:text-text-2 cursor-pointer",
                  )}
                >
                  Remove client
                </button>
              )}
              {isLoading ? (
                <div className="px-2 py-2">
                  <Mono size={11} color="text-3">
                    LOADING…
                  </Mono>
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-2 py-2">
                  <Mono size={11} color="text-3">
                    NO CLIENTS FOUND
                  </Mono>
                </div>
              ) : (
                filtered.map((c) => {
                  const active = c.id === value;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handlePick(c.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-chip py-1.5 pl-2 pr-2",
                        "font-mohave text-[14px] text-text",
                        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        "hover:bg-[var(--surface-input)] cursor-pointer",
                        active && "bg-[var(--surface-input)]",
                      )}
                    >
                      <span className="truncate">{c.name}</span>
                      {active && (
                        <Check
                          size={12}
                          strokeWidth={2}
                          className="text-ops-accent shrink-0"
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}

// ─── IdentityTab ─────────────────────────────────────────────────────────────

const TRADE_OPTIONS = [
  { value: "roofing", label: "ROOFING" },
  { value: "hvac", label: "HVAC" },
  { value: "plumbing", label: "PLUMBING" },
];

export interface IdentityTabProps {
  /** Drives the required/optional state of the Trade field — creating
   *  requires a category up front, editing leaves NULL trades alone for
   *  legacy projects. */
  mode: EditCreateMode;
}

export function IdentityTab({ mode }: IdentityTabProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ProjectEditCreateFormValues>();

  const tradeRequired = mode === "creating";

  return (
    <Stack gap={3} data-testid="identity-tab">
      <Section title="IDENTITY">
        <Stack gap={2}>
          <Field
            label="PROJECT NAME"
            required
            error={errors.title?.message}
          >
            <TextInput
              {...register("title")}
              placeholder="e.g. Acme HQ Reroof"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <FieldRow
            gap={2}
            columns={["2fr", "1fr"]}
            data-testid="identity-client-trade-row"
          >
            <Controller
              control={control}
              name="clientId"
              render={({ field }) => (
                <ClientPicker
                  value={field.value}
                  onChange={(id) => field.onChange(id)}
                />
              )}
            />

            <Controller
              control={control}
              name="trade"
              render={({ field }) => (
                <Field
                  label="TRADE"
                  required={tradeRequired}
                  optional={!tradeRequired}
                  error={errors.trade?.message}
                >
                  <Select
                    options={TRADE_OPTIONS}
                    value={field.value ?? undefined}
                    onChange={(v) =>
                      field.onChange(
                        v as ProjectEditCreateFormValues["trade"],
                      )
                    }
                    placeholder="—"
                    aria-invalid={errors.trade ? "true" : undefined}
                  />
                </Field>
              )}
            />
          </FieldRow>

          <Field
            label="SITE ADDRESS"
            optional
            hint="Pick from the list to capture coordinates"
          >
            <Controller
              control={control}
              name="address"
              render={({ field }) => (
                <AddressAutocomplete
                  value={field.value ?? ""}
                  onChange={(sel) => {
                    field.onChange(sel.address);
                    // Coordinates land alongside the address — set both via
                    // the imperative form API so a single picker action
                    // updates address + lat + lon atomically.
                    formSetValueRef.current?.(sel.latitude, sel.longitude);
                  }}
                />
              )}
            />
          </Field>

          <Field
            label="DESCRIPTION"
            optional
            hint="WHAT WILL BE DONE"
          >
            <TextArea
              {...register("projectDescription")}
              rows={3}
              placeholder="Scope of work"
            />
          </Field>
        </Stack>
      </Section>

      {/* Bind the form's setValue to a ref so the address picker callback
          (which closes over `field.onChange` for `address`) can also write
          lat + lon. Done at the bottom so the ref binding doesn't fight
          with the input layout. */}
      <SetValueBinder />
    </Stack>
  );
}

IdentityTab.displayName = "IdentityTab";

// ─── setValue binding helper ─────────────────────────────────────────────────
//
// The AddressAutocomplete onChange writes three fields at once
// (address, latitude, longitude). React Hook Form's Controller only
// owns one field per render. Rather than nest three Controllers, we
// bind the form's setValue to a module-scoped ref that the address
// callback can call directly. The binding component lives inside the
// FormProvider tree so useFormContext() resolves correctly.

// Only `latitude` and `longitude` need this side-channel — the address
// picker writes them alongside `address` in a single onChange call.
// Narrowing the ref's signature keeps Zod / RHF's path inference happy.
const formSetValueRef: {
  current: ((latitude: number, longitude: number) => void) | null;
} = { current: null };

function SetValueBinder() {
  const { setValue } = useFormContext<ProjectEditCreateFormValues>();
  React.useEffect(() => {
    formSetValueRef.current = (latitude, longitude) => {
      setValue("latitude", latitude, { shouldDirty: true });
      setValue("longitude", longitude, { shouldDirty: true });
    };
    return () => {
      formSetValueRef.current = null;
    };
  }, [setValue]);
  return null;
}

