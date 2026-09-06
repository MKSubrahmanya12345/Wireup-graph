/**
 * materials.ts — one PBR look for the whole bench.
 *
 * Blender-level does not mean textures downloaded from the internet; it
 * means consistent, physically-plausible materials: soldermask greens with
 * high roughness, tinned copper with high metalness, black IC epoxy almost
 * matte, LED lenses transmissive-looking (transparent + emissive), screen
 * glass near-black with emissive content, brushed steel for cans.
 *
 * All values are plain props spread onto <meshStandardMaterial/> — no new
 * dependencies, no HDRIs, no external assets.
 */

export const PCB_GREEN = '#0f7a3d';
export const PCB_BLUE = '#1d4fd7';
export const PCB_BLACK = '#17191d';
export const PCB_RED = '#b01e24';
export const SILK = '#f2f4f1';
export const COPPER = '#c87f3a';
export const GOLD_PIN = '#d8b25a';
export const TIN = '#c9ced4';
export const CHIP_EPOXY = '#14161a';
export const PLASTIC_BLACK = '#20242a';
export const PLASTIC_WHITE = '#f2efe9';
export const STEEL = '#9aa3ad';
export const ALUMINIUM = '#c9ced4';
export const BREADBOARD = '#f2efe9';
export const BENCH_TOP = '#e3ddd0';
export const SERVO_ORANGE = '#e8722a';
export const BUTTON_RED = '#d63a2f';
export const KNOB_CREAM = '#e8dcc3';
export const LCD_GREEN_BG = '#9db33c';
export const LCD_BLUE_BG = '#1a5fb4';
export const OLED_GLASS = '#05070c';

export interface Std {
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

/** Soldermask PCB top. */
export const pcb = (color: string = PCB_GREEN): Std => ({
  color,
  roughness: 0.62,
  metalness: 0.08,
});

/** Tinned header pin / lead. */
export const pin: Std = { color: TIN, roughness: 0.28, metalness: 0.9 };

/** Gold-plated edge / pad. */
export const gold: Std = { color: GOLD_PIN, roughness: 0.32, metalness: 0.85 };

/** Black IC epoxy. */
export const chip: Std = { color: CHIP_EPOXY, roughness: 0.42, metalness: 0.1 };

/** Matte plastic housing. */
export const plastic = (color: string = PLASTIC_BLACK): Std => ({
  color,
  roughness: 0.58,
  metalness: 0.05,
});

/** Brushed metal can / shield. */
export const steel: Std = { color: STEEL, roughness: 0.3, metalness: 0.85 };

export const aluminium: Std = { color: ALUMINIUM, roughness: 0.38, metalness: 0.75 };

/** Silkscreen white. */
export const silk: Std = { color: SILK, roughness: 0.85, metalness: 0 };

/** Lit element — LEDs, screens, backlights. */
export const lit = (color: string, intensity = 1.6): Std => ({
  color,
  emissive: color,
  emissiveIntensity: intensity,
  roughness: 0.25,
  metalness: 0,
});

/** LED lens name → hex. Matches @wokwi/elements colour names. */
export function ledHex(name: string | undefined): string {
  switch ((name ?? 'red').toLowerCase()) {
    case 'green':
      return '#22c55e';
    case 'blue':
      return '#3b82f6';
    case 'yellow':
      return '#eab308';
    case 'orange':
      return '#f97316';
    case 'white':
      return '#f8fafc';
    case 'purple':
      return '#a855f7';
    default:
      return '#ef2b2b';
  }
}

/** IEC 60062 digit → band colour. */
const BAND_DIGITS = [
  '#111111', // 0 black
  '#6b4226', // 1 brown
  '#d62626', // 2 red
  '#e8722a', // 3 orange
  '#eab308', // 4 yellow
  '#22c55e', // 5 green
  '#3b82f6', // 6 blue
  '#a855f7', // 7 violet
  '#9ca3af', // 8 grey
  '#f8fafc', // 9 white
];

/**
 * Decode a resistor value string ("10k", "4k7", "220", "1M") into the three
 * significant-digit colour bands + gold tolerance. Returns null when the
 * value is not parseable — the mesh then renders plain beige.
 */
export function resistorBands(value: string | undefined): [string, string, string] | null {
  if (!value) return null;
  const m = /^([0-9]+)(?:[.,]([0-9]+))?\s*([km]?)\s*(?:Ω|ohm|ohms)?$/i.exec(value.trim());
  if (!m) return null;
  const int = m[1];
  const frac = m[2] ?? '';
  const mult = m[3].toLowerCase();
  let ohms = parseFloat(`${int}.${frac || '0'}`);
  if (mult === 'k') ohms *= 1_000;
  else if (mult === 'm') ohms *= 1_000_000;
  if (!Number.isFinite(ohms) || ohms <= 0) return null;
  // Normalise to two significant digits + decimal multiplier.
  const exp = Math.floor(Math.log10(ohms));
  const sig = Math.round(ohms / Math.pow(10, exp - 1));
  const d1 = Math.floor(sig / 10) % 10;
  const d2 = sig % 10;
  const multExp = exp - 1;
  const multBand =
    multExp >= 0 && multExp <= 6
      ? BAND_DIGITS[multExp]
      : multExp === -1
        ? '#d8b25a' // gold ×0.1
        : '#c0c0c0'; // silver ×0.01
  return [BAND_DIGITS[d1], BAND_DIGITS[d2], multBand];
}
