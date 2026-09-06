import asyncio
import json
import boto3

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


MODEL_ID = "minimax.minimax-m2.5"
REGION = "us-east-1"

SYSTEM_PROMPT = """
You are a CAD/electronics engineering agent operating Blender through BlenderMCP.

Your job is to create production-ready 3D assets for a web-based electronics simulator.

When working on a component:

1. Import the provided STEP/CAD file into Blender using BlenderMCP.
2. Set scene units to MILLIMETERS and preserve 1:1 scale.
3. Remove default Cube, Light, and Camera objects.
4. Keep the actual imported CAD geometry.
5. Center the component appropriately at the world origin.
6. Create EMPTY objects of type PLAIN_AXES at the electrical connection/pin locations.
7. Pin EMPTY names must exactly match the required names.
8. Pin EMPTY objects must not render; they are connection anchors.
9. Export the complete component as ONE GLB.
10. Disable Draco compression.
11. Verify the resulting scene and report the exact pin names created.

Arduino Uno required pin names:
0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
A0, A1, A2, A3, A4, A5,
GND.1, GND.2, 3V3, VIN, 5V, RESET

SG90 servo required pin names:
SIGNAL, VCC, GND

IMPORTANT:
- Use BlenderMCP tools to perform the actual Blender operations.
- Do not merely describe Python code or tell the user how to do it.
- Execute the required Blender operations yourself.
- Inspect the imported geometry before placing pin anchors.
- Preserve realistic CAD geometry and materials where possible.
- Do not create fake box representations when actual STEP geometry is available.
"""

TASK = """
Convert these two STEP components into GLB assets.

Project root:
E:/Hardware-Architecture-Agent/Wireup-graphing

1. Arduino Uno:
STEP:
cad/arduino-uno-r3-1.snapshot.5/arduino uno.STEP

Output:
external/velxio/frontend/public/models3d/arduino-uno/arduino-uno.glb

Asset key:
arduino-uno

Required pins:
0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
A0, A1, A2, A3, A4, A5,
GND.1, GND.2, 3V3, VIN, 5V, RESET


2. SG90 Micro Servo:
STEP:
cad/sg90-micro-servo-9g-tower-pro-1.snapshot.3/SG90 - Micro Servo 9g - Tower Pro.STEP

Output:
external/velxio/frontend/public/models3d/sg90/sg90.glb

Asset key:
servo

Required pins:
SIGNAL, VCC, GND


For each component:
- Import the actual STEP geometry.
- Preserve 1:1 scale.
- Set millimeter units.
- Remove default Blender objects.
- Center the component.
- Identify the physical electrical connection locations from the CAD geometry.
- Create the required pin EMPTY anchors at those locations.
- Export the complete scene as GLB with Draco disabled.
- Verify the exported scene.
- Report exactly which pin EMPTY names were created.

Do the Arduino first, then the SG90.

STEP IMPORT:
The installed STEP Importer exposes this exact Blender operator:

bpy.ops.import_scene.step(filepath="ABSOLUTE_PATH_TO_STEP_FILE")

NEVER use bpy.ops.wm.stl_import for STEP files.
NEVER guess another import operator.
Use bpy.ops.import_scene.step with the exact absolute STEP path.
"""

async def main():
    bedrock = boto3.client(
        "bedrock-runtime",
        region_name=REGION,
    )

    server_params = StdioServerParameters(
        command="uvx",
        args=["blender-mcp"],
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            mcp_tools = (await session.list_tools()).tools

            tools = []

            for tool in mcp_tools:
                tools.append({
                    "toolSpec": {
                        "name": tool.name,
                        "description": tool.description or "",
                        "inputSchema": {
                            "json": tool.input_schema
                        },
                    }
                })

            print(f"Connected to Blender MCP: {len(tools)} tools")

            messages = [
                {
                    "role": "user",
                    "content": [
                        {"text": TASK}
                    ],
                }
            ]

            while True:
                response = bedrock.converse(
                    modelId=MODEL_ID,
                    system=[
                        {
                            "text": SYSTEM_PROMPT
                        }
                    ],
                    messages=messages,
                    toolConfig={
                        "tools": tools,
                        "toolChoice": {"auto": {}},
                    },
                )

                output_message = response["output"]["message"]
                messages.append(output_message)

                if response["stopReason"] != "tool_use":
                    print("\nBedrock:")
                    for block in output_message["content"]:
                        if "text" in block:
                            print(block["text"])
                    break

                tool_results = []

                for block in output_message["content"]:
                    if "toolUse" not in block:
                        continue

                    tool_use = block["toolUse"]

                    tool_name = tool_use["name"]
                    tool_input = tool_use.get("input", {})
                    tool_use_id = tool_use["toolUseId"]

                    print(f"\n→ Blender: {tool_name}")
                    print(json.dumps(tool_input, indent=2))

                    try:
                        result = await session.call_tool(
                            tool_name,
                            arguments=tool_input,
                        )

                        result_text = ""

                        for content in result.content:
                            if hasattr(content, "text"):
                                result_text += content.text

                        tool_results.append({
                            "toolResult": {
                                "toolUseId": tool_use_id,
                                "content": [
                                    {"text": result_text}
                                ],
                            }
                        })

                    except Exception as e:
                        print(f"Tool error: {e}")

                        tool_results.append({
                            "toolResult": {
                                "toolUseId": tool_use_id,
                                "status": "error",
                                "content": [
                                    {"text": str(e)}
                                ],
                            }
                        })

                messages.append({
                    "role": "user",
                    "content": tool_results,
                })


if __name__ == "__main__":
    asyncio.run(main())