"use client";

import * as React from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Search, Check } from "lucide-react";
import { useClients } from "@/lib/hooks/use-clients";
import { useProjects } from "@/lib/hooks/use-projects";
import { deriveStreetLine } from "@/lib/utils/derive-project-name";
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
import { useDictionary } from "@/i18n/client";
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
  const { t } = useDictionary("project-workspace");
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
    <Field label={t("identity.client.label")} optional={!required} required={required}>
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
            <span data-testid="client-picker-empty">{t("identity.client.empty")}</span>
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
                placeholder={t("identity.client.search")}
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
                  {t("identity.client.remove")}
                </button>
              )}
              {isLoading ? (
                <div className="px-2 py-2">
                  <Mono size={11} color="text-3">
                    {t("identity.client.loading")}
                  </Mono>
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-2 py-2">
                  <Mono size={11} color="text-3">
                    {t("identity.client.noResults")}
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

const TRADE_VALUE_KEY: Record<string, string> = {
  roofing: "identity.trade.options.roofing",
  hvac: "identity.trade.options.hvac",
  plumbing: "identity.trade.options.plumbing",
};

export interface IdentityTabProps {
  /** Drives the required/optional state of the Trade field — creating
   *  requires a category up front, editing leaves NULL trades alone for
   *  legacy projects. */
  mode: EditCreateMode;
  /** Current project id (editing) — excluded from the duplicate-name check. */
  projectId?: string | null;
}

export function IdentityTab({ mode, projectId = null }: IdentityTabProps) {
  const { t } = useDictionary("project-workspace");
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ProjectEditCreateFormValues>();

  const tradeRequired = mode === "creating";

  const tradeOptions = React.useMemo(
    () => [
      { value: "roofing", label: t(TRADE_VALUE_KEY.roofing) },
      { value: "hvac", label: t(TRADE_VALUE_KEY.hvac) },
      { value: "plumbing", label: t(TRADE_VALUE_KEY.plumbing) },
    ],
    [t],
  );

  return (
    <Stack gap={3} data-testid="identity-tab">
      <Section title={t("identity.section")}>
        <Stack gap={2}>
          {/* Address-primary, auto-named: the operator never types a name —
              SITE ADDRESS leads and the name tracks it (see NameAddressSection). */}
          <NameAddressSection projectId={projectId} />

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
                  label={t("identity.trade.label")}
                  required={tradeRequired}
                  optional={!tradeRequired}
                  error={errors.trade?.message}
                >
                  <Select
                    options={tradeOptions}
                    value={field.value ?? undefined}
                    onChange={(v) =>
                      field.onChange(
                        v as ProjectEditCreateFormValues["trade"],
                      )
                    }
                    placeholder={t("identity.trade.placeholder")}
                    aria-invalid={errors.trade ? "true" : undefined}
                  />
                </Field>
              )}
            />
          </FieldRow>

          <Field
            label={t("identity.description.label")}
            optional
            hint={t("identity.description.hint")}
          >
            <TextArea
              {...register("projectDescription")}
              rows={3}
              placeholder={t("identity.description.placeholder")}
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

// ─── NameAddressSection ──────────────────────────────────────────────────────
//
// The auto-named create/edit surface. SITE ADDRESS is the primary input; the
// project name is a live preview of the value the BEFORE-write trigger will
// store (street line → `{Client}'s Project` → "New project") while the name is
// auto. A quiet `rename` reveals the input and freezes the name
// (titleIsAuto=false). In editing, a custom name offers `use address` to revert
// to auto, and clearing it reverts too. A hand-set name that collides with
// another project shows a non-blocking DUPLICATE NAME warning (iOS parity).

function NameAddressSection({ projectId }: { projectId: string | null }) {
  const { t } = useDictionary("project-workspace");
  const { control, register, setValue } =
    useFormContext<ProjectEditCreateFormValues>();
  const { data: clientsData } = useClients();
  const { data: projectsData } = useProjects();

  const titleIsAuto = useWatch({ control, name: "titleIsAuto" });
  const title = useWatch({ control, name: "title" });
  const address = useWatch({ control, name: "address" });
  const clientId = useWatch({ control, name: "clientId" });

  const clientName = React.useMemo(() => {
    if (!clientId) return null;
    return clientsData?.clients?.find((c) => c.id === clientId)?.name ?? null;
  }, [clientId, clientsData]);

  // Mirrors private.derive_project_name: street line first, then the client
  // fallback, then the placeholder — exactly what the trigger will store.
  const preview = React.useMemo(() => {
    const street = deriveStreetLine(address);
    if (street) return street;
    if (clientName)
      return t("editCreate.clientProject", "{client}'s Project").replace(
        "{client}",
        clientName,
      );
    return t("editCreate.newProjectName", "New project");
  }, [address, clientName, t]);

  const duplicateName = React.useMemo(() => {
    if (titleIsAuto) return false;
    const typed = (title ?? "").trim().toLowerCase();
    if (!typed) return false;
    return (projectsData?.projects ?? []).some(
      (p) =>
        p.id !== projectId && (p.title ?? "").trim().toLowerCase() === typed,
    );
  }, [titleIsAuto, title, projectsData, projectId]);

  return (
    <Stack gap={2}>
      {/* SITE ADDRESS — primary input */}
      <Field
        label={t("identity.address.label")}
        optional
        hint={t("identity.address.hint")}
      >
        <Controller
          control={control}
          name="address"
          render={({ field }) => (
            <AddressAutocomplete
              value={field.value ?? ""}
              onChange={(sel) => {
                field.onChange(sel.address);
                // Coordinates land alongside the address — write both via the
                // imperative form API so one picker action updates all three.
                formSetValueRef.current?.(sel.latitude, sel.longitude);
              }}
            />
          )}
        />
      </Field>

      {/* NAME — auto preview + rename, or editable name + use-address */}
      {titleIsAuto ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1">
            <Mono size={11} color="mute" caseSensitive>
              {"//"}
            </Mono>
            <Mono size={11} color="text-3">
              {t("editCreate.nameAutoPreview", "Name")}
            </Mono>
            <Mono size={11} color="mute" caseSensitive>
              ·
            </Mono>
            <Mono
              size={11}
              color="text"
              caseSensitive
              className="truncate"
              data-testid="identity-name-preview"
            >
              {preview}
            </Mono>
          </div>
          <button
            type="button"
            data-testid="identity-name-rename"
            onClick={() =>
              setValue("titleIsAuto", false, { shouldDirty: true })
            }
            className="shrink-0 font-mono text-[11px] lowercase tracking-[0.14em] text-text-3 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text-2"
          >
            {t("editCreate.rename", "rename")}
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Mono size={11} color="text-3">
              {t("identity.title.label")}
            </Mono>
            <button
              type="button"
              data-testid="identity-name-use-address"
              onClick={() => {
                setValue("title", "", { shouldDirty: true });
                setValue("titleIsAuto", true, { shouldDirty: true });
              }}
              className="shrink-0 font-mono text-[11px] lowercase tracking-[0.14em] text-text-3 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-text-2"
            >
              {t("editCreate.useAddress", "use address")}
            </button>
          </div>
          <TextInput
            data-testid="identity-name-input"
            placeholder={preview}
            autoComplete="off"
            spellCheck={false}
            {...register("title", {
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                // Clearing a custom name reverts to auto (trigger refills it).
                if (e.target.value.trim() === "") {
                  setValue("titleIsAuto", true, { shouldDirty: true });
                }
              },
            })}
          />
          {duplicateName && (
            <Mono
              size={11}
              color="tan"
              caseSensitive
              data-testid="identity-name-duplicate-warning"
            >
              {t(
                "editCreate.duplicateNameWarning",
                "Another project already uses this name.",
              )}
            </Mono>
          )}
        </div>
      )}
    </Stack>
  );
}

