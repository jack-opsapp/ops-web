import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PermissionModuleEditor } from "@/components/settings/permission-grid";
import {
  PERMISSION_CATEGORIES,
  type PermissionModule,
  type PermissionScope,
} from "@/lib/types/permissions";
import type { PermissionEditState } from "@/lib/permissions/pipeline-dependencies";
import en from "@/i18n/dictionaries/en/settings.json";
import es from "@/i18n/dictionaries/es/settings.json";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) =>
      ({
        "roles.tierNone": "None",
        "roles.tierViewOnly": "View",
        "roles.tierManage": "Manage",
        "roles.tierFullAccess": "Full",
        "roles.scopeAll": "All",
        "roles.scopeAssignedOnly": "Assigned",
        "roles.scopeOwn": "Own",
        "roles.customPermissions": "Custom",
        "roles.permissionModule.pipeline": "Pipeline",
        "roles.permissionModule.inbox": "Inbox",
        "roles.permissionAction.pipeline.create": "Create leads",
        "roles.permissionAction.pipeline.view": "View leads",
        "roles.permissionAction.pipeline.edit": "Edit leads",
        "roles.permissionAction.pipeline.assign": "Assign leads",
        "roles.permissionAction.pipeline.convert": "Convert leads",
        "roles.permissionAction.inbox.view": "View inbox",
        "roles.permissionAction.inbox.send": "Send and reply",
        "roles.pipelineDependencyHint":
          "Create needs view access. Edit cannot exceed view; assign and convert cannot exceed edit.",
        "roles.inboxScopeHint": "Set view and send access separately.",
      })[key] ??
      fallback ??
      key,
  }),
}));

const localizedActionKeys = [
  "roles.permissionModule.pipeline",
  "roles.permissionModule.inbox",
  "roles.permissionAction.pipeline.create",
  "roles.permissionAction.pipeline.view",
  "roles.permissionAction.pipeline.edit",
  "roles.permissionAction.pipeline.assign",
  "roles.permissionAction.pipeline.convert",
  "roles.permissionAction.pipeline.configure_stages",
  "roles.permissionAction.pipeline.manage_views",
  "roles.permissionAction.inbox.view",
  "roles.permissionAction.inbox.archive",
  "roles.permissionAction.inbox.snooze",
  "roles.permissionAction.inbox.categorize",
  "roles.permissionAction.inbox.send",
  "roles.permissionAction.inbox.configure_phase_c",
  "roles.pipelineDependencyHint",
  "roles.inboxScopeHint",
] as const;

describe("action-level permission dictionaries", () => {
  it.each(localizedActionKeys)("defines %s in English and Spanish", (key) => {
    expect(en[key]).toBeTruthy();
    expect(es[key]).toBeTruthy();
  });
});

function moduleById(id: string): PermissionModule {
  const permissionModule = PERMISSION_CATEGORIES.flatMap(
    (category) => category.modules
  ).find((candidate) => candidate.id === id);
  if (!permissionModule) throw new Error(`Missing ${id} module`);
  return permissionModule;
}

function editMap(
  permissionModule: PermissionModule
): Map<string, PermissionEditState> {
  return new Map(
    permissionModule.actions.map((action) => [
      action.id,
      {
        permission: action.id,
        scope: action.scopes[0],
        enabled: action.id.endsWith(".view"),
      },
    ])
  );
}

const noScopeOptions: Array<{ value: PermissionScope; label: string }> = [];

describe("PermissionModuleEditor", () => {
  it("renders Pipeline as independent radio groups and hides pipeline.manage", async () => {
    const user = userEvent.setup();
    const permissionModule = moduleById("pipeline");
    const onActionChange = vi.fn();

    render(
      <PermissionModuleEditor
        module={permissionModule}
        edits={editMap(permissionModule)}
        tier="view"
        isCustom={false}
        scope="all"
        scopeOptions={noScopeOptions}
        onTierChange={vi.fn()}
        onScopeChange={vi.fn()}
        onActionChange={onActionChange}
      />
    );

    expect(screen.getByText(/Create needs view access/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Manage opportunities" })
    ).not.toBeInTheDocument();

    const view = screen.getByRole("radiogroup", { name: "View leads" });
    expect(within(view).getByRole("radio", { name: "All" })).toBeChecked();
    expect(
      within(view).getByRole("radio", { name: "Assigned" })
    ).toBeInTheDocument();

    const create = screen.getByRole("radiogroup", { name: "Create leads" });
    expect(
      within(create).queryByRole("radio", { name: "Assigned" })
    ).not.toBeInTheDocument();

    const edit = screen.getByRole("radiogroup", { name: "Edit leads" });
    await user.click(within(edit).getByRole("radio", { name: "Assigned" }));
    expect(onActionChange).toHaveBeenCalledWith("pipeline.edit", "assigned");
  });

  it("renders Inbox view/send scopes independently and hides inbox.view_company", () => {
    const permissionModule = moduleById("inbox");

    render(
      <PermissionModuleEditor
        module={permissionModule}
        edits={editMap(permissionModule)}
        tier="view"
        isCustom={false}
        scope="all"
        scopeOptions={noScopeOptions}
        onTierChange={vi.fn()}
        onScopeChange={vi.fn()}
        onActionChange={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("group", { name: "View all company mail" })
    ).not.toBeInTheDocument();
    const view = screen.getByRole("radiogroup", { name: "View inbox" });
    expect(
      within(view).getByRole("radio", { name: "Own" })
    ).toBeInTheDocument();
    const send = screen.getByRole("radiogroup", {
      name: "Send and reply",
    });
    expect(
      within(send).getByRole("radio", { name: "Assigned" })
    ).toBeInTheDocument();
    expect(
      within(send).queryByRole("radio", { name: "Own" })
    ).not.toBeInTheDocument();
  });

  it("uses one native radio group per action with arrow-key selection", async () => {
    const user = userEvent.setup();
    const permissionModule = moduleById("pipeline");

    function Harness() {
      const [edits, setEdits] = useState(() => editMap(permissionModule));

      return (
        <PermissionModuleEditor
          module={permissionModule}
          edits={edits}
          tier="view"
          isCustom={false}
          scope="all"
          scopeOptions={noScopeOptions}
          onTierChange={vi.fn()}
          onScopeChange={vi.fn()}
          onActionChange={(permission, scope) => {
            setEdits((current) => {
              const existing = current.get(permission);
              if (!existing) return current;
              const next = new Map(current);
              next.set(permission, {
                ...existing,
                enabled: scope !== null,
                scope: scope ?? existing.scope,
              });
              return next;
            });
          }}
        />
      );
    }

    render(<Harness />);

    const view = screen.getByRole("radiogroup", { name: "View leads" });
    const all = within(view).getByRole("radio", { name: "All" });
    const assigned = within(view).getByRole("radio", { name: "Assigned" });

    expect(all).toHaveAttribute("name");
    expect(assigned).toHaveAttribute("name", all.getAttribute("name"));
    expect(all).toBeChecked();

    all.focus();
    await user.keyboard("{ArrowRight}");

    expect(assigned).toHaveFocus();
    expect(assigned).toBeChecked();
  });

  it("keeps choice radios inert while the editor is disabled", async () => {
    const user = userEvent.setup();
    const permissionModule = moduleById("pipeline");
    const onActionChange = vi.fn();

    render(
      <PermissionModuleEditor
        module={permissionModule}
        edits={editMap(permissionModule)}
        tier="view"
        isCustom={false}
        scope="all"
        scopeOptions={noScopeOptions}
        disabled
        onTierChange={vi.fn()}
        onScopeChange={vi.fn()}
        onActionChange={onActionChange}
      />
    );

    const view = screen.getByRole("radiogroup", { name: "View leads" });
    const assigned = within(view).getByRole("radio", { name: "Assigned" });
    expect(assigned).toBeDisabled();

    await user.click(assigned);
    expect(onActionChange).not.toHaveBeenCalled();
  });

  it("keeps every other module on the existing tier row", () => {
    const permissionModule = moduleById("projects");

    render(
      <PermissionModuleEditor
        module={permissionModule}
        edits={editMap(permissionModule)}
        tier="view"
        isCustom={false}
        scope="assigned"
        scopeOptions={[
          { value: "all", label: "All" },
          { value: "assigned", label: "Assigned" },
        ]}
        onTierChange={vi.fn()}
        onScopeChange={vi.fn()}
        onActionChange={vi.fn()}
      />
    );

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "View" })).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "View projects" })
    ).not.toBeInTheDocument();
  });
});
