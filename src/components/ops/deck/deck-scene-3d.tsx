"use client";

/**
 * `DeckScene3D` — the massing.
 *
 * 3D answers one question the plan cannot: *how does this thing sit on the
 * ground?* How high, how many posts, where the stairs land. So the scene is
 * deliberately plain — grey boards, grey framing, one soft key light, a ground
 * plane — and every dimension comes from `scene-plan.ts`, which is tested. No
 * textures, no sky, no shadows-as-drama: this is a massing model shown to a
 * business owner, not a render sold to a homeowner.
 *
 * The component itself is thin on purpose. Everything worth being wrong about
 * (elevations, post count, stair run) is decided and unit-tested in the plan;
 * what is left here is turning boxes and shapes into meshes.
 *
 * Loaded only through `deck-scene-3d-slot.tsx`, so the plan view never pays
 * for Three.js.
 */

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import {
  buildScenePlan,
  type SceneBeam,
  type SceneLevel,
  type ScenePoint,
  type SceneDeckSlab,
} from "@/lib/deck/scene-plan";
import type { DeckDrawing, DeckLevelColor } from "@/lib/deck/drawing-data";

/**
 * Monochrome, with the level's own colour washed in at low alpha when a design
 * has more than one level — the same rule the 2D plan follows, so a level looks
 * like itself in both views. The hexes are the design system's steel accent and
 * earth tones; there is no fourth colour to invent.
 */
const LEVEL_TINT: Record<DeckLevelColor, string> = {
  blue: "#6F94B0",
  green: "#9DB582",
  amber: "#C4A868",
};
const BOARD_GREY = "#8A8A8A";
const FRAME_GREY = "#6A6A6A";
const GROUND_GREY = "#121214";

function slabShape(slab: SceneDeckSlab): THREE.Shape {
  const shape = new THREE.Shape();
  slab.outer.forEach((point, index) => {
    if (index === 0) shape.moveTo(point[0], point[1]);
    else shape.lineTo(point[0], point[1]);
  });
  shape.closePath();
  for (const hole of slab.holes) {
    const path = new THREE.Path();
    hole.forEach((point, index) => {
      if (index === 0) path.moveTo(point[0], point[1]);
      else path.lineTo(point[0], point[1]);
    });
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

/** A box laid along a segment: rim joists, wall panels and stair treads. */
function Bar({
  from,
  to,
  top,
  depth,
  thickness,
  color,
  opacity = 1,
}: {
  from: ScenePoint;
  to: ScenePoint;
  top: number;
  depth: number;
  thickness: number;
  color: string;
  opacity?: number;
}) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(length > 0)) return null;
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return (
    <mesh
      position={[
        (from[0] + to[0]) / 2,
        top - depth / 2,
        (from[1] + to[1]) / 2,
      ]}
      rotation={[0, -angle, 0]}
    >
      <boxGeometry args={[length, depth, thickness]} />
      <meshLambertMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

function LevelMeshes({ level, tint }: { level: SceneLevel; tint: string | null }) {
  return (
    <group>
      {level.decks.map((slab) => (
        <mesh
          key={slab.id}
          // Extrude runs along +z, so the slab is laid flat and dropped to its
          // own underside — the plan's `top` is the walking surface.
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, slab.top, 0]}
        >
          <extrudeGeometry
            args={[slabShape(slab), { depth: slab.thickness, bevelEnabled: false }]}
          />
          <meshLambertMaterial color={tint ?? BOARD_GREY} />
        </mesh>
      ))}

      {level.rimBeams.map((beam: SceneBeam) => (
        <Bar
          key={beam.id}
          from={beam.from}
          to={beam.to}
          top={beam.top}
          depth={beam.depth}
          thickness={0.125}
          color={FRAME_GREY}
        />
      ))}

      {level.walls.map((wall) => (
        <Bar
          key={wall.id}
          from={wall.from}
          to={wall.to}
          top={wall.base + wall.height}
          depth={wall.height}
          thickness={0.5}
          color={FRAME_GREY}
          opacity={0.35}
        />
      ))}

      {level.posts.map((post) => (
        <mesh key={post.id} position={[post.at[0], post.height / 2, post.at[1]]}>
          <boxGeometry args={[post.size, post.height, post.size]} />
          <meshLambertMaterial color={FRAME_GREY} />
        </mesh>
      ))}

      {level.stairs.flatMap((stair) =>
        stair.treads.map((tread, index) => (
          <Bar
            key={`${stair.id}:${index}`}
            from={tread.from}
            to={tread.to}
            top={tread.top}
            depth={0.125}
            thickness={10 / 12}
            color={BOARD_GREY}
          />
        )),
      )}
    </group>
  );
}

export function DeckScene3D({
  drawing,
  isolatedLevelId,
}: {
  drawing: DeckDrawing;
  isolatedLevelId: string | null;
}) {
  const plan = useMemo(
    () => buildScenePlan(drawing, isolatedLevelId),
    [drawing, isolatedLevelId],
  );

  const [cx, cy, cz] = plan.focus.center;
  const reach = plan.focus.radius * 2.6;

  return (
    <Canvas
      data-testid="deck-scene-3d"
      dpr={[1, 2]}
      camera={{
        // Three-quarter view from above: the angle a person walks up to a deck
        // from, which is how it is recognised.
        position: [cx + reach * 0.8, cy + reach * 0.7, cz + reach * 0.8],
        fov: 40,
        near: 0.1,
        far: reach * 20,
      }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[reach, reach * 1.5, reach * 0.5]} intensity={1.6} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]}>
        <planeGeometry args={[reach * 8, reach * 8]} />
        <meshBasicMaterial color={GROUND_GREY} />
      </mesh>

      {plan.levels.map((level) => (
        <LevelMeshes
          key={level.id}
          level={level}
          tint={
            drawing.isMultiLevel && level.colorKey
              ? LEVEL_TINT[level.colorKey]
              : null
          }
        />
      ))}

      {/* Damping off per DESIGN.md: no inertia, no bounce — it stops where the
          hand stops, the same contract the 2D pan has. */}
      <OrbitControls
        target={[cx, cy, cz]}
        enableDamping={false}
        enablePan
        maxPolarAngle={Math.PI / 2.05}
      />
    </Canvas>
  );
}
