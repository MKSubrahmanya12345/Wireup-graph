# bedrock-blender-agent

Bedrock-powered agent that drives **Blender via BlenderMCP** to convert the
STEP CAD files in `cad/` into the GLB assets used by the Velxio 3D view
(`external/velxio/frontend/public/models3d/`).

That job is **already done** — the GLBs were built with OpenCASCADE
(`build_models3d.py --all`, no Blender needed) and are committed in this repo.
This agent only matters if you want to regenerate them *through Blender* from
your own machine.

## Requirements (your machine — NOT this repo/sandbox)

1. Blender installed, **with the STEP importer addon** and the
   [BlenderMCP](https://github.com/ahujasid/blender-mcp) addon enabled.
   BlenderMCP addon installs via the MCP server package:

   ```bash
   uvx blender-mcp --save-addon   # writes the addon zip Blender must load
   ```

   Then in Blender: `Edit → Preferences → Add-ons → Install…` → the zip,
   enable it, and keep the addon's MCP connection running (default port 9876).

2. [uv](https://docs.astral.sh/uv/) (agent uses `uvx blender-mcp`).
   `.python-version` pins 3.14.

3. AWS Bedrock credentials for `us-east-1`:

   ```bash
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_REGION=us-east-1
   ```

## Run

```bash
uv sync
python main.py            # on Windows: py -3 main.py
```

The agent connects to `uvx blender-mcp`, exposes its Blender tools to Bedrock
(model `minimax.minimax-m2.5`), and executes the STEP → pin EMPTY → GLB task.
Output paths match the committed assets:
`external/velxio/frontend/public/models3d/{arduino-uno, sg90}/`.

## Notes

- The committed GLBs came from the cascadio builder (no GUI, no Blender),
  self-verified: 26/26 Uno contract pins, 3/3 servo pins, Draco off, mm 1:1,
  bbox centred. Only rebuild through Blender if you change the CAD or want
  Blender-authored materials.
- Rebuild script lives at
  `external/velxio/frontend/public/models3d/build_models3d.py`.
