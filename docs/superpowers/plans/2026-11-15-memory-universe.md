# Memory Universe (`cocnai`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile-first 3D "Vũ trụ ký ức" (`cocnai`) web application where 3D keepsakes float in zero-gravity with two-state touch physics (Overview flick/drag vs. 360° Inspect mode), accompanied by animated 3D Froakie (Cóc) and Deerling (Nai) companions and an automated local `.glb` optimization pipeline.

**Architecture:** A Vite + React + TypeScript single-page 3D web application powered by React Three Fiber (`@react-three/fiber`, `@react-three/drei`) and Wasm physics (`@react-three/rapier`). Pure math/state modules handle touch gesture disambiguation, soft spherical boundary forces, and companion paired steering, while a Node CLI script (`scripts/sync-models.mjs`) optimizes raw Trellis.2 `.glb` files into `public/models/keepsakes/` and updates `src/data/keepsakes.json`.

**Tech Stack:** Vite, React 18, TypeScript, Three.js, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`, `zustand`, `@gltf-transform/core`, `@gltf-transform/functions`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-11-15-memory-universe-design.md`

## Global Constraints

- Primary viewport is mobile touch screens (`touch-action: none`, adaptive DPR `[1, 1.75]`, no 2D text/story popups or cluttered HUD).
- Zero-gravity physics (`gravity={[0, 0, 0]}`) with `linearDamping: 0.5`, `angularDamping: 0.5`, and a soft spherical restoring boundary so keepsakes never drift off to infinity.
- Two strictly separated touch interaction modes:
  - **Overview Mode:** Tap (< 200ms, delta < 10px) on a keepsake enters 360° Inspect Mode; drag (> 10px) on a keepsake applies 3D physical impulse; drag on empty space orbits the camera.
  - **360° Inspect Mode:** Selected keepsake glides to the foreground center; 1-finger drag rotates 360° across all axes; 2-finger pinch zooms; tapping outside releases the keepsake back into floating space.
- Companion characters **Froakie (Cóc)** and **Deerling (Nai)** combine skeletal animation playback (`THREE.AnimationMixer` / `useAnimations`) with a procedural motion fallback (elastic breathing, banking into turns, hop/spin on tap) so they always move livelily and stay near each other.
- `npm run sync-models` processes raw `.glb` files from `models-raw/` into `public/models/keepsakes/` and generates `src/data/keepsakes.json` without manual code edits.

## Review Focus

1. **Zero-duration or NaN pointer flick delta (`dt === 0` or zero-length drag):** `computeFlickImpulse` must clamp `dt` to a minimum of `16ms` and cap maximum impulse magnitude so a fast mobile tap/swipe never launches a keepsake at infinite velocity or produces `NaN`.
2. **Tap vs. Drag ambiguity on high-DPI mobile screens:** Small finger jitter (`<= 10px` movement within `200ms`) must still classify as `'tap'` so users on phones can reliably open 360° Inspect Mode without accidentally dragging.
3. **Empty `models-raw/` directory on fresh clone:** `npm run sync-models` must gracefully generate 3 lightweight sample `.glb` keepsakes and companion `.glb` placeholders when `models-raw/` has no user files yet, so the app runs out-of-the-box.
4. **Unrigged or clip-missing companion `.glb` files:** When `froakie.glb` or `deerling.glb` has zero animation clips (`animations.length === 0`), `computeProceduralCompanionPose` must still produce continuous breathing, banking, and tap-jump offsets so the characters are never static statues.
5. **Selecting a second keepsake while already in 360° Inspect Mode:** Switching or tapping backdrop must cleanly restore the previously inspected keepsake to its floating physics body without locking both objects in inspect state.

---

### Task 1: Project Scaffolding, Core Types & Pure Physics/Steering Math

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/types/universe.ts`
- Create: `src/utils/physicsMath.ts`
- Test: `src/utils/__tests__/physicsMath.test.ts`

**Interfaces:**
- Produces:
  - `src/types/universe.ts`:
    - `export interface KeepsakeManifestItem { id: string; url: string; radius: number; initialPosition: [number, number, number]; }`
    - `export type CompanionId = 'froakie' | 'deerling'`
    - `export type GestureKind = 'tap' | 'drag'`
  - `src/utils/physicsMath.ts`:
    - `export function classifyPointerGesture(durationMs: number, distancePx: number): GestureKind`
    - `export function computeGravityWellImpulse(position: [number, number, number], safeRadius: number, pullStrength: number): [number, number, number]`
    - `export function computeFlickImpulse(deltaWorld: [number, number, number], durationMs: number, maxImpulse?: number): [number, number, number]`
    - `export function stepCompanionPair(froakiePos: [number, number, number], deerlingPos: [number, number, number], elapsedSec: number): { froakieTarget: [number, number, number]; deerlingTarget: [number, number, number] }`
    - `export function computeProceduralCompanionPose(elapsedSec: number, isExcited: boolean): { offsetY: number; scaleY: number; scaleXZ: number; spinY: number }`

- [ ] **Step 1: Initialize `package.json`, `tsconfig.json`, `vite.config.ts`, and `src/types/universe.ts`, and write the failing unit tests in `src/utils/__tests__/physicsMath.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import {
  classifyPointerGesture,
  computeFlickImpulse,
  computeGravityWellImpulse,
  computeProceduralCompanionPose,
  stepCompanionPair,
} from '../physicsMath';

describe('physicsMath', () => {
  it('classifies short low-jitter touches (<200ms, <=10px) as tap and larger/longer moves as drag', () => {
    expect(classifyPointerGesture(120, 6)).toBe('tap');
    expect(classifyPointerGesture(199, 10)).toBe('tap');
    expect(classifyPointerGesture(250, 4)).toBe('drag');
    expect(classifyPointerGesture(90, 14)).toBe('drag');
  });

  it('returns zero impulse inside safeRadius and inward centripetal impulse outside safeRadius', () => {
    expect(computeGravityWellImpulse([3, 0, 4], 6, 0.5)).toEqual([0, 0, 0]);
    const [ix, iy, iz] = computeGravityWellImpulse([10, 0, 0], 6, 0.5);
    expect(ix).toBeCloseTo(-2);
    expect(iy).toBeCloseTo(0);
    expect(iz).toBeCloseTo(0);
  });

  it('clamps dt=0 and caps maximum flick impulse without producing NaN', () => {
    const [ix, iy, iz] = computeFlickImpulse([100, -50, 25], 0, 8);
    const mag = Math.hypot(ix, iy, iz);
    expect(Number.isFinite(mag)).toBe(true);
    expect(mag).toBeLessThanOrEqual(8.0001);
  });

  it('keeps Froakie and Deerling targets bounded and close together over time', () => {
    const step = stepCompanionPair([-8, 2, 0], [8, -2, 0], 12.5);
    const dist = Math.hypot(
      step.froakieTarget[0] - step.deerlingTarget[0],
      step.froakieTarget[1] - step.deerlingTarget[1],
      step.froakieTarget[2] - step.deerlingTarget[2],
    );
    expect(dist).toBeLessThan(4.5);
  });

  it('produces higher jump offset and squash/stretch when companion is excited', () => {
    const calm = computeProceduralCompanionPose(0.25, false);
    const excited = computeProceduralCompanionPose(0.25, true);
    expect(Math.abs(excited.offsetY)).toBeGreaterThan(Math.abs(calm.offsetY));
    expect(excited.spinY).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Install dependencies and run test to verify it fails**

Run: `npm install && npx vitest run src/utils/__tests__/physicsMath.test.ts`
Expected: FAIL with module `../physicsMath` not found.

- [ ] **Step 3: Implement `src/utils/physicsMath.ts`**

Implement the 5 exported functions using volume-preserving squash-and-stretch (`scaleXZ = 1 / Math.sqrt(scaleY)`) for `computeProceduralCompanionPose` and smooth Lissajous/orbital paired targets in `stepCompanionPair` so Froakie and Deerling stay within `3.5` units of each other inside radius `5`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/physicsMath.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts src/types/universe.ts src/utils/physicsMath.ts src/utils/__tests__/physicsMath.test.ts
git commit -m "feat: scaffold project and add core physics & companion math"
```

---

### Task 2: Two-State Universe Interaction Store

**Files:**
- Create: `src/store/useUniverseStore.ts`
- Test: `src/store/__tests__/useUniverseStore.test.ts`

**Interfaces:**
- Consumes: `CompanionId` from `src/types/universe.ts`
- Produces:
  - `useUniverseStore`: Zustand hook with state `{ selectedKeepsakeId: string | null; excitedCompanion: CompanionId | null; selectKeepsake: (id: string) => void; clearSelection: () => void; triggerCompanion: (id: CompanionId) => void; }`

- [ ] **Step 1: Write the failing test in `src/store/__tests__/useUniverseStore.test.ts`**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { useUniverseStore } from '../useUniverseStore';

describe('useUniverseStore', () => {
  beforeEach(() => {
    useUniverseStore.getState().clearSelection();
  });

  it('transitions cleanly between overview, single keepsake selection, and switching keepsakes', () => {
    expect(useUniverseStore.getState().selectedKeepsakeId).toBeNull();
    useUniverseStore.getState().selectKeepsake('keepsake-1');
    expect(useUniverseStore.getState().selectedKeepsakeId).toBe('keepsake-1');
    useUniverseStore.getState().selectKeepsake('keepsake-2');
    expect(useUniverseStore.getState().selectedKeepsakeId).toBe('keepsake-2');
    useUniverseStore.getState().clearSelection();
    expect(useUniverseStore.getState().selectedKeepsakeId).toBeNull();
  });

  it('sets excitedCompanion when triggered', () => {
    useUniverseStore.getState().triggerCompanion('froakie');
    expect(useUniverseStore.getState().excitedCompanion).toBe('froakie');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/useUniverseStore.test.ts`
Expected: FAIL with `../useUniverseStore` not found.

- [ ] **Step 3: Implement `src/store/useUniverseStore.ts`**

Implement the Zustand store with a `1800ms` auto-reset timer on `triggerCompanion(id)` so the excited state returns to `null` after the celebration animation finishes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/useUniverseStore.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/store/useUniverseStore.ts src/store/__tests__/useUniverseStore.test.ts
git commit -m "feat: add two-state universe interaction store"
```

---

### Task 3: Local `.glb` Optimization Pipeline (`npm run sync-models`) & Starter 3D Assets

**Files:**
- Create: `scripts/sync-models.mjs`
- Create: `src/data/keepsakes.json`
- Test: `scripts/__tests__/sync-models.test.ts`

**Interfaces:**
- Consumes: `KeepsakeManifestItem` shape from `src/types/universe.ts`
- Produces:
  - `export async function syncKeepsakeModels(options: { rawDir: string; outDir: string; companionsDir: string; manifestPath: string }): Promise<KeepsakeManifestItem[]>` in `scripts/sync-models.mjs`
  - Generated `.glb` files in `public/models/keepsakes/` and `public/models/companions/{froakie,deerling}.glb`
  - Generated `src/data/keepsakes.json`

- [ ] **Step 1: Write the failing test in `scripts/__tests__/sync-models.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncKeepsakeModels } from '../sync-models.mjs';

describe('syncKeepsakeModels', () => {
  it('generates fallback sample keepsakes, companion glbs, and manifest when rawDir is empty', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cocnai-sync-'));
    const rawDir = path.join(tmp, 'models-raw');
    const outDir = path.join(tmp, 'public/models/keepsakes');
    const companionsDir = path.join(tmp, 'public/models/companions');
    const manifestPath = path.join(tmp, 'src/data/keepsakes.json');

    const manifest = await syncKeepsakeModels({ rawDir, outDir, companionsDir, manifestPath });
    expect(manifest.length).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(companionsDir, 'froakie.glb'))).toBe(true);
    expect(fs.existsSync(path.join(companionsDir, 'deerling.glb'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/sync-models.test.ts`
Expected: FAIL with `../sync-models.mjs` not found.

- [ ] **Step 3: Implement `scripts/sync-models.mjs` and run `npm run sync-models`**

Use `@gltf-transform/core` (`NodeIO`) and `@gltf-transform/functions` (`center`, `prune`, `dedup`, `weld`) to process any `.glb` in `models-raw/` into `public/models/keepsakes/`, distribute `initialPosition` on a Fibonacci sphere around the origin, and generate stylized multi-mesh `.glb` starter models when `models-raw/` or `public/models/companions/` are empty.

- [ ] **Step 4: Run test and CLI to verify it passes**

Run: `npx vitest run scripts/__tests__/sync-models.test.ts && npm run sync-models`
Expected: PASS and `src/data/keepsakes.json` populated.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-models.mjs scripts/__tests__/sync-models.test.ts src/data/keepsakes.json public/models
git commit -m "feat: add glb optimization script and starter 3D assets"
```

---

### Task 4: Cosmic Environment, Zero-Gravity Keepsakes & 360° Focus Inspector

**Files:**
- Create: `src/components/CosmicEnvironment.tsx`
- Create: `src/components/KeepsakeItem.tsx`
- Create: `src/components/KeepsakeInspector.tsx`

**Interfaces:**
- Consumes: `KeepsakeManifestItem` (`src/types/universe.ts`), `useUniverseStore` (`src/store/useUniverseStore.ts`), `classifyPointerGesture`, `computeGravityWellImpulse`, `computeFlickImpulse` (`src/utils/physicsMath.ts`).
- Produces:
  - `export function CosmicEnvironment(): JSX.Element`
  - `export function KeepsakeItem({ item }: { item: KeepsakeManifestItem }): JSX.Element`
  - `export function KeepsakeInspector({ items }: { items: KeepsakeManifestItem[] }): JSX.Element | null`

- [ ] **Step 1: Implement `src/components/CosmicEnvironment.tsx`**

Render deep space color/fog, two layers of `<Stars>` and `<Sparkles>` from `@react-three/drei`, plus warm-cool multi-directional lights (`ambientLight`, 3 `directionalLight` rim lights, `Environment` preset) so Trellis.2 models have crisp illumination from all 360° angles.

- [ ] **Step 2: Implement `src/components/KeepsakeItem.tsx`**

Wrap each `.glb` model in a Rapier `<RigidBody gravityScale={0} linearDamping={0.5} angularDamping={0.5} colliders="hull">`. In `useFrame`, apply `computeGravityWellImpulse`. On pointer down/move/up, use `classifyPointerGesture`: a `'tap'` calls `selectKeepsake(item.id)`; a `'drag'` moves the body kinematically and applies `computeFlickImpulse` + torque on release. Hide the floating instance while `selectedKeepsakeId === item.id`.

- [ ] **Step 3: Implement `src/components/KeepsakeInspector.tsx`**

When `selectedKeepsakeId` is non-null, render an invisible backdrop plane (tapping it calls `clearSelection()`) and smoothly damp the selected `.glb` model to `[0, 0, 3.2]` in front of the camera with full 360° pointer drag rotation and pinch/wheel zoom scaling (`0.6x` to `2.4x`).

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: Exit code 0 with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/CosmicEnvironment.tsx src/components/KeepsakeItem.tsx src/components/KeepsakeInspector.tsx
git commit -m "feat: add cosmic environment, zero-g keepsakes, and 360 inspector"
```

---

### Task 5: Companion Characters (Froakie & Deerling) & Full Universe Assembly

**Files:**
- Create: `src/components/CompanionPair.tsx`
- Create: `src/App.tsx`
- Create: `src/main.tsx`
- Create: `index.html`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `stepCompanionPair`, `computeProceduralCompanionPose` (`src/utils/physicsMath.ts`), `useUniverseStore` (`src/store/useUniverseStore.ts`), `CosmicEnvironment`, `KeepsakeItem`, `KeepsakeInspector`, `src/data/keepsakes.json`.
- Produces: Complete runnable application at `src/App.tsx` and production build in `dist/`.

- [ ] **Step 1: Implement `src/components/CompanionPair.tsx`**

Load `/models/companions/froakie.glb` and `/models/companions/deerling.glb` with `useGLTF` and `useAnimations`. Play idle/move/jump clips when present, and always layer `computeProceduralCompanionPose` + smooth banking along the velocity vector from `stepCompanionPair`. Render subtle cyan water-bubble sparkles around Froakie and warm pink/gold starlight sparkles around Deerling; intensify bursts when `triggerCompanion` is called on tap.

- [ ] **Step 2: Implement `src/App.tsx`, `src/main.tsx`, `index.html`, and `vercel.json`**

Assemble `<Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, 9], fov: 50 }}>` with `<Physics gravity={[0, 0, 0]}>`, `<OrbitControls enabled={selectedKeepsakeId === null} enablePan={false} minDistance={4} maxDistance={16} />`, `<CosmicEnvironment />`, `<CompanionPair />`, all `<KeepsakeItem />` components, and `<KeepsakeInspector />`. Enforce `touch-action: none; user-select: none; overflow: hidden;` in CSS for mobile browsers.

- [ ] **Step 3: Run full test suite and production build verification**

Run: `npx vitest run && npm run build`
Expected: All tests PASS and Vite production bundle builds cleanly into `dist/`.

- [ ] **Step 4: Commit**

```bash
git add src/components/CompanionPair.tsx src/App.tsx src/main.tsx index.html vercel.json
git commit -m "feat: add Froakie & Deerling companions and assemble universe canvas"
```
