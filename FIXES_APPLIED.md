# Fixes Applied — Image Rendering Issues

## Issues Identified & Fixed

### 1. **Auto-rendering removed — now opt-in only**
   - **Problem:** Image was auto-generating on every page load/graph change, wasting API calls
   - **Solution:** Removed auto-trigger effects. RenderPanel now shows "Generate" button.
   - **Files:** `frontend/src/components/RenderPanel.tsx`
   - **Behavior:** 
     - Empty state → user clicks "Generate" → loads image
     - Same state persists on re-render (no spam)
     - User controls when to spend API quota

### 2. **On-demand generation with user control**
   - **Added:** Explicit "Generate" button (teal, prominent)
   - **Added:** Angle selector visible at all times
   - **Removed:** Auto-trigger on angle change
   - **Behavior:** User can change angle selector, then hit "Generate" once
   - **CSS:** New `.render-generate-btn` styling (teal, matches plan button style)

### 3. **Better diagnostics for Cloudflare calls**
   - **Files:** `backend/src/services/image/cloudflareFluxProvider.ts`
   - **Added:** Response status + statusText logging
   - **Added:** Full error response body (first 500 chars) logged
   - **Impact:** Can now see exactly what Cloudflare returns (success or error)

### 4. **Prompt builder logging**
   - **Files:** `backend/src/services/image/promptBuilder.ts`, `backend/src/services/image/renderService.ts`
   - **Added:** Component count in logs
   - **Added:** First 500 chars of prompt printed to INFO level
   - **Impact:** Can inspect the actual prompt sent to Cloudflare before API call

### 5. **Minor prompt improvement**
   - Changed "A {type} assembly" to "A {type} hardware assembly" for clarity
   - Should help FLUX understand this is a manufactured device

---

## Testing the Fix

1. **Start backend:** `npm run dev` in `backend/`
   - Watch logs for INFO level (prompt inspection)
   - Watch for "Cloudflare response received" + status code

2. **Start frontend:** `npm run dev` in `frontend/`

3. **Generate a plan** via Composer

4. **RenderPanel should show:**
   - Title + "Generate" button (prominent teal)
   - Angle selector (defaulted to three-quarter)
   - Text: "Click Generate to create a photorealistic render"

5. **Click Generate:**
   - Button becomes disabled (shows loading state)
   - Skeleton loader displays
   - Watch backend logs for prompt + Cloudflare response
   - Image appears when ready, or error if Cloudflare returns error

6. **Regenerate (force=true):**
   - Click the ↻ button that appears on success
   - Bypasses cache, calls Cloudflare again
   - Same flow as initial generation

7. **Change graph:**
   - RenderPanel reverts to idle state
   - User must click Generate again
   - This prevents auto-spawning multiple renders on edits

---

## Provider Extensibility

The architecture now supports adding more providers:

1. Create `backend/src/services/image/fal-ai-provider.ts` (implements `ImageProvider`)
2. Update `env.ts` to add `FAL_AI_API_KEY`
3. Update `providerFactory.ts` switch statement
4. Update frontend UI to show provider selector (future)

All without changing core logic. Provider is a pluggable interface.

---

## API Rate Limiting

`RENDER_RATE_LIMIT_MAX=20` (default) means 20 render requests per 60s window.
- User clicking Generate once = 1 request
- Regenerate (force) = 1 request
- Changing angle and clicking Generate = 1 request

This is independent of planning rate limit (`PLAN_RATE_LIMIT_MAX=10`).

---

## What's Logged (for debugging)

**Frontend (browser console):**
- Render state transitions (loading → ready / error / unavailable)
- API errors from backend

**Backend (server logs at INFO level):**
```
{prompt: "SUBJECT...[500 chars]..."} "Image prompt (first 500 chars)"
```

**Backend (DEBUG level, set LOG_LEVEL=debug):**
```
{graphHash, componentCount, promptLength} "Generated image prompt"
{status, statusText} "Cloudflare response received"
{graphHash} "Render cache hit, returning cached image"
{graphHash} "Image render complete"
```

---

## Files Modified

- `frontend/src/components/RenderPanel.tsx` — removed auto-trigger, added Generate button
- `frontend/src/styles/index.css` — added `.render-generate-btn` styling
- `backend/src/services/image/cloudflareFluxProvider.ts` — added diagnostics
- `backend/src/services/image/renderService.ts` — added prompt logging
- `backend/src/services/image/promptBuilder.ts` — minor text improvement

---

## Next Steps

To debug if image generation still fails:

1. **Check backend logs at INFO level:**
   ```
   LOG_LEVEL=info npm run dev
   ```

2. **Look for:**
   - "Image prompt (first 500 chars)" — see what prompt is being sent
   - "Cloudflare response received {status: 200}" — did Cloudflare accept it?
   - "Cloudflare returned error in payload" — did Cloudflare reject?
   - "Image generation failed" — which error?

3. **If Cloudflare returns error:**
   - Check token is valid at https://dash.cloudflare.com/
   - Check account ID matches credentials
   - Try calling Cloudflare manually via curl/Postman

4. **If Cloudflare succeeds but image is wrong:**
   - Expand "What I described" in UI to see full prompt
   - Adjust prompt in `promptBuilder.ts` (materials, arrangement, camera block)

---

**Status:** Code verified (typecheck clean). Ready to test end-to-end.
