/**
 * OPS Web - Permission Types & Constants
 *
 * Defines the complete permission system: modules, actions, scopes,
 * preset role IDs, category groupings, and human-readable labels.
 */

// ─── Core Types ──────────────────────────────────────────────────────────────

export type PermissionScope = "all" | "assigned" | "own";

export type AppPermission = (typeof ALL_PERMISSIONS)[number];

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isPreset: boolean;
  companyId: string | null;
  hierarchy: number;
  createdAt: string;
  updatedAt: string;
}

export interface RolePermission {
  roleId: string;
  permission: string;
  scope: PermissionScope;
}

export interface UserRole {
  userId: string;
  roleId: string;
  createdAt: string;
}

// ─── Preset Role IDs ─────────────────────────────────────────────────────────

export const PRESET_ROLE_IDS = {
  ADMIN: "00000000-0000-0000-0000-000000000001",
  OWNER: "00000000-0000-0000-0000-000000000002",
  OFFICE: "00000000-0000-0000-0000-000000000003",
  OPERATOR: "00000000-0000-0000-0000-000000000004",
  CREW: "00000000-0000-0000-0000-000000000005",
  UNASSIGNED: "00000000-0000-0000-0000-000000000006",
} as const;

// ─── Permission Module Definitions ───────────────────────────────────────────

export interface PermissionAction {
  id: string;
  label: string;
  scopes: PermissionScope[];
  /** Registered for compatibility/admin bypass, but never offered by new editors. */
  hiddenFromEditor?: boolean;
}

export interface PermissionModule {
  id: string;
  label: string;
  actions: PermissionAction[];
  /** Modules with independent action scopes cannot be represented by one tier row. */
  editorMode?: "tier" | "action";
}

export interface PermissionCategory {
  id: string;
  label: string;
  modules: PermissionModule[];
}

const projectsModule: PermissionModule = {
  id: "projects",
  label: "Projects",
  actions: [
    {
      id: "projects.view",
      label: "View projects",
      scopes: ["all", "assigned"],
    },
    { id: "projects.create", label: "Create projects", scopes: ["all"] },
    {
      id: "projects.edit",
      label: "Edit projects",
      scopes: ["all", "assigned"],
    },
    { id: "projects.delete", label: "Delete projects", scopes: ["all"] },
    { id: "projects.archive", label: "Archive projects", scopes: ["all"] },
    {
      id: "projects.assign_team",
      label: "Assign team members",
      scopes: ["all"],
    },
    {
      id: "projects.manage_views",
      label: "Manage shared project views",
      scopes: ["all"],
    },
    {
      id: "projects.view_financials",
      label: "View project financials",
      scopes: ["all"],
    },
  ],
};

const tasksModule: PermissionModule = {
  id: "tasks",
  label: "Tasks",
  actions: [
    { id: "tasks.view", label: "View tasks", scopes: ["all", "assigned"] },
    { id: "tasks.create", label: "Create tasks", scopes: ["all"] },
    { id: "tasks.edit", label: "Edit tasks", scopes: ["all", "assigned"] },
    { id: "tasks.delete", label: "Delete tasks", scopes: ["all"] },
    { id: "tasks.assign", label: "Assign tasks", scopes: ["all"] },
    {
      id: "tasks.change_status",
      label: "Change task status",
      scopes: ["all", "assigned"],
    },
  ],
};

const clientsModule: PermissionModule = {
  id: "clients",
  label: "Clients",
  actions: [
    { id: "clients.view", label: "View clients", scopes: ["all", "assigned"] },
    { id: "clients.create", label: "Create clients", scopes: ["all"] },
    { id: "clients.edit", label: "Edit clients", scopes: ["all"] },
    { id: "clients.delete", label: "Delete clients", scopes: ["all"] },
  ],
};

const calendarModule: PermissionModule = {
  id: "calendar",
  label: "Calendar",
  actions: [
    { id: "calendar.view", label: "View calendar", scopes: ["all", "own"] },
    { id: "calendar.create", label: "Create events", scopes: ["all"] },
    { id: "calendar.edit", label: "Edit events", scopes: ["all", "own"] },
    { id: "calendar.delete", label: "Delete events", scopes: ["all"] },
  ],
};

const jobBoardModule: PermissionModule = {
  id: "job_board",
  label: "Job Board",
  actions: [
    {
      id: "job_board.view",
      label: "View job board",
      scopes: ["all", "assigned"],
    },
    {
      id: "job_board.manage_sections",
      label: "Manage board sections",
      scopes: ["all"],
    },
  ],
};

const deckBuilderModule: PermissionModule = {
  id: "deck_builder",
  label: "Deck Designer",
  actions: [
    {
      id: "deck_builder.view",
      label: "View deck designs",
      scopes: ["all", "assigned"],
    },
    {
      id: "deck_builder.create",
      label: "Create deck designs",
      scopes: ["all", "assigned"],
    },
    {
      id: "deck_builder.edit",
      label: "Edit deck designs",
      scopes: ["all", "assigned"],
    },
  ],
};

const estimatesModule: PermissionModule = {
  id: "estimates",
  label: "Estimates",
  actions: [
    {
      id: "estimates.view",
      label: "View estimates",
      scopes: ["all", "assigned"],
    },
    { id: "estimates.create", label: "Create estimates", scopes: ["all"] },
    { id: "estimates.edit", label: "Edit estimates", scopes: ["all", "own"] },
    { id: "estimates.delete", label: "Delete estimates", scopes: ["all"] },
    { id: "estimates.send", label: "Send estimates", scopes: ["all"] },
    { id: "estimates.convert", label: "Convert to invoice", scopes: ["all"] },
  ],
};

const invoicesModule: PermissionModule = {
  id: "invoices",
  label: "Invoices",
  actions: [
    {
      id: "invoices.view",
      label: "View invoices",
      scopes: ["all", "assigned"],
    },
    { id: "invoices.create", label: "Create invoices", scopes: ["all"] },
    { id: "invoices.edit", label: "Edit invoices", scopes: ["all"] },
    { id: "invoices.delete", label: "Delete invoices", scopes: ["all"] },
    { id: "invoices.send", label: "Send invoices", scopes: ["all"] },
    {
      id: "invoices.record_payment",
      label: "Record payments",
      scopes: ["all"],
    },
    { id: "invoices.void", label: "Void invoices", scopes: ["all"] },
  ],
};

const pipelineModule: PermissionModule = {
  id: "pipeline",
  label: "Pipeline",
  editorMode: "action",
  actions: [
    { id: "pipeline.create", label: "Create leads", scopes: ["all"] },
    { id: "pipeline.view", label: "View leads", scopes: ["all", "assigned"] },
    { id: "pipeline.edit", label: "Edit leads", scopes: ["all", "assigned"] },
    {
      id: "pipeline.assign",
      label: "Assign leads",
      scopes: ["all", "assigned"],
    },
    {
      id: "pipeline.convert",
      label: "Convert leads",
      scopes: ["all", "assigned"],
    },
    {
      id: "pipeline.manage",
      label: "Manage opportunities",
      scopes: ["all", "own"],
      hiddenFromEditor: true,
    },
    {
      id: "pipeline.configure_stages",
      label: "Configure stages",
      scopes: ["all"],
    },
    {
      id: "pipeline.manage_views",
      label: "Manage shared pipeline views",
      scopes: ["all"],
    },
  ],
};

const productsModule: PermissionModule = {
  id: "products",
  label: "Products",
  actions: [
    { id: "products.view", label: "View products", scopes: ["all"] },
    { id: "products.manage", label: "Manage products", scopes: ["all"] },
  ],
};

// Client home for the DB `catalog.*` namespace that ships in role_permissions.
// Keeping every live catalog bit registered here is load-bearing:
// account-holders & company-admins derive their grants from ALL_PERMISSIONS at
// scope 'all' (usePermissionStore.fetchPermissions), NOT from role_permissions.
// An unregistered DB bit silently denies the owner/admin path.
const catalogModule: PermissionModule = {
  id: "catalog",
  label: "Catalog",
  actions: [
    { id: "catalog.view", label: "View catalog", scopes: ["all"] },
    { id: "catalog.manage", label: "Manage catalog", scopes: ["all"] },
    { id: "catalog.import", label: "Import catalog", scopes: ["all"] },
    { id: "catalog.stock.adjust", label: "Adjust stock", scopes: ["all"] },
    {
      id: "catalog.products.view",
      label: "View catalog products",
      scopes: ["all"],
    },
    {
      id: "catalog.products.manage",
      label: "Manage catalog products",
      scopes: ["all"],
    },
    {
      id: "catalog.orders.view",
      label: "View purchase orders",
      scopes: ["all"],
    },
    {
      id: "catalog.orders.manage",
      label: "Manage purchase orders",
      scopes: ["all"],
    },
    { id: "catalog.run_setup", label: "Run catalog setup", scopes: ["all"] },
    { id: "inventory.manage", label: "Manage inventory", scopes: ["all"] },
  ],
};

const expensesModule: PermissionModule = {
  id: "expenses",
  label: "Expenses",
  actions: [
    { id: "expenses.view", label: "View expenses", scopes: ["all", "own"] },
    { id: "expenses.create", label: "Create expenses", scopes: ["all"] },
    { id: "expenses.edit", label: "Edit expenses", scopes: ["all", "own"] },
    { id: "expenses.delete", label: "Delete expenses", scopes: ["all", "own"] },
    {
      id: "expenses.approve",
      label: "Approve expenses",
      scopes: ["all", "assigned"],
    },
    {
      id: "expenses.configure",
      label: "Configure expense settings",
      scopes: ["all"],
    },
  ],
};

const accountingModule: PermissionModule = {
  id: "accounting",
  label: "Accounting",
  actions: [
    { id: "accounting.view", label: "View accounting", scopes: ["all"] },
    {
      id: "accounting.manage_connections",
      label: "Manage integrations",
      scopes: ["all"],
    },
  ],
};

const financesModule: PermissionModule = {
  id: "finances",
  label: "Financial Summaries",
  actions: [
    { id: "finances.view", label: "View financial summaries", scopes: ["all"] },
  ],
};

const photosModule: PermissionModule = {
  id: "photos",
  label: "Photos",
  actions: [
    { id: "photos.view", label: "View photos", scopes: ["all", "assigned"] },
    { id: "photos.upload", label: "Upload photos", scopes: ["all"] },
    { id: "photos.annotate", label: "Annotate photos", scopes: ["all"] },
    { id: "photos.delete", label: "Delete photos", scopes: ["all", "own"] },
  ],
};

const documentsModule: PermissionModule = {
  id: "documents",
  label: "Documents",
  actions: [
    { id: "documents.view", label: "View documents", scopes: ["all"] },
    {
      id: "documents.manage_templates",
      label: "Manage templates",
      scopes: ["all"],
    },
  ],
};

const teamModule: PermissionModule = {
  id: "team",
  label: "Team",
  actions: [
    { id: "team.view", label: "View team", scopes: ["all"] },
    { id: "team.manage", label: "Manage team members", scopes: ["all"] },
    { id: "team.assign_roles", label: "Assign roles", scopes: ["all"] },
  ],
};

const timeOffModule: PermissionModule = {
  id: "time_off",
  label: "Time Off",
  actions: [
    {
      id: "time_off.approve",
      label: "Approve time off",
      scopes: ["all", "assigned"],
    },
  ],
};

const profileModule: PermissionModule = {
  id: "profile",
  label: "Profile",
  actions: [{ id: "profile.edit", label: "Edit own profile", scopes: ["own"] }],
};

const mapModule: PermissionModule = {
  id: "map",
  label: "Map",
  actions: [
    { id: "map.view", label: "View map", scopes: ["all"] },
    {
      id: "map.view_crew_locations",
      label: "View crew locations",
      scopes: ["all"],
    },
  ],
};

const notificationsModule: PermissionModule = {
  id: "notifications",
  label: "Notifications",
  actions: [
    { id: "notifications.view", label: "View notifications", scopes: ["own"] },
    {
      id: "notifications.manage_preferences",
      label: "Manage preferences",
      scopes: ["own"],
    },
  ],
};

const settingsModule: PermissionModule = {
  id: "settings",
  label: "Settings",
  actions: [
    { id: "settings.company", label: "Company settings", scopes: ["all"] },
    { id: "settings.billing", label: "Billing settings", scopes: ["all"] },
    {
      id: "settings.integrations",
      label: "Integration settings",
      scopes: ["all"],
    },
    {
      id: "settings.preferences",
      label: "Personal preferences",
      scopes: ["all"],
    },
  ],
};

const emailModule: PermissionModule = {
  id: "email",
  label: "Email Integration",
  actions: [
    { id: "email.connect", label: "Connect email accounts", scopes: ["all"] },
    { id: "email.view", label: "View email activity", scopes: ["all", "own"] },
    { id: "email.manage", label: "Manage email integration", scopes: ["all"] },
    {
      id: "email.configure_ai",
      label: "Configure AI features",
      scopes: ["all"],
    },
  ],
};

const inboxModule: PermissionModule = {
  id: "inbox",
  label: "Inbox",
  editorMode: "action",
  actions: [
    {
      id: "inbox.view",
      label: "View inbox",
      scopes: ["all", "assigned", "own"],
    },
    {
      id: "inbox.view_company",
      label: "View all company mail",
      scopes: ["all"],
      hiddenFromEditor: true,
    },
    {
      id: "inbox.archive",
      label: "Archive / unarchive threads",
      scopes: ["all"],
    },
    { id: "inbox.snooze", label: "Snooze / unsnooze threads", scopes: ["all"] },
    { id: "inbox.categorize", label: "Recategorize threads", scopes: ["all"] },
    {
      id: "inbox.send",
      label: "Send and reply from inbox",
      scopes: ["all", "assigned"],
    },
    {
      id: "inbox.configure_phase_c",
      label: "Configure Phase C autonomy",
      scopes: ["all"],
    },
  ],
};

const portalModule: PermissionModule = {
  id: "portal",
  label: "Portal",
  actions: [
    { id: "portal.view", label: "View portal", scopes: ["all"] },
    { id: "portal.manage_branding", label: "Manage branding", scopes: ["all"] },
  ],
};

const reportsModule: PermissionModule = {
  id: "reports",
  label: "Reports",
  actions: [{ id: "reports.view", label: "View reports", scopes: ["all"] }],
};

// ─── Category Groupings ──────────────────────────────────────────────────────

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "core",
    label: "Core Operations",
    modules: [
      projectsModule,
      tasksModule,
      clientsModule,
      calendarModule,
      jobBoardModule,
      deckBuilderModule,
    ],
  },
  {
    id: "financial",
    label: "Financial",
    modules: [
      estimatesModule,
      invoicesModule,
      pipelineModule,
      productsModule,
      catalogModule,
      expensesModule,
      accountingModule,
      financesModule,
    ],
  },
  {
    id: "resources",
    label: "Resources",
    modules: [photosModule, documentsModule],
  },
  {
    id: "people",
    label: "People & Location",
    modules: [
      teamModule,
      timeOffModule,
      profileModule,
      mapModule,
      notificationsModule,
    ],
  },
  {
    id: "admin",
    label: "Admin",
    modules: [
      settingsModule,
      emailModule,
      inboxModule,
      portalModule,
      reportsModule,
    ],
  },
];

// ─── Flat Permission List ────────────────────────────────────────────────────
//
// This registry must stay a SUPERSET of every permission string granted in the
// DB (role_permissions / user_permission_overrides): account holders and
// company admins derive their access from ALL_PERMISSIONS at scope 'all', so
// an unregistered DB string is silently DENIED to the owner while remaining
// grantable to crew — the inverted-privilege trap.
//
// Deliberate exclusion: `spec.admin` (the internal SPEC operator console gate)
// is NEVER registered here. Registering it would hand the SPEC console to
// every company admin via the bypass. The permission-override API validates
// against ALL_PERMISSIONS, so the product surface can neither display nor
// write it.

export const ALL_PERMISSIONS = PERMISSION_CATEGORIES.flatMap((cat) =>
  cat.modules.flatMap((mod) => mod.actions.map((a) => a.id))
);

/**
 * Exact registry used by guarded role-permission replacement. Hidden legacy
 * compatibility bits remain readable in the expected snapshot but are never
 * rewritten by current editors.
 */
export const PERMISSION_EDITOR_REGISTRY = PERMISSION_CATEGORIES.flatMap((cat) =>
  cat.modules.flatMap((mod) =>
    mod.actions.filter((action) => !action.hiddenFromEditor)
  )
).sort((left, right) => left.id.localeCompare(right.id));

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

const _permissionLabelMap = new Map<string, string>();
const _moduleLabelMap = new Map<string, string>();

for (const cat of PERMISSION_CATEGORIES) {
  for (const mod of cat.modules) {
    _moduleLabelMap.set(mod.id, mod.label);
    for (const action of mod.actions) {
      _permissionLabelMap.set(action.id, action.label);
    }
  }
}

/** Get human-readable label for a permission (e.g., "projects.view" → "View projects") */
export function getPermissionLabel(permission: string): string {
  return _permissionLabelMap.get(permission) ?? permission;
}

/** Get human-readable label for a module (e.g., "projects" → "Projects") */
export function getModuleLabel(moduleId: string): string {
  return _moduleLabelMap.get(moduleId) ?? moduleId;
}

const _permissionModuleMap = new Map<string, string>();
for (const cat of PERMISSION_CATEGORIES) {
  for (const mod of cat.modules) {
    for (const action of mod.actions) {
      _permissionModuleMap.set(action.id, mod.id);
    }
  }
}

/** Map a permission id to its owning module id (e.g. "catalog.products.view" → "catalog"). */
export function getModuleForPermission(permission: string): string | null {
  return _permissionModuleMap.get(permission) ?? null;
}

/** Get the available scopes for a specific permission */
export function getPermissionScopes(permission: string): PermissionScope[] {
  for (const cat of PERMISSION_CATEGORIES) {
    for (const mod of cat.modules) {
      const action = mod.actions.find((a) => a.id === permission);
      if (action) return action.scopes;
    }
  }
  return ["all"];
}

// ─── Tier Mapping ─────────────────────────────────────────────────────────────

export type PermissionTier = "view" | "manage" | "full";

export const TIER_LABELS: Record<PermissionTier, string> = {
  view: "View Only",
  manage: "Manage",
  full: "Full Access",
};

/**
 * Action suffixes considered destructive / admin-only.
 * These are excluded from the "manage" tier.
 */
const DESTRUCTIVE_SUFFIXES = [
  "delete",
  "archive",
  "approve",
  "import",
  "assign_roles",
  "manage_connections",
  "manage_templates",
  "manage_branding",
  "configure_stages",
  "manage_sections",
  "company",
  "billing",
  "integrations",
  "void",
  "configure",
  "configure_ai",
  "configure_phase_c",
  "convert",
  "view_company",
  // Financial visibility never rides in via the Manage tier — granting a
  // module's day-to-day actions must not silently expose money.
  "view_financials",
];

function _isDestructive(actionId: string): boolean {
  const suffix = actionId.split(".").slice(1).join(".");
  return DESTRUCTIVE_SUFFIXES.includes(suffix);
}

function _findModule(moduleId: string): PermissionModule | undefined {
  for (const cat of PERMISSION_CATEGORIES) {
    const mod = cat.modules.find((m) => m.id === moduleId);
    if (mod) return mod;
  }
  return undefined;
}

/**
 * Return action IDs for a given module and tier.
 *  - "view"   → only actions ending in `.view`
 *  - "manage" → all actions EXCEPT destructive ones
 *  - "full"   → all actions
 */
export function getActionsForTier(
  moduleId: string,
  tier: PermissionTier
): string[] {
  const mod = _findModule(moduleId);
  if (!mod) return [];
  const editableActions = mod.actions.filter(
    (action) => !action.hiddenFromEditor
  );

  switch (tier) {
    case "view":
      return editableActions
        .filter((a) => a.id.endsWith(".view"))
        .map((a) => a.id);
    case "manage":
      return editableActions
        .filter((a) => !_isDestructive(a.id))
        .map((a) => a.id);
    case "full":
      return editableActions.map((a) => a.id);
  }
}

/**
 * Detect the current tier for a module based on which permissions are enabled.
 * Returns null if no permissions for the module are enabled.
 */
export function detectModuleTier(
  moduleId: string,
  enabledPermissions: string[]
): PermissionTier | null {
  const mod = _findModule(moduleId);
  if (!mod) return null;

  const allActionIds = mod.actions
    .filter((action) => !action.hiddenFromEditor)
    .map((action) => action.id);
  const enabled = allActionIds.filter((id) => enabledPermissions.includes(id));

  if (enabled.length === 0) return null;

  // Check full first: every action in the module is enabled
  const fullActions = getActionsForTier(moduleId, "full");
  if (fullActions.every((id) => enabled.includes(id))) return "full";

  // Check manage: every non-destructive action is enabled
  const manageActions = getActionsForTier(moduleId, "manage");
  if (manageActions.every((id) => enabled.includes(id))) return "manage";

  // Check view: at least the view actions are present
  const viewActions = getActionsForTier(moduleId, "view");
  if (viewActions.length > 0 && viewActions.every((id) => enabled.includes(id)))
    return "view";

  // Enabled permissions don't map cleanly to a tier
  return null;
}

/**
 * Return modules whose actions include at least one action with more than
 * one scope option (e.g., ["all", "assigned"]).
 */
export function getModulesWithScopes(): PermissionModule[] {
  const result: PermissionModule[] = [];
  for (const cat of PERMISSION_CATEGORIES) {
    for (const mod of cat.modules) {
      if (mod.actions.some((a) => a.scopes.length > 1)) {
        result.push(mod);
      }
    }
  }
  return result;
}
