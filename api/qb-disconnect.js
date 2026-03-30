// api/qb-disconnect.js — Remove a QB company connection

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { realmId, entityId } = req.body || {};
  if (!realmId) return res.status(400).json({ error: "realmId required" });

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  try {
    if (kvUrl && kvToken) {
      const { Redis } = await import("@upstash/redis");
      const kv = new Redis({ url: kvUrl, token: kvToken });
      await kv.del(`qb_token_${realmId}`);
      if (entityId) await kv.del(`qb_entity_${entityId}`);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
