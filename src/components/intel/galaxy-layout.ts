// ---------------------------------------------------------------------------
// Galaxy Layout Calculator — pure TypeScript, no React
// Determines the 3D position of every entity in the Intel Galaxy scene.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PositionedEntity {
  entityId: string;
  position: [number, number, number]; // x, y, z in Three.js world units
  cluster: string;
  confidence: number;
}

export interface LayoutConfig {
  entities: Array<{
    id: string;
    cluster: string;
    type: string;
    confidence: number;
    properties?: Record<string, unknown>;
  }>;
  /** Seed is reserved for future deterministic seeding. Currently unused because
   *  all randomness is derived from entity ID hashes (already deterministic). */
  seed?: number;
}

// ---------------------------------------------------------------------------
// Cluster color palette — exported so other components share the same tokens
// ---------------------------------------------------------------------------

export const CLUSTER_COLORS: Record<string, string> = {
  voice: '#597794',     // Accent — "you" channel, near center
  internal: '#8E8E93',  // System gray — team / employees
  client: '#8195B5',    // Steel blue — client records
  project: '#B58289',   // Muted rose — active projects
  vendor: '#C4A868',    // Amber gold — vendor contacts
  subtrade: '#9DB582',  // Muted green — subtrade contacts
  financial: '#BCBCBC', // Neutral gray — invoices / estimates (orbit parents)
};

// ---------------------------------------------------------------------------
// Cluster orbital geometry
// ---------------------------------------------------------------------------

// Each cluster gets a fixed sector angle (degrees from positive X axis, CCW).
// Distributing 7 clusters evenly around 360° gives ~51.4° spacing.
// Specific assignments are chosen so the most-used clusters (client, project)
// appear in the upper hemisphere (left/right of center) for easy reading.
const CLUSTER_SECTOR_DEG: Record<string, number> = {
  voice: 0,        // Top-center — "you", closest to origin
  internal: 51,    // Upper right
  client: 103,     // Right
  project: 154,    // Lower right
  vendor: 206,     // Lower left
  subtrade: 257,   // Left
  financial: 309,  // Upper left (special: overridden per-entity to orbit parent)
};

// Base orbital radii (Three.js world units from the scene origin).
// voice is closest ("you"), financial is overridden below.
const CLUSTER_BASE_RADIUS: Record<string, number> = {
  voice: 3,
  internal: 5,
  client: 8,
  project: 8,    // Same ring as clients, different sector (154°)
  vendor: 11,
  subtrade: 11,  // Same ring as vendors, different sector (257°)
  financial: 8,  // Placeholder — overridden by parent project orbit logic
};

// ---------------------------------------------------------------------------
// Deterministic hash — maps any string → a 32-bit signed integer.
// Using the djb2 variant: stable, cheap, no external deps.
// ---------------------------------------------------------------------------

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    // (hash << 5) - hash  ≡  hash * 31, the djb2 multiplier
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Coerce to 32-bit integer (avoids float drift)
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Adaptive density scale
// Keeps the galaxy filling a consistent visual volume regardless of entity count.
// ---------------------------------------------------------------------------

function densityScale(totalCount: number): number {
  if (totalCount < 50) return 1.4;  // Sparse data → wider orbits, more breathing room
  if (totalCount > 300) return 0.8; // Dense data → tighter orbits, prevents overcrowding
  return 1.0;
}

// ---------------------------------------------------------------------------
// Z-depth offset — gives the galaxy 3D depth on a flat initial view.
// Formula: z = sin(hash * φ) * maxDepth
// φ = 2.399 rad ≈ 137.5° (the golden angle in radians) — distributes z values
// uniformly across [-1, 1] for any set of entity IDs, avoiding clustering at 0.
// ---------------------------------------------------------------------------
const GOLDEN_ANGLE_RAD = 2.399; // radians — the golden angle

function zDepthForEntity(entityId: string): number {
  const h = hashString(entityId);
  // Normalize hash to [0, 2π] using abs, then apply golden angle phase
  // so adjacent IDs get maximally spread z values (sunflower-style)
  return Math.sin(h * GOLDEN_ANGLE_RAD) * 1.0;
}

// ---------------------------------------------------------------------------
// Spiral layout within a cluster sector
// Uses the golden angle (≈137.508°) between successive entities so that each
// new node falls in the largest available gap — the same geometry sunflowers use.
// This produces organic, non-repeating spacing with no parameter tuning.
// ---------------------------------------------------------------------------
const GOLDEN_ANGLE_DEG = 137.508; // degrees — sunflower phyllotaxis angle

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeGalaxyLayout(config: LayoutConfig): PositionedEntity[] {
  const { entities } = config;

  if (entities.length === 0) return [];

  const scale = densityScale(entities.length);

  // ── Step 1: Group entities by cluster ────────────────────────────────────
  const byCluster = new Map<string, typeof entities>();
  for (const entity of entities) {
    const group = byCluster.get(entity.cluster) ?? [];
    group.push(entity);
    byCluster.set(entity.cluster, group);
  }

  // ── Step 2: Compute positions for all non-financial clusters first ────────
  // Financial entities need parent project positions to orbit around, so they
  // must be resolved in a second pass.
  const result: PositionedEntity[] = [];
  const positionById = new Map<string, [number, number, number]>();

  for (const [cluster, members] of byCluster.entries()) {
    if (cluster === 'financial') continue; // Deferred — needs parent positions

    const sectorDeg = CLUSTER_SECTOR_DEG[cluster] ?? 0;
    const sectorRad = (sectorDeg * Math.PI) / 180;
    const baseRadius = (CLUSTER_BASE_RADIUS[cluster] ?? 8) * scale;

    // Sort: 'company' type entities closer to cluster center, 'person' further out.
    // Within each tier, order by confidence descending (most confident nodes
    // cluster tighter to the center — they're the anchor nodes).
    const sorted = [...members].sort((a, b) => {
      const tierA = a.type === 'company' ? 0 : 1;
      const tierB = b.type === 'company' ? 0 : 1;
      if (tierA !== tierB) return tierA - tierB;
      return b.confidence - a.confidence;
    });

    for (let idx = 0; idx < sorted.length; idx++) {
      const entity = sorted[idx];

      // Spread radius for this entity within its cluster.
      // Index 0 (the anchor company node) sits right at cluster center.
      // Each subsequent node spirals outward, capped at 2.5 to keep clusters tight.
      const spreadRadius = Math.min(0.3 + idx * 0.15, 2.5);

      // Golden-angle spiral: rotate by 137.508° per entity.
      // This is the same geometry as seeds in a sunflower — provably optimal
      // for uniform gap distribution with arbitrary N, no bunching or lines.
      const spiralAngleRad = (idx * GOLDEN_ANGLE_DEG * Math.PI) / 180;

      // Cluster center in polar → Cartesian, then add spiral offset.
      // The cluster center is at (baseRadius, sectorRad) in polar coords.
      const clusterCenterX = baseRadius * Math.cos(sectorRad);
      const clusterCenterY = baseRadius * Math.sin(sectorRad);

      // Spread offset around the cluster center using the spiral angle.
      const offsetX = spreadRadius * Math.cos(spiralAngleRad + sectorRad);
      const offsetY = spreadRadius * Math.sin(spiralAngleRad + sectorRad);

      const x = clusterCenterX + offsetX;
      const y = clusterCenterY + offsetY;
      const z = zDepthForEntity(entity.id);

      const pos: [number, number, number] = [x, y, z];
      positionById.set(entity.id, pos);
      result.push({ entityId: entity.id, position: pos, cluster, confidence: entity.confidence });
    }
  }

  // ── Step 3: Financial entities — orbit parent project ─────────────────────
  // Invoices and estimates are children of projects. They orbit their parent
  // at a small radius (0.8–1.2 units), evenly spaced in a ring around it.
  // If no parent is found, fall back to the financial cluster's nominal position.
  const financialMembers = byCluster.get('financial') ?? [];

  if (financialMembers.length > 0) {
    // Group financial entities by parent project ID.
    // Convention: properties.projectId holds the parent project entity ID.
    const byParent = new Map<string, typeof financialMembers>();
    const orphans: typeof financialMembers = [];

    for (const entity of financialMembers) {
      const parentId = entity.properties?.projectId as string | undefined;
      if (parentId && positionById.has(parentId)) {
        const group = byParent.get(parentId) ?? [];
        group.push(entity);
        byParent.set(parentId, group);
      } else {
        orphans.push(entity);
      }
    }

    // Orbit children around their parent
    for (const [parentId, children] of byParent.entries()) {
      const parentPos = positionById.get(parentId)!;

      for (let idx = 0; idx < children.length; idx++) {
        const entity = children[idx];

        // Orbit radius varies between 0.8 and 1.2 based on entity hash —
        // prevents all financials stacking at the exact same radius.
        const hashVal = Math.abs(hashString(entity.id));
        const orbitRadius = 0.8 + (hashVal % 100) / 250; // maps to [0.8, 1.2)

        // Distribute evenly around the parent: divide full circle by child count.
        // Add a hash-based phase offset so financials from different projects
        // don't all start at angle 0.
        const phaseOffset = (Math.abs(hashString(parentId)) % 628) / 100; // [0, 2π)
        const orbitAngle = phaseOffset + (idx / children.length) * 2 * Math.PI;

        const x = parentPos[0] + orbitRadius * Math.cos(orbitAngle);
        const y = parentPos[1] + orbitRadius * Math.sin(orbitAngle);
        const z = parentPos[2] + zDepthForEntity(entity.id) * 0.3; // tight z range near parent

        const pos: [number, number, number] = [x, y, z];
        positionById.set(entity.id, pos);
        result.push({ entityId: entity.id, position: pos, cluster: 'financial', confidence: entity.confidence });
      }
    }

    // Orphaned financial entities (no parent found) — place them in the financial
    // sector at the nominal radius, using the same spiral logic as other clusters.
    if (orphans.length > 0) {
      const sectorDeg = CLUSTER_SECTOR_DEG['financial'] ?? 309;
      const sectorRad = (sectorDeg * Math.PI) / 180;
      const baseRadius = (CLUSTER_BASE_RADIUS['financial'] ?? 8) * scale;

      for (let idx = 0; idx < orphans.length; idx++) {
        const entity = orphans[idx];
        const spreadRadius = Math.min(0.3 + idx * 0.15, 2.5);
        const spiralAngleRad = (idx * GOLDEN_ANGLE_DEG * Math.PI) / 180;

        const x = baseRadius * Math.cos(sectorRad) + spreadRadius * Math.cos(spiralAngleRad + sectorRad);
        const y = baseRadius * Math.sin(sectorRad) + spreadRadius * Math.sin(spiralAngleRad + sectorRad);
        const z = zDepthForEntity(entity.id);

        const pos: [number, number, number] = [x, y, z];
        positionById.set(entity.id, pos);
        result.push({ entityId: entity.id, position: pos, cluster: 'financial', confidence: entity.confidence });
      }
    }
  }

  return result;
}
