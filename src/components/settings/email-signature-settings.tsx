"use client";

/**
 * Sender identity — the one card that decides how OPS signs for this mailbox.
 *
 * The operator meets this once: right after connecting a mailbox, or when the
 * rail tells them new-lead replies are held. So the card leads with the state
 * they are in — confirmed, imported-but-unconfirmed, or nothing yet — and only
 * opens the builder when there is something to build. Fields are inputs; the
 * card on the sheet is the product.
 *
 * The preview sits on the OPS near-white because it is a window into someone
 * else's inbox, not an OPS surface. Showing near-black signature ink on the
 * black canvas would be a lie about what the customer receives.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Pencil, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { renderSignatureTemplate } from "@/lib/email/signature-template";
import {
  useConfirmImportedEmailSignature,
  useEmailSignature,
  useImportProviderEmailSignature,
  useSaveEmailSignature,
} from "@/lib/hooks/use-email-signature";
import type {
  EmailIdentityFields,
  EmailSignatureLayout,
  EmailSignatureSettingsResponse,
} from "@/lib/types/email-signature";
import { cn } from "@/lib/utils/cn";

interface EmailSignatureSettingsProps {
  companyId: string;
  userId: string;
  connectionId: string;
  mailbox: string;
  canManage?: boolean;
  /**
   * The card the operator was sent here to deal with — the rail's identity
   * notification deep-links to exactly one mailbox. Lifts it out of a list of
   * otherwise identical cards; it is not a state of the identity itself.
   */
  highlighted?: boolean;
}

type Translate = (key: string, fallback?: string) => string;

const EMPTY_FIELDS: EmailIdentityFields = {
  name: "",
  title: "",
  companyName: "",
  phone: "",
  website: "",
  includeLogo: false,
  layout: "logo-left",
};

/** Nothing to show yet reads as an em dash, never as prose. */
function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-micro uppercase tracking-wider text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </p>
  );
}

/**
 * The signature as the customer will see it. The markup comes from the OPS
 * template over the operator's own fields — never from anything pasted.
 */
function SignatureSheet({ html, label }: { html: string; label: string }) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <div className="mt-1 overflow-x-auto rounded border border-border bg-text-primary p-2 animate-fade-in motion-reduce:animate-none">
        {html.trim() ? (
          <div
            data-testid="signature-sheet"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="font-mono text-micro text-text-inverse">—</p>
        )}
      </div>
    </div>
  );
}

/**
 * The two arrangements, drawn rather than named — the operator is choosing a
 * shape, and a shape is faster to recognize than a word.
 */
function LayoutOption({
  layout,
  selected,
  label,
  disabled,
  onSelect,
}: {
  layout: EmailSignatureLayout;
  selected: boolean;
  label: string;
  disabled: boolean;
  onSelect: (layout: EmailSignatureLayout) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      disabled={disabled}
      onClick={() => onSelect(layout)}
      className={cn(
        "flex flex-1 items-center gap-1 rounded border px-1.5 py-1 text-left",
        "transition-all duration-150 disabled:pointer-events-none disabled:opacity-40",
        selected
          ? "border-border-medium bg-surface-active text-text"
          : "border-border bg-transparent text-text-3 hover:bg-surface-hover-subtle hover:text-text-2"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center gap-[3px]",
          layout === "stacked" && "flex-col items-start gap-[3px]"
        )}
      >
        {layout === "logo-left" ? (
          <>
            <span className="block h-[18px] w-[18px] rounded-sm bg-fill-neutral" />
            <span className="block h-[18px] w-px bg-border-medium" />
            <span className="flex flex-col gap-[3px]">
              <span className="block h-[2px] w-[22px] rounded-bar bg-fill-neutral" />
              <span className="block h-[2px] w-[16px] rounded-bar bg-fill-neutral-dim" />
              <span className="block h-[2px] w-[19px] rounded-bar bg-fill-neutral-dim" />
            </span>
          </>
        ) : (
          <>
            <span className="block h-[2px] w-[26px] rounded-bar bg-fill-neutral" />
            <span className="block h-[2px] w-[18px] rounded-bar bg-fill-neutral-dim" />
            <span className="block h-[12px] w-[12px] rounded-sm bg-fill-neutral" />
          </>
        )}
      </span>
      <span className="font-mono text-micro uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}

/** Confirmed identity, or the absence of one — the first thing to read. */
function StateTag({
  confirmed,
  t,
}: {
  confirmed: boolean;
  t: Translate;
}) {
  return confirmed ? (
    <Tag variant="olive">
      {t("integrations.signature.state.confirmed", "Confirmed")}
    </Tag>
  ) : (
    <Tag variant="tan">
      {t("integrations.signature.state.unconfirmed", "Not confirmed")}
    </Tag>
  );
}

function hydrationKey(data: EmailSignatureSettingsResponse): string {
  return [
    data.confirmedAt ?? "",
    data.outreachSubject ?? "",
    JSON.stringify(data.fields),
  ].join("|");
}

export function EmailSignatureSettings({
  companyId,
  userId,
  connectionId,
  mailbox,
  canManage = true,
  highlighted = false,
}: EmailSignatureSettingsProps) {
  const { t } = useDictionary("settings");
  const scope = { companyId, userId, connectionId };
  const signature = useEmailSignature(scope);
  const saveSignature = useSaveEmailSignature();
  const confirmImported = useConfirmImportedEmailSignature();
  const importProvider = useImportProviderEmailSignature();

  const [fields, setFields] = useState<EmailIdentityFields>(EMPTY_FIELDS);
  const [subject, setSubject] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const hydratedRef = useRef<string | null>(null);

  const data = signature.data;
  const confirmed = Boolean(data?.confirmedAt);
  const importedSignature = data?.providerSignature ?? null;

  // Re-seed only when the server's answer actually changed, so a background
  // refetch can never overwrite what the operator is typing. A save does change
  // it — which is what closes the builder and returns the compact state.
  useEffect(() => {
    if (!data) return;
    const key = hydrationKey(data);
    if (hydratedRef.current === key) return;
    hydratedRef.current = key;
    setFields(data.fields);
    setSubject(data.outreachSubject ?? "");
    setIsBuilding(!data.confirmedAt && !data.providerSignature);
  }, [data]);

  const preview = useMemo(
    () =>
      renderSignatureTemplate({
        name: fields.name,
        title: fields.title,
        companyName: fields.companyName,
        phone: fields.phone,
        website: fields.website,
        logoUrl: fields.includeLogo ? (data?.companyLogoUrl ?? null) : null,
        layout: fields.layout,
      }),
    [fields, data?.companyLogoUrl]
  );

  // A promoted Gmail import — or anything saved before the builder existed —
  // cannot be re-derived from these fields. Showing the live render then would
  // be a picture of a signature the customer is not receiving, so the stored
  // text stands in whenever the two do not match exactly.
  const storedIsTemplate = Boolean(data?.ops && data.ops.html === preview.html);

  const busy =
    saveSignature.isPending ||
    confirmImported.isPending ||
    importProvider.isPending;
  const editable = canManage && !busy;

  const setField = <K extends keyof EmailIdentityFields>(
    key: K,
    value: EmailIdentityFields[K]
  ) => setFields((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    try {
      await saveSignature.mutateAsync({
        ...scope,
        fields: {
          name: fields.name,
          title: fields.title,
          companyName: fields.companyName,
          phone: fields.phone,
          website: fields.website,
        },
        includeLogo: fields.includeLogo,
        layout: fields.layout,
        outreachSubject: subject,
      });
      toast.success(t("integrations.signature.saved", "Identity confirmed"));
    } catch (error) {
      toast.error(
        t("integrations.signature.saveFailed", "Identity not saved"),
        { description: error instanceof Error ? error.message : String(error) }
      );
    }
  };

  const handleConfirmImported = async () => {
    try {
      await confirmImported.mutateAsync(scope);
      toast.success(t("integrations.signature.saved", "Identity confirmed"));
    } catch (error) {
      toast.error(
        t("integrations.signature.saveFailed", "Identity not saved"),
        { description: error instanceof Error ? error.message : String(error) }
      );
    }
  };

  const handleImport = async () => {
    try {
      const updated = await importProvider.mutateAsync(scope);
      if (updated.providerImportStatus === "not_configured") {
        toast.error(
          t("integrations.signature.notConfigured", "No Gmail signature found")
        );
        return;
      }
      toast.success(
        t("integrations.signature.imported", "Gmail signature imported")
      );
    } catch (error) {
      toast.error(
        t("integrations.signature.importFailed", "Signature not imported"),
        { description: error instanceof Error ? error.message : String(error) }
      );
    }
  };

  return (
    <Surface
      variant="inset"
      className={cn(
        "p-2",
        highlighted && "border-border-medium bg-surface-active"
      )}
      data-testid="email-signature-settings"
      data-highlighted={highlighted || undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-mono text-micro uppercase tracking-wider text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("integrations.signature.title", "Sender identity")}
          </h3>
          <p className="mt-1 truncate font-mono text-micro text-text-3">
            {mailbox}
          </p>
        </div>
        {data ? <StateTag confirmed={confirmed} t={t} /> : null}
      </div>

      {signature.isLoading ? (
        <div className="mt-2 flex items-center gap-1 text-text-3" role="status">
          <Loader2
            className="h-icon-16 w-icon-16 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="font-mohave text-body-sm">
            {t("integrations.loading", "Loading…")}
          </span>
        </div>
      ) : signature.isError ? (
        <div
          className="mt-2 flex items-start gap-2 border-t border-border pt-2"
          role="alert"
        >
          <AlertTriangle
            className="h-icon-16 w-icon-16 shrink-0 text-rose"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-mohave text-body-sm text-rose">
              {t(
                "integrations.signature.loadFailed",
                "Signature status unavailable"
              )}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1"
              onClick={() => signature.refetch()}
            >
              <RotateCcw className="h-icon-16 w-icon-16" aria-hidden="true" />
              {t("integrations.signature.retry", "Retry")}
            </Button>
          </div>
        </div>
      ) : data ? (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {!confirmed && (
            <p className="font-mohave text-body-sm text-text-2">
              {t(
                "integrations.signature.held",
                "New-lead replies stay held until you confirm how you sign off."
              )}
            </p>
          )}

          {isBuilding ? (
            <>
              <div className="grid gap-1 sm:grid-cols-2">
                <Input
                  label={t("integrations.signature.fields.name", "Name")}
                  value={fields.name}
                  onChange={(event) => setField("name", event.target.value)}
                  disabled={!editable}
                />
                <Input
                  label={t("integrations.signature.fields.title", "Title")}
                  helperText={t(
                    "integrations.signature.fields.optional",
                    "[optional]"
                  )}
                  value={fields.title}
                  onChange={(event) => setField("title", event.target.value)}
                  disabled={!editable}
                />
                <Input
                  label={t("integrations.signature.fields.company", "Company")}
                  value={fields.companyName}
                  onChange={(event) =>
                    setField("companyName", event.target.value)
                  }
                  disabled={!editable}
                />
                <Input
                  label={t("integrations.signature.fields.phone", "Phone")}
                  value={fields.phone}
                  onChange={(event) => setField("phone", event.target.value)}
                  disabled={!editable}
                />
                <Input
                  className="sm:col-span-2"
                  label={t("integrations.signature.fields.website", "Website")}
                  value={fields.website}
                  onChange={(event) => setField("website", event.target.value)}
                  disabled={!editable}
                />
              </div>

              {/* No logo on the company record means no toggle to reason about. */}
              {data.companyLogoUrl ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={data.companyLogoUrl}
                        alt=""
                        className="h-icon-24 w-icon-24 shrink-0 object-contain"
                      />
                      <span className="truncate font-mohave text-body-sm text-text-2">
                        {t(
                          "integrations.signature.logo.toggle",
                          "Show company logo"
                        )}
                      </span>
                    </div>
                    <Switch
                      checked={fields.includeLogo}
                      onCheckedChange={(checked) =>
                        setField("includeLogo", checked)
                      }
                      disabled={!editable}
                      aria-label={t(
                        "integrations.signature.logo.toggle",
                        "Show company logo"
                      )}
                    />
                  </div>

                  {fields.includeLogo ? (
                    <div
                      role="radiogroup"
                      aria-label={t(
                        "integrations.signature.layout.label",
                        "Logo placement"
                      )}
                      className="flex gap-1"
                    >
                      <LayoutOption
                        layout="logo-left"
                        selected={fields.layout === "logo-left"}
                        label={t(
                          "integrations.signature.layout.left",
                          "Logo left"
                        )}
                        disabled={!editable}
                        onSelect={(layout) => setField("layout", layout)}
                      />
                      <LayoutOption
                        layout="stacked"
                        selected={fields.layout === "stacked"}
                        label={t(
                          "integrations.signature.layout.below",
                          "Logo below"
                        )}
                        disabled={!editable}
                        onSelect={(layout) => setField("layout", layout)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <SignatureSheet
                html={preview.html}
                label={t("integrations.signature.preview", "Preview")}
              />

              <Input
                label={t(
                  "integrations.signature.subject.label",
                  "First reply subject"
                )}
                helperText={t(
                  "integrations.signature.subject.help",
                  "[the subject line on first replies to new leads]"
                )}
                placeholder={t(
                  "integrations.signature.subject.placeholder",
                  "Thanks for reaching out"
                )}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={!editable}
              />

              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  loading={saveSignature.isPending}
                  disabled={!editable || !fields.name.trim()}
                >
                  {t("integrations.signature.save", "Confirm identity")}
                </Button>

                {confirmed || importedSignature ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFields(data.fields);
                      setSubject(data.outreachSubject ?? "");
                      setIsBuilding(false);
                    }}
                    disabled={busy}
                  >
                    {t("integrations.signature.cancel", "Cancel")}
                  </Button>
                ) : null}

                {data.providerImportSupported ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleImport}
                    loading={importProvider.isPending}
                    disabled={!editable}
                  >
                    {t(
                      "integrations.signature.importGmail",
                      "Import from Gmail"
                    )}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              {confirmed ? (
                <>
                  {storedIsTemplate ? (
                    <SignatureSheet
                      html={preview.html}
                      label={t(
                        "integrations.signature.signsOffAs",
                        "Signs off as"
                      )}
                    />
                  ) : (
                    <div>
                      <PanelLabel>
                        {t(
                          "integrations.signature.signsOffAs",
                          "Signs off as"
                        )}
                      </PanelLabel>
                      <pre className="mt-1 whitespace-pre-wrap break-words font-mohave text-body-sm text-text-2">
                        {data.ops?.text || data.effective?.text || "—"}
                      </pre>
                    </div>
                  )}
                  <div>
                    <PanelLabel>
                      {t(
                        "integrations.signature.subject.label",
                        "First reply subject"
                      )}
                    </PanelLabel>
                    <p className="mt-1 font-mohave text-body-sm text-text-2">
                      {data.outreachSubject ?? (
                        <span className="font-mono text-micro text-text-3">
                          —
                        </span>
                      )}
                    </p>
                  </div>
                </>
              ) : importedSignature ? (
                <>
                  <p className="font-mohave text-body-sm text-text-2">
                    {t(
                      "integrations.signature.gmailHelp",
                      "Gmail sent this one over. Confirm it to sign with it, or build your own."
                    )}
                  </p>
                  <div>
                    <PanelLabel>
                      {t("integrations.signature.gmailLabel", "From Gmail")}
                    </PanelLabel>
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mohave text-body-sm text-text-2">
                      {importedSignature.text}
                    </pre>
                  </div>
                </>
              ) : null}

              <div className="flex flex-wrap items-center gap-1">
                {!confirmed && importedSignature ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleConfirmImported}
                    loading={confirmImported.isPending}
                    disabled={!editable}
                  >
                    {t("integrations.signature.confirmImported", "Use this")}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant={confirmed ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setIsBuilding(true)}
                  disabled={!editable}
                >
                  {confirmed ? (
                    <>
                      <Pencil
                        className="h-icon-16 w-icon-16"
                        aria-hidden="true"
                      />
                      {t("integrations.signature.edit", "Edit identity")}
                    </>
                  ) : (
                    t("integrations.signature.buildInstead", "Build one instead")
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </Surface>
  );
}
