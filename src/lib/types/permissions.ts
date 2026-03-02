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
  assignedAt: string;
  assignedBy: string | null;
}

// ─── Preset Role IDs ─────────────────────────────────────────────────────────

export const PRESET_ROLE_IDS = {
  ADMIN: "00000000-0000-0000-0000-000000000001",
  OWNER: "00000000-0000-0000-0000-000000000002",
  OFFICE: "00000000-0000-0000-0000-000000000003",
  OPERATOR: "00000000-0000-0000-0000-000000000004",
  CREW: "00000000-0000-0000-0000-000000000005",
} as const;

// ─── Permission Module Definitions ───────────────────────────────────────────

export interface PermissionAction {
  id: string;
  label: string;
  scopes: PermissionScope[];
}

export interface PermissionModule {
  id: string;
  label: string;
  actions: PermissionAction[];
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
    { id: "projects.view", label: "View projects", scopes: ["all", "assigned"] },
    { id: "projects.create", label: "Create projects", scopes: ["all"] },
    { id: "projects.edit", label: "Edit projects", scopes: ["all", "assigned"] },
    { id: "projects.delete", label: "Delete projects", scopes: ["all"] },
    { id: "projects.archive", label: "Archive projects", scopes: ["all"] },
    { id: "projects.assign_team", label: "Assign team members", scopes: ["all"] },
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
    { id: "tasks.change_status", label: "Change task status", scopes: ["all", "assigned"] },
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
    { id: "job_board.view", label: "View job board", scopes: ["all", "assigned"] },
    { id: "job_board.manage_sections", label: "Manage board sections", scopes: ["all"] },
  ],
};

const estimatesModule: PermissionModule = {
  id: "estimates",
  label: "Estimates",
  actions: [
    { id: "estimates.view", label: "View estimates", scopes: ["all", "assigned"] },
    { id: "estimates.create", label: "Create estimates", scopes: ["all"] },
    { id: "estimates.edit", label: "Edit estimates", scopes: ["all", "own"] },
    { id: "estimates.delete", label: "Delete estimates", scopes: ["all"] },
    { id: "estimates.send", label: "Send estimates", scopes: ["all"] },
  ],
};

const invoicesModule: PermissionModule = {
  id: "invoices",
  label: "Invoices",
  actions: [
    { id: "invoices.view", label: "View invoices", scopes: ["all", "assigned"] },
    { id: "invoices.create", label: "Create invoices", scopes: ["all"] },
    { id: "invoices.edit", label: "Edit invoices", scopes: ["all"] },
    { id: "invoices.delete", label: "Delete invoices", scopes: ["all"] },
    { id: "invoices.send", label: "Send invoices", scopes: ["all"] },
    { id: "invoices.record_payment", label: "Record payments", scopes: ["all"] },
  ],
};

const pipelineModule: PermissionModule = {
  id: "pipeline",
  label: "Pipeline",
  actions: [
    { id: "pipeline.view", label: "View pipeline", scopes: ["all"] },
    { id: "pipeline.manage", label: "Manage opportunities", scopes: ["all"] },
    { id: "pipeline.configure_stages", label: "Configure stages", scopes: ["all"] },
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

const expensesModule: PermissionModule = {
  id: "expenses",
  label: "Expenses",
  actions: [
    { id: "expenses.view", label: "View expenses", scopes: ["all", "own"] },
    { id: "expenses.create", label: "Create expenses", scopes: ["all"] },
    { id: "expenses.edit", label: "Edit expenses", scopes: ["all", "own"] },
    { id: "expenses.approve", label: "Approve expenses", scopes: ["all"] },
  ],
};

const accountingModule: PermissionModule = {
  id: "accounting",
  label: "Accounting",
  actions: [
    { id: "accounting.view", label: "View accounting", scopes: ["all"] },
    { id: "accounting.manage_connections", label: "Manage integrations", scopes: ["all"] },
  ],
};

const inventoryModule: PermissionModule = {
  id: "inventory",
  label: "Inventory",
  actions: [
    { id: "inventory.view", label: "View inventory", scopes: ["all"] },
    { id: "inventory.manage", label: "Manage inventory", scopes: ["all"] },
    { id: "inventory.import", label: "Import inventory", scopes: ["all"] },
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
    { id: "documents.manage_templates", label: "Manage templates", scopes: ["all"] },
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

const mapModule: PermissionModule = {
  id: "map",
  label: "Map",
  actions: [
    { id: "map.view", label: "View map", scopes: ["all"] },
    { id: "map.view_crew_locations", label: "View crew locations", scopes: ["all"] },
  ],
};

const notificationsModule: PermissionModule = {
  id: "notifications",
  label: "Notifications",
  actions: [
    { id: "notifications.view", label: "View notifications", scopes: ["own"] },
    { id: "notifications.manage_preferences", label: "Manage preferences", scopes: ["own"] },
  ],
};

const settingsModule: PermissionModule = {
  id: "settings",
  label: "Settings",
  actions: [
    { id: "settings.company", label: "Company settings", scopes: ["all"] },
    { id: "settings.billing", label: "Billing settings", scopes: ["all"] },
    { id: "settings.integrations", label: "Integration settings", scopes: ["all"] },
    { id: "settings.preferences", label: "Personal preferences", scopes: ["all"] },
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
  actions: [
    { id: "reports.view", label: "View reports", scopes: ["all"] },
  ],
};

// ─── Category Groupings ──────────────────────────────────────────────────────

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "core",
    label: "Core Operations",
    modules: [projectsModule, tasksModule, clientsModule, calendarModule, jobBoardModule],
  },
  {
    id: "financial",
    label: "Financial",
    modules: [estimatesModule, invoicesModule, pipelineModule, productsModule, expensesModule, accountingModule],
  },
  {
    id: "resources",
    label: "Resources",
    modules: [inventoryModule, photosModule, documentsModule],
  },
  {
    id: "people",
    label: "People & Location",
    modules: [teamModule, mapModule, notificationsModule],
  },
  {
    id: "admin",
    label: "Admin",
    modules: [settingsModule, portalModule, reportsModule],
  },
];

// ─── Flat Permission List ────────────────────────────────────────────────────

export const ALL_PERMISSIONS = PERMISSION_CATEGORIES.flatMap((cat) =>
  cat.modules.flatMap((mod) => mod.actions.map((a) => a.id))
);

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
