// api/qb-sync.js — Pull bank transactions, correct income/expense types

import { refreshTokenIfNeeded } from "./_qb-refresh.js";

const QB_BASE = "https://quickbooks.api.intuit.com";

async function fetchForCompany(tokenData, sinceDate, linkedQBAccountIds) {
  let token;
  try { token = await refreshTokenIfNeeded(tokenData); }
  catch(e) { console.error("Token refresh failed:", e.message); return []; }

  const { realm_id: realmId, entity_id: entityId, access_token } = token;
  const headers = { "Authorization": `Bearer ${access_token}`, "Accept": "application/json" };
  const base    = `${QB_BASE}/v3/company/${realmId}`;

  if (!linkedQBAccountIds?.length) {
    console.log(`${entityId}: no linked accounts — skip`);
    return [];
  }

  const results = [];

  const run = async (sql) => {
    try {
      const r = await fetch(`${base}/query?query=${encodeURIComponent(sql)}&minorversion=65`, { headers });
      if (!r.ok) { console.error("QB query", r.status, sql.slice(0,60)); return {}; }
      return (await r.json())?.QueryResponse || {};
    } catch(e) { console.error("QB error:", e.message); return {}; }
  };

  for (const acctId of linkedQBAccountIds) {

    // 1. Purchases = money OUT (expenses, payments made)
    const pq = await run(`SELECT * FROM Purchase WHERE AccountRef = '${acctId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (pq.Purchase||[]).forEach(p => results.push({
      qbId:`P-${p.Id}`, qbType:"Purchase", qbAccountId:acctId,
      date:p.TxnDate,
      description:p.EntityRef?.name || p.PrivateNote || "Purchase",
      amount:Math.abs(parseFloat(p.TotalAmt||0)),
      type:"expense", // Purchases are ALWAYS expenses
      categoryId:"", entityId, realmId, source:"quickbooks"
    }));

    // 2. SalesReceipt = money IN (customer pays immediately, no invoice)
    const srq = await run(`SELECT * FROM SalesReceipt WHERE DepositToAccountRef = '${acctId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (srq.SalesReceipt||[]).forEach(s => results.push({
      qbId:`SR-${s.Id}`, qbType:"SalesReceipt", qbAccountId:acctId,
      date:s.TxnDate,
      description:`Receipt — ${s.CustomerRef?.name||s.DocNumber||""}`,
      amount:Math.abs(parseFloat(s.TotalAmt||0)),
      type:"income", // SalesReceipts are ALWAYS income
      categoryId:"", entityId, realmId, source:"quickbooks"
    }));

    // 3. Deposits = money IN
    const dq = await run(`SELECT * FROM Deposit WHERE DepositToAccountRef = '${acctId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (dq.Deposit||[]).forEach(d => results.push({
      qbId:`D-${d.Id}`, qbType:"Deposit", qbAccountId:acctId,
      date:d.TxnDate,
      description:d.PrivateNote || d.Line?.[0]?.Description || "Deposit",
      amount:Math.abs(parseFloat(d.TotalAmt||0)),
      type:"income",
      categoryId:"", entityId, realmId, source:"quickbooks"
    }));

    // 4. Customer Payments = money IN
    const pmtq = await run(`SELECT * FROM Payment WHERE DepositToAccountRef = '${acctId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (pmtq.Payment||[]).forEach(p => results.push({
      qbId:`PMT-${p.Id}`, qbType:"Payment", qbAccountId:acctId,
      date:p.TxnDate,
      description:`Payment — ${p.CustomerRef?.name||""}`,
      amount:Math.abs(parseFloat(p.TotalAmt||0)),
      type:"income",
      categoryId:"", entityId, realmId, source:"quickbooks"
    }));

    // 5. Transfers OUT from this account
    const trfOut = await run(`SELECT * FROM Transfer WHERE FromAccountRef = '${acctId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (trfOut.Transfer||[]).forEach(t => results.push({
      qbId:`TRF-OUT-${t.Id}`, qbType:"Transfer", qbAccountId:acctId,
      date:t.TxnDate,
      description:`Transfer → ${t.ToAccountRef?.name||""}`,
      amount:Math.abs(parseFloat(t.Amount||0)),
      type:"expense",
      categoryId:"", entityId, realmId, source:"quickbooks"
    }));

    // 6. Transfers IN to this account
    const trfIn = await run(`SELECT * FROM Transfer WHERE ToAccountRef = '${acctId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (trfIn.Transfer||[]).forEach(t => results.push({
      qbId:`TRF-IN-${t.Id}`, qbType:"Transfer", qbAccountId:acctId,
      date:t.TxnDate,
      description:`Transfer ← ${t.FromAccountRef?.name||""}`,
      amount:Math.abs(parseFloat(t.Amount||0)),
      type:"income",
      categoryId:"", entityId, realmId, source:"quickbooks"
    }));

    // 7. Journal entries touching this account
    // Debit = money OUT, Credit = money IN (for asset/bank accounts)
    const jeq = await run(`SELECT * FROM JournalEntry WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (jeq.JournalEntry||[]).forEach(j => {
      (j.Line||[]).forEach(line => {
        const detail = line.JournalEntryLineDetail;
        if (!detail || detail.AccountRef?.value !== acctId) return;
        // For bank accounts: Debit = money IN, Credit = money OUT
        const isDebit = detail.PostingType === "Debit";
        results.push({
          qbId:`JE-${j.Id}-${line.Id||"0"}`, qbType:"JournalEntry", qbAccountId:acctId,
          date:j.TxnDate,
          description:line.Description || `Journal Entry #${j.DocNumber||j.Id}`,
          amount:Math.abs(parseFloat(line.Amount||0)),
          type:isDebit ? "income" : "expense", // bank debit = cash in
          categoryId:"", entityId, realmId, source:"quickbooks"
        });
      });
    });
  }

  // Deduplicate by qbId
  const seen = new Set();
  const deduped = results.filter(r => { if(seen.has(r.qbId)) return false; seen.add(r.qbId); return true; });
  console.log(`${entityId} (${realmId}): ${deduped.length} txns since ${sinceDate}`);
  return deduped;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });

  const { accounts, sinceDate } = req.body || {};
  const since = sinceDate || new Date().toISOString().slice(0,10);

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(200).json({ transactions:[], message:"No KV configured." });

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");
    if (!keys.length) return res.status(200).json({ transactions:[], message:"No QB companies connected." });

    // Build entityId → QB account IDs map
    const entityAccounts = {};
    (accounts||[]).forEach(a => {
      if (!a.qbAccountId) return;
      if (!entityAccounts[a.entityId]) entityAccounts[a.entityId] = [];
      entityAccounts[a.entityId].push(a.qbAccountId);
    });

    const allResults = await Promise.allSettled(keys.map(async key => {
      const raw = await kv.get(key);
      const td  = typeof raw === "string" ? JSON.parse(raw) : raw;
      return fetchForCompany(td, since, entityAccounts[td.entity_id]||[]);
    }));

    let transactions = [];
    const errors = [];
    allResults.forEach((r,i) => {
      if (r.status==="fulfilled") transactions.push(...r.value);
      else errors.push({ key:keys[i], error:r.reason?.message });
    });

    // Map to CashFlow Pro accountId
    transactions = transactions.map(txn => {
      const match = (accounts||[]).find(a => a.qbAccountId===txn.qbAccountId && a.entityId===txn.entityId);
      return { ...txn, accountId: match?.id || null };
    });

    await kv.set("qb_last_sync", new Date().toISOString());
    return res.status(200).json({
      transactions, errors,
      syncedAt:   new Date().toISOString(),
      totalCount: transactions.length,
      since,
      companiesQueried: keys.length,
    });
  } catch(err) {
    return res.status(500).json({ error:"Sync failed", message:err.message });
  }
}
