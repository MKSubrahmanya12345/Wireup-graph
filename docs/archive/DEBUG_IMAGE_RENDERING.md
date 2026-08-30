# Debugging Image Rendering

## Quick Test Flow

1. **Start backend with debug logging:**
   ```powershell
   cd backend
   $env:LOG_LEVEL = "debug"
   npm run dev
   ```

2. **Start frontend in another terminal:**
   ```powershell
   cd frontend
   npm run dev
   ```

3. **Generate a plan:**
   - Go to http://localhost:5173
   - Enter a brief like "8-servo quadruped robot with battery"
   - Click "Generate architecture"
   - Wait for plan to complete

4. **Trigger image render:**
   - Scroll down to "Photorealistic render" panel
   - You should see "Generate" button (teal)
   - Click it

5. **Watch the flow:**

   **Backend logs should show (in order):**
   ```
   [INFO] {prompt: "SUBJECT...[first 500 chars]..."} Image prompt (first 500 chars)
   [DEBUG] {graphHash, componentCount: 8, promptLength: 2850} Generated image prompt
   [DEBUG] {provider: "cloudflare-flux-1-schnell", promptLength: 2850} Cloudflare image generation starting
   [DEBUG] {status: 200, statusText: "OK"} Cloudflare response received
   [DEBUG] {provider: "cloudflare-flux-1-schnell"} Cloudflare image generation completed
   [DEBUG] {graphHash: "abc123..."} Image render complete
   ```

   **Frontend UI should show:**
   - Loading skeleton (pulsing gray boxes)
   - Then the generated image (3:2 ratio)
   - "Rendered from data · 8 components · illustrative"
   - "What I described" link to expand prompt

---

## If Image Generation Fails

### Error: "Cloudflare API error (401)"
- **Cause:** API token is invalid or expired
- **Fix:** 
  1. Go to https://dash.cloudflare.com/profile/api-tokens
  2. Find your token, regenerate if needed
  3. Update `backend/.env` with new token
  4. Restart backend

### Error: "Cloudflare API error (403)"
- **Cause:** Account ID doesn't match credentials
- **Fix:**
  1. Go to https://dash.cloudflare.com/
  2. Look at URL: `https://dash.cloudflare.com/{ACCOUNT_ID}/`
  3. Copy that ID
  4. Update `backend/.env` CLOUDFLARE_ACCOUNT_ID
  5. Restart backend

### Error: "Cloudflare API error (400)"
- **Cause:** Request body is malformed or prompt is invalid
- **In logs:** Look at the response body (first 500 chars)
- **Check:**
  - Is `prompt` field present and non-empty? (yes, should see in INFO log)
  - Is `num_steps` = 8? (yes, hardcoded)
  - Is JSON valid? (yes, we stringify it)
- **Try:** Manually call Cloudflare with curl:
  ```bash
  curl -X POST \
    https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell \
    -H "Authorization: Bearer {TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
      "prompt": "A simple test prompt",
      "num_steps": 8
    }'
  ```

### Error: "Cloudflare returned no image"
- **Cause:** Response didn't include `result.image`
- **In logs:** Print the full response object
- **Fix in code:** 
  1. Add this after `const payload = (await response.json())`:
     ```typescript
     logger.error({ payload }, 'Full Cloudflare response');
     ```
  2. Restart and retry
  3. Check logs for actual response structure

### UI shows "Loading..." forever
- **Cause:** API call is hanging or never completes
- **Check:**
  1. Is backend running? (`http://localhost:5000/api/healthz`)
  2. Are there any CORS errors in browser console?
  3. Check backend logs — is the request even arriving?
  4. Check network tab in DevTools — what's the request status?

### UI shows "Image generation unavailable"
- **Cause:** Provider failed or couldn't be initialized
- **In backend logs:**
  - Look for "Failed to initialize image provider"
  - Or "Image generation failed"
  - Will say which error
- **Check:**
  - Is `IMAGE_PROVIDER=cloudflare` set?
  - Are credentials set (not empty)?
  - Is provider factory working? (add logging if needed)

---

## Accessing Logs

### Backend logs (terminal where `npm run dev` is running):
- Look for timestamps + [INFO]/[DEBUG]/[ERROR] levels
- Pino format: `{key: value, ...}` followed by message
- Set `LOG_LEVEL=debug` for verbose output
- Set `LOG_LEVEL=error` to quiet it down

### Frontend logs (browser DevTools):
- Open DevTools (F12)
- Console tab shows `console.error()` calls
- Network tab shows `/api/architecture/render` request + response
- Check Response tab to see JSON returned from backend

---

## Manual Cache Invalidation

If you want to force a fresh render without changing the graph:

1. Click the ↻ **Regenerate** button (appears after first successful render)
2. Or add `?cache-bust=true` to the URL (doesn't actually work, use button)

Cache is automatically invalidated when:
- Graph nodes change
- Node names/parts change
- Graph summary changes
- Any connection changes

---

## Provider Selection (Future)

Currently hardcoded to Cloudflare. To add fal.ai later:

1. Create `backend/src/services/image/fal-ai-provider.ts`
2. Add `FAL_AI_API_KEY` to env
3. Update `providerFactory.ts` to detect provider from env
4. Update frontend to show provider selector
5. Test with both providers

For now, Cloudflare is the only implemented provider.

---

## Performance Tips

- **Image generation takes 5-15 seconds** — UI shows loading state, this is normal
- **Cache saves repeated calls** — same graph = same image, no API call
- **Rate limiting is 20 req/min** — enough for interactive use
- **Disable image rendering** in test: just don't click Generate button

---

## Final Checklist Before Deploying

- [ ] Cloudflare account ID is correct
- [ ] Cloudflare API token is valid (not expired)
- [ ] `LOG_LEVEL=info` for production (debug is too verbose)
- [ ] Test image generation once with a simple graph
- [ ] Verify cache hit on second render (same graph)
- [ ] Verify regenerate (↻) forces new generation
- [ ] Check no API keys in frontend bundle: `grep -r CLOUDFLARE dist/`

---

**Questions?** Check backend logs with `LOG_LEVEL=debug` — they'll show exactly where it fails.
