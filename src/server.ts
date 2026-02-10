import "dotenv/config";
import "./instrument";
import http from "http";
import { Sentry } from "./instrument";
import app from "./app";
import { initSocket } from "./socket";
import config from "./config/config";

const port = config.port;
const server = http.createServer(app);

const start = async () => {
  try {
    await initSocket(server);
    server.listen(port, () =>
      console.log(`Server is listening on port ${port}...`)
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "server", phase: "start" },
    });
    console.error(error);
    process.exit(1);
  }
};

start();
