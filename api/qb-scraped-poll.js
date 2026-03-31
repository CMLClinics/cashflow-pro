// api/qb-scraped-poll.js
// App polls this to pick up transactions sent by Chrome extension

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(200).json({ transactions: [] });

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });

    const queueRaw = await kv.get("scraped_queue");
    const queue = queueRaw ? (typeof queueRaw === "string" ? JSON.parse(queueRaw) : queueRaw) : [];

    // Clear the queue after reading
    if (queue.length > 0) await kv.set("scraped_queue", "[]");

    return res.status(200).json({ transactions: queue, count: queue.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, transactions: [] });
  }
}
