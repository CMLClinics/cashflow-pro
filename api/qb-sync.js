// api/qb-sync.js — Pull bank feed transactions using QB Banking API

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

  const query = async (sql) => {
    try {
      const url = `${base}/query?query=${encodeURIComponent(sql)}&minorversion=65`;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        const txt = await r.text();
        console.error("QB query failed:", r.status, sql.slice(0,80), txt.slice(0,200));
        return {};
      }
      const d = await r.json();
      return d?.QueryResponse || {};
    } catch(e) { console.error("QB query error:", e.message); return {}; }
  };

  // Pull for each linked account separately
  for (const qbAccountId of linkedQBAccountIds) {

    // 1. BankTransaction (bank feed — the rows you see in QB Banking tab)
    // These are the raw imported bank transactions before/after categorization
    const btQuery = `SELECT * FROM BankTransaction WHERE AccountRef = '${qbAccountId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`;
    const bt = await query(btQuery);
    (bt.BankTransaction||[]).forEach(t => {
      const amount = parseFloat(t.Amount||0);
      results.push({
        qbId:        `BT-${t.Id}`,
        qbType:      "BankTransaction",
        qbAccountId,
        date:        t.TxnDate,
        description: t.Description || t.PayeeName || "Bank Transaction",
        amount:      Math.abs(amount),
        type:        amount < 0 ? "expense" : "income",
        categoryId:  "",
        entityId, realmId, source: "quickbooks"
      });
    });

    // 2. Purchases linked to this bank account
    const pq = await query(`SELECT * FROM Purchase WHERE AccountRef = '${qbAccountId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (pq.Purchase||[]).forEach(p => {
      results.push({
        qbId:`P-${p.Id}`, qbType:"Purchase", qbAccountId,
        date:p.TxnDate,
        description:p.EntityRef?.name || p.PrivateNote || p.PaymentMethodRef?.name || "Purchase",
        amount:Math.abs(parseFloat(p.TotalAmt||0)),
        type:"expense", categoryId:"", entityId, realmId, source:"quickbooks"
      });
    });

    // 3. Deposits to this bank account
    const dq = await query(`SELECT * FROM Deposit WHERE DepositToAccountRef = '${qbAccountId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (dq.Deposit||[]).forEach(d => {
      const memo = d.PrivateNote || d.Line?.[0]?.Description || "Deposit";
      results.push({
        qbId:`D-${d.Id}`, qbType:"Deposit", qbAccountId,
        date:d.TxnDate, description:memo,
        amount:Math.abs(parseFloat(d.TotalAmt||0)),
        type:"income", categoryId:"", entityId, realmId, source:"quickbooks"
      });
    });

    // 4. Customer payments deposited to this account
    const pmtq = await query(`SELECT * FROM Payment WHERE DepositToAccountRef = '${qbAccountId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (pmtq.Payment||[]).forEach(p => {
      results.push({
        qbId:`PMT-${p.Id}`, qbType:"Payment", qbAccountId,
        date:p.TxnDate,
        description:`Payment — ${p.CustomerRef?.name||""}`,
        amount:Math.abs(parseFloat(p.TotalAmt||0)),
        type:"income", categoryId:"", entityId, realmId, source:"quickbooks"
      });
    });

    // 5. Transfers out from this account
    const trfq = await query(`SELECT * FROM Transfer WHERE FromAccountRef = '${qbAccountId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (trfq.Transfer||[]).forEach(t => {
      results.push({
        qbId:`TRF-OUT-${t.Id}`, qbType:"Transfer", qbAccountId,
        date:t.TxnDate,
        description:`Transfer to ${t.ToAccountRef?.name||""}`,
        amount:Math.abs(parseFloat(t.Amount||0)),
        type:"expense", categoryId:"", entityId, realmId, source:"quickbooks"
      });
    });

    // 6. Transfers into this account
    const trfiq = await query(`SELECT * FROM Transfer WHERE ToAccountRef = '${qbAccountId}' AND TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (trfiq.Transfer||[]).forEach(t => {
      results.push({
        qbId:`TRF-IN-${t.Id}`, qbType:"Transfer", qbAccountId,
        date:t.TxnDate,
        description:`Transfer from ${t.FromAccountRef?.name||""}`,
        amount:Math.abs(parseFloat(t.Amount||0)),
        type:"income", categoryId:"", entityId, realmId, source:"quickbooks"
      });
    });

    // 7. Journal entry lines touching this account
    const jeq = await query(`SELECT * FROM JournalEntry WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`);
    (jeq.JournalEntry||[]).forEach(j => {
      (j.Line||[]).forEach(line => {
        const detail = line.JournalEntryLineDetail;
        if (!detail || detail.AccountRef?.value !== qbAccountId) return;
        const isDebit = detail.PostingType === "Debit";
        results.push({
          qbId:`JE-${j.Id}-${line.Id||"0"}`, qbType:"JournalEntry", qbAccountId,
          date:j.TxnDate,
          description:line.Description || `Journal Entry #${j.DocNumber||j.Id}`,
          amount:Math.abs(parseFloat(line.Amount||0)),
          type:isDebit?"expense":"income", categoryId:"", entityId, realmId, source:"quickbooks"
        });
      });
    });
  }

  // Deduplicate by qbId (in case multiple queries return same txn)
  const seen = new Set();
  const deduped = results.filter(r => {
    if (seen.has(r.qbId)) return false;
    seen.add(r.qbId);
    return true;
  });

  console.log(`Entity ${entityId}: ${deduped.length} transactions (${results.length} before dedup) since ${sinceDate}`);
  return deduped;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Sync from today's date (start of day)
  const { accounts, sinceDate } = req.body || {};
  const today = new Date();
  today.setHours(0,0,0,0);
  const since = sinceDate || today.toISOString().slice(0,10);

  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) return res.status(200).json({ transactions:[], message:"No QB companies connected." });

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");
    if (!keys.length) return res.status(200).json({ transactions:[], message:"No QB companies connected." });

    // Build entityId → linked QB account IDs
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
      const match = (accounts||[]).find(a => a.qbAccountId===txn.qbAccountId && a.entityId===txn.entityId);
      return { ...txn, accountId: match?.id || null };
    });

    await kv.set("qb_last_sync", new Date().toISOString());
    return res.status(200).json({ transactions, errors, syncedAt:new Date().toISOString(), totalCount:transactions.length, since });
  } catch(err) {
    return res.status(500).json({ error:"Sync failed", message:err.message });
  }
}
