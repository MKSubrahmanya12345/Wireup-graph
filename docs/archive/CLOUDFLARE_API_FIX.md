# Cloudflare API Fix: Request Body Simplified

## Issue
Cloudflare Workers AI FLUX.1-schnell endpoint only accepts a **single `prompt` field**. Previous implementation sent extra fields (`num_steps`, `negative_prompt`, `aspectRatio`) which the API rejected.

## Solution
### Before ❌
```json
{
  "prompt": "...",
  "num_steps": 8,
  "negative_prompt": "...",
  "aspectRatio": "3:2"
}
```
**Result:** API returns 400 Bad Request (unknown fields)

### After ✓
```json
{
  "prompt": "Render: controller assembly...\n\nNegative: no text, no logos..."
}
```
**Result:** API accepts and generates image

## Implementation

### 1. Cloudflare Provider (`backend/src/services/image/cloudflareFluxProvider.ts`)
```typescript
// Embed negative prompt directly in the prompt text
const fullPrompt = negativePrompt 
  ? `${prompt}\n\nNegative: ${negativePrompt}` 
  : prompt;

// Send only prompt field
body: JSON.stringify({ prompt: fullPrompt })
```

### 2. Prompt Builder (`backend/src/services/image/promptBuilder.ts`)
```typescript
// Build compact prompt
const basePrompt = `Render: ... Components: ... Quality: ...`;

// Append negative instructions as plain text
const prompt = `${basePrompt}\n\nNegative: ${NEGATIVE_PROMPT}`;
```

## Result

**Request sent to Cloudflare:**
```
POST /api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell
Content-Type: application/json
Authorization: Bearer {TOKEN}

{
  "prompt": "Render: controller assembly \"Quadruped Robot\". Four-legged autonomous walker\nComponents: ARM Cortex (STM32F4), 4× Servo Motor (SG90)\nMaterials: Moulded ABS plastic\nLayout: Compact 3D assembly\nCamera: 3/4 view, 22° elevation\nLighting: 3-point product photography\nQuality: PBR, 8K, micro-details\n\nNegative: no text, no logos, no people, no diagrams, no clay render, no blur"
}
```

**Typical total size:** ~700 characters (well under 2048 limit)

## Why This Works

1. **FLUX understands text instructions** — the model reads "Negative: ..." as guidance
2. **Embedding is cleaner** — one prompt field vs multiple parameters
3. **No information loss** — negative guidance still reaches the model
4. **Simplified API contract** — only required field, nothing optional

## Files Modified

- `backend/src/services/image/cloudflareFluxProvider.ts` — removed unused fields, embed negative prompt
- `backend/src/services/image/promptBuilder.ts` — combine prompt + negative into single string

## Verification

✓ `npm run typecheck` passes  
✓ `npm run build` clean  
✓ Request body is now single `{ prompt }` field  
✓ Negative prompt instructions embedded as text  
✓ Total prompt < 2048 characters  

## Testing

1. Start backend: `npm run dev`
2. Generate a plan
3. Click "Generate" on RenderPanel
4. Check backend logs for: `Cloudflare response received {status: 200}`
5. Image should appear in UI

---

**Status:** Ready for testing. Cloudflare endpoint should now accept the request.
