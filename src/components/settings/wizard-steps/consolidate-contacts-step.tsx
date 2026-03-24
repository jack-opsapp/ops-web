"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { CardCarousel, type CarouselItem, type CarouselDecision } from "./card-carousel";
import { EmailThreadView } from "./email-thread-view";
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
        return { label: "CONFIRMED", color: "#597794" };
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
        return { label: "MERGED", color: "#C4A868" };
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
        return { label: "DISCARDED", color: "#6B7280" };
      },
    }),
    [leads, onLeadsChanged, updateGroup]
  );

  return (
    <CardCarousel
      title={t("consolidate.title")}
      items={items}
      actions={actions}
      onComplete={onComplete}
      onBack={onBack}
      keyboardHint={t("consolidate.hint")}
      renderCard={(item) => {
        const group = item.data;

        return (
          <div className="space-y-3">
            {/* Company name (editable) */}
            <EditableCompanyName
              value={group.companyName}
              onChange={(name) => updateGroup(group.id, { companyName: name })}
            />
            <p className="font-mohave text-[11px] text-[#666] -mt-1">
              {group.contacts.length} {group.domain ? `${t("consolidate.contactsFrom")} ${group.domain}` : t("consolidate.contacts")}
            </p>

            {/* Contacts list */}
            <div className="space-y-1">
              <span className="font-kosugi text-[8px] tracking-[0.12em] uppercase text-[#555]">
                {t("consolidate.contacts")}
              </span>
              {group.contacts.map((contact) => (
                <div
                  key={contact.leadId}
                  className="flex items-center gap-2 py-1 px-2 border border-white/5"
                  style={{ borderRadius: 4 }}
                >
                  <span className="font-mohave text-[11px] text-[#999] flex-1 truncate">
                    {contact.name}
                  </span>
                  <span className="font-mohave text-[10px] text-[#555] truncate">
                    {contact.email}
                  </span>
                  {group.contacts.length > 2 && (
                    <button
                      onClick={() =>
                        removeContactFromGroup(group.id, contact.leadId)
                      }
                      className="flex-shrink-0 text-[#444] hover:text-[#999] transition-colors"
                      title="Remove from group"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Leads list with editable titles */}
            <div className="space-y-1">
              <span className="font-kosugi text-[8px] tracking-[0.12em] uppercase text-[#555]">
                {t("consolidate.leads")} ({group.leads.length})
              </span>
              {group.leads.map((gl, i) => {
                const fullLead = leads.find((l) => l.id === gl.leadId);
                return (
                  <div
                    key={gl.leadId}
                    className="py-1.5 px-2 border border-white/5 space-y-1"
                    style={{ borderRadius: 4 }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mohave text-[11px] text-[#999]">
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
                    <p className="font-mohave text-[10px] text-[#555] ml-4">
                      {t("consolidate.via")} {group.contacts.find((c) => c.email === gl.primaryContactEmail)?.name || gl.primaryContactEmail} · {gl.correspondenceCount} {t("emails")}
                    </p>
                    {fullLead && (
                      <div className="ml-4">
                        <EmailThreadView lead={fullLead} keyboardEnabled={i === 0} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <button
                onClick={() => actions["1"](item)}
                className="flex-1 py-2 font-kosugi text-[10px] tracking-[0.1em] uppercase border border-[#597794]/30 text-[#597794] hover:bg-[#597794]/10 transition-colors"
                style={{ borderRadius: 4 }}
              >
                1: {t("consolidate.confirm")}
              </button>
              <button
                onClick={() => actions["2"](item)}
                className="flex-1 py-2 font-kosugi text-[10px] tracking-[0.1em] uppercase border border-[#C4A868]/30 text-[#C4A868] hover:bg-[#C4A868]/10 transition-colors"
                style={{ borderRadius: 4 }}
              >
                2: {t("consolidate.mergeIntoOne")}
              </button>
            </div>
          </div>
        );
      }}
      renderPreview={(item) => (
        <span className="font-mohave text-[11px] text-[#777] truncate">
          {item.data.companyName} ({item.data.contacts.length})
        </span>
      )}
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
        className="font-mohave text-[15px] text-white bg-transparent border-b border-[#597794] outline-none w-full py-0"
        style={{ borderRadius: 0 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-mohave text-[15px] text-white text-left hover:text-[#597794] transition-colors cursor-text"
      title="Click to edit company name"
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
        className="font-mohave text-[11px] text-white bg-transparent border-b border-[#597794]/50 outline-none flex-1 py-0"
        style={{ borderRadius: 0 }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-mohave text-[11px] text-left truncate transition-colors cursor-text"
      style={{ color: value ? "#999" : "#444" }}
      title="Click to edit title"
    >
      {value || placeholder}
    </button>
  );
}
