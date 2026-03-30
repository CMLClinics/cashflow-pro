// api/qb-callback.js
// Step 2: Intuit redirects here after user approves.
// Exchanges auth code for access_token + refresh_token.
// Stores tokens in Vercel KV (key-value store).

import { Redis } from "@upstash/redis";
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  const { code, state, realmId, error } = req.query;

  if (error) {
    return res.redirect(302, `/?qb_error=${encodeURIComponent(error)}`);
  }
  if (!code || !realmId) {
    return res.status(400).json({ error: "Missing code or realmId" });
  }

  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri  = process.env.QB_REDIRECT_URI;

  try {
    // Exchange auth code for tokens
    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Accept":        "application/json",
      },
      body: new URLSearchParams({
        grant_type:   "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(400).json({ error: "Token exchange failed", details: tokens });
    }

    // Store tokens keyed by realmId (one per QB company file)
    // state = entityId from our app, so we can map QB company → our entity
    const tokenData = {
      access_token:   tokens.access_token,
      refresh_token:  tokens.refresh_token,
      token_type:     tokens.token_type,
      expires_in:     tokens.expires_in,
      x_refresh_token_expires_in: tokens.x_refresh_token_expires_in,
      obtained_at:    Date.now(),
      realm_id:       realmId,
      entity_id:      state, // our internal entityId
    };

    await kv.set(`qb_token_${realmId}`, JSON.stringify(tokenData));
    // Also store a mapping: entityId → realmId for easy lookup
    await kv.set(`qb_entity_${state}`, realmId);

    // Redirect back to app with success flag
    res.redirect(302, `/?qb_connected=${encodeURIComponent(state)}&realm=${realmId}`);
  } catch (err) {
    console.error("QB callback error:", err);
    res.status(500).json({ error: "Internal error", message: err.message });
  }
}
