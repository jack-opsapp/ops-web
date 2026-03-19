// ---------------------------------------------------------------------------
// Galaxy Layout — Hierarchical Positioning
//
// Computes 3D positions for all visible nodes based on the current focus level.
// Level 1: Clients orbit the organization center (2D ring, slight z-jitter)
// Level 2: Projects orbit the focused client; other clients dim + repulse
// Level 3: Tasks/team/financial orbit the focused project
//
// Pure TypeScript — no React, no Three.js. Deterministic given the same input.
// ---------------------------------------------------------------------------

import { PROJECT_STATUS_COLORS, TASK_STATUS_COLORS, type ProjectStatus, type TaskStatus } from "@/lib/types/models";
import type { IntelTask, IntelTeamMember, IntelClientWithStatus } from "@/types/intel";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PositionedNode {
  entityId: string;
  nodeType: "organization" | "client" | "project" | "task" | "team" | "financial";
  position: [number, number, number];
  color: string;
  label: string;
  sublabel?: string;
  dimmed: boolean;
  visible: boolean;
}

export interface HierarchicalLayoutConfig {
  clients: IntelClientWithStatus[];
  projects: Array<{
    id: string;
    clientId: string;
    title: string;
    status: string;
    address: string | null;
  }>;
  tasks: IntelTask[];
  teamMembers: IntelTeamMember[];
  financialEntities: Array<{
    id: string;
    projectId: string | null;
    name: string;
    type: "invoice" | "estimate";
    total: number | null;
    status: string | null;
  }>;
  focusLevel: 1 | 2 | 3;
  focusedClientId: string | null;
  focusedProjectId: string | null;
}

// ---------------------------------------------------------------------------
// Cluster color palette — exported so HUD components share the same tokens
// ---------------------------------------------------------------------------

export const CLUSTER_COLORS: Record<string, string> = {
  voice: "#597794",
  internal: "#8E8E93",
  client: "#8195B5",
  project: "#B58289",
  vendor: "#C4A868",
  subtrade: "#9DB582",
  financial: "#BCBCBC",
};

// ---------------------------------------------------------------------------
// Deterministic hash — djb2 variant. Maps any string → 32-bit signed integer.
// Used for z-jitter, phase offsets, and any place we need stable randomness.
// ---------------------------------------------------------------------------

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Status color helpers
// ---------------------------------------------------------------------------

function projectStatusColor(status: string): string {
  return PROJECT_STATUS_COLORS[status as ProjectStatus] ?? "#BCBCBC";
}

function taskStatusColor(status: string): string {
  return TASK_STATUS_COLORS[status as TaskStatus] ?? "#8195B5";
}

// ---------------------------------------------------------------------------
// Level 1 — Clients orbit organization
//
// Evenly distributed around a 2D circle with slight z-jitter.
// Color comes from the client's most-active project status.
// ---------------------------------------------------------------------------

function layoutLevel1(config: HierarchicalLayoutConfig): PositionedNode[] {
  const result: PositionedNode[] = [];
  const { clients } = config;
  if (clients.length === 0) return result;

  // Adaptive radius: sparser data gets wider orbits so nodes aren't crammed
  const baseRadius = clients.length < 10 ? 7 : clients.length < 25 ? 5.5 : 4.5;

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    const angle = (i / clients.length) * Math.PI * 2;
    const x = baseRadius * Math.cos(angle);
    const y = baseRadius * Math.sin(angle);
    // z-jitter: ±0.3 based on entity hash — slight depth, not flat
    const z = ((hashString(client.id) % 60) - 30) / 100;

    result.push({
      entityId: client.id,
      nodeType: "client",
      position: [x, y, z],
      color: projectStatusColor(client.mostActiveProjectStatus),
      label: client.name,
      dimmed: false,
      visible: true,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Level 2 — Projects orbit focused client
//
// The focused client stays at its Level 1 position.
// Its projects orbit it in a ring. Other clients dim and repulse outward.
// ---------------------------------------------------------------------------

function layoutLevel2(
  config: HierarchicalLayoutConfig,
  clientPositions: Map<string, [number, number, number]>
): PositionedNode[] {
  const result: PositionedNode[] = [];
  const focusPos = clientPositions.get(config.focusedClientId!);
  if (!focusPos) return result;

  // Re-emit all clients — dimmed + repulsed if not focused
  for (const client of config.clients) {
    const pos = clientPositions.get(client.id);
    if (!pos) continue;
    const isFocused = client.id === config.focusedClientId;

    let finalPos: [number, number, number] = pos;
    if (!isFocused) {
      // Repulse: push 1.5x further from the focused client's position.
      // This creates visual breathing room around the focus point.
      const dx = pos[0] - focusPos[0];
      const dy = pos[1] - focusPos[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.01) {
        finalPos = [
          focusPos[0] + (dx / len) * len * 1.5,
          focusPos[1] + (dy / len) * len * 1.5,
          pos[2],
        ];
      }
    }

    result.push({
      entityId: client.id,
      nodeType: "client",
      position: finalPos,
      color: projectStatusColor(client.mostActiveProjectStatus),
      label: client.name,
      dimmed: !isFocused,
      visible: true,
    });
  }

  // Projects orbit the focused client — tight orbit so they feel connected
  const clientProjects = config.projects.filter(p => p.clientId === config.focusedClientId);
  if (clientProjects.length === 0) return result;

  const pRadius = clientProjects.length < 6 ? 1.8 : clientProjects.length < 15 ? 1.5 : 1.2;

  for (let i = 0; i < clientProjects.length; i++) {
    const project = clientProjects[i];
    const angle = (i / clientProjects.length) * Math.PI * 2;
    const x = focusPos[0] + pRadius * Math.cos(angle);
    const y = focusPos[1] + pRadius * Math.sin(angle);
    const z = focusPos[2] + ((hashString(project.id) % 40) - 20) / 100;

    result.push({
      entityId: project.id,
      nodeType: "project",
      position: [x, y, z],
      color: projectStatusColor(project.status),
      label: project.title,
      sublabel: project.address || undefined,
      dimmed: false,
      visible: true,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Level 3 — Tasks / Team / Financial orbit focused project
//
// Inner ring: tasks (colored by taskColor)
// Mid ring: financial entities (invoices/estimates)
// Outer ring: team members assigned to this project's tasks
// Non-focused projects dim + repulse. Clients deeply dim.
// ---------------------------------------------------------------------------

function layoutLevel3(
  config: HierarchicalLayoutConfig,
  clientPositions: Map<string, [number, number, number]>,
  projectPositions: Map<string, [number, number, number]>
): PositionedNode[] {
  const result: PositionedNode[] = [];
  const focusPos = projectPositions.get(config.focusedProjectId!);
  if (!focusPos) return result;
  const clientPos = clientPositions.get(config.focusedClientId!) ?? [0, 0, 0] as [number, number, number];

  // ── Clients: deeply dimmed, repulsed ──────────────────────────────────
  for (const client of config.clients) {
    const pos = clientPositions.get(client.id);
    if (!pos) continue;
    const dx = pos[0] - focusPos[0];
    const dy = pos[1] - focusPos[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const finalPos: [number, number, number] = len > 0.01
      ? [focusPos[0] + (dx / len) * len * 1.8, focusPos[1] + (dy / len) * len * 1.8, pos[2]]
      : pos;

    result.push({
      entityId: client.id,
      nodeType: "client",
      position: finalPos,
      color: projectStatusColor(client.mostActiveProjectStatus),
      label: client.name,
      dimmed: true,
      visible: true,
    });
  }

  // ── Projects of focused client: dimmed except focused ─────────────────
  const siblingProjects = config.projects.filter(p => p.clientId === config.focusedClientId);
  const pRadius = siblingProjects.length < 6 ? 1.8 : siblingProjects.length < 15 ? 1.5 : 1.2;

  for (let i = 0; i < siblingProjects.length; i++) {
    const project = siblingProjects[i];
    const isFocused = project.id === config.focusedProjectId;
    const angle = (i / siblingProjects.length) * Math.PI * 2;
    let x = clientPos[0] + pRadius * Math.cos(angle);
    let y = clientPos[1] + pRadius * Math.sin(angle);
    const z = clientPos[2] + ((hashString(project.id) % 40) - 20) / 100;

    if (!isFocused) {
      // Repulse from focused project
      const dx = x - focusPos[0];
      const dy = y - focusPos[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.01) {
        x = focusPos[0] + (dx / len) * len * 1.5;
        y = focusPos[1] + (dy / len) * len * 1.5;
      }
    }

    result.push({
      entityId: project.id,
      nodeType: "project",
      position: [x, y, z],
      color: projectStatusColor(project.status),
      label: project.title,
      sublabel: project.address || undefined,
      dimmed: !isFocused,
      visible: true,
    });
  }

  // ── Tasks orbit focused project (inner ring) ──────────────────────────
  const projectTasks = config.tasks.filter(t => t.projectId === config.focusedProjectId);
  const taskRadius = projectTasks.length < 5 ? 1.8 : projectTasks.length < 12 ? 1.4 : 1.1;

  for (let i = 0; i < projectTasks.length; i++) {
    const task = projectTasks[i];
    const angle = (i / projectTasks.length) * Math.PI * 2;
    const x = focusPos[0] + taskRadius * Math.cos(angle);
    const y = focusPos[1] + taskRadius * Math.sin(angle);
    const z = focusPos[2] + ((hashString(task.id) % 30) - 15) / 100;

    // Sublabel: date + status
    let sublabel: string = task.status;
    if (task.startDate) {
      const d = new Date(task.startDate);
      const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      sublabel = `${dateStr} · ${task.status}`;
    }

    result.push({
      entityId: task.id,
      nodeType: "task",
      position: [x, y, z],
      color: task.taskColor,
      label: task.title,
      sublabel,
      dimmed: false,
      visible: true,
    });
  }

  // ── Team members orbit focused project (outer ring) ───────────────────
  // Collect unique team member IDs from this project's tasks
  const projectTeamIds = new Set<string>();
  for (const task of projectTasks) {
    for (const id of task.teamMemberIds) projectTeamIds.add(id);
  }
  const teamForProject = config.teamMembers.filter(m => projectTeamIds.has(m.id));
  const teamRadius = 2.5;

  for (let i = 0; i < teamForProject.length; i++) {
    const member = teamForProject[i];
    // Offset angle from tasks so they don't overlap
    const angle = (i / Math.max(teamForProject.length, 1)) * Math.PI * 2 + Math.PI / 6;
    const x = focusPos[0] + teamRadius * Math.cos(angle);
    const y = focusPos[1] + teamRadius * Math.sin(angle);
    const z = focusPos[2] + 0.1;

    result.push({
      entityId: member.id,
      nodeType: "team",
      position: [x, y, z],
      color: member.userColor || "#8E8E93",
      label: `${member.firstName} ${member.lastName}`.trim() || "Team Member",
      sublabel: member.role,
      dimmed: false,
      visible: true,
    });
  }

  // ── Financial entities orbit focused project (mid ring) ────────────────
  const projectFinancials = config.financialEntities.filter(
    f => f.projectId === config.focusedProjectId
  );
  const finRadius = 2.0;

  for (let i = 0; i < projectFinancials.length; i++) {
    const fin = projectFinancials[i];
    // Offset angle from tasks + team
    const angle = (i / Math.max(projectFinancials.length, 1)) * Math.PI * 2 + Math.PI / 3;
    const x = focusPos[0] + finRadius * Math.cos(angle);
    const y = focusPos[1] + finRadius * Math.sin(angle);
    const z = focusPos[2] - 0.1;

    result.push({
      entityId: fin.id,
      nodeType: "financial",
      position: [x, y, z],
      color: "#BCBCBC",
      label: fin.name,
      sublabel: fin.total != null ? `$${fin.total.toLocaleString()}` : undefined,
      dimmed: false,
      visible: true,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main export — dispatches to the appropriate level layout
// ---------------------------------------------------------------------------

export function computeHierarchicalLayout(config: HierarchicalLayoutConfig): PositionedNode[] {
  // Always compute Level 1 positions first (client ring around origin)
  const level1Nodes = layoutLevel1(config);
  const clientPositions = new Map<string, [number, number, number]>();
  for (const node of level1Nodes) {
    clientPositions.set(node.entityId, node.position);
  }

  if (config.focusLevel === 1) return level1Nodes;

  // Level 2: projects orbit focused client
  const level2Nodes = layoutLevel2(config, clientPositions);
  const projectPositions = new Map<string, [number, number, number]>();
  for (const node of level2Nodes) {
    if (node.nodeType === "project") {
      projectPositions.set(node.entityId, node.position);
    }
  }

  if (config.focusLevel === 2) return level2Nodes;

  // Level 3: tasks/team/financial orbit focused project
  return layoutLevel3(config, clientPositions, projectPositions);
}
