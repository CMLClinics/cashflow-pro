// api/qb-auth.js
// Forces fresh Intuit login so user can pick the right company.
// Pass ?entityId=xxx in query string.

export default function handler(req, res) {
  const clientId    = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  const entityId    = req.query.entityId || "unassigned";

  if (!clientId || !redirectUri) {
    return res.status(500).send(`<h2>Missing QB_CLIENT_ID or QB_REDIRECT_URI in Vercel env vars.</h2>`);
  }

  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("scope",         "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state",         entityId);

  // Note: Intuit does NOT support prompt=select_account or prompt=login reliably.
  // The company picker shows automatically if the user is NOT already logged in,
  // or if they have multiple companies. The user must sign out of Intuit manually
  // between connections to pick a different company.

  res.redirect(302, url.toString());
}
