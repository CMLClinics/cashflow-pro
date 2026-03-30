// api/qb-assign.js — Reassign a connected QB company to a different entity

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { realmId, entityId } = req.body || {};
  if (!realmId || !entityId) return res.status(400).json({ error: "realmId and entityId required" });

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  try {
    if (kvUrl && kvToken) {
      const { Redis } = await import("@upstash/redis");
      const kv = new Redis({ url: kvUrl, token: kvToken });
      const raw = await kv.get(`qb_token_${realmId}`);
      if (raw) {
        const data = typeof raw === "string" ? JSON.parse(raw) : raw;
        // Update old entity mapping
        if (data.entity_id && data.entity_id !== entityId) {
          await kv.del(`qb_entity_${data.entity_id}`);
        }
        // Save updated token with new entityId
        await kv.set(`qb_token_${realmId}`, JSON.stringify({ ...data, entity_id: entityId }));
        await kv.set(`qb_entity_${entityId}`, realmId);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
