# Vybe Check API

Backend for **Vybe Check**: a real-time multiplayer question game. This API provides Socket.IO rooms and game logic, plus HTTP endpoints for health checks, feedback email, and Gmail OAuth2 setup.

## Tech stack

- **Node.js** + **TypeScript**
- **Express** – HTTP API (health, feedback, auth callback)
- **Socket.IO** – real-time rooms and game events (with Redis adapter)
- **Redis** – room state, player heartbeats, adapter for scaling
- **Nodemailer** + **Gmail OAuth2** – feedback emails
- **Sentry** – error tracking (optional)

## Prerequisites

- Node.js 18+
- Redis (local or hosted)
- pnpm (or npm/yarn)

## Quick start

```bash
# Install dependencies
pnpm install

# Set environment variables (see below)
cp .env.example .env

# Development
pnpm run dev

# Build
pnpm run build

# Production
pnpm start
```

The server listens on **port 4000** (HTTP + Socket.IO on the same server).

---

## Environment variables

Create a `.env` file in the project root.

### Required (core)

| Variable         | Description                  | Example                  |
| ---------------- | ---------------------------- | ------------------------ |
| `REDIS_HOST`     | Redis host                   | `localhost` or Redis URL |
| `REDIS_PASSWORD` | Redis password (if required) | `your-redis-password`    |

### Optional (core)

| Variable     | Description           | Default       |
| ------------ | --------------------- | ------------- |
| `NODE_ENV`   | Environment           | `development` |
| `SENTRY_DSN` | Sentry DSN for errors | –             |

### Email (feedback + Gmail OAuth2)

Feedback is sent via Gmail OAuth2 only (no app password).

| Variable                   | Description                                       | Required |
| -------------------------- | ------------------------------------------------- | -------- |
| `SMTP_USER`                | Gmail address used to send (and receive feedback) | Yes\*    |
| `SMTP_OAUTH_CLIENT_ID`     | Google OAuth2 client ID                           | Yes\*    |
| `SMTP_OAUTH_CLIENT_SECRET` | Google OAuth2 client secret                       | Yes\*    |
| `SMTP_OAUTH_REFRESH_TOKEN` | OAuth2 refresh token (see “Gmail OAuth2” below)   | Yes\*    |
| `GMAIL_OAUTH_REDIRECT_URI` | OAuth2 redirect URI                               | No\*\*   |
| `SMTP_FROM`                | Sender shown in emails                            | No\*\*\* |

\* Required to send feedback.  
\*\* Default: `http://localhost:4000/auth/gmail/callback`. Set if your app URL/port differs.  
\*\*\* Default: `Vybe Check <noreply@vybecheck.com>`.

---

## Gmail OAuth2 setup

1. **Google Cloud Console**  
   Create a project, enable the Gmail API, and create an **OAuth 2.0 Client ID** (e.g. “Web application”). Add this **Authorized redirect URI**:

   ```text
   http://localhost:4000/auth/gmail/callback
   ```

   (Use your real URL/port if different.)

2. **.env**  
   Set:

   ```env
   SMTP_USER=yourname@gmail.com
   SMTP_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
   SMTP_OAUTH_CLIENT_SECRET=GOCSPX-xxx
   FEEDBACK_EMAIL=yourname@gmail.com
   ```

   (Feedback is currently sent to `SMTP_USER`; the error message may still refer to `FEEDBACK_EMAIL` for clarity.)

3. **Get refresh token**  
   Start the server and open in a browser:

   ```text
   http://localhost:4000/auth/gmail
   ```

   Sign in with the Gmail account above, allow access, then copy the **refresh token** from the success page into `.env`:

   ```env
   SMTP_OAUTH_REFRESH_TOKEN=1//0xxxx...
   ```

4. Restart the server. Feedback emails will be sent via Gmail OAuth2.

---

## API reference

### HTTP

| Method | Path                   | Description                                       |
| ------ | ---------------------- | ------------------------------------------------- |
| GET    | `/health`              | Health check (JSON)                               |
| POST   | `/feedback`            | Submit feedback (body: `type`, `name`, `message`) |
| GET    | `/auth/gmail`          | Start Gmail OAuth2 flow (redirect)                |
| GET    | `/auth/gmail/callback` | OAuth2 callback; shows refresh token              |
| GET    | `/email/verify`        | Verify email config (JSON)                        |

### Socket.IO events (client → server)

- **Rooms:** `create_room`, `join_room`, `rejoin_room`, `heartbeat`, `kick_player`
- **Game:** `select_pack`, `start_game`, `flip_card`, `next_question`, `add_custom_question`, `remove_custom_question`

The server emits room and game updates (e.g. `room_updated`, `player_left`, `player_kicked`) to the appropriate rooms. Connect to the same origin/port as the HTTP server (e.g. `http://localhost:4000`).

---

## Project structure

```text
src/
├── app.ts              # Express app, mounts routes
├── server.ts           # HTTP server + Socket.IO
├── config/
│   └── config.ts       # Env-based config
├── routes/             # HTTP routes
│   ├── index.ts
│   ├── health.ts
│   ├── feedback.ts
│   ├── auth.ts         # Gmail OAuth2 flow
│   └── email.ts        # /email/verify
├── services/
│   ├── email.ts        # Gmail OAuth2 + Nodemailer
│   ├── room.service.ts
│   ├── room.cleanup.ts
│   └── trafficMonitor.ts
├── socket/
│   ├── socket.ts       # Socket.IO setup, event wiring
│   ├── redis/          # Redis client + adapter
│   └── handlers/       # Room + game + disconnect
├── templates/          # HTML for auth/error pages
└── utils/
    └── template.ts     # Simple HTML template helper
```

---

## Scripts

| Script     | Command             | Description              |
| ---------- | ------------------- | ------------------------ |
| `dev`      | `pnpm run dev`      | Run with ts-node-dev     |
| `build`    | `pnpm run build`    | Lint + TypeScript build  |
| `start`    | `pnpm start`        | Run `dist/src/server.js` |
| `lint`     | `pnpm run lint`     | ESLint                   |
| `lint:fix` | `pnpm run lint:fix` | ESLint with auto-fix     |

---

## License

See [LICENSE](LICENSE).
