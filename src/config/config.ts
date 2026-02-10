import "dotenv/config";

const config = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || "development",
  redis: {
    password: process.env.REDIS_PASSWORD,
    host: process.env.REDIS_HOST,
    serverId: process.env.SERVER_ID,
    url: process.env.REDIS_URL,
  },
  sentryDSn: process.env.SENTRY_DSN,
};

export default config;
