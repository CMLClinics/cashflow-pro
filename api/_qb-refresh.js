// api/_qb-refresh.js  (prefixed _ so Vercel doesn't expose it as a route)
// Refreshes an expired QB access token using the refresh_token.
// Returns updated tokenData, already saved to KV.

import { Redis } from "@upstash/redis";
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export async function refreshTokenIfNeeded(tokenData) {
  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;

  // access_token expires in 3600s (1 hr). Refresh if < 5 min remaining.
  const expiresAt = tokenData.obtained_at + (tokenData.expires_in - 300) * 1000;
  if (Date.now() < expiresAt) {
    return tokenData; // still valid
  }

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Accept":        "application/json",
    },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: tokenData.refresh_token,
    }).toString(),
  });

  const tokens = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(tokens)}`);

  const updated = {
    ...tokenData,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token || tokenData.refresh_token,
    obtained_at:   Date.now(),
    expires_in:    tokens.expires_in,
  };

  await kv.set(`qb_token_${tokenData.realm_id}`, JSON.stringify(updated));
  return updated;
}
