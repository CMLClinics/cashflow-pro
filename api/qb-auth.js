// api/qb-auth.js
// Intuit OAuth doesn't support prompt=select_account.
// To connect multiple companies, user must be logged out of Intuit first,
// OR we use different Intuit accounts per company.
// The correct solution: after connecting one company, we store it and
// the next connect attempt uses &prompt=login to force fresh login.

export default function handler(req, res) {
  const clientId    = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  const entityId    = req.query.entityId || "default";

  if (!clientId || !redirectUri) {
    return res.status(500).send(`<h2>Missing QB_CLIENT_ID or QB_REDIRECT_URI in Vercel env vars.</h2>`);
  }

  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("scope",         "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state",         entityId);
  // Force Intuit to show fresh login so user can pick a different company
  url.searchParams.set("prompt",        "login");

  res.redirect(302, url.toString());
}
