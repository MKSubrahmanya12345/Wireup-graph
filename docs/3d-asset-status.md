# 3D asset status board

Shared claim/status checklist for the CAD 3D catalog. **Claim a row before you
start** (status → `claimed`, assignee → you) so two people never model the same
part. When done: status → `done`, add the source URL/licence, and open a PR.

Process guide: `docs/models3d-workflow.md`
Builder: `external/velxio/frontend/public/models3d/build_models3d.py`
Model location: `external/velxio/frontend/public/models3d/<key>/<key>.glb`
CAD source location: `cad/<key>/<key>.step` (or `.stl`)

## Tier 1 — parts the Wireup pipeline emits (do first)

metadataId = Velxio component key; wire pins = element `pinInfo` names (see
workflow doc §2).

| metadataId | status | assignee | source URL / licence | pin notes |
| --- | --- | --- | --- | --- |
| servo | ✅ done | — | CAD snapshot in `cad/` | SIGNAL/VCC/GND + PWM/V+ aliases; horn animates |
| dht22 | ✅ done | arena-agent | user-provided STL `cad/dht22/dht22.stl` (licence: as-provided) | VCC SDA NC GND; anchors on 2.54 mm header blades, NC = unpopulated slot; live temp/humidity mirrored to render store |
| hc-sr04 | open | | | VCC TRIG ECHO GND |
| pir-motion-sensor | open | | | VCC OUT GND |
| ssd1306 | open | | | DATA CLK DC RST CS 3V3 VIN GND |
| led | open | | | A C (generic → primitive) |
| buzzer | open | | | 1 2 |
| pushbutton | open | | | 1.l 2.l 1.r 2.r |
| potentiometer | open | | | GND SIG VCC |
| photoresistor-sensor | open | | | VCC GND DO AO |
| ntc-temperature-sensor | open | | | GND VCC OUT |
| mpu6050 | open | | | INT AD0 XCL XDA SDA SCL GND VCC |
| lcd1602 | open | | | i2c: GND VCC SDA SCL · full: VSS VDD V0 RS RW E D0–D7 |
| neopixel | open | | | VDD DOUT VSS DIN |
| resistor | open | | | 1 2 (generic → primitive) |
| bmp280 | open | | | SDA SCL GND VCC |
| gas-sensor | open | | | AOUT DOUT GND VCC |
| relay | open | | | COIL+ COIL− NO COM NC |
| ks2e-m-dc5 | open | | | NO2 NC2 P2 COIL2 NO1 NC1 P1 COIL1 |

## Tier 2 — boards in the Velxio picker

| boardKind | status | assignee | source URL / licence | pin notes |
| --- | --- | --- | --- | --- |
| arduino-uno | ✅ done | — | official A000066-cad-files.zip | 26 contract pins |
| arduino-nano | open | | official / GrabCAD | check `ArduinoNano.tsx` pinInfo |
| arduino-mega | open | | official / GrabCAD | check `ArduinoMega.tsx` pinInfo |
| raspberry-pi-pico | open | | official RPi step zip | check `NanoRP2040/RP2040` pinInfo |
| raspberry-pi-3 | open | | GrabCAD (official board STEPs are scarce) | check board def |
| raspberry-pi-4 | open | | GrabCAD | |
| raspberry-pi-5 | open | | GrabCAD | |
| esp32 | open | | GrabCAD DevKitC V4 | check `Esp32` pinInfo (D0–D33, 3V3, GND.1/2, VIN) |
| esp32-s3 | open | | GrabCAD | |
| esp32-c3 | open | | GrabCAD | |
| stm32-bluepill | open | | GrabCAD | check board def |
| stm32-blackpill | open | | GrabCAD | |

## Tier 3 — remaining catalog

Enumerate and bulk-claim from
`external/velxio/frontend/public/components-metadata.json`:

```bash
jq -r '.components[] | "\(.id)  \(.name)  \(.category)"' \
  external/velxio/frontend/public/components-metadata.json
```

Add rows here (same table shape) as people take them.