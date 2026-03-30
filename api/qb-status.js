// api/qb-status.js — Return all connected QB companies with names

export default async function handler(req, res) {
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(200).json({ connections: [], lastSync: null });
  }

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");

    const connections = await Promise.all(keys.map(async key => {
      const raw  = await kv.get(key);
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!data) return null;
      const refreshExp = data.obtained_at + (data.x_refresh_token_expires_in || 8726400) * 1000;
      return {
        realmId:      data.realm_id,
        entityId:     data.entity_id,
        companyName:  data.company_name || "Unknown",
        needsReauth:  Date.now() > refreshExp,
      };
    }));

    const lastSync = await kv.get("qb_last_sync");
    return res.status(200).json({
      connections: connections.filter(Boolean),
      lastSync,
    });
  } catch (err) {
    return res.status(200).json({ connections: [], lastSync: null, error: err.message });
  }
}
