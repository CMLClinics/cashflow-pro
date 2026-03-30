// api/_qb-refresh.js — Refresh expired QB access token

export async function refreshTokenIfNeeded(tokenData) {
  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const kvUrl        = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken      = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  const expiresAt = tokenData.obtained_at + (tokenData.expires_in - 300) * 1000;
  if (Date.now() < expiresAt) return tokenData;

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Accept":        "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokenData.refresh_token }).toString(),
  });

  const tokens = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(tokens)}`);

  const updated = { ...tokenData, access_token: tokens.access_token, refresh_token: tokens.refresh_token || tokenData.refresh_token, obtained_at: Date.now(), expires_in: tokens.expires_in };

  if (kvUrl && kvToken) {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    await kv.set(`qb_token_${tokenData.realm_id}`, JSON.stringify(updated));
  }
  return updated;
}
