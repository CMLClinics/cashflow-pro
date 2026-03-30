// api/qb-companies.js
// Fetches company info and chart of accounts from QB for all connected companies.
// Used to show real company names and available bank accounts in the UI.

import { refreshTokenIfNeeded } from "./_qb-refresh.js";

export default async function handler(req, res) {
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(200).json({ companies: [] });
  }

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");

    const companies = await Promise.allSettled(keys.map(async key => {
      const raw = await kv.get(key);
      const tokenData = typeof raw === "string" ? JSON.parse(raw) : raw;
      const token = await refreshTokenIfNeeded(tokenData);

      // Fetch company info
      const infoRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${token.realm_id}/companyinfo/${token.realm_id}?minorversion=65`,
        { headers: { "Authorization": `Bearer ${token.access_token}`, "Accept": "application/json" } }
      );
      const info = await infoRes.json();
      const companyName = info?.CompanyInfo?.CompanyName || `Company (${token.realm_id})`;

      // Fetch bank accounts
      const acctRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${token.realm_id}/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 50")}&minorversion=65`,
        { headers: { "Authorization": `Bearer ${token.access_token}`, "Accept": "application/json" } }
      );
      const acctData = await acctRes.json();
      const bankAccounts = (acctData?.QueryResponse?.Account || []).map(a => ({
        id:      a.Id,
        name:    a.Name,
        number:  a.AcctNum || "",
        balance: a.CurrentBalance || 0,
      }));

      return {
        realmId:      token.realm_id,
        entityId:     token.entity_id,
        companyName,
        bankAccounts,
      };
    }));

    const result = companies
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    return res.status(200).json({ companies: result });
  } catch (err) {
    return res.status(500).json({ error: err.message, companies: [] });
  }
}
