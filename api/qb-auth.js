// api/qb-auth.js
// Step 1: Redirect user to Intuit OAuth consent screen
// Called when user clicks "Connect QuickBooks" for a company

export default function handler(req, res) {
  const clientId     = process.env.QB_CLIENT_ID;
  const redirectUri  = process.env.QB_REDIRECT_URI; // e.g. https://cashflow-pro-one.vercel.app/api/qb-callback
  const state        = req.query.entityId || "default"; // pass entityId so callback knows which company

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: "Missing QB_CLIENT_ID or QB_REDIRECT_URI env vars" });
  }

  const scope        = "com.intuit.quickbooks.accounting";
  const authUrl      = "https://appcenter.intuit.com/connect/oauth2";

  const url = new URL(authUrl);
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("scope",         scope);
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state",         state);

  res.redirect(302, url.toString());
}
