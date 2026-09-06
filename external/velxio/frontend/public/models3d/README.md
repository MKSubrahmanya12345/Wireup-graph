# models3d — CAD 3D asset registry

The new **CAD 3D view** (Option A) renders **only** parts that have a registered
GLB here. A part with no registered model is simply omitted from the 3D scene
— there is no placeholder slab and no procedural fallback body. When no models
are registered at all, the 3D view shows a clear empty-state message instead of
crashing.

## What lives here

```
public/models3d/
  manifest.json          # the registry table (this file)
  export_glb.py          # Blender script: STEP -> GLB + pins + manifest entry
  <key>/<key>.glb        # the actual model assets (produced by Blender)
  <key>/textures/        # optional PBR textures (referenced by manifest)
```

`public/` is served at the app root, so a manifest `file: "arduino-uno/arduino-uno.glb"`
resolves to `/models3d/arduino-uno/arduino-uno.glb`.

## manifest.json contract

```json
{
  "version": 1,
  "models": {
    "<key>": {
      "file": "<path-under-models3d>.glb",
      "pinNodes": ["<pin-name>", "..."],
      "bench": {
        "position": [x, y, z],
        "rotation": [x, y, z],
        "scale": 1
      },
      "materials": {
        "baseColorMap": "arduino-uno/textures/diffuse.png",
        "baseColor": [0.5, 0.5, 0.5]
      }
    }
  }
}
```

- **`<key>`** — the lookup key. For a **board** it is its `boardKind`
  (e.g. `arduino-uno`). For a **component** it is its `metadataId`
  (e.g. `servo`).
- **`pinNodes`** — the Node/Empty names inside the GLB that correspond to the
  part's connection points. The frontend resolves wire endpoints via
  `getObjectByName(pinName).getWorldPosition()`, so **these names must match the
  wire endpoints exactly**. `pinNodes` is documentation/introspection; the actual
  lookup reads object names.
- **`bench`** — optional placement. `position` is applied as an offset on top of
  the automatic grid layout, `rotation` (radians, Y) and `scale` tune the pose.

## Pin names (the critical contract)

Wire endpoints carry the pin `name` the web component exposes in `pinInfo`.
The Blender side must create an Empty with **exactly** that name inside the GLB.
Verified names:

| Key           | Pin names                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `arduino-uno` | `0`,`1`,`2`,`3`,`4`,`5`,`6`,`7`,`8`,`9`,`10`,`11`,`12`,`13`, `A0`–`A5`, `GND.1`, `GND.2`, `3V3`, `VIN`, `5V`, `RESET` |
| `servo`       | `SIGNAL`, `VCC`, `GND`                                                                                      |

Important notes:

- Arduino Uno digital pins are exposed **numerically** (`0`–`13`), not `D0`–`D13`.
  The frontend already tries aliases (`13` ↔ `D13`, `3V3` ↔ `3.3V`, `GND.1` ↔
  `GND1`), but **prefer the exact names above**.
- `GND.1` is the most at risk of being sanitized/deduped by the exporter. Verify
  it round-trips: reopen the GLB and enumerate names before relying on wiring.

## Verify an export

After producing a GLB, reopen it and list every object name before committing:

```bash
# Blender
blender --background --python-expr "import bpy; [print(repr(o.name)) for o in bpy.data.objects]"
```

then in the running app, open the 3D view and confirm wires draw between the two
registered parts.

## Produce the assets (Blender host)

The export script is `export_glb.py`. It imports the STEP, adds the pin empties,
writes the manifest entry, and exports an uncompressed GLB (no Draco, so no CDN
decoder is needed). See the script header for a runnable example.
