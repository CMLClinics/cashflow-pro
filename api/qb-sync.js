// api/qb-sync.js — Full transaction pull including all QB transaction types

import { refreshTokenIfNeeded } from "./_qb-refresh.js";

const QB_BASE = "https://quickbooks.api.intuit.com";

async function fetchQBTransactions(tokenData, sinceDate, linkedQBAccountIds) {
  const token = await refreshTokenIfNeeded(tokenData);
  const { realm_id: realmId, entity_id: entityId, access_token } = token;
  const headers = { "Authorization": `Bearer ${access_token}`, "Accept": "application/json" };
  const base = `${QB_BASE}/v3/company/${realmId}`;

  if (!linkedQBAccountIds || linkedQBAccountIds.length === 0) {
    console.log(`Entity ${entityId}: no linked QB accounts — skipping`);
    return [];
  }

  const results = [];

  // Helper: run a QB query
  const query = async (sql) => {
    try {
      const url = `${base}/query?query=${encodeURIComponent(sql)}&minorversion=65`;
      const r = await fetch(url, { headers });
      if (!r.ok) { console.error("QB query failed:", r.status, sql.slice(0,60)); return {}; }
      const d = await r.json();
      return d?.QueryResponse || {};
    } catch(e) { console.error("QB query error:", e.message); return {}; }
  };

  // 1. Purchases (bank/card withdrawals)
  const purchases = await query(`SELECT * FROM Purchase WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
  (purchases.Purchase||[]).forEach(p => {
    const qbAccountId = p.AccountRef?.value;
    if (!linkedQBAccountIds.includes(qbAccountId)) return;
    results.push({ qbId:`P-${p.Id}`, qbType:"Purchase", qbAccountId,
      date:p.TxnDate, description:p.EntityRef?.name||p.PrivateNote||p.PaymentType||"Purchase",
      amount:Math.abs(parseFloat(p.TotalAmt||0)), type:"expense", categoryId:"", entityId, realmId, source:"quickbooks" });
  });

  // 2. Deposits
  const deposits = await query(`SELECT * FROM Deposit WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
  (deposits.Deposit||[]).forEach(d => {
    const qbAccountId = d.DepositToAccountRef?.value;
    if (!linkedQBAccountIds.includes(qbAccountId)) return;
    const memo = d.PrivateNote || (d.Line?.[0]?.Description) || "Deposit";
    results.push({ qbId:`D-${d.Id}`, qbType:"Deposit", qbAccountId,
      date:d.TxnDate, description:memo,
      amount:Math.abs(parseFloat(d.TotalAmt||0)), type:"income", categoryId:"", entityId, realmId, source:"quickbooks" });
  });

  // 3. Customer payments received (cash hitting bank)
  const payments = await query(`SELECT * FROM Payment WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
  (payments.Payment||[]).forEach(p => {
    const qbAccountId = p.DepositToAccountRef?.value;
    if (qbAccountId && !linkedQBAccountIds.includes(qbAccountId)) return;
    results.push({ qbId:`PMT-${p.Id}`, qbType:"Payment", qbAccountId:qbAccountId||linkedQBAccountIds[0],
      date:p.TxnDate, description:`Payment — ${p.CustomerRef?.name||""}`,
      amount:Math.abs(parseFloat(p.TotalAmt||0)), type:"income", categoryId:"", entityId, realmId, source:"quickbooks" });
  });

  // 4. Journal Entries (filtered to linked accounts only)
  const journals = await query(`SELECT * FROM JournalEntry WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
  (journals.JournalEntry||[]).forEach(j => {
    (j.Line||[]).forEach(line => {
      const detail = line.JournalEntryLineDetail;
      if (!detail) return;
      const qbAccountId = detail.AccountRef?.value;
      if (!linkedQBAccountIds.includes(qbAccountId)) return;
      const isDebit = detail.PostingType === "Debit";
      results.push({ qbId:`JE-${j.Id}-${line.Id||"0"}`, qbType:"JournalEntry", qbAccountId,
        date:j.TxnDate, description:line.Description||`Journal Entry #${j.DocNumber||j.Id}`,
        amount:Math.abs(parseFloat(line.Amount||0)), type:isDebit?"expense":"income", categoryId:"", entityId, realmId, source:"quickbooks" });
    });
  });

  // 5. Transfers between bank accounts
  const transfers = await query(`SELECT * FROM Transfer WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
  (transfers.Transfer||[]).forEach(t => {
    const fromId = t.FromAccountRef?.value;
    const toId   = t.ToAccountRef?.value;
    if (linkedQBAccountIds.includes(fromId)) {
      results.push({ qbId:`TRF-OUT-${t.Id}`, qbType:"Transfer", qbAccountId:fromId,
        date:t.TxnDate, description:`Transfer to ${t.ToAccountRef?.name||""}`,
        amount:Math.abs(parseFloat(t.Amount||0)), type:"expense", categoryId:"", entityId, realmId, source:"quickbooks" });
    }
    if (linkedQBAccountIds.includes(toId)) {
      results.push({ qbId:`TRF-IN-${t.Id}`, qbType:"Transfer", qbAccountId:toId,
        date:t.TxnDate, description:`Transfer from ${t.FromAccountRef?.name||""}`,
        amount:Math.abs(parseFloat(t.Amount||0)), type:"income", categoryId:"", entityId, realmId, source:"quickbooks" });
    }
  });

  console.log(`Entity ${entityId}: fetched ${results.length} transactions since ${sinceDate}`);
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

    // Build entityId → linked QB account IDs map
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
      return fetchQBTransactions(td, since, entityToQBAccounts[td.entity_id]||[]);
    }));

    let transactions = [];
    const errors = [];
    allResults.forEach((r,i) => {
      if (r.status === "fulfilled") transactions.push(...r.value);
      else errors.push({ key:keys[i], error:r.reason?.message });
    });

    // Map to CashFlow Pro account
    transactions = transactions.map(txn => {
      const matchedAcct = (accounts||[]).find(a => a.qbAccountId===txn.qbAccountId && a.entityId===txn.entityId);
      return { ...txn, accountId: matchedAcct?.id || null };
    });

    await kv.set("qb_last_sync", new Date().toISOString());
    return res.status(200).json({ transactions, errors, syncedAt:new Date().toISOString(), totalCount:transactions.length, since });
  } catch(err) {
    return res.status(500).json({ error:"Sync failed", message:err.message });
  }
}
