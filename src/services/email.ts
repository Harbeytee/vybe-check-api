import nodemailer from "nodemailer";
import { OAuth2Client } from "google-auth-library";
import config from "../config/config";

const emailConfig = config.email;

const hasOAuth2 =
  Boolean(emailConfig.smtpUser) &&
  Boolean(emailConfig.smtpOAuthClientId) &&
  Boolean(emailConfig.smtpOAuthClientSecret);

/**
 * Create OAuth2Client for Gmail API
 */
function createOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    emailConfig.smtpOAuthClientId,
    emailConfig.smtpOAuthClientSecret,
    emailConfig.oauthRedirectUri
  );
}

/**
 * Generate authorization URL for OAuth2 setup
 * This is used by the /auth/gmail endpoint
 */
export function getAuthUrl(): string {
  if (!hasOAuth2) {
    throw new Error("OAuth2 credentials not configured");
  }

  const oauth2Client = createOAuth2Client();

  const scopes = ["https://www.googleapis.com/auth/gmail.send"];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // Required to get refresh token
    scope: scopes,
    prompt: "consent", // Force consent screen to get refresh token
  });

  return url;
}

/**
 * Exchange authorization code for tokens
 * This is used by the /auth/gmail/callback endpoint
 */
export async function getTokensFromCode(code: string): Promise<{
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}> {
  const oauth2Client = createOAuth2Client();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.warn(
        "Warning: No refresh token received. Make sure 'prompt=consent' is set."
      );
    }

    return tokens;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to exchange code for tokens: ${msg}`);
  }
}

/**
 * Create a Nodemailer transporter using Gmail OAuth2
 * Accepts refresh token as parameter (from environment or database)
 */
async function createOAuth2Transporter(
  refreshToken: string
): Promise<nodemailer.Transporter> {
  const oauth2Client = createOAuth2Client();

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  try {
    const { token } = await oauth2Client.getAccessToken();

    if (!token) {
      throw new Error(
        "Failed to obtain OAuth2 access token from refresh token"
      );
    }

    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: emailConfig.smtpUser,
        clientId: emailConfig.smtpOAuthClientId,
        clientSecret: emailConfig.smtpOAuthClientSecret,
        refreshToken: refreshToken,
        accessToken: token,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`OAuth2 authentication failed: ${msg}`);
  }
}

/**
 * Build email payload
 */
function buildPayload(params: { type: string; name: string; message: string }) {
  const { type, name, message } = params;
  const subject = `[Vybe Check] ${
    type === "bug" ? "Bug Report" : "Suggestion"
  }${name ? ` from ${name}` : ""}`;

  const html = [
    `<div>From: <strong>${name || "(no name)"}</strong></div>`,
    `<div>Type: <strong>${type}</strong></div>`,
    "<br>",
    `<div>${message.replace(/\n/g, "<br>")}</div>`,
  ].join("");

  return { subject, html };
}

/**
 * Send feedback email
 * Now uses refresh token from environment variable
 */
export async function sendFeedbackEmail(params: {
  type: string;
  name: string;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to = emailConfig.smtpUser;

  if (!to) {
    return {
      ok: false,
      error: "Email recipient not configured (set FEEDBACK_EMAIL in .env)",
    };
  }

  if (!hasOAuth2) {
    return {
      ok: false,
      error:
        "Email is not configured. Set SMTP_USER, SMTP_OAUTH_CLIENT_ID, and SMTP_OAUTH_CLIENT_SECRET in .env.",
    };
  }

  const refreshToken = emailConfig.smtpOAuthRefreshToken;
  if (!refreshToken) {
    return {
      ok: false,
      error:
        "OAuth2 refresh token not found. Visit /auth/gmail to authorize and add SMTP_OAUTH_REFRESH_TOKEN to .env.",
    };
  }

  let transporter: nodemailer.Transporter;
  try {
    transporter = await createOAuth2Transporter(refreshToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to create email transporter: ${msg}`,
    };
  }

  return sendViaSmtp(transporter, params, to);
}

/**
 * Send email via SMTP
 */
async function sendViaSmtp(
  transporter: nodemailer.Transporter,
  params: { type: string; name: string; message: string },
  to: string
): Promise<{ ok: boolean; error?: string }> {
  const { type, name, message } = params;
  const { subject, html } = buildPayload(params);

  const text = [
    name ? `From: ${name}` : "From: (no name)",
    `Type: ${type}`,
    "",
    message,
  ].join("\n");

  try {
    const info = await transporter.sendMail({
      from: emailConfig.from,
      to,
      subject,
      text,
      html,
    });

    console.log("Email sent successfully:", info.messageId);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /ETIMEDOUT|ECONNREFUSED|connection/i.test(msg);
    const isAuth = /auth|credential|invalid|unauthorized/i.test(msg);

    console.error("Email send error:", msg);

    return {
      ok: false,
      error: isTimeout
        ? "Could not reach the email server. Check your network."
        : isAuth
        ? "Authentication failed. Check OAuth2 credentials and refresh token."
        : `Email send failed: ${msg}`,
    };
  }
}

/**
 * Verify email configuration is working
 * Useful for health checks or testing
 */
export async function verifyEmailSetup(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    if (!hasOAuth2) {
      return {
        ok: false,
        error:
          "OAuth2 not configured (SMTP_USER, SMTP_OAUTH_CLIENT_ID, SMTP_OAUTH_CLIENT_SECRET).",
      };
    }
    const refreshToken = emailConfig.smtpOAuthRefreshToken;
    if (!refreshToken) {
      return {
        ok: false,
        error: "OAuth2 refresh token not found. Visit /auth/gmail to get one.",
      };
    }
    const transporter = await createOAuth2Transporter(refreshToken);
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
