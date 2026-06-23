"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { CardCarousel, type CarouselItem, type CarouselDecision } from "./card-carousel";
import { EmailThreadView } from "./email-thread-view";
import { GlassActionButton } from "./glass-action-button";
import { useDictionary } from "@/i18n/client";
import type { AnalyzedLead, ConsolidationGroup } from "@/lib/types/email-import";

// ─── Component ────────────────────────────────────────────────────────────────

interface ConsolidateContactsStepProps {
  leads: AnalyzedLead[];
  onLeadsChanged: (leads: AnalyzedLead[]) => void;
  consolidationGroups: ConsolidationGroup[];
  onGroupsChanged: (groups: ConsolidationGroup[]) => void;
  onComplete: () => void;
  onBack?: () => void;
}

export function ConsolidateContactsStep({
  leads,
  onLeadsChanged,
  consolidationGroups,
  onGroupsChanged,
  onComplete,
  onBack,
}: ConsolidateContactsStepProps) {
  const { t } = useDictionary("import-wizard");

  // Build carousel items from groups
  const items: CarouselItem<ConsolidationGroup>[] = useMemo(
    () =>
      consolidationGroups.map((group) => ({
        id: group.id,
        data: group,
        defaultAction: "1", // default = confirm
      })),
    [consolidationGroups]
  );

  const updateGroup = useCallback(
    (groupId: string, update: Partial<ConsolidationGroup>) => {
      onGroupsChanged(
        consolidationGroups.map((g) =>
          g.id === groupId ? { ...g, ...update } : g
        )
      );
    },
    [consolidationGroups, onGroupsChanged]
  );

  const removeContactFromGroup = useCallback(
    (groupId: string, leadId: string) => {
      const group = consolidationGroups.find((g) => g.id === groupId);
      if (!group) return;

      // Remove contact and lead from group
      const updatedContacts = group.contacts.filter(
        (c) => c.leadId !== leadId
      );
      const updatedLeads = group.leads.filter((l) => l.leadId !== leadId);

      if (updatedContacts.length < 2) {
        // Group no longer valid — remove it entirely
        onGroupsChanged(consolidationGroups.filter((g) => g.id !== groupId));
      } else {
        updateGroup(groupId, {
          contacts: updatedContacts,
          leads: updatedLeads,
        });
      }
    },
    [consolidationGroups, onGroupsChanged, updateGroup]
  );

  const actions = useMemo(
    () => ({
      "1": (item: CarouselItem<ConsolidationGroup>): CarouselDecision => {
        updateGroup(item.id, { decision: "confirm" });
        // Neutral text-2 — a decision badge is not the primary CTA, so no accent.
        return { label: t("consolidate.decisionConfirmed"), color: "#B5B5B5" };
      },
      "2": (item: CarouselItem<ConsolidationGroup>): CarouselDecision => {
        updateGroup(item.id, { decision: "merge" });

        // Disable all but the first lead in the group
        const group = item.data;
        if (group.leads.length > 1) {
          const primaryId = group.leads[0].leadId;
          onLeadsChanged(
            leads.map((l) => {
              const isInGroup = group.leads.some(
                (gl) => gl.leadId === l.id
              );
              if (isInGroup && l.id !== primaryId) {
                return { ...l, enabled: false };
              }
              return l;
            })
          );
        }
        return { label: t("consolidate.decisionMerged"), color: "#C4A868" };
      },
      "3": (item: CarouselItem<ConsolidationGroup>): CarouselDecision => {
        const group = item.data;
        onLeadsChanged(
          leads.map((l) => {
            const isInGroup = group.leads.some(
              (gl) => gl.leadId === l.id
            );
            return isInGroup ? { ...l, enabled: false } : l;
          })
        );
        return { label: t("consolidate.decisionDiscarded"), color: "#8A8A8A" };
      },
      Backspace: (item: CarouselItem<ConsolidationGroup>): CarouselDecision => {
        const group = item.data;
        onLeadsChanged(
          leads.map((l) => {
            const isInGroup = group.leads.some(
              (gl) => gl.leadId === l.id
            );
            return isInGroup ? { ...l, enabled: false } : l;
          })
        );
        return { label: t("consolidate.decisionDiscarded"), color: "#8A8A8A" };
      },
    }),
    [leads, onLeadsChanged, updateGroup, t]
  );

  return (
    <CardCarousel
      title={t("consolidate.title")}
      items={items}
      actions={actions}
      onComplete={onComplete}
      onBack={onBack}
      keyboardHint={t("consolidate.hint")}
      renderCard={(item, focused, _setDecision, triggerAction, highlightedKey, threadToggle) => {
        const group = item.data;

        // Compact peek: company name + counts. Full content is only rendered
        // when the card is focused; otherwise 4× email thread views per card
        // would push the focused card out of the viewport.
        if (!focused) {
          return (
            <div className="space-y-1">
              <h4 className="font-mohave text-[18px] text-text leading-tight truncate">
                {group.companyName}
              </h4>
              <p className="font-mohave text-[13px] text-text-3">
                {group.contacts.length} {t("consolidate.contacts").toLowerCase()}
                {" · "}
                {group.leads.length} {t("consolidate.leads").toLowerCase()}
                {group.domain ? ` · ${group.domain}` : ""}
              </p>
            </div>
          );
        }

        return (
          <div className="space-y-3">
            {/* Company name (editable) */}
            <EditableCompanyName
              value={group.companyName}
              onChange={(name) => updateGroup(group.id, { companyName: name })}
            />
            <p className="font-mohave text-[13px] text-text-3 -mt-2">
              {group.contacts.length} {group.domain ? `${t("consolidate.contactsFrom")} ${group.domain}` : t("consolidate.contacts")}
            </p>

            {/* Contacts list */}
            <div className="space-y-1.5">
              <span className="font-mono text-micro tracking-[0.12em] uppercase text-text-3">
                {t("consolidate.contacts")}
              </span>
              {group.contacts.map((contact) => {
                const isRemoved = !group.leads.some((gl) => gl.leadId === contact.leadId);
                return (
                  <div
                    key={contact.leadId}
                    className="flex items-center gap-2 py-1.5 px-2.5 border border-border-subtle"
                    style={{
                      borderRadius: 4,
                      opacity: isRemoved ? 0.3 : 1,
                    }}
                  >
                    <span className="font-mohave text-[13px] text-text-2 flex-1 truncate">
                      {contact.name}
                    </span>
                    <span className="font-mohave text-[12px] text-text-3 truncate">
                      {contact.email}
                    </span>
                    {!isRemoved && group.contacts.filter((c) => group.leads.some((gl) => gl.leadId === c.leadId)).length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Remove this contact's lead from the group — keeps the group intact,
                          // just removes this sub-contact so it won't be created on import
                          const updatedLeads = group.leads.filter((gl) => gl.leadId !== contact.leadId);
                          updateGroup(group.id, { leads: updatedLeads });
                        }}
                        className="flex-shrink-0 text-text-mute hover:text-text-2 transition-colors"
                        title={t("consolidate.removeContactTooltip")}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Leads list with editable titles */}
            <div className="space-y-1.5">
              <span className="font-mono text-micro tracking-[0.12em] uppercase text-text-3">
                {t("consolidate.leads")} ({group.leads.length})
              </span>
              {group.leads.map((gl, i) => {
                const fullLead = leads.find((l) => l.id === gl.leadId);
                return (
                  <div
                    key={gl.leadId}
                    className="py-1.5 px-2 border border-border-subtle space-y-1"
                    style={{ borderRadius: 4 }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mohave text-[11px] text-text-2">
                        {i + 1}.
                      </span>
                      <EditableTitle
                        value={gl.title}
                        placeholder={t("consolidate.editTitle")}
                        onChange={(title) => {
                          const updated = [...group.leads];
                          updated[i] = { ...updated[i], title };
                          updateGroup(group.id, { leads: updated });
                        }}
                      />
                    </div>
                    <p className="font-mohave text-micro text-text-mute ml-4">
                      {t("consolidate.via")} {group.contacts.find((c) => c.email === gl.primaryContactEmail)?.name || gl.primaryContactEmail} · {gl.correspondenceCount} {t("emails")}
                    </p>
                    {fullLead && (
                      <div className="ml-4">
                        <EmailThreadView lead={fullLead} keyboardEnabled={i === 0} toggleSignal={i === 0 ? threadToggle : 0} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Action buttons — only on focused card. Each button is a
                floating glass chip with its own backdrop blur. */}
            {focused && (
              <div className="flex items-center gap-1.5 pt-3 pb-1 sticky bottom-0 -mx-4 px-2 -mb-4">
                <GlassActionButton
                  keyLabel="1"
                  label={group.leads.length !== 1 ? t("consolidate.saveAsLeads", { count: group.leads.length }) : t("consolidate.saveAsLead")}
                  highlighted={highlightedKey === "1"}
                  onClick={() => triggerAction("1")}
                  className="flex-1"
                />
                <GlassActionButton
                  keyLabel="2"
                  label={t("consolidate.mergeIntoOne")}
                  highlighted={highlightedKey === "2"}
                  onClick={() => triggerAction("2")}
                  className="flex-1"
                />
                <GlassActionButton
                  keyLabel="3"
                  label={t("filter.discard")}
                  highlighted={highlightedKey === "3"}
                  onClick={() => triggerAction("3")}
                  className="flex-shrink-0"
                />
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

// ─── Inline editable fields ──────────────────────────────────────────────────

function EditableCompanyName({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useDictionary("import-wizard");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          e.stopPropagation(); // prevent carousel keyboard capture
        }}
        className="font-mohave text-[18px] text-text bg-transparent border-b border-ops-accent outline-none w-full py-0"
        style={{ borderRadius: 0 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-mohave text-[18px] text-text text-left hover:text-text-2 transition-colors cursor-text"
      title={t("consolidate.editCompanyTooltip")}
    >
      {value}
    </button>
  );
}

function EditableTitle({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const { t } = useDictionary("import-wizard");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const commit = () => {
    onChange(draft.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          e.stopPropagation();
        }}
        placeholder={placeholder}
        className="font-mohave text-[11px] text-text bg-transparent border-b border-ops-accent/50 outline-none flex-1 py-0"
        style={{ borderRadius: 0 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`font-mohave text-[11px] text-left truncate transition-colors cursor-text ${
        value ? "text-text-2" : "text-text-mute"
      }`}
      title={t("consolidate.editTitleTooltip")}
    >
      {value || placeholder}
    </button>
  );
}
