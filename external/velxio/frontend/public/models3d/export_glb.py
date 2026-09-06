#!/usr/bin/env python3
"""
export_glb.py — convert the CAD STEP files to the GLBs the 3D view needs.

Run inside Blender (the sandbox/bin side that has Blender/OCP). Blender's STEP
importer uses OCP, so a plain `blender --background` works:

    blender --background --python export_glb.py -- \
        --step "cad/arduino-uno-r3-1.snapshot.5/arduino uno.STEP" \
        --out "external/velxio/frontend/public/models3d/arduino-uno/arduino-uno.glb" \
        --key arduino-uno \
        --pins 0:0:0 6.35:0:0 D0 ...   # or --pins-json file

It:
  1. imports the STEP,
  2. unit-scales to mm (STEP is already mm; Blender's default scene unit is m,
     so a STEP in mm import may appear 1000x smaller — we set scene unit to
     'MILLIMETERS' and apply a 1:1 scale),
  3. creates an EMPTY at each requested pin coordinate, named EXACTLY as the
     wire endpoints use (these become the `getObjectByName` pins),
  4. writes /models3d/manifest.json (merging with any existing entries),
  5. exports a single GLB (no Draco, so the browser loads it with a plain
     GLTFLoader — no CDN decoder needed).

Pins are supplied in the part's LOCAL mm coordinates measured from the part's
origin (the same origin the STEP import centers). The simplest workflow is to
first import the STEP, add one empty per pin by hand-locating it on the CAD
geometry (or read the pad x/y from the 2D element), then re-run with
`--pins-json` listing each {name, x, y, z}.

Only the FIRST argument after `--` is parsed by argparse; everything else is
argv. Blender forward-slash paths are used deliberately.
"""

import argparse
import json
import os
import sys

import bpy


def parse_args():
    # Blender puts script args after a bare `--`.
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Export a STEP part to a GLB for the 3D view.")
    p.add_argument("--step", required=True, help="Path to the .STEP file.")
    p.add_argument("--out", required=True, help="Output .glb path.")
    p.add_argument("--key", required=True, help="Manifest key (boardKind / metadataId).")
    p.add_argument(
        "--pins-json",
        default=None,
        help="JSON file: [{'name': 'D0', 'x': 0, 'y': 0, 'z': 0}, ...] in local mm.",
    )
    p.add_argument(
        "--pins",
        nargs="*",
        default=None,
        help="Space-separated name:x:y:z entries (e.g. SIGNAL:5:0:0 VCC:0:5:0).",
    )
    p.add_argument("--manifest", required=True, help="Path to /models3d/manifest.json.")
    return p.parse_args(argv)


def set_scene_mm():
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.length_unit = "MILLIMETERS"
    bpy.context.scene.unit_settings.scale_length = 1.0


def import_step(step_path):
    # Blender's STEP importer. Select-but-don't-import in one call.
    bpy.ops.import_scene.import_step(filepath=step_path)
    # Fan-out to all selected objects is handled by the operator; it leaves the
    # imported objects in the scene.


def add_empty(name, co):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=co)
    ob = bpy.context.object
    ob.name = name
    return ob


def center_scene_at_origin():
    """Move everything so the bbox center sits at the origin, then bake."""
    from mathutils import Vector

    # Gather all mesh objs.
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        return
    minv = Vector((float("inf"),) * 3)
    maxv = Vector((float("-inf"),) * 3)
    for o in objs:
        for corner in o.bound_box:
            wc = o.matrix_world @ Vector(corner)
            minv.x = min(minv.x, wc.x)
            minv.y = min(minv.y, wc.y)
            minv.z = min(minv.z, wc.z)
            maxv.x = max(maxv.x, wc.x)
            maxv.y = max(maxv.y, wc.y)
            maxv.z = max(maxv.z, wc.z)
    center = (minv + maxv) * 0.5
    for o in bpy.context.scene.objects:
        o.location -= center
    bpy.context.view_layer.update()


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    set_scene_mm()
    args = parse_args()

    if not os.path.exists(args.step):
        raise SystemExit(f"STEP not found: {args.step}")

    import_step(args.step)

    # Hold empties so they don't get swept into the final export transform.
    pins = []
    if args.pins_json:
        with open(args.pins_json) as f:
            pins = json.load(f)
    elif args.pins:
        for entry in args.pins:
            name, x, y, z = (entry.split(":") + ["0", "0", "0"])[:4]
            pins.append({"name": name, "x": float(x), "y": float(y), "z": float(z)})

    center_scene_at_origin()  # empties added after this use local coords relative to center

    # Create pin empties in local coords.
    for p in pins:
        add_empty(p["name"], (p["x"], p["y"], p["z"]))
        # Pin empties should not render; they're only name anchors.
        bpy.context.object.hide_render = True

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    # Export GLB. Draco OFF so the browser builds with a plain GLTFLoader.
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_draco_mesh_compression_enable=False,
        export_yup=True,
    )

    # Refresh /models3d/manifest.json.
    manifest_path = args.manifest
    manifest = {"version": 1, "models": {}}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    pin_names = [p["name"] for p in pins]
    manifest.setdefault("models", {})[args.key] = {
        "file": os.path.relpath(args.out, os.path.dirname(manifest_path)).replace(os.sep, "/"),
        "pinNodes": pin_names,
        "bench": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": 1},
    }
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[export_glb] wrote {args.out}; manifest key '{args.key}' ({len(pin_names)} pins)")


if __name__ == "__main__":
    main()
