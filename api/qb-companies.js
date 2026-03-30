// api/qb-companies.js — Fetch real company names and bank accounts from QB

import { refreshTokenIfNeeded } from "./_qb-refresh.js";

export default async function handler(req, res) {
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) return res.status(200).json({ companies: [] });

  try {
    const { Redis } = await import("@upstash/redis");
    const kv = new Redis({ url: kvUrl, token: kvToken });
    const keys = await kv.keys("qb_token_*");
    if (!keys.length) return res.status(200).json({ companies: [] });

    const companies = await Promise.allSettled(keys.map(async key => {
      const raw = await kv.get(key);
      const tokenData = typeof raw === "string" ? JSON.parse(raw) : raw;
      
      let token;
      try { token = await refreshTokenIfNeeded(tokenData); }
      catch(e) { return { realmId: tokenData.realm_id, entityId: tokenData.entity_id, companyName: `QB Company (${tokenData.realm_id})`, bankAccounts: [], error: "Token refresh failed: "+e.message }; }

      const headers = { "Authorization": `Bearer ${token.access_token}`, "Accept": "application/json" };
      const base = `https://quickbooks.api.intuit.com/v3/company/${token.realm_id}`;

      // Fetch company info
      let companyName = `QB Company (${token.realm_id})`;
      try {
        const infoRes = await fetch(`${base}/companyinfo/${token.realm_id}?minorversion=65`, { headers });
        if (infoRes.ok) {
          const info = await infoRes.json();
          companyName = info?.CompanyInfo?.CompanyName || companyName;
        } else {
          const errText = await infoRes.text();
          console.error("CompanyInfo fetch failed:", infoRes.status, errText.slice(0,200));
        }
      } catch(e) { console.error("CompanyInfo error:", e.message); }

      // Fetch bank accounts
      let bankAccounts = [];
      try {
        const acctRes = await fetch(
          `${base}/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 100")}&minorversion=65`,
          { headers }
        );
        if (acctRes.ok) {
          const acctData = await acctRes.json();
          bankAccounts = (acctData?.QueryResponse?.Account || []).map(a => ({
            id:      a.Id,
            name:    a.Name,
            number:  a.AcctNum || "",
            balance: parseFloat(a.CurrentBalance || 0),
            type:    a.AccountSubType || a.AccountType,
          }));
        } else {
          const errText = await acctRes.text();
          console.error("Accounts fetch failed:", acctRes.status, errText.slice(0,200));
        }
      } catch(e) { console.error("Accounts error:", e.message); }

      return { realmId: token.realm_id, entityId: token.entity_id, companyName, bankAccounts };
    }));

    const result = companies
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    return res.status(200).json({ companies: result });
  } catch (err) {
    console.error("qb-companies error:", err);
    return res.status(500).json({ error: err.message, companies: [] });
  }
}
