// api/import-scraped.js
// Receives transactions from the Chrome extension scraper
// Deduplicates by qbScraperId and stores them

export default async function handler(req, res) {
  // Allow CORS from extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { transactions, company } = req.body || {};
  if (!transactions || !Array.isArray(transactions)) {
    return res.status(400).json({ error: "transactions array required" });
  }

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: "KV not configured" });
  }

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });

    // Get existing scraped IDs to deduplicate
    const existingRaw = await kv.get("scraped_ids") || "[]";
    const existingIds = new Set(typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw);

    // Filter to only new transactions
    const newTxns = transactions.filter(t => t.qbScraperId && !existingIds.has(t.qbScraperId));

    if (newTxns.length > 0) {
      // Store new IDs
      newTxns.forEach(t => existingIds.add(t.qbScraperId));
      await kv.set("scraped_ids", JSON.stringify([...existingIds].slice(-10000))); // keep last 10k IDs

      // Store transactions in a queue for the app to pick up
      const queueRaw = await kv.get("scraped_queue") || "[]";
      const queue = typeof queueRaw === "string" ? JSON.parse(queueRaw) : queueRaw;
      queue.push(...newTxns.map(t => ({
        ...t,
        id: t.qbScraperId,
        status: "actual",
        categoryId: "",
        source: "qb-scraper",
        importedAt: new Date().toISOString(),
      })));
      await kv.set("scraped_queue", JSON.stringify(queue.slice(-5000))); // keep last 5k

      console.log(`Stored ${newTxns.length} new scraped transactions for ${company?.name}`);
    }

    return res.status(200).json({
      ok: true,
      received: transactions.length,
      newCount: newTxns.length,
      duplicate: transactions.length - newTxns.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
