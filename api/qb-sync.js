// api/qb-sync.js — Delta sync, only pulls transactions for linked accounts

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

async function fetchQBTransactions(tokenData, sinceDate, linkedQBAccountIds) {
  const token = await refreshTokenIfNeeded(tokenData);
  const { realm_id: realmId, entity_id: entityId, access_token } = token;
  const headers = { "Authorization": `Bearer ${access_token}`, "Accept": "application/json" };
  const base = `${QB_BASE}/v3/company/${realmId}`;

  const results = [];

  // If we have linked account IDs, query per account for efficiency
  // Otherwise skip — don't pull unlinked accounts
  if (!linkedQBAccountIds || linkedQBAccountIds.length === 0) {
    console.log(`Entity ${entityId}: no linked QB accounts — skipping sync`);
    return [];
  }

  // Build account filter for QB query
  // QB uses account Id in WHERE clause
  const acctFilter = linkedQBAccountIds.map(id => `AccountRef = '${id}'`).join(" OR ");

  const queries = [
    { q: `SELECT * FROM Purchase WHERE TxnDate >= '${sinceDate}' AND (${acctFilter}) MAXRESULTS 1000`, type: "Purchase" },
    { q: `SELECT * FROM Deposit  WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`, type: "Deposit" },
    { q: `SELECT * FROM Invoice  WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`, type: "Invoice" },
    { q: `SELECT * FROM Bill     WHERE TxnDate >= '${sinceDate}' AND (${acctFilter}) MAXRESULTS 1000`, type: "Bill" },
  ];

  for (const { q, type } of queries) {
    try {
      const url = `${base}/query?query=${encodeURIComponent(q)}&minorversion=65`;
      const r = await fetch(url, { headers });
      if (!r.ok) { console.error(`QB ${type} failed:`, r.status); continue; }
      const data = await r.json();
      const qr = data?.QueryResponse || {};

      (qr.Purchase||[]).forEach(p => {
        const qbAccountId = p.AccountRef?.value;
        if (!linkedQBAccountIds.includes(qbAccountId)) return; // skip unlinked
        results.push({ qbId:`P-${p.Id}`, qbType:"Purchase", qbAccountId, date:p.TxnDate, description:p.PrivateNote||p.PaymentType||p.EntityRef?.name||"QB Purchase", amount:Math.abs(parseFloat(p.TotalAmt||0)), type:"expense", categoryId:"", entityId, realmId, source:"quickbooks" });

      });

      (qr.Deposit||[]).forEach(d => {
        const qbAccountId = d.DepositToAccountRef?.value;
        if (!linkedQBAccountIds.includes(qbAccountId)) return;
        results.push({ qbId:`D-${d.Id}`, qbType:"Deposit", qbAccountId, date:d.TxnDate, description:d.PrivateNote||"QB Deposit", amount:Math.abs(parseFloat(d.TotalAmt||0)), type:"income", categoryId:"", entityId, realmId, source:"quickbooks" });
      });

      (qr.Invoice||[]).filter(i=>i.Balance===0).forEach(i => {
        // Invoices go to first linked account for that entity
        results.push({ qbId:`I-${i.Id}`, qbType:"Invoice", qbAccountId:linkedQBAccountIds[0], date:i.TxnDate, description:`Invoice #${i.DocNumber||i.Id} — ${i.CustomerRef?.name||""}`, amount:Math.abs(parseFloat(i.TotalAmt||0)), type:"income", categoryId:"", entityId, realmId, source:"quickbooks" });

      });

      (qr.Bill||[]).forEach(b => {
        const qbAccountId = b.APAccountRef?.value;
        if (!linkedQBAccountIds.includes(qbAccountId)) return;
        results.push({ qbId:`B-${b.Id}`, qbType:"Bill", qbAccountId, date:b.TxnDate, description:`Bill — ${b.VendorRef?.name||""}`, amount:Math.abs(parseFloat(b.TotalAmt||0)), type:"expense", categoryId:"", entityId, realmId, source:"quickbooks" });
      });
    } catch(e) { console.error(`QB ${type} error:`, e.message); }
  }
  return results;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sinceDate, accounts } = req.body || {};
  const since = sinceDate || new Date(Date.now() - 90*24*60*60*1000).toISOString().slice(0,10);

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) return res.status(200).json({ transactions:[], message:"No QB companies connected." });

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");
    if (!keys.length) return res.status(200).json({ transactions:[], message:"No QB companies connected." });

    // Build a map: entityId → [qbAccountId, ...] from the linked accounts
    const entityToQBAccounts = {};
    (accounts||[]).forEach(a => {
      if (a.qbAccountId) {
        if (!entityToQBAccounts[a.entityId]) entityToQBAccounts[a.entityId] = [];
        entityToQBAccounts[a.entityId].push(a.qbAccountId);
      }
    });

    const allResults = await Promise.allSettled(keys.map(async key => {
      const raw = await kv.get(key);
      const td = typeof raw === "string" ? JSON.parse(raw) : raw;
      const linkedIds = entityToQBAccounts[td.entity_id] || [];
      return fetchQBTransactions(td, since, linkedIds);
    }));

    let transactions = [];
    const errors = [];
    allResults.forEach((r,i) => {
      if (r.status === "fulfilled") transactions.push(...r.value);
      else errors.push({ key:keys[i], error:r.reason?.message });
    });

    // Map each transaction to its CashFlow Pro account
    transactions = transactions.map(txn => {
      const matchedAcct = (accounts||[]).find(a => a.qbAccountId === txn.qbAccountId && a.entityId === txn.entityId);
      return { ...txn, accountId: matchedAcct?.id || null };
    });

    await kv.set("qb_last_sync", new Date().toISOString());
    return res.status(200).json({ transactions, errors, syncedAt: new Date().toISOString(), totalCount: transactions.length, since });
  } catch(err) {
    return res.status(500).json({ error:"Sync failed", message:err.message });
  }
}
