// One-time helper to mint a Google Calendar refresh token for booking.
//
//   1. In Google Cloud Console: create an OAuth 2.0 Client ID of type
//      "Web application", add redirect URI  http://localhost:5599/oauth2callback
//      Enable the "Google Calendar API" for the project.
//   2. Put GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local
//   3. Run:  npm run get-google-token
//   4. Approve in the browser; copy the printed refresh token into
//      GOOGLE_OAUTH_REFRESH_TOKEN (locally AND in Vercel env vars).

import http from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";
import { loadDotEnv, envRequired } from "../lib/env";

loadDotEnv();

const PORT = 5599;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

async function main() {
  const clientId = envRequired("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envRequired("GOOGLE_OAUTH_CLIENT_SECRET");
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-auth
    scope: SCOPES,
  });

  console.log("\n🔑 Opening Google consent screen. If it doesn't open, visit:\n\n" + authUrl + "\n");
  open(authUrl);

  const code = await waitForCode();
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "\n❌ No refresh_token returned. Revoke prior access at https://myaccount.google.com/permissions and re-run.\n",
    );
    process.exit(1);
  }

  console.log("\n✅ Success! Add this to .env.local AND your Vercel env vars:\n");
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN="${tokens.refresh_token}"\n`);
  process.exit(0);
}

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith("/oauth2callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, REDIRECT);
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:sans-serif;padding:40px"><h2>${
          code ? "✅ Authorized — you can close this tab." : "❌ Authorization failed."
        }</h2></body></html>`,
      );
      server.close();
      if (code) resolve(code);
      else reject(new Error(err || "no code"));
    });
    server.listen(PORT, () => console.log(`⏳ Waiting for Google redirect on ${REDIRECT} …`));
  });
}

function open(url: string) {
  const cmd =
    process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

main().catch((e) => {
  console.error("\n❌ " + e.message + "\n");
  process.exit(1);
});
