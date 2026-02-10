import * as Sentry from "@sentry/node";
import { ProcessEnv } from "./types/enums";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? ProcessEnv.DEVELOPMENT,
    enabled: process.env.NEXT_PUBLIC_ENVIRONMENT == ProcessEnv.PRODUCTION,
    tracesSampleRate: 0.1,
    debug: false,
  });
}

export { Sentry };
