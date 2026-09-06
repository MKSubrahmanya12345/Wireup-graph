# Velxio — 2D Simulation Architecture & Interface Reference

> **Scope.** This is a deep, code-level map of how the *2D* (canvas) simulation works in
> `external/velxio` (pinned commit `2642ed7`), vendored as a submodule in
> `Wireup-graph`. All three-dimensional/three.js rendering is deliberately **ignored**
> (the `frontend/src/three/` tree and the `viewMode === '3d'` branch are out of scope).
>
> **Purpose.** Another agent should be able to read this and (a) understand the exact
> data model, layering and call flow, and (b) reuse the **public interfaces** (the
> `.vlx` format, the Zustand store shape, the postMessage embed bridge, the part-sim
> registry contract, the wire/component/pin types) for a separate task — without
> reverse-engineering anything.
>
> **Nothing here is run.** This is pure static analysis of the source tree.

---

## 0. TL;DR — the layering in one picture

Velxio's "simulator" is **not one thing**. It is a stack of four cooperating layers.
Understanding which layer owns what is the single most useful fact for reuse.

```
 ┌────────────────────────────────────────────────────────────────────────────┐
 │  L4 · PRESENTATION (2D canvas)   frontend/src/components/simulator/        │
 │      SimulatorCanvas, WireLayer, PinOverlay, DynamicComponent,             │
 │      BoardOnCanvas, ElectricalOverlay, SerialMonitor, Oscilloscope          │
 │      → React DOM (HTML + <svg>) + Web Components (@wokwi/elements,          │
 │        velxio-* custom elements)                                             │
 ├────────────────────────────────────────────────────────────────────────────┤
 │  L3 · STATE  (Zustand stores)   frontend/src/store/                         │
 │      useSimulatorStore   ← boards, components, wires, undo/redo, engine     │
 │      useEditorStore      ← file groups (source files per board)             │
 │      useElectricalStore  ← SPICE/analog solve state                         │
 │      useProjectStore     ← project metadata (name for .vlx download)        │
 │      useOscilloscopeStore, useVfsStore, serialBatcher                        │
 ├────────────────────────────────────────────────────────────────────────────┤
 │  L2 · RUNTIME ENGINES (the "sim" itself)   frontend/src/simulation/         │
 │      AVRSimulator        (avr8js, in-browser)  Uno/Nano/Mega/ATtiny85       │
 │      RP2040Simulator     (rp2040js, in-browser) Pico / Pico W               │
 │      RiscVSimulator      (in-browser)                                       │
 │      Esp32C3Simulator    (in-browser RISC-V)                                │
 │      Esp32Bridge / Stm32Bridge / RaspberryPi3Bridge  → backend QEMU, WS     │
 │      + PinManager, I2CBusManager, SignalRouter, PartSimulationRegistry      │
 ├────────────────────────────────────────────────────────────────────────────┤
 │  L1 · COMPILE + MATH   backend/ (FastAPI) + frontend/src/simulation/spice/  │
 │      arduino-cli compile → .hex/.bin                                         │
 │      QEMU (esp32/esp32-s3/esp32-c3/stm32/RaspberryPi) workers               │
 │      SPICE/ngspice-MNA analog resolver (voltages, currents, shorts)         │
 └────────────────────────────────────────────────────────────────────────────┘
```

**The 2D "flow" in one sentence:** the user draws a **component** (from the catalog) and a
**board**, connects them by drawing **wires** between **pins**; everything lives in
`useSimulatorStore`; when you press **Run** a *runtime engine* executes the compiled
firmware and pushes pin/state changes back into the store, which re-renders the Web
Components / DOM; a **SPICE pass** can also solve the analog voltages on those wires.

The single most important **interface** for reuse is the `.vlx` project file (a JSON
snapshot of `{boards, fileGroups, components, wires, activeBoardId}`) plus the
`window.postMessage` **embed bridge** (load/export a project from a parent iframe), and
the Zustand `SimulatorState` shape it round-trips through.

---

## 1. Entry point & route wiring

**Files:** `frontend/src/main.tsx` · `frontend/src/App.tsx` · `frontend/src/pages/EditorPage.tsx`

- `main.tsx` is the real entry. After the i18n side-effect and a batch of side-effect
  imports that **register custom Web Components** (`*Elements.ts`), it imports `App`.
  It also **calls `initEmbedBridge()`** (the parent-iframe bridge) and configures
  Monaco's local asset path.
- `App.tsx` sets up React Router. The main editor page (the one with the 2D canvas) is
  `EditorPage`.
- `EditorPage.tsx` composes the three quadrants:
  - Left: `CodeEditor` (Monaco) + `FileExplorer` + `EditorToolbar`
  - Right/bottom: the **`SimulatorCanvas`** and the **`SerialMonitor`** / **`Oscilloscope`**
  - `SimulatorCanvas` is the 2D drawing surface. It accepts an optional `headerSlot` prop
    (a DOM ref it portals its toolbar into).

Routing note: `SimPage.tsx` is Wireup's *own* page 04 (`/sim`) — it embeds Velxio in an
iframe and is **not** part of Velxio's internal routing. It is covered in §8.

---

## 2. The stores (the client-side "database" of the 2D scene)

All state lives in Zustand stores under `frontend/src/store/`. The canvas is a pure
projection of `useSimulatorStore`; there is essentially **no component-local state for the
scene** (only transient per-gesture refs).

### 2.1 `useSimulatorStore` — the core (≈3,900 lines)

This is the **primary interface** another task will use. Two structs are central:

**Component** (defined inline in the store, `~line 1025`):
```ts
interface Component {
  id: string;                 // unique in canvas, e.g. `led_1717...`
  metadataId: string;         // registry key, e.g. 'led', 'wokwi-...' stripped
  x: number;                  // canvas position (world px, unrotated top-left of inner el)
  y: number;
  properties: Record<string, unknown>;  // e.g. { color:'#ff0000', value:220, rotation:90 }
}
```

**The store's public surface** (`SimulatorState`) includes (grouped):

- `boards: BoardInstance[]`, `activeBoardId: string | null`
  - `addBoard`, `removeBoard`, `updateBoard`, `setBoardPosition`, `setActiveBoardId`,
    `startBoard`, `stopBoard`, `resetBoard`, `rebuildEsp32Bridge`,
    `compileBoardProgram`, `loadMicroPythonProgram`, `setBoardLanguageMode`
  - `loadProjectState(payload)` — the single entry point used by `.vlx` import.
- `components: Component[]`, `wires: Wire[]`, `selectedWireId`, `wireInProgress`
  - `addComponent`, `removeComponent`, `updateComponent`, `updateComponentState`,
    `handleComponentEvent`, `setComponents`, `reseedComponentOnBreadboard`
  - `addWire`, `removeWire`, `updateWire`, `setWires`, `setSelectedWire`
  - `startWireCreation(endpoint,color)`, `updateWireInProgress(x,y)`, `addWireWaypoint`,
    `setWireInProgressColor`, `finishWireCreation(endpoint)`, `cancelWireCreation`
  - `updateWirePositions(componentId)`, `recalculateAllWirePositions()`
- **Undo/redo**: `history`, `historyIndex`, `pushCommand`, `undo`, `redo`,
  `recordAddComponent`, `recordRemoveComponent`, `recordMove`, `recordRotate`,
  `recordSetProperty`, `recordAddWire`, `recordRemoveWire` (`CanvasCommand` = `{description,
  execute(), undo()}`; cap 50).
- **Legacy single-board API** (`@deprecated`): `boardType`, `boardPosition`, `simulator`,
  `pinManager`, `running`, `compiledHex`, `initSimulator`, `loadHex`, `loadBinary`,
  `startSimulation`/`stopSimulation`, `setRunning`, `connectRemoteSimulator`.
  **Do not use in new code — read `boards[]` and `getBoardSimulator(activeBoardId)` instead.**
- Runtime/UX: `burntComponents`, `serialOutput`, `serialBaudRate`, `serialMonitorOpen`,
  `esp32CrashBoardId`, `zOrders`/`zTop`/`raiseItem` (drag-to-front stacking), `hydrationSeq`.

**Selectors (exported functions):**
- `getBoardSimulator(id)` → the L2 runtime engine for a board (or `undefined`).
- `getBoardBridge(id)` → the WebSocket bridge (ESP32/STM32/Pi).
- `getBoardPinManager(id)` → the `PinManager` for a board.
- `getEsp32Bridge(id)`, `getStm32Bridge(id)`.

To read the current scene data at any time (e.g. from another agent/tool):
```ts
useSimulatorStore.getState().boards
useSimulatorStore.getState().components
useSimulatorStore.getState().wires
```

### 2.2 `useEditorStore` — the source files

Multi-file workspaces. This is what actually **compiles**. Key shape:
```ts
interface WorkspaceFile { id: string; name: string; content: string; modified: boolean }
interface EditorState {
  files: WorkspaceFile[];
  activeFileId: string;
  openFileIds: string[];
  fileGroups: Record<string, WorkspaceFile[]>;   // ← per-board groups
  folderGroups?: Record<string, string[]>;
  createFile/deleteFile/renameFile/setFileContent/markFileSaved/
  openFile/closeFile/setActiveFile/loadFiles/setCode(legacy);
  chipFileGroupId(id: string): string;
}
```
`fileGroups` keys are the `activeFileGroupId` on each board. A board compiles **exactly**
its group's files. The sketch must be first in the group.

### 2.3 `useElectricalStore` — SPICE/analog overlay state

Holds the analog solve results (node voltages, currents, short-circuit warnings), `paused`,
the resolver registry. It drives `ElectricalOverlay` and the SPICE `runNetlist`/`maybeSolve`
lifecycle.

### 2.4 Other stores
`useProjectStore` (current project name/slug — used to pick the `.vlx` download filename),
`useOscilloscopeStore`, `useVfsStore` (Pi virtual filesystem), `serialBatcher`.

---

## 3. Component catalog & metadata registry

**Files:** `frontend/public/components-metadata.json` (committed, generated)
`frontend/src/services/ComponentRegistry.ts` · `frontend/src/types/component-metadata.ts`
`frontend/src/types/components.ts` · `scripts/generate-component-metadata.ts`
`scripts/component-overrides.json`

There are **156 components** in the pinned catalog. The registry is a singleton:

**`ComponentMetadata`** shape:
```ts
interface ComponentMetadata {
  id: string;            // registry key, e.g. 'led', 'arduino-uno', 'bmp280'
  tagName: string;       // e.g. 'wokwi-led', 'wokwi-arduino-uno', 'velxio-*'
  name: string;          // display
  category: ComponentCategory;   // 'boards'|'sensors'|'displays'|'input'|'output'|
                                 // 'motors'|'communication'|'connectivity'|'passive'|
                                 // 'logic'|'analog'|'electromech'|'other'
  description?: string;
  thumbnail: string;     // inline SVG
  properties: PropertyDescriptor[];  // {name,type,defaultValue,control,...}
  defaultValues: Record<string, any>;
  pinCount: number;
  tags: string[];
  pro_only?: boolean;    // hosted-only (velxio.dev), OSS never sets
  featured?: boolean;
  sdSlot?: boolean;
  custom?: boolean;
}
```

**`ComponentRegistry`** API:
- `getInstance()` → singleton
- `load()` / `isLoaded` / `loadPromise`
- `getById(id)` → `ComponentMetadata | undefined` (with a `wokwi-`/`velxio-` prefix strip fallback)
- `getAllComponents()`, `getByCategory(cat)`, `getCategories()`
- `search(query)` → matches name/id/description/tags
- `mergeComponents(extras)` / `removeComponents(ids)` — **overlay seam** for hosting premium parts
- `getComponentCount()`, `getCategoryDisplayName(cat)`
- `subscribe(cb)` / `getVersion()` — for `useSyncExternalStore`

**Loading:** it `fetch('/components-metadata.json')` (cache no-store) at module import.
The file is **generated** (never hand-edited). Velxio-native parts
(custom chips, ePaper, logic gates, voltmeters) are injected via
`scripts/component-overrides.json` under `_customComponents`; the generator copies them
verbatim. Some current-catalog entries (Raspberry Pi 0/1/2 + the 6 Pi header boards, the
SPICE probe instruments `instr-voltmeter`/`instr-ammeter`, and `custom-chip`) are injected
in code in `ComponentRegistry._doLoad()`.

### 3.1 What a "component" means physically
- Most components are **Wokwi Web Components** from `@wokwi/elements`
  (`<wokwi-led>`, `<wokwi-arduino-uno>`, `<wokwi-lcd1602>`, …).
- Velxio adds its own native elements under `frontend/src/velxio-elements/` and
  `frontend/src/components/velxio-components/*Element.ts`.
- Every wire-able component **must** be a real DOM custom element exposing a `pinInfo`
  getter (see §5) — not a plain React SVG.

---

## 4. The 2D canvas (`SimulatorCanvas`)

**File:** `frontend/src/components/simulator/SimulatorCanvas.tsx` (≈4,100 lines)
**Styles:** `components/simulator/SimulatorCanvas.css`, `App.css`, `index.css`

It is a **DOM tree** (HTML + an SVG overlay for wires). Pan + zoom live as a
`transform: translate(pan) scale(zoom)` on the inner `.canvas-world` div. It is a
"world" (infinite) because the world div is transformed, and children are absolutely
positioned at world coordinates; world ⇄ screen conversion is `(clientX - pan)/zoom`.

### 4.1 DOM structure (z-order bottom → top)

```
.simulator-canvas                       (the panel)
 └ .canvas-world                        ← pan/zoom transform; hidden when viewMode='3d'
    ├ <WireLayer>  (SVG, z 35)          ← wires drawn *below* components? Actually
    │    over boards, under component DOM; pointerEvents none, hit-test manual
    ├ boards.map() → <BoardOnCanvas>    (z 0 default, z 3 when seated, z 10+rank dragged)
    ├ .components-area
    │    └ components.map() → <DynamicComponent>   (abs positioned, z 1/5)
    └ <ElectricalOverlay>               (SPICE voltages / warnings, hover-gated)
 └ 3D view (out of scope)
```

Header (portaled) UI: status dot, board selector, Serial Monitor toggle, camera/mic
toggles (ESP32), WiFi/BLE badges, Oscilloscope toggle, component count, Add Component.

Floating overlays: `WireModeBanner`, `SelectionActionBar` (wire color / touch component
actions), floating zoom controls, `SensorControlPanel`, property dialog, pin-inspector
dialog, component picker modal.

### 4.2 Pan / zoom
- `handleWheel` converts screen delta to world delta using `zoomRef`/`panRef`.
- `handleCanvasMouseDown` starts pan / selection / wire / drag depending on mode.
- Drag-to-front: `raiseItem(id)` bumps `zOrders` so the last-dragged thing paints on top.
- Grid snap for components = configurable; wire endpoints snap to `20px` grid by default.

### 4.3 Selection & context
- Left-click empty canvas → clear selection + close wiring.
- Click near a wire (`findWireNearPoint`) → select wire; right-click → wire color/delete menu.
- Double-click a wire segment → insert a draggable waypoint.
- Click a pin (`handlePinClick`) → start/complete a wire.
- Component mouse-down (capture phase) → drag/threshold click vs drag; rotate via R /
  right-click menu / touch action bar.

---

## 5. Components on the canvas (`DynamicComponent`)

**File:** `frontend/src/components/DynamicComponent.tsx`

`renderComponent` in `SimulatorCanvas` builds a `<DynamicComponent>` wrapper for each
`Component` in the store, resolving `metadataId → ComponentMetadata` via the registry.
`DynamicComponent` is the glue between React and the Web Component:

- It creates a web component **as a child div** (the `.web-component-container`).
- It **synces React `properties` → element attributes/properties** in a `useEffect`,
  coercing string values to the metadata default type (`Number`/boolean). Programmatic
  writes also dispatch `input`/`change` DOM events and `dispatchSensorUpdate(...)` so the
  running simulation sees them.
- It binds **part-sim events** for interactive parts via `PartSimulationRegistry` (see §7).
- It exposes the **pin bridge**: after mount it reads `(element as any).pinInfo` and calls
  `onPinInfoReady`, and it drives `calculatePinPosition` for wire endpoints.
- The **wrapper** has `padding:4px; border:2px` on every side, so the inner element sits
  `+6p (+6, +6)` from the wrapper top-left. This padding is a **hard-coded invariant** that
  `updateWirePositions`/`recalculateAllWirePositions` and `pinPositionCalculator`
  depend on. Rotation is applied with `transform: rotate()` on the wrapper.

**Creating an instance** (used by the picker/agent tools):
```ts
createComponentFromMetadata(metadata, x, y)
// → { id: `<safePrefix>_${Date.now()}_${rand}`, metadataId, x, y,
//     properties: { ...metadata.defaultValues, rotation?: 90 } }
```
`safePrefix` strips `-` from `metadata.id` (SPICE name safety). Resistors default to
`rotation: 90` (vertical).

**The board case** is different — `BoardOnCanvas` renders boards directly (not via
`DynamicComponent`) so it can manage stacking, the active ring, status dot, drag overlay
and the `PinOverlay`. Board pixel sizes live in `BOARD_SIZE` (`BoardOnCanvas.tsx`).

---

## 6. The pin system (wire connection targets)

**Contract (critical):** every wire-able board/component is a Web Component with a
`pinInfo` getter returning pin tips in **CSS pixels relative to the element's top-left**:
```ts
get pinInfo() {
  return [
    { name: 'GP0', x: 6, y: 24, description: 'UART0 TX' },
    { name: 'GND.1', x: 120, y: 190, signals?: [{type:'power', signal:'gnd'}] },
    // ...
  ];
}
```
`signals` is optional metadata (some boards/components supply it for the SPICE resolver).

**Files:**
- `utils/pinPositionCalculator.ts` — `calculatePinPosition(componentId, pinName,
  componentX, componentY, rotation)` resolves a pin's **world** position; `getAllPinPositions`,
  `findClosestPin`, and `rotatePinLocal` (rotate a pin around the wrapper centre for
  overlays that live outside the rotated wrapper). It has extensive alias fallbacks so
  pin-name spellings (`D13`, `13`, `GP13`, `GND.1`/`GND.2`, `3V3`, `VIN`, `VBUS`, …)
  resolve even when the element exposes a different spelling.
- `components/simulator/PinOverlay.tsx` — renders clickable squares over pins. Visible on
  hover, when wiring (every square is a valid target), or for touch with `selection`.
  Size grows on coarse pointers to keep a ~44px screen hit-target.

---

## 7. Wires

### 7.1 Data model — `types/wire.ts`
```ts
interface WireEndpoint {
  componentId: string;
  pinName: string;
  x: number;   // world px (resolved pin position)
  y: number;
}
type WireSignalType =
  | 'power-vcc' | 'power-gnd' | 'analog' | 'digital'
  | 'pwm' | 'i2c' | 'spi' | 'usart';

interface Wire {
  id: string;
  start: WireEndpoint;
  end: WireEndpoint;
  waypoints: { x: number; y: number }[];   // user/system-inserted corners
  color: string;                           // hex
  signalType?: WireSignalType;             // set by classifiers; absent while fresh
  bb?: boolean;                            // breadboard seating wire — invisible, not hit-testable
  autoRouted?: boolean;                    // system owns the shape; cleared when user drags a segment
}
interface WireInProgress {
  startEndpoint: WireEndpoint;
  waypoints: { x: number; y: number }[];
  color: string;
  currentX: number; currentY: number;
  routedPreview?: {x:number;y:number}[] | null;
  lastRouteAt?: number;
}
```

### 7.2 Creation flow (mouse)
1. User clicks a pin → `handlePinClick` → `startWireCreation(endpoint, color)`
   (color from `autoWireColor(pinName)` / keyboard shortcuts / palette).
2. Mouse moves → `updateWireInProgress(x,y)`. If no user waypoints yet it computes a live
   **`routeAroundObstacles(...)`** preview (dodges components + existing wires).
3. Click empty canvas → `addWireWaypoint`. Click target pin → `finishWireCreation(endpoint)`.
4. On finish: final color (reset to `autoWireColor` if still default), first-time
   auto-route around obstacles, materialise the elbow of the last leg exactly as previewed,
   then `normalizeWireWaypoints(...)` → stored `waypoints`, and push to `wires[]`.
   `autoRouted: true` marks it system-owned.

### 7.3 Wiring plumbing
- `utils/wireUtils.ts` — `generateOrthogonalPath`, `expandOrthogonalPoints`,
  `simplifyOrthogonalPath`, `fuseMicroJogs`, `roundedPathFromPoints`,
  `normalizeWireWaypoints`, `generatePreviewPath`, `previewElbow`,
  `autoWireColor`, `jumperColorForId`, `railWireColor`, `WIRE_KEY_COLORS`,
  `DEFAULT_WIRE_COLOR`, `WIRE_JUMPER_PALETTE`, `WIRE_BEND_RADIUS`. Wokwi-style orthogonal
  + rounded bends.
- `utils/wireAutoRoute.ts` — `routeAroundObstacles`, `collectComponentObstacles`,
  `collectComponentRects`, `collectWireSegments`. Used for live preview AND system re-route.
- `components/simulator/WireLayer.tsx` — SVG layer (z 35, `pointerEvents:none`), renders all
  `WireRenderer`s, plus segment/waypoint handles (draggable circles), alignment guides, and
  the `WireInProgressRenderer`.
- `components/simulator/WireRenderer.tsx` — pure visual render of one wire: dark outline
  for crossing effect, hover highlight, colored stroke, selection dashes, endpoint dots.
  Returns `null` when `wire.bb`.
- `components/simulator/WireInProgressRenderer.tsx` — live preview (dashes, start pin
  marker, waypoint markers, cursor marker).

### 7.4 Wire hit-test / editing
Done stat in `SimulatorCanvas` via `findWireNearPoint`, `findSegmentNearPoint`,
`insertWaypointAtSegment`, `segmentDragPreview`, etc. (these helpers live in the canvas
module / imported from wire utils).

### 7.5 Breadboard seating
`utils/breadboardNets.ts`, `utils/breadboardSnap.ts`, `utils/breadboardOccupancy.ts`,
`utils/socketSnap.ts` generate invisible `bb:true` wires connecting a part's pins to the
holes it plugs into, and determine whether a board is *seated* on a socket component.

---

## 8. The `.vlx` project format — THE reusability interface

**Files:** `frontend/src/utils/vlxFile.ts` (Velxio side) · `backend/src/agentic/velxioProject.ts`
(Wireup side) · `frontend/src/lib/velxioBridge.ts` + `frontend/src/lib/vlxSync.ts` (Wireup side)

Velxio's portable project format is a single JSON object. This is what another agent should
produce/consume to load a circuit into Velxio.

```ts
interface VlxPayload {
  format: 'velxio-project';
  version: 1;
  exportedAt: string;                       // ISO
  name?: string;
  boards: Array<{
    id: string;
    name?: string;
    boardKind: string;                      // e.g. 'esp32', 'esp32-s3', 'arduino-uno'
    x: number; y: number;
    activeFileGroupId: string;
    languageMode?: 'arduino' | 'micropython' | 'espidf';
    serialBaudRate?: number;
    sdFiles?: Array<{ name: string; contentB64: string }>;
    libraries?: string[];                   // compile-scoped manifest
  }>;
  fileGroups: Record<string, Array<{ name: string; content: string }>>;
  folderGroups?: Record<string, string[]>;
  components: Array<{
    id: string; metadataId: string; x: number; y: number;
    properties: Record<string, unknown>;
  }>;
  wires: Array<{
    id: string;
    start: { componentId: string; pinName: string; x: number; y: number };
    end:   { componentId: string; pinName: string; x: number; y: number };
    waypoints: Array<{ x: number; y: number }>;
    color: string;
    signalType?: 'power-vcc' | 'power-gnd' | 'analog' | 'digital' | 'pwm' | 'i2c' | 'spi' | 'usart';
  }>;
  activeBoardId: string | null;
}
```

**Velxio functions:**
- `buildVlxPayload(opts)` → snapshot current store into a `VlxPayload` (pure).
- `buildVlxBlob(opts)` → a JSON `Blob`.
- `triggerDownloadVlx(opts)` → filename (sanitised) + triggers download.
- `parseVlxFile(file)` → validate → `VlxPayload` (throws `VlxParseError`).
- `importVlxFile(file)` → parse **and** `useSimulatorStore.loadProjectState(...)`.
- Validation: checks `format === 'velxio-project'`, `version <= 1`, `boards[]`,
  `fileGroups`, `components[]`, `wires[]`. It does **not** verify `metadataId`s against the
  catalog (bad ids render nothing but don't fail import).

**Wireup side — the generator** (`backend/src/agentic/velxioProject.ts`):
`generateVelxioProject(plan, sketch, extraFiles)` → `{ project, json, unsupported }`.
It derives the `.vlx` from the same Wokwi `diagram.json` the firmware and instructions use,
so board pin wiring can't drift. Key consts/tables another task may reuse:
- `boardKindFor(plan)` — Wireup board id → Velxio `boardKind` (`esp32-s3-devkit`→`esp32-s3`, default `esp32`).
- `METADATA_BY_WOKWI_TYPE` — Wokwi type → Velxio `metadataId` (e.g. `wokwi-dht22`→`dht22`).
  Anything absent is reported in `unsupported`, never faked.
- `velxioBoardPin(net)` — plan net label → board element pin name (`'4'`→`'D4'`, `'GPIO4'`→`'D4'`,
  `'GND.0'`→`'GND.1'`, `'3V3'`/`'5V'`/`'VIN'`).
- `classifyNet(boardPin, partPin)` → `{color, signalType}` for power vs signal wires.
- `normalizeWifiForEmulator(files)` — rewrites `WIFI_SSID`→`"Espressif"`, `WIFI_PASSWORD`→`""`
  (Velxio/QEMU only emulates one open AP); the shipped firmware zip keeps real credentials.
- `QEMU_WIFI_SSID = 'Espressif'`.

---

## 9. The postMessage embed bridge — the iframe interface

**Files:** `external/velxio/frontend/src/utils/embedBridge.ts` (applied via
`external/patches/velxio-embed-bridge.patch`) · Wireup side `frontend/src/lib/velxioBridge.ts`.

This is a **window.postMessage** protocol (origin-checked both ways) that lets a parent
page (Wireup page 04) drive an embedded Velxio iframe — the practical "interface" for
"load a circuit into Velxio from outside".

```
parent → velxio  { type: 'velxio:load-vlx', vlx: string | VlxPayload }
                 → importVlxFile()  → ack { type: 'velxio:vlx-loaded', name }  | err
parent → velxio  { type: 'velxio:export-vlx', name? }
                 → buildVlxPayload() →  { type: 'velxio:vlx-export', vlx: VlxPayload } | err
velxio → parent  { type: 'velxio:ready' }        (once, embedded contexts only)
either           { type: 'velxio:vlx-error', message }
```

Velxio's `initEmbedBridge()` only activates when `window.parent !== window`; all replies
go to `event.origin` (never `*`). Wireup's `useVelxioBridge(embedUrl, autoPushVlx)` returns
`{ status, push(vlxJson), pull(): Promise<VlxCanvasPayload>, frameRef }` and auto-pushes
the build's `.vlx` on `velxio:ready`.

**Wireup pull-back — `frontend/src/lib/vlxSync.ts`**:
`applyCanvasToArtifacts(payload, files)` folds a pulled `VlxCanvasPayload` back into
`diagram.json`, `hardware/universal-diagram.json` and the `.vlx`. It is the exact inverse
of `velxioProject.ts` (`WOKWI_TYPE_BY_METADATA`, `planNetFromBoardPin`). Parts the canvas
doesn't manage (the board, unmodelled passives) are left untouched.

---

## 10. Running it: engine selection & the simulation loop

### 10.1 Which engine runs a board (`startBoard`)
`useSimulatorStore.startBoard(boardId)` (in the store) routes by board kind:

- **`isPiBoardKind`** (Raspberry Pi Zero/1/2/3/4/5 + overlay kinds) → the QEMU bridge
  (`getBoardBridge` → `RaspberryPi3Bridge`), or the in-browser "instant" Python engine
  (`decideEngine`), selected by `enginePinned`/detector. `running` flips true immediately;
  `piBooted` flips when the guest reaches a shell.
- **`isEsp32Kind`** (ESP32/ESP32-S3/ESP32-C3/C6 families) → `Esp32Bridge`
  (`getEsp32Bridge` / `createEsp32Bridge` from `Esp32BridgeFactory`). Before connect it
  **pre-registers sensors** (walking wires with `traceBoardGpio`) and I2C devices
  (virtual pin `200 + addr`), and builds a FAT16 microSD image if a card is on canvas.
  `bridge.connect()` opens the WebSocket to the backend QEMU worker.
- **`isStm32BoardKind`** → `Stm32Bridge` (same pattern).
- **Otherwise** (AVR Uno/Nano/Mega/ATtiny85, RP2040 Pico/Pico W, RISC-V) → `getBoardSimulator`
  (in-browser engine), via `rpSim.start()`.

`stopBoard`/`resetBoard` mirror the same routing. Stopping a browser board calls
`reset()` (back to PC=0 — a true power-cycle), and always `PinManager.hardResetPinStates()`.

### 10.2 The in-browser loop (`AVRSimulator`, `RP2040Simulator`)
`frontend/src/simulation/AVRSimulator.ts` wraps `avr8js`. The loop is `requestAnimationFrame`
(~60 fps), each frame executing ~267,000 instructions and calling both:
```ts
avrInstruction(this.cpu);   // execute
this.cpu.tick();            // advance timers/peripherals
```
Port listeners fire on `PORTB/PORTC/PORTD` register writes → `pinManager.updatePort(...)`
→ component callbacks. `loadHex`/`loadBinary` parse the compiled program. Public hooks:
`onSerialData`, `onBaudRateChange`, `onPinChangeWithTime`, `pinManager`, `i2cBus`.
`RP2040Simulator` wraps `rp2040js` similarly (full 30-GPIO, UART0/1, ADC, I2C, PIO).

`PinManager` (`simulation/PinManager.ts`) maps Arduino/Board pins ↔ components:
- `onPinChange(pin, cb)`, `updatePort(portName, value, old, pinMap, ...)`,
  `setPinState(pin, state, source)`, `getOutputPins()`, `updatePwm(pin, duty, t)`,
  `resetPinStates()`, `hardResetPinStates()`, `onPullChange`.

### 10.3 Backend QEMU bridge (ESP32 family / STM32 / Pi Linux)
The frontend talks to the backend over a **WebSocket** at
`/simulation/ws/{sessionId}::{boardId}`. Message contract (from `Esp32Bridge.ts`):

**Frontend → backend:**
`start_esp32 {board, firmware_b64, sensors, sd_image_b64, wifi_enabled}` ·
`stop_esp32` · `load_firmware` · `esp32_serial_input {bytes, uart}` ·
`esp32_gpio_in {pin, state}` · `esp32_adc_set {channel, millivolts}` ·
`esp32_i2c_response {addr, response}` · `esp32_spi_response {response}` ·
`esp32_sensor_attach/update/detach` · `esp32_adc_waveform` · `esp32_proxy_i2c_register/update/unregister`.

**Backend → frontend:**
`serial_output {data, uart}` · `gpio_change {pin, state}` · `gpio_dir` · `gpio_pull` ·
`ledc_duty {channel, duty_pct}` · `gpio_routing`/`gpio_routing_clear` ·
`ws2812_update {channel, pixels}` · `i2c_event {addr, data}` ·
`i2c_transaction {addr, data[]}` · `spi_event {data}` · `system {event,...}` · `error {message}`.

### 10.4 The backend service
`backend/app/main.py` — FastAPI app, CORS, lifespan hooks.
`backend/app/api/routes/` — `compile.py` (multi-file arduino-cli, sync+async),
`compile_chip.py` (custom-chip WASM), `compile_rom.py`, `simulation.py` (WS bridge),
`iot_gateway.py`, `libraries.py`, `intellisense.py`, `micropython_libs.py`, `flash.py`, `news.py`.
`backend/app/services/` — `arduino_cli.py`, `espidf_compiler.py`.
`backend/app/core/hooks.py` — overlay no-op hooks (`record_compile`, `get_current_user_id`, `lifespan_startup`).

---

## 11. Part simulation registry — how components react to pins

**Files:** `frontend/src/simulation/parts/*` — the whole `parts/` tree is the "behaviour"
layer that makes components respond (LED lights up, button drives a pin, I2C display
receives bytes).

**Key contract** (`simulation/parts/PartSimulationRegistry.ts`):
```ts
type AnySimulator =
  | { setPinState(pin, state); isRunning(); pinManager: PinManager; [key:string]: any }
  | AVRSimulator | RP2040Simulator;

interface PartSimulationLogic {
  onPinStateChange?(pinName: string, state: boolean, element: HTMLElement): void;
  attachEvents?(
    element: HTMLElement,
    simulator: AnySimulator,
    getArduinoPinHelper(componentPin: string): number | null,
    componentId: string,
    getPinResolver?(componentPin: string): PinResolver | null,   // preferred entry point
  ): () => void;   // returns a cleanup fn
}

class PartRegistry { register(metadataId, logic); get(metadataId); listRegisteredParts(); }
export const PartSimulationRegistry = new PartRegistry();
```
`DynamicComponent` calls `attachEvents` in an effect (keyed on `hexEpoch`, wires,
chip WASM fingerprint), attaches DOM listeners to the element, and calls the cleanup on
unmount. The **`getPinResolver`** path hides whether a pin is fed by the digital `PinManager`
or by a SPICE-resolved net voltage with threshold conversion.

Sub-files: `ActiveParts`, `BasicParts`, `ComplexParts`, `ChipParts`, `CustomChipPart`,
`EPaperPart`, `GpsParts`, `LogicGateParts`, `MotorDriverParts`, `ProtocolParts`,
`SensorParts`, `partUtils` (`emitPropertyChange`, `setAdcVoltage`, `getADC`,
`analogRailVolts`), `runtimeBurnout` (P4 destruction monitor), `chipJson`, `busKernel/Nets/Logic`,
`simulatorBridges`, `syntheticPins`, `uartBitBang`, `WasiShim`, `ChipRuntime`, `SPIBus`.

**Cross-cutting simulation utilities:** `I2CBusManager`, `SignalRouter`, `PinResolver`,
`LogicFamilies`, `Interconnect`, `PinTrace` (`traceBoardGpio`, `traceDetailed`),
`SensorUpdateRegistry`, `sensorModels`, `sensorControlConfig`, `esp32-signals`,
`micropythonSession`, `MicroPythonLoader`, `Esp32MicroPythonLoader`, `HD44780Decoder`,
`piSlaveScanner`, `partPinOwnership`, `SpiBus`, `PioPeripheral`, `RiscVCore`.

---

## 12. SPICE / analog electrical layer (brief)

Files under `frontend/src/simulation/spice/` (and a user-facing overlay
`components/analog-ui/ElectricalOverlay.tsx`). This is separate from the digital pin
simulation. It builds a **netlist** from the same components/wires/pins
(`NetlistBuilder`, `componentToSpice`, `connectDigitalInputsToMcu`, `collectPinStates`,
`boardPinGroups`, `unionFind`) and solves it with a SPICE engine (`runNetlist`,
`MixedModeScheduler`, `CircuitSimulationService`, `electricalResolveHook`,
`valueParser`, `probes`, `waveformStats`, `types`). Results drive `ElectricalOverlay`
(voltage pills on wires, current, short warnings) and can feed ADC channels into the MCU.

---

## 13. How the "2D" page is laid out (EditorPage)

`pages/EditorPage.tsx` composes:
- Left m]ain: Monaco `CodeEditor`, `FileExplorer`, `EditorToolbar`
- Middle/right: `SimulatorCanvas` (portal `headerSlot`)
- Bottom panel (`SerialMonitor`, `Oscilloscope`) with a resizable drag handle
- The whole thing inside an `app-container`.

`SimulatorCanvas` is mounted by `EditorPage`; the intermediate `App.tsx` route layer and the
pro overlay (`@pro/*`, `proRoutes.ts`) are out of scope.

---

## 14. Key file/dependency map (2D only)

### Editor / route / stores
- `frontend/src/main.tsx` — entry, `initEmbedBridge()`, side-effect Web Component imports
- `frontend/src/App.tsx` — Router
- `frontend/src/pages/EditorPage.tsx` — layout
- `frontend/src/store/useSimulatorStore.ts` — the scene "database" + engine routing
- `frontend/src/store/useEditorStore.ts` — file groups
- `frontend/src/store/useElectricalStore.ts` — SPICE state
- `frontend/src/store/useProjectStore.ts`, `useOscilloscopeStore.ts`, `useVfsStore.ts`

### Canvas / components
- `components/simulator/SimulatorCanvas.tsx`
- `components/simulator/BoardOnCanvas.tsx` (+ `BOARD_SIZE`)
- `components/simulator/DynamicComponent.tsx` (+ `createComponentFromMetadata`)
- `components/simulator/WireLayer.tsx`, `WireRenderer.tsx`, `WireInProgressRenderer.tsx`
- `components/simulator/PinOverlay.tsx`, `SeatedPinMarkers.tsx`
- `components/simulator/ComponentPalette.tsx`, `ComponentPickerModal.tsx`,
  `ComponentPropertyDialog.tsx`, `PartInspectorDialog.tsx`, `BoardOptionsModal.tsx`,
  `BoardPickerModal.tsx`, `SelectionActionBar.tsx`, `WireModeBanner.tsx`
- `components/simulator/SerialMonitor.tsx`, `Oscilloscope.tsx`,
  `SensorControlPanel.tsx`, `CameraToggle.tsx`, `MicrophoneToggle.tsx`,
  `BoardSensorControls.tsx`, `ComponentCameraToggles.tsx`, `CircuitVerificationModal.tsx`,
  `InstallLibrariesModal.tsx`, `LibraryManagerModal.tsx`, `FlashModal.tsx`, `SdCardPanel.tsx`
- `components/analog-ui/ElectricalOverlay.tsx`
- `components/velxio-components/*` (board + element wrappers) and `velxio-elements/*`
- `components/editor/*` (CodeEditor, EditorToolbar, FileExplorer, FileTabs, CompilationConsole, …)

### Utils
- `utils/pinPositionCalculator.ts`, `wireUtils.ts`, `wireAutoRoute.ts`,
  `wireColors.ts`, `wireHitDetection.ts`, `wireUtils`
- `utils/vlxFile.ts` (import/export), `embedBridge.ts`, `importProject.ts`,
  `loadExample.ts`, `socketSnap.ts`, `breadboardNets.ts`, `breadboardSnap.ts`,
  `breadboardOccupancy.ts`, `dropSlot.ts`, `pinInspectorLayout.ts`, `wireAutoRoute.ts`
- `utils/hexParser.ts`, `firmwareLoader.ts`, `firmwareWifiNote.ts`, `sourceFingerprint.ts`,
  `exampleToBuildNetlistInput.ts`, `sdCardFiles.ts`, `fatImage.ts`, `esp32ImageParser.ts`

### Simulation engines
- `simulation/AVRSimulator.ts`, `RP2040Simulator.ts`, `RiscVSimulator.ts`,
  `Esp32C3Simulator.ts`, `Esp32Bridge.ts`, `Esp32BridgeFactory.ts`, `Stm32Bridge.ts`,
  `RaspberryPi3Bridge.ts`, `PinManager.ts`, `I2CBusManager.ts`, `SignalRouter.ts`,
  `PinResolver.ts`, `LogicFamilies.ts`, `Interconnect.ts`, `PinTrace.ts`,
  `SensorUpdateRegistry.ts`, `sensorModels.ts`, `sensorControlConfig.ts`,
  `esp32-signals.ts`, `micropythonSession.ts`, `partPinOwnership.ts`, `SpiBus.ts`,
  `PioPeripheral.ts`, `piSlaveScanner.ts`, `HD44780Decoder.ts`, `UsiI2cBridge.ts`

### Backend (for the QEMU boards)
- `backend/app/main.py`, `api/routes/{compile,compile_chip,compile_rom,simulation,iot_gateway,libraries,intellisense,micropython_libs,flash,news}.py`,
  `services/{arduino_cli,espidf_compiler}.py`, `core/{config,hooks}.py`

### Types
- `types/wire.ts`, `types/board.ts`, `types/component-metadata.ts`, `types/components.ts`,
  `types/boardOptions.ts`

---

## 15. The interface cheat-sheet (for the "another task" agent)

If you want to **create/load a circuit programmatically**, these are the four surfaces that
matter, in order of least coupling:

1. **Produce a `.vlx` payload** (JSON) matching `VlxPayload` (§8). Feed it to Velxio by either
   - an import file event → `importVlxFile`, or
   - the **postMessage bridge** `{type:'velxio:load-vlx', vlx}` from a parent iframe (§9).
   The **Wireup generator** `backend/src/agentic/velxioProject.ts` is the reference producer
   (`metadataId`, `boardKind`, pin-name translation, wire colour/signal classifiers).

2. **Read the scene back** as a `.vlx` via `buildVlxPayload()` or the bridge
   `{type:'velxio:export-vlx'}` → `velxio:vlx-export`. Wireup's `vlxSync.ts` shows how to
   fold it back into a canonical diagram (`applyCanvasToArtifacts`).

3. **Drive the stores directly** (if you can run in the same JS context) via
   `useSimulatorStore.getState()` — `addBoard`, `addComponent`, `addWire`,
   `startWireCreation`/`finishWireCreation`, `updateComponent`, `setComponents`,
   `setWires`, then `startBoard`/`compileBoardProgram`. Board kinds are `BoardKind`
   (`types/board.ts`), component types are `metadataId`s (`components-metadata.json` /
   `ComponentRegistry`), pin names come from the element's `pinInfo`.

4. **React to component behaviour** via `PartSimulationRegistry.register(metadataId, {
   onPinStateChange?, attachEvents? })` and read output pins with `PinManager`.

**Rules that keep a circuit valid:**
- Wire endpoints must reference a **real `componentId`** (board or component) and a
  **pin name the element's `pinInfo` exposes** (use `velxioBoardPin`/`planNetFromBoardPin`
  to translate net labels).
- `fileGroups[activeFileGroupId]` must be self-contained for the board to compile.
- For ESP32/QEMU, WiFi in the emulator is a single open AP, SSID `"Espressif"` — normalize
  credentials (`normalizeWifiForEmulator`).
- Components without a Velxio model must be reported (Wireup puts them in `unsupported`),
  never substituted.
- **The `(6,6)` wrapper offset and orthogonal wire routing are invariants** — don't change
  them or wire endpoints and rotated components break.

---

*Based on static analysis of `external/velxio` at commit `2642ed7`. 3D/three.js paths and the
hosted (`velxio-prod`) overlay are out of scope.*
