import { Router, Request, Response } from "express";
import config from "../config/config";
import { getAuthUrl, getTokensFromCode } from "../services/email";
import { renderTemplate } from "../utils/template";

const router = Router();
const emailConfig = config.email;

router.get("/gmail", (req: Request, res: Response) => {
  const { smtpOAuthClientId, smtpOAuthClientSecret, oauthRedirectUri } =
    emailConfig;

  if (!smtpOAuthClientId || !smtpOAuthClientSecret) {
    const redirectUri =
      oauthRedirectUri || "http://localhost:4000/auth/gmail/callback";
    const envBlock = `SMTP_USER=your-email@gmail.com
SMTP_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
SMTP_OAUTH_CLIENT_SECRET=your-client-secret
SMTP_OAUTH_REDIRECT_URI=${redirectUri}
FEEDBACK_EMAIL=recipient@gmail.com`;
    const html = renderTemplate("auth-missing-config", {
      oauthRedirectUri: redirectUri,
      envBlockRaw: envBlock,
    });
    return res.status(400).send(html);
  }

  try {
    const authUrl = getAuthUrl();
    res.redirect(authUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const html = renderTemplate("auth-error", { message });
    res.status(500).send(html);
  }
});

router.get("/gmail/callback", async (req: Request, res: Response) => {
  const { code } = req.query;

  if (!code || typeof code !== "string") {
    const html = renderTemplate("auth-callback-missing-code", {});
    return res.status(400).send(html);
  }

  const { smtpOAuthClientId, smtpOAuthClientSecret } = emailConfig;

  if (!smtpOAuthClientId || !smtpOAuthClientSecret) {
    const html = renderTemplate("auth-callback-missing-oauth", {});
    return res.status(500).send(html);
  }

  try {
    const tokens = await getTokensFromCode(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      const html = renderTemplate("auth-callback-no-refresh-token", {});
      return res.status(400).send(html);
    }

    const html = renderTemplate("auth-callback-success", {
      refreshTokenRaw: refreshToken,
    });
    res.send(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const html = renderTemplate("auth-callback-error", { message });
    res.status(500).send(html);
  }
});

export default router;
