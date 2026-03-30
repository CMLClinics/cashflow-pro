// api/qb-sync.js — Pull transactions from QB (delta sync, deduplicated by qbId)

import { refreshTokenIfNeeded } from "./_qb-refresh.js";

const QB_BASE = "https://quickbooks.api.intuit.com";

function mapQBAccount(name) {
  if (!name) return "cat12";
  const n = name.toLowerCase();
  if (n.includes("payroll")||n.includes("salary")||n.includes("wage")) return "cat5";
  if (n.includes("rent")||n.includes("lease"))                          return "cat8";
  if (n.includes("adverti")||n.includes("market"))                      return "cat6";
  if (n.includes("software")||n.includes("subscri"))                    return "cat9";
  if (n.includes("utility")||n.includes("hydro")||n.includes("gas"))    return "cat10";
  if (n.includes("tax")||n.includes("hst")||n.includes("gst"))          return "cat11";
  if (n.includes("revenue")||n.includes("income")||n.includes("sales")) return "cat1";
  if (n.includes("membersh"))                                            return "cat2";
  return "cat12";
}

async function fetchQBTransactions(tokenData, sinceDate) {
  const token = await refreshTokenIfNeeded(tokenData);
  const { realm_id: realmId, entity_id: entityId, access_token } = token;
  const queries = [
    `SELECT * FROM Purchase WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
    `SELECT * FROM Deposit  WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
    `SELECT * FROM Invoice  WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
    `SELECT * FROM Bill     WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
  ];
  const results = [];
  for (const query of queries) {
    const url = `${QB_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
    const r = await fetch(url, { headers: { "Authorization": `Bearer ${access_token}`, "Accept": "application/json" } });
    if (!r.ok) { console.error("QB query failed:", await r.text()); continue; }
    const data = await r.json();
    const qr = data?.QueryResponse || {};
    (qr.Purchase||[]).forEach(p => results.push({ qbId:`P-${p.Id}`, qbType:"Purchase", date:p.TxnDate, description:p.PrivateNote||"QB Purchase", amount:Math.abs(parseFloat(p.TotalAmt||0)), type:"expense", categoryId:mapQBAccount(p.AccountRef?.name), entityId, realmId, source:"quickbooks" }));
    (qr.Deposit||[]).forEach(d  => results.push({ qbId:`D-${d.Id}`,  qbType:"Deposit",  date:d.TxnDate, description:d.PrivateNote||"QB Deposit",  amount:Math.abs(parseFloat(d.TotalAmt||0)), type:"income",  categoryId:mapQBAccount(d.DepositToAccountRef?.name), entityId, realmId, source:"quickbooks" }));
    (qr.Invoice||[]).filter(i=>i.Balance===0).forEach(i => results.push({ qbId:`I-${i.Id}`, qbType:"Invoice", date:i.TxnDate, description:`Invoice #${i.DocNumber||i.Id} — ${i.CustomerRef?.name||""}`, amount:Math.abs(parseFloat(i.TotalAmt||0)), type:"income", categoryId:"cat1", entityId, realmId, source:"quickbooks" }));
    (qr.Bill||[]).forEach(b    => results.push({ qbId:`B-${b.Id}`,  qbType:"Bill",    date:b.TxnDate, description:`Bill — ${b.VendorRef?.name||""}`, amount:Math.abs(parseFloat(b.TotalAmt||0)), type:"expense", categoryId:mapQBAccount(b.APAccountRef?.name), entityId, realmId, source:"quickbooks" }));
  }
  return results;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sinceDate } = req.body || {};
  const since = sinceDate || new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(200).json({ transactions:[], message:"No QB companies connected yet. Connect via Settings → Bank Sync." });
  }

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");

    if (!keys.length) return res.status(200).json({ transactions:[], message:"No QB companies connected yet." });

    const allResults = await Promise.allSettled(keys.map(async key => {
      const raw = await kv.get(key);
      const td = typeof raw === "string" ? JSON.parse(raw) : raw;
      return fetchQBTransactions(td, since);
    }));

    const transactions = [], errors = [];
    allResults.forEach((r,i) => r.status==="fulfilled" ? transactions.push(...r.value) : errors.push({ key:keys[i], error:r.reason?.message }));

    await kv.set("qb_last_sync", new Date().toISOString());
    return res.status(200).json({ transactions, errors, syncedAt: new Date().toISOString(), totalCount: transactions.length, since });
  } catch (err) {
    return res.status(500).json({ error: "Sync failed", message: err.message });
  }
}
