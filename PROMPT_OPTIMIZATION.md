# Prompt Optimization for Cloudflare (2048 char limit)

## Problem
Cloudflare FLUX.1-schnell has a **2048 character limit** for prompts. The original prompt format was ~2500+ chars, exceeding the limit and causing failures.

## Solution
Completely rewrote the prompt builder to be ultra-compact while preserving accuracy:

### Original Format (TOO LONG)
```
SUBJECT
A controller hardware assembly: "Quadruped Robot". ...

EXACT COMPONENTS — render every one, no more, no fewer
1× ARM Cortex (STM32F4) — Main processor
4× Servo Motor (SG90) — Joint control
...

MATERIALS & FINISH
Moulded ABS plastic with nylon horn actuators.
...

ARRANGEMENT
...
```
**Result:** ~2500-3000 chars (exceeds limit ❌)

### New Compact Format
```
Render: controller assembly "Quadruped Robot". Four-legged autonomous walker with onboard controller
Components: ARM Cortex (STM32F4), 4× Servo Motor (SG90), IMU Sensor (MPU6050), Li-Po Battery (2S4000mAh), Resistor Network (10k pullup)
Materials: Moulded ABS plastic with nylon horn actuators
Layout: Compact 3D assembly with servos on legs, controller central
Camera: 3/4 view, 22° elevation, 35mm, eye-level
Lighting: 3-point product photography, soft shadows, grey cyclorama
Quality: PBR, 8K, micro-details, real hardware look
no text, no logos, no people, no diagrams, no clay render, no blur
```
**Result:** ~600 chars (well under limit ✓)

## Key Changes

### 1. **Single-line format**
- Removed verbose section headers (SUBJECT, MATERIALS & FINISH, ARRANGEMENT, etc.)
- Each concept on one line, colon-separated

### 2. **Components on one line**
- Old: 8 lines for 8 servos
- New: `4× Servo Motor (SG90)` comma-separated with others
- Still preserves grouping and part numbers

### 3. **Materials condensed**
- Old: Multi-line material list with detailed finishes
- New: Single line with primary material type
- FLUX gets the key info (ABS, steel, aluminum, etc.)

### 4. **Camera block abbreviated**
- Old: 3 sentences of camera description
- New: `Camera: 3/4 view, 22° elevation, 35mm, eye-level`
- Concise but complete

### 5. **Lighting simplified**
- Old: 3 sentences of 3-point lighting with positions
- New: `Lighting: 3-point product photography, soft shadows, grey cyclorama`
- Captures intent in 10 words

### 6. **Quality hints retained**
- `PBR, 8K, micro-details, real hardware look`
- Essential keywords for FLUX quality

### 7. **Negative prompt stripped to essentials**
- Old: 2 sentences
- New: `no text, no logos, no people, no diagrams, no clay render, no blur`
- Covers all critical negatives

## Prompt Size Verification

**Typical quadruped robot example:**
- 8 components grouped to 5 entries
- Full materials + arrangement inference
- **Result: 599 characters**
- **Headroom: 1,449 characters (71% unused)**

Even with longer project names and summaries, typical graphs stay under **1000 characters**.

## What's Preserved

✓ **Exact component counts** — `4×` prefix still present  
✓ **Part numbers** — `(SG90)` still in the string  
✓ **Component names** — all preserved  
✓ **Material types** — primary materials still named  
✓ **Camera angle** — 3/4 view specified  
✓ **Lighting style** — 3-point photography  
✓ **Quality hints** — PBR, 8K, details  
✓ **Negative prompt** — key restrictions  

## What's Sacrificed (Acceptable)

✗ **Detailed descriptions** — no node-level descriptions sent  
✗ **Arrangement derivation** — simplified to "Compact 3D assembly"  
✗ **Verbose section headers** — space saved  
✗ **Exact camera math** — "22° elevation" vs "22 degrees above horizon"  
✗ **Subsurface scattering mentions** — implicit in "real hardware look"  

## Trade-off Analysis

**Why this is OK:**
1. FLUX 1-schnell is fast but less precise than DALL-3. Verbose prompts don't help much.
2. The model is good at inferring hardware details from material + component names
3. "4× SG90" is information-dense; FLUX understands this means 4 servos
4. Compact prompts leave room for future additions (angle selector, custom styles)
5. The graph is ground truth; the image is illustrative

## Future Flexibility

With ~1500 unused characters, we can add:
- **Angle variations:** "front view" vs "3/4 view" + extended layout
- **Custom styles:** "weathered" vs "pristine" finish
- **Scale hints:** "small PCB-mounted assembly" vs "large tabletop device"
- **Color preferences:** "black and grey" vs "blue and white"

Without hitting the 2048 limit.

## Testing

To verify the prompt fits:

1. Generate a plan with 8+ components
2. Click "Generate" on RenderPanel
3. Expand "What I described" to see the full prompt
4. Character count should be **< 1000** (usually 600-800)

If a prompt ever exceeds 2048, the code will silently truncate it:
```typescript
const truncatedPrompt = prompt.slice(0, 2048);
```

This ensures the Cloudflare API never rejects the request due to size.

---

**Result:** Cloudflare now receives valid, compact, effective prompts. ✓
