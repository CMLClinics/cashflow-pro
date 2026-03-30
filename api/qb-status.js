// api/qb-status.js
// Returns list of connected QB companies with their connection status.
// Frontend calls this on load to show green/red dots in Settings → Bank Sync.

import { Redis } from "@upstash/redis";
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  try {
    const keys = await kv.keys("qb_token_*");
    const connections = await Promise.all(
      keys.map(async (key) => {
        const raw = await kv.get(key);
        const data = typeof raw === "string" ? JSON.parse(raw) : raw;
        const expiresAt   = data.obtained_at + data.expires_in * 1000;
        const refreshExp  = data.obtained_at + (data.x_refresh_token_expires_in || 8726400) * 1000;
        return {
          realmId:          data.realm_id,
          entityId:         data.entity_id,
          accessExpired:    Date.now() > expiresAt,
          refreshExpired:   Date.now() > refreshExp,
          refreshExpiresAt: new Date(refreshExp).toISOString(),
          needsReauth:      Date.now() > refreshExp,
        };
      })
    );
    const lastSync = await kv.get("qb_last_sync");
    return res.status(200).json({ connections, lastSync });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
