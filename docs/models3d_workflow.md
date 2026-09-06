The Velxio 3D view renders a part **only** if it has a registered GLB in
`external/velxio/frontend/public/models3d/manifest.json`. Today only two parts
are registered: `arduino-uno` (board) and `servo` (component). This doc is the
repeatable process for registering the rest.

## 1. How the pipeline works

```
cad/<key>/<key>.step  ──►  build_models3d.py  ──►  models3d/<key>/<key>.glb
   (or .stl)              (cascadio/trimesh)       + manifest.json (merged)
                                                          │
                                 3D view: /models3d/manifest.json ──► `<key>/<key>.glb`
                                                          │
                                                          └─ named EMPTY nodes = wire anchors
                                                             (`servo_horn` group = animated servo)
```

- **Keys**: board → its `boardKind` (e.g. `arduino-uno`, `esp32`); component →
  its `metadataId` (e.g. `servo`, `dht22`).
- The builder reads **STEP natively** (OpenCASCADE `cascadio`), or **STL** via
  trimesh; scales to mm, centres the bbox at origin, adds hidden pin empties,
  optionally materials/animations, merges `manifest.json` (never clobbers),
  then self-verifies: pin names round-trip, Draco off, bbox centred.
- **No Blender and no FreeCAD are required for STEP or STL.** Blender is only
  an **optional** route (see §4): on a machine with Blender 5.1+, the free
  Clonephaze **STEP Importer** addon (extensions.blender.org — it uses
  cascadio under the hood) is great for material/PBR polish and repositioning
  moving parts. FreeCAD is the fallback for a broken file. The
  `bedrock-blender-agent/` (Blender-MCP) agent drives that Blender route.

## 1b. Phase 0 — widen the render store ONCE (before part #3)

`external/velxio/frontend/src/store/usePartRenderStore.ts` currently only
understands servos and LEDs:

```ts
export interface PartRenderValue { angle?: number; brightness?: number; }
```

A button (`pressed`), potentiometer (`position`), 7-segment (`digit`), RGB LED
(`r/g/b`) etc. don't fit. **One person widens it once**, everything is
additive:

```ts
export interface PartRenderValue {
  [key: string]: number | boolean | string;
}
```

- Existing `angle` / `brightness` keys keep working; `Cad3DScene`'s
  `v?.angle` / LED emissive readers are unaffected.
- Writers: keep the existing pattern — a part's simulator writes its live
  value with the **componentId in scope** (`setValue(componentId, {...})`)
  from the same call site that sets `el.angle`/`el.brightness`, so 2D never
  regresses.
- **Agents must NOT touch shared infra**: `usePartRenderStore`'s shape,
  wire-resolution code, `Cad3DScene.tsx`, `models3d.ts`, or
  `manifest.json`. Only the Phase-0 owner edits those. There is no
  `DynamicComponent3D` component in this repo — don't invent one.

## 1c. Claim before you start (the status checklist)

`docs/3d-asset-status.md` is the shared board:
`metadataId | status | assignee | source`. **Claim a row (status = `claimed`,
assignee = you) before modeling** so two people never model the same resistor.
Mark `done` + attach the source URL/licence in the PR.

## 2. What exists and what's next (priority tiers)

| Tier | Scope | Count | Notes |
| --- | --- | --- | --- |
| Done | `arduino-uno`, `servo` | 2 | verified: 26 + 3 contract pins |
| 1 | Parts the Wireup pipeline emits (`backend/src/agentic/velxioProject.ts`) + boards it uses | 19 parts + `esp32`, `esp32-s3` | **must work first** — these appear in real builds |
| 2 | Boards in the Velxio picker (`BoardPickerModal.tsx`) | 12 | includes Tier-1 boards |
| 3 | Rest of the component catalog | 156 types | enumerate: `jq '.components[].id' external/velxio/frontend/public/components-metadata.json` |

Tier 1 list (metadataId → wokwi tag → **exact `pinInfo` names**, from
`@wokwi/elements` 1.9.2 / `src/components/velxio-components/`):

| metadataId | tagName | Pin names (contract) |
| --- | --- | --- |
| `dht22` | wokwi-dht22 | VCC, SDA, NC, GND |
| `hc-sr04` | wokwi-hc-sr04 | VCC, TRIG, ECHO, GND |
| `pir-motion-sensor` | wokwi-pir-motion-sensor | VCC, OUT, GND |
| `servo` ✅ | wokwi-servo | SIGNAL, VCC, GND (aliases: PWM→SIGNAL, V+→VCC) |
| `ssd1306` | wokwi-ssd1306 | DATA, CLK, DC, RST, CS, 3V3, VIN, GND |
| `led` | wokwi-led | A, C |
| `buzzer` | wokwi-buzzer | 1, 2 |
| `pushbutton` | wokwi-pushbutton | 1.l, 2.l, 1.r, 2.r |
| `potentiometer` | wokwi-potentiometer | GND, SIG, VCC |
| `photoresistor-sensor` | wokwi-photoresistor-sensor | VCC, GND, DO, AO |
| `ntc-temperature-sensor` | wokwi-ntc-temperature-sensor | GND, VCC, OUT |
| `mpu6050` | wokwi-mpu6050 | INT, AD0, XCL, XDA, SDA, SCL, GND, VCC |
| `lcd1602` | wokwi-lcd1602 | i2c: GND, VCC, SDA, SCL · full: VSS, VDD, V0, RS, RW, E, D0–D7 (+ backlight pins — confirm in pinInfo) |
| `neopixel` | wokwi-neopixel | VDD, DOUT, VSS, DIN |
| `resistor` | wokwi-resistor | 1, 2 |
| `bmp280` | wokwi-bmp280 | SDA, SCL, GND, VCC |
| `gas-sensor` | wokwi-gas-sensor | AOUT, DOUT, GND, VCC |
| `relay` | wokwi-relay(-module) | COIL+, COIL−, NO, COM, NC |
| `ks2e-m-dc5` | wokwi-ks2e-m-dc5 | NO2, NC2, P2, COIL2, NO1, NC1, P1, COIL1 |

Always double-check the names in the live app before committing:
`document.querySelector('wokwi-<part>').pinInfo` in the dev-server console.

## 3. What to download, and where to place it

1. **Find the official CAD first** (STEP preferred; STL acceptable):
   - Arduino boards: `docs.arduino.cc` product page → “CAD files” (Uno R3 =
     `A000066-cad-files.zip`, official STEP).
   - Raspberry Pi: `datasheets.raspberrypi.org` (Pico has an official STEP zip).
   - Espressif devkits / ST boards: manufacturer docs site (often DXF + PDF
     dims; STEP sometimes only via GrabCAD).
   - Modules & generic parts (DHT22, HC-SR04, PIR, MPU6050, LCDs, relays…):
     **GrabCAD Community** (search “<part> step”), **SnapEDA / Component
     Search Engine** (footprint + 3D model, often STEP), or the manufacturer.
   - Note the source URL + licence in the PR (GrabCAD models keep their
     author's licence; official files are safest).
2. **Place it at** `cad/<key>/<key>.step` (or `.stl`) — the builder resolves
   paths from the repo root, and `PART_SPECS` points at exactly that path.
   Example: `cad/dht22/dht22.step`.
3. **Units must be mm.** If the model is in inches/metres, scale it in FreeCAD
   (or report it — the builder assumes mm for STL).

## 4. What to convert (and what NOT to)

| You have | Do this |
| --- | --- |
| `.step` / `.stp` | Nothing — build directly. **Default.** |
| `.stl` | Nothing — the builder accepts STL directly (assumes mm). |
| `.igs`, `.x_t`, `.SLDPRT`, others | Convert once to STEP with **FreeCAD** (File → Import, then File → Export STEP) or **CAD Assistant** (free) — then build. |
| Blender (optional, per-machine) | Only with the free **STEP Importer** addon (Clonephaze, extensions.blender.org, Blender 5.1+, cascadio underneath — also handles `.iges`). Good for PBR polish (Poly Haven HDRI/presets — reuse ONE set across parts so the catalog looks consistent) and for renaming moving parts / LED lenses. **Export must stay Draco OFF** (the 3D view has no Draco decoder). |
| Generic passives (resistor, basic cap, plain 5 mm LED) | Don't hunt for CAD — generate a primitive: `trimesh.creation.cylinder/box` → export GLB → run it through the same pin-anchor + verify steps. Same effort rule: distinctive shape → source real CAD; generic → primitive. |

## 5. Pin anchors: the one rule that breaks everything

- The GLB must contain **hidden EMPTY nodes** whose names match the part's
  `pinInfo` names **exactly** (case-sensitive; `GND.1` must survive).
  The builder does the placement — you only supply coordinates.
- **Measure in the CAD (FreeCAD), in mm, at the physical connector centre**
  (header holes are on a 2.54 mm pitch; sensors/modules have solder pads).
- **Axis rule (the usual mistake):** FreeCAD is Z-up, the GLB is Y-up.
  Convert every coordinate: `(X, Y, Z)_FreeCAD → (X, Z, −Y)_GLB`.
  Worked example (Uno, left header): FreeCAD `(-50.8, 63.5, 8.5)` →
  spec coords `(-50.8, 8.5, -63.5)`.
- Verifying is cheap: after the build, check every wire in the 3D view
  attaches at the right pin; the builder already asserts the **names**.

## 6. Registering a new part (the only code edit)

Append a spec to `PART_SPECS` in
`external/velxio/frontend/public/models3d/build_models3d.py`:

```python
    "dht22": {
        "step": "cad/dht22/dht22.step",          # path from repo root
        "out": ("external/velxio/frontend/public/models3d/"
                "dht22/dht22.glb"),
        # CONTRACT pins (names MUST equal the element's pinInfo)
        "pins": {
            "VCC":  (0.0, 0.0, 0.0),             # ← measured, mm, Y-up
            "SDA":  (0.0, 0.0, 0.0),             # ← measured, mm, Y-up
            "NC":   (0.0, 0.0, 0.0),             # ← measured, mm, Y-up
            "GND":  (0.0, 0.0, 0.0),             # ← measured, mm, Y-up
        },
        "aux": {},        # extra anchors (non-contract) if the part needs them
        "aliases": {},    # e.g. {"PWM": "SIGNAL"}
        "materials": False,   # True only when the CAD has/nearly-has material info
        "horn": None,         # {"name": "servo_horn", "center_mm": (…), "mesh_suffixes": (…)} for servos
    },
```

**Registration = spec + merged manifest.** There is **no `model3d:` field** in
this codebase (that was a proposal for a different layout); the 3D view keys a
model by `boardKind`/`metadataId` in
`external/velxio/frontend/public/models3d/manifest.json` (`file`, `pinNodes`,
`bench`, `materials`). Output lives at
`external/velxio/frontend/public/models3d/<key>/<key>.glb` — not
`frontend/public/models/`.

- **Coordinates are placeholders — replace with measured values.** The builder
  self-verify only checks names, so a wrong coordinate still passes the script;
  the visual/wire check in the running app is the real acceptance test.
- `aux` = extra named empties beyond the contract (aliases for the frontend's
  fallback lookups); they are **not** listed in manifest `pinNodes`.
- Never hand-edit `manifest.json` — `python build_models3d.py --all` merges it
  and leaves it byte-identical when nothing changed.

## 7. Build, verify, and ship

```bash
# one-time tooling (Python 3.11+; cascadio/trimesh wheels, no Blender/FreeCAD)
pip install -r external/velxio/frontend/public/models3d/requirements.txt

# build everything + manifest (+ self-verify)
python external/velxio/frontend/public/models3d/build_models3d.py --all

# single new part (fast loop while iterating)
python external/velxio/frontend/public/models3d/build_models3d.py \
  --input cad/dht22/dht22.step \
  --out external/velxio/frontend/public/models3d/dht22/dht22.glb \
  --key dht22
```

Script output must show: `contract pins present: N/N`, `extensionsUsed: none`
(Draco OFF), bbox close to the datasheet dims (compare against the numbers in
`frontend/src/three/dimensions.ts`), centre offset ≈ 0.

Optional second pair of eyes on the binary:

```bash
npx @gltf-transform/cli inspect models3d/<key>/<key>.glb
# confirm: every contract pin appears as a node, no extensionsRequired for Draco
```

Then run the app and prove it visually:

```bash
cd external/velxio/frontend && corepack pnpm install --frozen-lockfile && npm run dev
```

Add the board/part → **Start** → **3D** tab: geometry appears, wires attach at
the pins, servo horn rotates if it's a servo.

**Definition of done:** CAD source `cad/<key>/<key>.step|stl` + spec entry in
`build_models3d.py` + `models3d/<key>/<key>.glb` + manifest entry (built, not
hand-edited) + self-verify passes + a wire actually attaches in the 3D view +
PR with source URL/licence + pin screenshot.

## 8. Copy-paste instructions for teammate agents

> You are converting one electronic part into a GLB for the Wireup/Velxio CAD
> 3D view. Target key: `<key>` (boardKind or metadataId). Contract pin names:
> `<…list from the table…>`.
>
> 1. **Claim it first**: mark `docs/3d-asset-status.md` — status `claimed`,
>    assignee = you — so nobody else starts the same part.
> 2. Download official CAD first (Arduino docs / Raspberry Pi datasheets /
>    manufacturer); otherwise GrabCAD Community / SnapEDA. Prefer STEP;
>    STL is accepted. Generic passives (resistor, cap, plain LED) → skip the
>    hunt and generate a primitive. Record source URL + licence.
> 3. Place at `cad/<key>/<key>.step` (or `.stl`). Units must be mm.
> 4. Measure pin anchors in FreeCAD (mm) at the centre of every connector/pad
>    matching a contract pin name. Convert coordinates from FreeCAD's Z-up
>    frame to the GLB's Y-up frame: `(X,Y,Z) → (X, Z, −Y)`.
> 5. Add a `PART_SPECS` entry in
>    external/velxio/frontend/public/models3d/build_models3d.py with those
>    measured coordinates (mm, Y-up). Do NOT rename pins and do NOT edit
>    manifest.json by hand.
> 6. Run `python external/velxio/frontend/public/models3d/build_models3d.py
>    --all`. Confirm: `contract pins present: N/N`, `extensionsUsed: none`,
>    bbox sane and centred, Draco off. Optional cross-check:
>    `npx @gltf-transform/cli inspect` the GLB.
> 7. If the part's sim logic writes a live value (angle, pressed, digit, RGB
>    channels…), wire it: `setValue(componentId, {...})` from the same call
>    site that sets the 2D element's property — the widened render bag already
>    accepts it. Do NOT change the shape of `usePartRenderStore`, wire
>    resolution, `Cad3DScene`, or `models3d.ts` — shared infra.
> 8. Start the dev server (`cd external/velxio/frontend && npm run dev`), place
>    the part on the bench, Start, open the 3D tab, confirm geometry + wires
>    attach at the right pins.
> 9. Mark the checklist `done`, commit `cad/` source, the builder spec, the GLB
>    and the manifest, and open a PR with the source URL and a pin screenshot.

Agent hard rules: keep the **default pipeline without Blender** (cascadio/trimesh
is always correct); Blender is optional, and only via the STEP Importer addon
(Blender 5.1+), **still exporting Draco OFF**; never ship without self-verify
passing; never fake coordinates (`0,0,0` pins make wires invisible/misplaced);
keep names case-exact (`GND.1`); mm only; don't touch shared infra.

