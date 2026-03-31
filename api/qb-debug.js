// api/qb-debug.js — Test what transaction types QB returns for your accounts

import { refreshTokenIfNeeded } from "./_qb-refresh.js";

export default async function handler(req, res) {
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) return res.status(200).json({ error: "No KV configured" });

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");
    if (!keys.length) return res.status(200).json({ error: "No QB companies connected" });

    // Use first connected company
    const raw = await kv.get(keys[0]);
    const tokenData = typeof raw === "string" ? JSON.parse(raw) : raw;
    const token = await refreshTokenIfNeeded(tokenData);
    const { realm_id: realmId, access_token } = token;
    const headers = { "Authorization": `Bearer ${access_token}`, "Accept": "application/json" };
    const base = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const since = req.query.since || "2026-01-01";
    const accountId = req.query.accountId || null;

    const run = async (sql) => {
      const r = await fetch(`${base}/query?query=${encodeURIComponent(sql)}&minorversion=65`, { headers });
      const d = await r.json();
      return { status: r.status, count: Object.values(d?.QueryResponse||{})?.[0]?.length || 0, raw: d?.QueryResponse, fault: d?.Fault };
    };

    const results = {};

    // Test every transaction type
    // Test BankFeedTransaction — the "For Review" tab data
    const bankFeedUrl = `${base}/bankfeedtransaction?startposition=1&maxresults=10`;
    try {
      const bfr = await fetch(bankFeedUrl, { headers });
      const bfd = await bfr.json();
      results.BankFeedTransaction = { status: bfr.status, data: bfd };
    } catch(e) {
      results.BankFeedTransaction = { status: "error", error: e.message };
    }

    // Also test the newer v4 endpoint
    const v4url = `https://quickbooks.api.intuit.com/v4/company/${realmId}/bankfeedtransaction?startposition=1&maxresults=10`;
    try {
      const v4r = await fetch(v4url, { headers });
      const v4d = await v4r.json();
      results.BankFeedTransaction_v4 = { status: v4r.status, data: v4d };
    } catch(e) {
      results.BankFeedTransaction_v4 = { status: "error", error: e.message };
    }

    results.Purchase       = await run(`SELECT * FROM Purchase WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.Deposit        = await run(`SELECT * FROM Deposit WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.Payment        = await run(`SELECT * FROM Payment WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.Transfer       = await run(`SELECT * FROM Transfer WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.JournalEntry   = await run(`SELECT * FROM JournalEntry WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.BankTransaction= await run(`SELECT * FROM BankTransaction WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.SalesReceipt   = await run(`SELECT * FROM SalesReceipt WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.Expense        = await run(`SELECT * FROM Expense WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.Check          = await run(`SELECT * FROM Check WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.CreditCardPayment = await run(`SELECT * FROM CreditCardPayment WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.BillPayment    = await run(`SELECT * FROM BillPayment WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.VendorCredit   = await run(`SELECT * FROM VendorCredit WHERE TxnDate >= '${since}' MAXRESULTS 5`);
    results.RefundReceipt  = await run(`SELECT * FROM RefundReceipt WHERE TxnDate >= '${since}' MAXRESULTS 5`);

    // Check Purchase types to find EFT/PAD/wire payments
    const purchaseSample = await run(`SELECT * FROM Purchase WHERE TxnDate >= '${since}' MAXRESULTS 50`);
    const paymentTypes = {};
    (purchaseSample.Purchase||[]).forEach(p => {
      const pt = p.PaymentType || "unknown";
      paymentTypes[pt] = (paymentTypes[pt]||0) + 1;
    });
    results.Purchase_PaymentTypes = paymentTypes;

    // Sample all purchases to see their structure
    results.Purchase_sample = (purchaseSample.Purchase||[]).slice(0,3).map(p=>({
      Id:p.Id, TxnDate:p.TxnDate, PaymentType:p.PaymentType,
      AccountRef:p.AccountRef, EntityRef:p.EntityRef,
      TotalAmt:p.TotalAmt, PrivateNote:p.PrivateNote
    }));

    // If accountId provided, test account-specific queries
    if (accountId) {
      results.Purchase_filtered = await run(`SELECT * FROM Purchase WHERE AccountRef = '${accountId}' AND TxnDate >= '${since}' MAXRESULTS 5`);
      results.Deposit_filtered  = await run(`SELECT * FROM Deposit WHERE DepositToAccountRef = '${accountId}' AND TxnDate >= '${since}' MAXRESULTS 5`);
    }

    // Sample one Purchase to see its structure
    if (results.Purchase.count > 0) {
      results.Purchase_sample = results.Purchase.raw;
    }
    if (results.Deposit.count > 0) {
      results.Deposit_sample = results.Deposit.raw;
    }
    if (results.SalesReceipt.count > 0) {
      results.SalesReceipt_sample = results.SalesReceipt.raw;
    }

    // Clear raw to keep response clean
    Object.keys(results).forEach(k => {
      if (!k.includes('_sample') && !k.includes('_filtered')) delete results[k].raw;
    });

    return res.status(200).json({ realmId, since, accountId, results });
  } catch(err) {
    return res.status(500).json({ error: err.message, stack: err.stack?.slice(0,500) });
  }
}
