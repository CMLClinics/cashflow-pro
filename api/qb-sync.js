// api/qb-sync.js
// Fetches new transactions from QuickBooks for one or all connected companies.
// Called by the frontend "Sync QB" button.
// Returns { transactions: [...], errors: [...] }

import { kv } from "@vercel/kv";
import { refreshTokenIfNeeded } from "./_qb-refresh.js";

const QB_BASE = "https://quickbooks.api.intuit.com";
const MINOR_VERSION = 65;

// Fetch QB transactions using IIF query language
async function fetchQBTransactions(tokenData, sinceDate) {
  const token   = await refreshTokenIfNeeded(tokenData);
  const realmId = token.realm_id;

  // QB uses SQL-like queries. We pull Purchases (expenses) and Deposits (income).
  // sinceDate format: YYYY-MM-DD
  const queries = [
    `SELECT * FROM Purchase WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
    `SELECT * FROM Deposit  WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
    `SELECT * FROM Invoice  WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
    `SELECT * FROM Bill     WHERE TxnDate >= '${sinceDate}' MAXRESULTS 1000`,
  ];

  const results = [];
  for (const query of queries) {
    const url = `${QB_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
        "Accept":        "application/json",
      },
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`QB query failed (${query.slice(0,30)}...):`, err);
      continue;
    }
    const data = await res.json();
    const queryResponse = data?.QueryResponse || {};

    // Normalize Purchase (expense)
    (queryResponse.Purchase || []).forEach(p => {
      results.push({
        qbId:        p.Id,
        qbType:      "Purchase",
        date:        p.TxnDate,
        description: p.PrivateNote || p.PaymentType || "QB Purchase",
        amount:      Math.abs(parseFloat(p.TotalAmt || 0)),
        type:        "expense",
        categoryId:  mapQBAccount(p.AccountRef?.name),
        entityId:    token.entity_id,
        realmId:     token.realm_id,
        source:      "quickbooks",
        raw:         p,
      });
    });

    // Normalize Deposit (income)
    (queryResponse.Deposit || []).forEach(d => {
      results.push({
        qbId:        d.Id,
        qbType:      "Deposit",
        date:        d.TxnDate,
        description: d.PrivateNote || "QB Deposit",
        amount:      Math.abs(parseFloat(d.TotalAmt || 0)),
        type:        "income",
        categoryId:  mapQBAccount(d.DepositToAccountRef?.name),
        entityId:    token.entity_id,
        realmId:     token.realm_id,
        source:      "quickbooks",
        raw:         d,
      });
    });

    // Normalize Invoice (income — when paid)
    (queryResponse.Invoice || []).forEach(inv => {
      if (inv.Balance === 0) { // only fully paid invoices
        results.push({
          qbId:        inv.Id,
          qbType:      "Invoice",
          date:        inv.TxnDate,
          description: `Invoice #${inv.DocNumber || inv.Id} — ${inv.CustomerRef?.name || ""}`,
          amount:      Math.abs(parseFloat(inv.TotalAmt || 0)),
          type:        "income",
          categoryId:  "cat1", // Revenue
          entityId:    token.entity_id,
          realmId:     token.realm_id,
          source:      "quickbooks",
          raw:         inv,
        });
      }
    });

    // Normalize Bill (expense)
    (queryResponse.Bill || []).forEach(b => {
      results.push({
        qbId:        b.Id,
        qbType:      "Bill",
        date:        b.TxnDate,
        description: `Bill — ${b.VendorRef?.name || ""}`,
        amount:      Math.abs(parseFloat(b.TotalAmt || 0)),
        type:        "expense",
        categoryId:  mapQBAccount(b.APAccountRef?.name),
        entityId:    token.entity_id,
        realmId:     token.realm_id,
        source:      "quickbooks",
        raw:         b,
      });
    });
  }

  return results;
}

// Simple QB account name → our category mapping
// You can expand this to match your actual QB account names
function mapQBAccount(accountName) {
  if (!accountName) return "cat12";
  const n = accountName.toLowerCase();
  if (n.includes("payroll") || n.includes("salary") || n.includes("wage")) return "cat5";
  if (n.includes("rent")    || n.includes("lease"))                        return "cat8";
  if (n.includes("adverti") || n.includes("market"))                       return "cat6";
  if (n.includes("software")|| n.includes("subscri"))                      return "cat9";
  if (n.includes("utility") || n.includes("hydro") || n.includes("gas"))   return "cat10";
  if (n.includes("tax")     || n.includes("hst")   || n.includes("gst"))   return "cat11";
  if (n.includes("inventor")|| n.includes("supply")|| n.includes("product"))return "cat7";
  if (n.includes("revenue") || n.includes("income")|| n.includes("sales")) return "cat1";
  if (n.includes("membersh"))                                               return "cat2";
  return "cat12"; // Other
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { entityIds, sinceDate } = req.body || {};
  // sinceDate: optional ISO date string (YYYY-MM-DD). Defaults to 30 days ago.
  const since = sinceDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    // Find all connected QB companies
    let realmIds = [];
    if (entityIds && entityIds.length > 0) {
      // Specific entities requested
      const mappings = await Promise.all(
        entityIds.map(id => kv.get(`qb_entity_${id}`))
      );
      realmIds = mappings.filter(Boolean);
    } else {
      // Scan for all stored tokens (pattern: qb_token_*)
      // Vercel KV scan — list all keys matching pattern
      const keys = await kv.keys("qb_token_*");
      realmIds = keys.map(k => k.replace("qb_token_", ""));
    }

    if (realmIds.length === 0) {
      return res.status(200).json({ transactions: [], message: "No QB companies connected yet. Connect via Settings → Bank Sync." });
    }

    // Fetch all companies in parallel
    const allResults = await Promise.allSettled(
      realmIds.map(async (realmId) => {
        const raw = await kv.get(`qb_token_${realmId}`);
        if (!raw) return [];
        const tokenData = typeof raw === "string" ? JSON.parse(raw) : raw;
        return fetchQBTransactions(tokenData, since);
      })
    );

    const transactions = [];
    const errors       = [];
    allResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        transactions.push(...result.value);
      } else {
        errors.push({ realmId: realmIds[i], error: result.reason?.message || "Unknown error" });
      }
    });

    // Store last sync time
    await kv.set("qb_last_sync", new Date().toISOString());

    return res.status(200).json({
      transactions,
      errors,
      syncedAt:   new Date().toISOString(),
      totalCount: transactions.length,
      since,
    });

  } catch (err) {
    console.error("qb-sync error:", err);
    return res.status(500).json({ error: "Sync failed", message: err.message });
  }
}
