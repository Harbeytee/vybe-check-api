import "dotenv/config";

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  redis: {
    password: process.env.REDIS_PASSWORD,
    host: process.env.REDIS_HOST,
  },
  sentryDSn: process.env.SENTRY_DSN,
  email: {
    smtpUser: process.env.SMTP_USER,
    smtpOAuthClientId: process.env.SMTP_OAUTH_CLIENT_ID,
    smtpOAuthClientSecret: process.env.SMTP_OAUTH_CLIENT_SECRET,
    smtpOAuthRefreshToken: process.env.SMTP_OAUTH_REFRESH_TOKEN,
    oauthRedirectUri: process.env.GMAIL_OAUTH_REDIRECT_URI,
    from: process.env.SMTP_FROM,
  },
};

export default config;
