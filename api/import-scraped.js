// api/import-scraped.js — Receives transactions from Chrome extension

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { transactions, company } = req.body || {};
  if (!transactions?.length) return res.status(200).json({ ok:true, newCount:0, duplicate:0 });

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error:"KV not configured" });

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });

    // Get existing IDs — these are IDs already delivered to the app
    const raw = await kv.get("scraped_delivered_ids").catch(()=>null);
    const deliveredIds = new Set(raw ? (typeof raw==="string" ? JSON.parse(raw) : raw) : []);

    // Filter: only send transactions not yet delivered
    const newTxns = transactions.filter(t => t.qbScraperId && !deliveredIds.has(t.qbScraperId));
    const duplicate = transactions.length - newTxns.length;

    if (newTxns.length > 0) {
      // Add to queue for app to pick up
      const queueRaw = await kv.get("scraped_queue").catch(()=>null);
      const queue = queueRaw ? (typeof queueRaw==="string" ? JSON.parse(queueRaw) : queueRaw) : [];

      const toAdd = newTxns.map(t => ({
        ...t,
        id: t.qbScraperId,
        status: "actual",
        importedAt: new Date().toISOString(),
      }));
      queue.push(...toAdd);
      await kv.set("scraped_queue", JSON.stringify(queue.slice(-5000)));

      // Mark as delivered
      newTxns.forEach(t => deliveredIds.add(t.qbScraperId));
      await kv.set("scraped_delivered_ids", JSON.stringify([...deliveredIds].slice(-20000)));

      console.log(`Queued ${newTxns.length} new txns from ${company?.name}`);
    }

    return res.status(200).json({ ok:true, newCount:newTxns.length, duplicate });
  } catch(err) {
    console.error("import-scraped error:", err);
    return res.status(500).json({ error: err.message });
  }
}
