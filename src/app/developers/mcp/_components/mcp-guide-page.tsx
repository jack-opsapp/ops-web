import { ArrowUpRight, Mail } from "lucide-react";

import { CopyCodeButton } from "@/app/developers/_components/copy-code-button";
import { DevelopersHeader } from "@/app/developers/_components/developers-header";
import type { McpDocsCopy } from "@/lib/agent-control-plane/mcp/docs/copy";
import type {
  PublicMcpReference,
  PublicMcpTool,
  PublicMcpToolGroupLabel,
} from "@/lib/agent-control-plane/mcp/docs/reference";
import { OPS_SUPPORT_EMAIL } from "@/lib/email/constants";

import { McpGuideNavigation } from "./mcp-guide-navigation";

interface McpGuidePageProps {
  readonly copy: McpDocsCopy;
  readonly reference: PublicMcpReference;
}

const HOST_DOCS = {
  codex: "https://developers.openai.com/codex/extend/mcp",
  claude: "https://code.claude.com/docs/en/mcp",
  chatgpt: "https://developers.openai.com/plugins/deploy/connect-chatgpt/",
} as const;

const GROUP_COPY_KEYS = {
  customersJobs: {
    title: "groupCustomersJobsTitle",
    body: "groupCustomersJobsBody",
  },
  jobContext: {
    title: "groupJobContextTitle",
    body: "groupJobContextBody",
  },
  scheduleTasks: {
    title: "groupScheduleTasksTitle",
    body: "groupScheduleTasksBody",
  },
  siteVisitsEvidence: {
    title: "groupSiteVisitsEvidenceTitle",
    body: "groupSiteVisitsEvidenceBody",
  },
  financialCatalog: {
    title: "groupFinancialCatalogTitle",
    body: "groupFinancialCatalogBody",
  },
  companyHealth: {
    title: "groupCompanyHealthTitle",
    body: "groupCompanyHealthBody",
  },
} as const satisfies Record<
  PublicMcpToolGroupLabel,
  { title: keyof McpDocsCopy; body: keyof McpDocsCopy }
>;

function CodePanel({
  code,
  label,
  copy,
}: {
  readonly code: string;
  readonly label: string;
  readonly copy: McpDocsCopy;
}) {
  return (
    <div className="rounded-modal border border-glass-border bg-glass-dense p-2">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-1">
        <p className="font-mono text-micro uppercase tracking-wider text-text-3">
          {label}
        </p>
        <CopyCodeButton
          code={code}
          label={`${copy.copyAction}: ${label}`}
          copyText={copy.copyAction}
          copiedText={copy.copiedStatus}
          failureText={copy.copyFailedStatus}
        />
      </div>
      <pre
        className="mt-2 overflow-x-auto font-mono text-data-sm text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-accent"
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ExternalDocsLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-0.5 font-mohave text-body-sm text-text-2 underline decoration-text-3 underline-offset-4 transition-colors duration-150 ease-smooth hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      {label}
      <ArrowUpRight aria-hidden className="h-icon-16 w-icon-16" />
    </a>
  );
}

function ToolRow({
  tool,
  copy,
}: {
  readonly tool: PublicMcpTool;
  readonly copy: McpDocsCopy;
}) {
  return (
    <li className="grid grid-cols-1 gap-1 border-t border-line py-2 first:border-t-0 lg:grid-cols-12 lg:gap-3">
      <div className="min-w-0 lg:col-span-4">
        <code className="break-words font-mono text-data-sm text-text">
          {tool.id}
        </code>
      </div>
      <p className="font-mohave text-body-sm text-text-2 lg:col-span-5">
        {tool.description}
      </p>
      <div className="min-w-0 lg:col-span-3">
        <p className="font-mono text-micro uppercase tracking-wider text-text-3">
          {copy.toolRequiredScopesLabel}
        </p>
        <p className="mt-0.5 break-words font-mono text-micro text-text-2">
          {tool.requiredScopes.join(" · ")}
        </p>
      </div>
    </li>
  );
}

export function McpGuidePage({ copy, reference }: McpGuidePageProps) {
  const toolById = new Map(reference.tools.map((tool) => [tool.id, tool]));
  const codexCommand = `codex mcp add ops --url ${reference.endpoint}`;
  const claudeCommand = `claude mcp add --transport http ops ${reference.endpoint}`;
  const requestHref = `mailto:${OPS_SUPPORT_EMAIL}?subject=${encodeURIComponent(
    copy.requestToolSubject
  )}&body=${encodeURIComponent(copy.requestToolTemplate)}`;

  return (
    <div className="min-h-screen bg-background text-text">
      <DevelopersHeader
        activeReference="mcp"
        copy={{
          developers: copy.headerDevelopers,
          navigationLabel: copy.headerNavigationLabel,
          restApi: copy.headerRestApi,
          mcp: copy.headerMcp,
          endpoint: copy.headerEndpoint,
        }}
        versionLabel={copy.headerVersion}
        endpoint={reference.endpoint}
      />

      <div className="mx-auto w-full max-w-screen-2xl px-2 md:px-3 xl:px-4">
        <McpGuideNavigation mobile copy={copy} />
        <div className="xl:grid xl:grid-cols-12">
          <aside className="hidden border-r border-line xl:col-span-2 xl:block">
            <McpGuideNavigation copy={copy} />
          </aside>

          <main className="min-w-0 xl:col-span-10 xl:pl-4">
            <section
              id="overview"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                {copy.overviewKicker}
              </p>
              <h1 className="mt-1 font-cakemono text-cake-display uppercase text-text">
                {copy.overviewTitle}
              </h1>
              <p className="mt-2 max-w-4xl font-mohave text-body-lg text-text-2">
                {copy.overviewDescription}
              </p>

              <dl className="mt-4 grid grid-cols-2 border-y border-line lg:grid-cols-4">
                {[
                  [copy.availableToolsLabel, reference.tools.length],
                  [copy.readScopesLabel, reference.scopes.length],
                  [copy.transportLabel, reference.transport],
                  [copy.modeLabel, copy.modeReadOnly],
                ].map(([label, value], index) => (
                  <div
                    key={String(label)}
                    className="border-b border-line p-2 odd:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"
                  >
                    <dt className="font-mono text-micro uppercase tracking-wider text-text-3">
                      {label}
                    </dt>
                    <dd
                      className={
                        index < 2
                          ? "mt-0.5 font-mono text-data-lg text-text"
                          : "mt-0.5 font-mono text-data-sm text-text"
                      }
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 grid grid-cols-1 border-y border-line md:grid-cols-2">
                <div className="py-2 md:pr-3">
                  <h2 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.sourceBackedTitle}
                  </h2>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.sourceBackedBody}
                  </p>
                  <p className="mt-1 font-mono text-micro text-text-3">
                    {copy.catalogRevisionLabel} ·{" "}
                    {reference.activeExposureRevision}
                  </p>
                </div>
                <div className="border-t border-line py-2 md:border-l md:border-t-0 md:pl-3">
                  <h2 className="font-cakemono text-cake-button uppercase text-text">
                    {copy.readOnlyTitle}
                  </h2>
                  <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                    {copy.readOnlyBody}
                  </p>
                </div>
              </div>
            </section>

            <section
              id="connect"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.connectTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.connectDescription}
              </p>

              <div className="mt-4">
                <CodePanel
                  code={reference.endpoint}
                  label={copy.endpointLabel}
                  copy={copy}
                />
              </div>

              <p className="mt-4 font-mono text-micro uppercase tracking-wider text-text-3">
                {copy.verificationCheckedLabel}
              </p>
              <div className="mt-1 grid grid-cols-1 border-y border-line lg:grid-cols-3">
                <section className="py-3 lg:pr-3" aria-labelledby="codex-title">
                  <h3
                    id="codex-title"
                    className="font-cakemono text-cake-section uppercase text-text"
                  >
                    {copy.codexTitle}
                  </h3>
                  <p className="mt-1 font-mono text-micro uppercase tracking-wider text-olive">
                    {copy.codexStatus}
                  </p>
                  <p className="mt-2 font-mohave text-body-sm text-text-2">
                    {copy.codexBody}
                  </p>
                  <div className="mt-3">
                    <CodePanel
                      code={codexCommand}
                      label={copy.codexCommandLabel}
                      copy={copy}
                    />
                  </div>
                  <ExternalDocsLink
                    href={HOST_DOCS.codex}
                    label={copy.codexDocsLabel}
                  />
                </section>

                <section
                  className="border-t border-line py-3 lg:border-l lg:border-t-0 lg:px-3"
                  aria-labelledby="claude-title"
                >
                  <h3
                    id="claude-title"
                    className="font-cakemono text-cake-section uppercase text-text"
                  >
                    {copy.claudeTitle}
                  </h3>
                  <p className="mt-1 font-mono text-micro uppercase tracking-wider text-tan">
                    {copy.claudeStatus}
                  </p>
                  <p className="mt-2 font-mohave text-body-sm text-text-2">
                    {copy.claudeBody}
                  </p>
                  <div className="mt-3">
                    <CodePanel
                      code={claudeCommand}
                      label={copy.claudeCommandLabel}
                      copy={copy}
                    />
                  </div>
                  <ExternalDocsLink
                    href={HOST_DOCS.claude}
                    label={copy.claudeDocsLabel}
                  />
                </section>

                <section
                  className="border-t border-line py-3 lg:border-l lg:border-t-0 lg:pl-3"
                  aria-labelledby="chatgpt-title"
                >
                  <h3
                    id="chatgpt-title"
                    className="font-cakemono text-cake-section uppercase text-text"
                  >
                    {copy.chatgptTitle}
                  </h3>
                  <p className="mt-1 font-mono text-micro uppercase tracking-wider text-tan">
                    {copy.chatgptStatus}
                  </p>
                  <p className="mt-2 font-mohave text-body-sm text-text-2">
                    {copy.chatgptBody}
                  </p>
                  <ExternalDocsLink
                    href={HOST_DOCS.chatgpt}
                    label={copy.chatgptDocsLabel}
                  />
                </section>
              </div>
              <p className="mt-3 max-w-4xl font-mohave text-body-sm text-text-3">
                {copy.hostVerificationNote}
              </p>
            </section>

            <section
              id="tested-prompts"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.examplesTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.examplesDescription}
              </p>
              <div className="mt-4 grid grid-cols-1 border-y border-line lg:grid-cols-3">
                {[
                  [copy.deckPromptLabel, copy.deckPrompt],
                  [copy.readinessPromptLabel, copy.readinessPrompt],
                  [copy.analyticsPromptLabel, copy.analyticsPrompt],
                ].map(([label, prompt]) => (
                  <div
                    key={label}
                    className="border-t border-line py-3 first:border-t-0 lg:border-l lg:border-t-0 lg:px-3 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0"
                  >
                    <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                      {label}
                    </p>
                    <p className="mt-2 font-mohave text-body text-text">
                      “{prompt}”
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 max-w-4xl font-mohave text-body-sm text-text-3">
                {copy.examplesBoundary}
              </p>
            </section>

            <section
              id="available-tools"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.capabilitiesTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.capabilitiesDescription}
              </p>
              <div className="mt-4 space-y-4">
                {reference.groups.map((group) => {
                  const copyKeys = GROUP_COPY_KEYS[group.label];
                  const tools = group.toolIds.map((toolId) => {
                    const tool = toolById.get(toolId);
                    if (!tool) {
                      throw new TypeError(
                        "Public MCP tool group is unresolved"
                      );
                    }
                    return tool;
                  });
                  return (
                    <section
                      key={group.id}
                      id={`tools-${group.id}`}
                      aria-labelledby={`tools-${group.id}-title`}
                      className="scroll-mt-8"
                    >
                      <div className="flex flex-col gap-1 border-b border-line pb-2 md:flex-row md:items-end md:justify-between md:gap-3">
                        <div>
                          <h3
                            id={`tools-${group.id}-title`}
                            className="font-cakemono text-cake-button uppercase text-text"
                          >
                            {copy[copyKeys.title]}
                          </h3>
                          <p className="mt-0.5 max-w-3xl font-mohave text-body-sm text-text-2">
                            {copy[copyKeys.body]}
                          </p>
                        </div>
                        <p className="shrink-0 font-mono text-data-sm text-text-3">
                          {tools.length}{" "}
                          {copy.availableToolsLabel.toLowerCase()}
                        </p>
                      </div>
                      <ul>
                        {tools.map((tool) => (
                          <ToolRow key={tool.id} tool={tool} copy={copy} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </section>

            <section
              id="permission-scopes"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.permissionsTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.permissionsDescription}
              </p>
              <dl className="mt-4 grid grid-cols-1 border-y border-line lg:grid-cols-2">
                {reference.scopes.map((scope, index) => (
                  <div
                    key={scope.id}
                    className="border-b border-line p-2 lg:odd:border-r lg:[&:nth-last-child(-n+2)]:border-b-0"
                  >
                    <dt className="font-mono text-data-sm text-text">
                      {scope.id}
                    </dt>
                    <dd className="mt-0.5 font-mohave text-body-sm text-text-2">
                      {scope.consentLabel}
                    </dd>
                    <span className="sr-only">
                      {copy.permissionScopeLabel} {index + 1}.{" "}
                      {copy.permissionAccessLabel}: {copy.modeReadOnly}.
                    </span>
                  </div>
                ))}
              </dl>
            </section>

            <section
              id="security"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.securityTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.securityDescription}
              </p>
              <div className="mt-4 grid grid-cols-1 border-y border-line md:grid-cols-2">
                {[
                  [copy.securityIdentityTitle, copy.securityIdentityBody],
                  [copy.securityTokensTitle, copy.securityTokensBody],
                  [copy.securityRevokeTitle, copy.securityRevokeBody],
                  [copy.securityContentTitle, copy.securityContentBody],
                ].map(([title, body]) => (
                  <div
                    key={title}
                    className="border-b border-line py-3 md:odd:pr-3 md:even:border-l md:even:pl-3 md:[&:nth-last-child(-n+2)]:border-b-0"
                  >
                    <h3 className="font-cakemono text-cake-button uppercase text-text">
                      {title}
                    </h3>
                    <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section
              id="limits"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.limitsTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.limitsDescription}
              </p>
              <div className="mt-4 grid grid-cols-1 border-y border-line lg:grid-cols-3">
                {[
                  [
                    copy.troubleshootReconnectTitle,
                    copy.troubleshootReconnectBody,
                  ],
                  [
                    copy.troubleshootUnauthorizedTitle,
                    copy.troubleshootUnauthorizedBody,
                  ],
                  [copy.troubleshootMissingTitle, copy.troubleshootMissingBody],
                ].map(([title, body]) => (
                  <div
                    key={title}
                    className="border-t border-line py-3 first:border-t-0 lg:border-l lg:border-t-0 lg:px-3 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0"
                  >
                    <h3 className="font-cakemono text-cake-button uppercase text-text">
                      {title}
                    </h3>
                    <p className="mt-0.5 font-mohave text-body-sm text-text-2">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section
              id="request-tool"
              className="scroll-mt-8 border-b border-line py-6"
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <h2 className="font-cakemono text-cake-section uppercase text-text">
                    {copy.requestToolTitle}
                  </h2>
                  <p className="mt-1 max-w-3xl font-mohave text-body text-text-2">
                    {copy.requestToolBody}
                  </p>
                  <p className="mt-3 font-mono text-micro uppercase tracking-wider text-text-3">
                    {copy.requestToolSafety}
                  </p>
                </div>
                <div className="self-start rounded-modal border border-glass-border bg-glass-dense p-3 lg:col-span-5">
                  <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                    {copy.requestToolEmailLabel}
                  </p>
                  <a
                    href={requestHref}
                    className="mt-1 block break-all font-mono text-data-sm text-text-2 underline decoration-text-3 underline-offset-4 transition-colors duration-150 ease-smooth hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                  >
                    {OPS_SUPPORT_EMAIL}
                  </a>
                  <a
                    href={requestHref}
                    className="mt-3 inline-flex min-h-control-36 items-center gap-1 rounded border border-ops-accent px-2 font-cakemono text-cake-button uppercase text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                  >
                    <Mail aria-hidden className="h-icon-16 w-icon-16" />
                    {copy.requestToolAction}
                  </a>
                </div>
              </div>
            </section>

            <section className="py-6">
              <h2 className="font-cakemono text-cake-section uppercase text-text">
                {copy.restApiResourceTitle}
              </h2>
              <p className="mt-1 max-w-4xl font-mohave text-body text-text-2">
                {copy.restApiResourceBody}
              </p>
              <a
                href="/developers/api"
                className="mt-3 inline-flex items-center gap-0.5 font-mohave text-body text-text-2 underline decoration-text-3 underline-offset-4 transition-colors duration-150 ease-smooth hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                {copy.restApiResourceAction}
                <ArrowUpRight aria-hidden className="h-icon-16 w-icon-16" />
              </a>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
