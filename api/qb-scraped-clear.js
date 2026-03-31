// api/qb-scraped-clear.js — Clear the scraped IDs cache (for debugging/reset)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    await kv.set("scraped_ids", "[]");
    await kv.set("scraped_queue", "[]");
    return res.status(200).json({ ok: true, msg: "Scraped cache cleared" });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
