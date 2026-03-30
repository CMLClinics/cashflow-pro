// api/qb-auth.js — Step 1: Redirect to Intuit OAuth consent screen

export default function handler(req, res) {
  const clientId    = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  const state       = req.query.entityId || "default";

  if (!clientId) {
    return res.status(500).send(`
      <h2>Missing QB_CLIENT_ID</h2>
      <p>Add QB_CLIENT_ID to Vercel Environment Variables and redeploy.</p>
    `);
  }
  if (!redirectUri) {
    return res.status(500).send(`
      <h2>Missing QB_REDIRECT_URI</h2>
      <p>Add QB_REDIRECT_URI to Vercel Environment Variables.</p>
      <p>It must be set to exactly: <strong>https://${req.headers.host}/api/qb-callback</strong></p>
      <p>And that exact URL must be whitelisted in your Intuit Developer app under Redirect URIs.</p>
    `);
  }

  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("scope",         "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state",         state);

  // Log for debugging
  console.log("QB Auth redirect:", { redirectUri, clientId: clientId.slice(0,8)+"..." });

  res.redirect(302, url.toString());
}
