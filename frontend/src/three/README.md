# True-scale 3D bench — research + contracts

## Why parts are the size they are

Every outline in `dimensions.ts` is a nominal, datasheet-sourced footprint in
metres (three.js world units). The RaTs that matter:

| Part | Outline (mm) | Source |
|---|---|---|
| Arduino Uno R3 | 68.6 × 53.4 | arduino.cc ABX00066 |
| Arduino Nano | 45 × 18 | Arduino Nano Classic |
| Arduino Mega 2560 | 101.6 × 53.4 | arduino.cc A000067 |
| ESP32 DevKitC V1 | 52 × 28 | Espressif DevKitC |
| ESP32-S3 DevKitC-1 | 48 × 25.5 | Espressif |
| ESP32-C3 SuperMini | 22.5 × 18 | retail breakout |
| XIAO ESP32 | 21 × 17.5 | Seeed Studio |
| Pi Pico (W) | 51 × 21 | Raspberry Pi Ltd |
| Blue/Black Pill | 53 × 22–24 | STM32duino |
| SSD1306 0.96" module | 27 × 27 | generic 4-pin breakout |
| LCD1602 / LCD2004 | 80 × 36 / 98 × 60 | Hitachi HD44780 class |
| SG90 servo | 23 × 12.2 × 29 | TowerPro SG90 |
| HC-SR04 | 45 × 20 | generic breakout |
| HC-SR501 PIR | 32 × 24 | dome tall |
| DHT22 module | 27 × 15 | AM2302 breakout |
| 12 mm tactile / 6 mm B3F | 12 × 12 / 6 × 6 | Omron B3F series |
| 5 mm LED | Ø5 | Kingbright L-53x class |
| 1/4 W resistor | 6.3 mm body | IEC 60115 |
| Full breadboard | 165 × 55 | MB-102 style |

So: Uno ≈ 2.5× wider than the OLED, the 6 mm button is genuinely tiny, the
breadboard dwarfs everything. Electrolytic cans grow with capacitance,
ceramics grow slightly, resistor bands decode per IEC 60062.

The planner emits the same numbers (`backend/src/data/spatialDims.ts`), so
server plans land true-scale with no client correction.

## Per-component sim adaptation (velxio → Wireup)

| Velxio source | Wireup adaptation |
|---|---|
| `sensorControlConfig.ts` ranges/defaults | `three/sensorDefs.ts` — same ranges, drives 3D panel + 2D tiles |
| `SensorUpdateRegistry` + live element props | `three/simStore.ts` — one zustand truth for bench, 3D, panel |
| `BasicParts` pushbutton (INPUT_PULLUP seed, active-low, `button-press/release`) | `sim/partSim.ts` + 3D `PressCap` — same contract |
| `BasicParts` pot wiper → ADC volts (Vref per rail) | `partSim` + `controlBindings` wiper cell + `circuitSim` volts |
| `ComplexParts` joystick (centre VCC/2, SW pull-up) | same, in `partSim` + `circuitSim` |
| `ComplexParts` servo PWM 544–2400 µs → angle | angle cell; horn renders it exactly (`ServoHorn`) |
| `SensorParts` NTC β-model divider | same formula in `circuitSim` + `sensors.tsx` note |
| `SensorParts` LDR log slider | `LOG_STEPS` curve in `controlBindings` |
| `sensorModels.ts` single-wire ownership (DHT DATA, HC-SR04 ECHO, keypad COLs, ePaper BUSY) | documented in `sensorDefs` blurbs; net solver never drives those nets from floating logic |
| `Parts3D` live-element → body animation | `parts/common.tsx` useFrame readers (no 60 fps re-renders) |
| `Wire3D` tube conductors | `Wires3D.tsx` catenary tubes coloured by connection kind |
| `runtimeBurnout.ts` LED >100 mA | documented in LED blurb + controls; solver flags the fault net |

## Logic-IC engine (circuitSim.ts)

Evaluated from datasheet pinouts every solve, pins matched by number or
name with a documented fallback order:

- **NE555 astable** — f = 1.44/((R1+2·R2)·C) from the R1/R2/C sliders
  (kΩ/µF), wall-clock phase, RESET honoured only when driven low.
- **CD4017** — clock-edge advance Q0→Q9 on the true DIP pins
  (3,2,4,7,10,1,5,6,9,11), RESET/INHIBIT, CO high for counts 0–4.
- **74HC595** — SER shifts on SRCLK↑, RCLK↑ latches, MR clears the shift
  register only (latch keeps its byte, like silicon), OE floats Q0–Q7,
  QH′ always follows the shift top so chips chain.
- **74HC165** — SH/LD low samples D0–D7 (A = bit 0 … H = bit 7, SER enters
  at A, QH reads H first), CLK ↑ shifts, QH′ is the true complement. The
  8-switches-on-3-pins companion to the 595.
- **74HC00/02/04/08/32/86 + CD4011** — full DIP packages, per-gate
  evaluation; a gate with missing inputs stays undriven, never guessed.
- Supply rule: WIRED VCC/GND pins must see supply; unwired supply pins
  assume power so legacy diagrams keep working.

Sequential state (edges, counts, registers, 555 t0) lives in module state
keyed by part id, reset on diagram change or via resetIcState().
Sampling limit: clocks are sampled when the store changes (per frame on
the bench, 4 Hz on the graph page) — a 555 faster than ~½ the sample rate
aliases, so raise C for a visible chase.

## Parts-expansion round (boards/sensors/displays/actuators/inputs)

Datasheet footprints, identity rules ordered ahead of the generic
catch-alls they would otherwise hit (D1-R32 before ESP32, 28BYJ/NEMA
before plain stepper, YL-69 before capacitive soil, TM1637 before 7-seg,
MAX7219 before NeoPixel-matrix so `8x8 neopixel` still lands right,
L298N before the L293D shield, MG996R before SG90):

- **Boards** — Wemos D1 mini (ESP-12F can), D1 R32 (Uno-size, micro-USB),
  Leonardo (Uno + micro-USB), Pro Micro 33×18, Pi 4B (dual USB stacks
  with blue USB3 insert, RJ45, 2× micro-HDMI, GPIO 2×20), Pi Zero 65×30,
  micro:bit (5×5 LEDs, A/B, gold edge fingers, JST).
- **Wireless** — RC522 (gold loop antenna), nRF24L01+ (inverted-F),
  HC-05 (daughter + breakout + EN button). No RF is simulated; the
  blurb says so.
- **Interface** — PCA9685 (16×3 grid + green terminal), ADS1115,
  TP4056 (charge red on, done green dark), LM2596 buck (toroid + 3296
  pot + IN/OUT terminals), HLK-PM01 (isolated black brick, 4 pins).
- **Motion** — MG996R (55 mm flange, 2.5 A stall note), 28BYJ-48
  (Ø28 can + 5-wire colours + D-shaft), NEMA 17 reuses the exact
  NEMA-17 Stepper mesh, TT yellow box + 130 can, coin 1027, 3010 fan
  (blades spin with the angle cell), 40 mm cone speaker, TEC1-12706
  slab, L298N (finned heatsink + 3 green terminals).
- **Touch/liquid** — TTP223 (gold pad, LED follows touch), SW-420
  (roller can + LM393), rain plate (nickel combs, wet shorts → out
  falls), YL-69 fork (dry-high, corrodes — blurb says capacitive
  lasts longer), water strip (level-high).
- **Displays** — MAX7219 8×8 (bitmap text rows, 0–15 brightness drives
  glow), TM1637 (0–9A–F + `-`, `:` toggles the colon), Nokia 5110
  (84×48 canvas texture, blue-white backlight).
- Bench honesty: all new 2D types return explicit null tags (labelled
  stub + unrendered note); backend planner footprints mirror the same
  priority order.

## True-pitch breadboard (parts/inputs.tsx)

The old board used a 5 mm hole grid. A real MB-102 is 2.54 mm pitch with
830 tie points (63×10 terminals + 4×50 rails) — 830 meshes would sink the
scene graph, so the top face is one canvas texture with every hole, rail
stripe and column number at its true position (mini SYB-170 class: 17×10,
no rails, 55×35 mm — the old mesh had the wrong depth). One draw call,
crisper than geometry.

## Studio light (SceneCanvas.tsx)

Locally rendered studio HDRI (drei Environment + Lightformers, zero
network fetches — Blender-style softboxes the PBR parts reflect), key
light with 2048px soft shadows, contact shadows, 10 mm grid. Hemisphere
rebalanced so the image-based light doesn't wash the paper aesthetic.

## Live arch nets (archAdapter.ts + ThreeViewport)

The 3D view adapts the architecture graph to a bench diagram (ids and
ports preserved) and runs the SAME solveNets()/commitSolved() pass: HIGH
wires glow green, wired LEDs follow their nets, IC readouts (q0–q9, f,
y1–y4) land in the inspector readout. Selecting a part spotlights its
nets. A real LED has no software switch — the Light toggle is gone on
purpose; on/off belongs to the circuit.

## Honesty boundaries (shown in UI, not hidden)

- Browser AVR core runs the heartbeat program only. Per-pin MCU emulation
  does not exist in the tab — virtual GPIO (`pins`/`adcVolts`) models
  continuity, pull-ups, switches, gates and sensors; the ESP32 firmware is
  compiled + simulated server-side.
- 2D tiles without a registered `@wokwi/elements` tag render as labelled
  placeholders; the 3D body is still exact. Same-family stand-ins
  (DHT11→DHT22 element, LCD2004→LCD1602 element) are captioned.
- Single-gate abstraction: multi-gate ICs (74HC00…) evaluate one gate from
  the first input nets — captioned on the tile.
