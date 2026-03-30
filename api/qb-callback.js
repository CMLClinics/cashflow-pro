// api/qb-callback.js — Exchange auth code, fetch company info, store token

export default async function handler(req, res) {
  const { code, state, realmId, error } = req.query;

  if (error) return res.redirect(302, `/?qb_error=${encodeURIComponent(error)}`);
  if (!code || !realmId) return res.status(400).send("<h2>Missing code or realmId from Intuit</h2>");

  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri  = process.env.QB_REDIRECT_URI;
  const kvUrl        = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
  const kvToken      = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

  if (!clientId || !clientSecret) {
    return res.status(500).send("<h2>Missing QB_CLIENT_ID or QB_CLIENT_SECRET in Vercel env vars.</h2>");
  }

  try {
    // 1. Exchange auth code for tokens
    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Accept":        "application/json",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(400).send(`<h2>Token exchange failed</h2><pre>${JSON.stringify(tokens,null,2)}</pre><p>Check that QB_REDIRECT_URI matches exactly what's in Intuit Developer → Redirect URIs.</p>`);
    }

    // 2. Fetch company name from QB CompanyInfo
    let companyName = "Unknown Company";
    try {
      const coRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`,
        { headers: { "Authorization": `Bearer ${tokens.access_token}`, "Accept": "application/json" } }
      );
      if (coRes.ok) {
        const coData = await coRes.json();
        companyName = coData?.CompanyInfo?.CompanyName || companyName;
      }
    } catch(e) { console.warn("Could not fetch company name:", e.message); }

    // 3. Store token keyed by realmId — ADDITIVE, never overwrites other companies
    const tokenData = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in:    tokens.expires_in,
      x_refresh_token_expires_in: tokens.x_refresh_token_expires_in,
      obtained_at:   Date.now(),
      realm_id:      realmId,
      entity_id:     state,   // our app's entity (may be "default" if not specified)
      company_name:  companyName,
    };

    if (kvUrl && kvToken) {
      const { Redis } = await import("@upstash/redis");
      const kv = new Redis({ url: kvUrl, token: kvToken });
      // Store by realmId — each QB company gets its own key
      await kv.set(`qb_token_${realmId}`, JSON.stringify(tokenData));
      await kv.set(`qb_entity_${state}`, realmId);
      console.log(`QB Connected: ${companyName} (realm: ${realmId}, entity: ${state})`);
    }

    // 4. Redirect back to app — include company name in success message
    res.redirect(302, `/?qb_connected=${encodeURIComponent(companyName)}&realm=${realmId}&entity=${encodeURIComponent(state)}`);

  } catch (err) {
    console.error("QB callback error:", err);
    res.status(500).send(`<h2>QB Callback Error</h2><p>${err.message}</p>`);
  }
}
