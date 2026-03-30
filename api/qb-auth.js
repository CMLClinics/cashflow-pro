// api/qb-auth.js — Redirect to Intuit OAuth
// For multi-company: user connects one company at a time.
// Each connection is stored by realmId — they accumulate, not overwrite.

export default function handler(req, res) {
  const clientId    = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  const entityId    = req.query.entityId || "default";

  if (!clientId || !redirectUri) {
    return res.status(500).send(`
      <h2 style="font-family:sans-serif">Setup incomplete</h2>
      <p>Add these to Vercel → Settings → Environment Variables:</p>
      <ul style="font-family:monospace">
        <li>QB_CLIENT_ID</li>
        <li>QB_CLIENT_SECRET</li>
        <li>QB_REDIRECT_URI = https://${req.headers.host}/api/qb-callback</li>
      </ul>
    `);
  }

  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("scope",         "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state",         entityId);
  // prompt=select_account forces Intuit to show company picker every time
  url.searchParams.set("prompt",        "select_account");

  res.redirect(302, url.toString());
}
