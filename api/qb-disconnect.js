// api/qb-disconnect.js
// Removes a QB company connection (deletes stored tokens).

import { Redis } from "@upstash/redis";
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { realmId, entityId } = req.body || {};
  if (!realmId) return res.status(400).json({ error: "realmId required" });
  try {
    await kv.del(`qb_token_${realmId}`);
    if (entityId) await kv.del(`qb_entity_${entityId}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
