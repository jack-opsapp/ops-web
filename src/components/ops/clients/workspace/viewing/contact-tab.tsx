"use client";

import * as React from "react";
import { Copy, Phone, Mail, MapPin, Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import type { Client } from "@/lib/types/models";
import { getInitials } from "@/lib/types/models";
import {
  useSubClients,
  useCreateSubClient,
  useDeleteSubClient,
} from "@/lib/hooks";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { formatPhoneNumber } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/date";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { IconBtn } from "@/components/ops/projects/workspace/atoms/icon-btn";
import { Btn } from "@/components/ops/projects/workspace/atoms/btn";
import { Field } from "@/components/ops/projects/workspace/atoms/field";
import { TextInput } from "@/components/ops/projects/workspace/atoms/text-input";

function ContactRow({
  label,
  children,
  actions,
}: {
  label: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Inline justify="between" align="center" className="py-1.5">
      <Inline gap={2} align="baseline" className="min-w-0">
        <Mono size={11} color="text-3" className="w-[60px] shrink-0">
          {label}
        </Mono>
        <div className="min-w-0 truncate">{children}</div>
      </Inline>
      {actions ? <Inline gap={0.5}>{actions}</Inline> : null}
    </Inline>
  );
}

export function ContactTab({
  client,
  clientId,
}: {
  client: Client;
  clientId: string;
}) {
  const { t } = useDictionary("clients");
  const can = usePermissionStore((s) => s.can);
  const canEdit = can("clients.edit");
  const canDelete = can("clients.delete");

  const { data: subClients } = useSubClients(clientId);
  const createSubClient = useCreateSubClient();
  const deleteSubClient = useDeleteSubClient();

  const copy = React.useCallback(
    (value: string) => {
      void navigator.clipboard?.writeText(value);
      toast.success(t("window.action.copied"));
    },
    [t],
  );

  const mapsUrl = client.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`
    : null;

  // ── Sub-contact add form ──────────────────────────────────────────────
  const [adding, setAdding] = React.useState(false);
  const [scName, setScName] = React.useState("");
  const [scTitle, setScTitle] = React.useState("");
  const [scPhone, setScPhone] = React.useState("");
  const [scEmail, setScEmail] = React.useState("");

  const resetAdd = () => {
    setAdding(false);
    setScName("");
    setScTitle("");
    setScPhone("");
    setScEmail("");
  };

  const submitSubContact = () => {
    if (!scName.trim()) return;
    createSubClient.mutate(
      {
        name: scName.trim(),
        title: scTitle.trim() || null,
        phoneNumber: scPhone.trim() || null,
        email: scEmail.trim() || null,
        clientId,
      },
      {
        onSuccess: () => {
          toast.success(t("toast.subContactAdded"));
          resetAdd();
        },
        onError: () => toast.error(t("form.saveFailed")),
      },
    );
  };

  const removeSubContact = (id: string) => {
    deleteSubClient.mutate(
      { id, clientId },
      {
        onSuccess: () => toast.success(t("toast.subContactRemoved")),
        onError: () => toast.error(t("form.saveFailed")),
      },
    );
  };

  const subs = (subClients ?? []).filter((sc) => !sc.deletedAt);

  return (
    <Stack gap={3} className="p-5">
      {/* Contact */}
      <Section title={t("window.section.contact")}>
        <Stack gap={0} className="divide-y divide-glass-border">
          {client.phoneNumber && (
            <ContactRow
              label={t("window.field.phone")}
              actions={
                <>
                  <IconBtn
                    aria-label={t("window.action.copy")}
                    size="xs"
                    onClick={() => copy(client.phoneNumber!)}
                  >
                    <Copy />
                  </IconBtn>
                  <a href={`tel:${client.phoneNumber}`} aria-label={t("window.action.call")}>
                    <IconBtn aria-label={t("window.action.call")} size="xs" tabIndex={-1}>
                      <Phone />
                    </IconBtn>
                  </a>
                </>
              }
            >
              <span className="font-mono text-[13px] tabular-nums text-text">
                {formatPhoneNumber(client.phoneNumber)}
              </span>
            </ContactRow>
          )}
          {client.email && (
            <ContactRow
              label={t("window.field.email")}
              actions={
                <>
                  <IconBtn
                    aria-label={t("window.action.copy")}
                    size="xs"
                    onClick={() => copy(client.email!)}
                  >
                    <Copy />
                  </IconBtn>
                  <a href={`mailto:${client.email}`} aria-label={t("window.action.mail")}>
                    <IconBtn aria-label={t("window.action.mail")} size="xs" tabIndex={-1}>
                      <Mail />
                    </IconBtn>
                  </a>
                </>
              }
            >
              <span className="font-mono text-[13px] text-text">{client.email}</span>
            </ContactRow>
          )}
          {client.address && (
            <ContactRow
              label={t("window.field.address")}
              actions={
                <>
                  <IconBtn
                    aria-label={t("window.action.copy")}
                    size="xs"
                    onClick={() => copy(client.address!)}
                  >
                    <Copy />
                  </IconBtn>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("window.action.map")}
                    >
                      <IconBtn aria-label={t("window.action.map")} size="xs" tabIndex={-1}>
                        <MapPin />
                      </IconBtn>
                    </a>
                  )}
                </>
              }
            >
              <Body size={14} color="text">
                {client.address}
              </Body>
            </ContactRow>
          )}
          {client.createdAt && (
            <ContactRow label={t("window.field.since")}>
              <span className="font-mono text-[13px] tabular-nums text-text-2">
                {formatDate(client.createdAt, "MMM yyyy")}
              </span>
            </ContactRow>
          )}
        </Stack>
      </Section>

      {/* Sub-contacts */}
      <Section
        title={t("window.section.subContacts")}
        rightSlot={
          canEdit && !adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent rounded-[3px]"
            >
              <Plus className="h-[12px] w-[12px]" aria-hidden />
              {t("window.action.add")}
            </button>
          ) : undefined
        }
      >
        <Stack gap={0} className="divide-y divide-glass-border">
          {subs.length === 0 && !adding ? (
            <Mono size={11} color="mute" className="py-2">
              {t("window.subContacts.empty")}
            </Mono>
          ) : (
            subs.map((sc) => (
              <Inline key={sc.id} justify="between" align="center" className="group py-2">
                <Inline gap={1.5} align="center" className="min-w-0">
                  <Avatar className="h-[24px] w-[24px] shrink-0">
                    <AvatarFallback className="font-mono text-[10px] uppercase tracking-wider">
                      {getInitials(sc.name) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <Inline gap={1} align="baseline" className="min-w-0">
                      <Body size={14} color="text" className="truncate">
                        {sc.name}
                      </Body>
                      {sc.title && (
                        <Mono size={10} color="mute" className="shrink-0">
                          {sc.title}
                        </Mono>
                      )}
                    </Inline>
                    {(sc.phoneNumber || sc.email) && (
                      <span className="font-mono text-[11px] tabular-nums text-text-3">
                        {[sc.phoneNumber ? formatPhoneNumber(sc.phoneNumber) : null, sc.email]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </span>
                    )}
                  </div>
                </Inline>
                {canDelete && (
                  <IconBtn
                    aria-label={t("footer.delete")}
                    size="xs"
                    variant="destructive"
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => removeSubContact(sc.id)}
                    disabled={deleteSubClient.isPending}
                  >
                    <Trash2 />
                  </IconBtn>
                )}
              </Inline>
            ))
          )}

          {adding && (
            <div className="py-2">
              <Stack gap={1.5}>
                <Field label={t("window.subContacts.namePlaceholder")} required>
                  <TextInput
                    value={scName}
                    onChange={(e) => setScName(e.target.value)}
                    placeholder={t("window.subContacts.namePlaceholder")}
                    autoFocus
                  />
                </Field>
                <Inline gap={1.5} align="start" className="[&>*]:flex-1">
                  <Field label={t("window.subContacts.titlePlaceholder")} optional>
                    <TextInput
                      value={scTitle}
                      onChange={(e) => setScTitle(e.target.value)}
                      placeholder={t("window.subContacts.titlePlaceholder")}
                    />
                  </Field>
                </Inline>
                <Inline gap={1.5} align="start" className="[&>*]:flex-1">
                  <Field label={t("window.subContacts.phonePlaceholder")} optional>
                    <TextInput
                      value={scPhone}
                      onChange={(e) => setScPhone(e.target.value)}
                      placeholder={t("window.subContacts.phonePlaceholder")}
                      type="tel"
                    />
                  </Field>
                  <Field label={t("window.subContacts.emailPlaceholder")} optional>
                    <TextInput
                      value={scEmail}
                      onChange={(e) => setScEmail(e.target.value)}
                      placeholder={t("window.subContacts.emailPlaceholder")}
                      type="email"
                    />
                  </Field>
                </Inline>
                <Inline gap={1} justify="end">
                  <Btn variant="ghost" size="sm" onClick={resetAdd}>
                    <X className="h-[14px] w-[14px]" aria-hidden />
                    {t("footer.cancel")}
                  </Btn>
                  <Btn
                    variant="primary"
                    size="sm"
                    onClick={submitSubContact}
                    disabled={!scName.trim() || createSubClient.isPending}
                  >
                    <Check className="h-[14px] w-[14px]" aria-hidden />
                    {t("window.action.add")}
                  </Btn>
                </Inline>
              </Stack>
            </div>
          )}
        </Stack>
      </Section>

      {/* Notes */}
      <Section title={t("window.section.notes")}>
        {client.notes ? (
          <Body size={14} color="text-2" as="p" className="whitespace-pre-wrap">
            {client.notes}
          </Body>
        ) : (
          <Mono size={11} color="mute" className="py-1">
            {t("window.notes.empty")}
          </Mono>
        )}
      </Section>
    </Stack>
  );
}
