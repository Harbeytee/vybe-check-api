import http from "http";
import "dotenv/config";
import app from "./app";
import { initSocket } from "./socket";
import config from "./config/config";
import { cleanupAllRooms, cleanupEmptyRooms } from "./services/room.cleanup";
import { trafficMonitor } from "./services/trafficMonitor";
import { PLAYER_TTL } from "./utils.ts/data";

const port = config.port;
const server = http.createServer(app);

// Background cleanup intervals optimized for free tier
const CLEANUP_INTERVAL_MS = (PLAYER_TTL + 5) * 1000; // 20s - full cleanup with stale players
const EMPTY_ROOM_CLEANUP_MS = 30000; // 30s - aggressive empty room cleanup for memory
const TRAFFIC_BROADCAST_MS = 60000; // 60s - broadcast traffic status to all clients

const start = async () => {
  try {
    const io = await initSocket(server);
    server.listen(port, () => {
      console.log(`Server is listening on port ${port}...`);

      // Full cleanup - removes stale players from active rooms
      setInterval(async () => {
        await cleanupAllRooms(io);
      }, CLEANUP_INTERVAL_MS);

      // Aggressive empty room cleanup - frees memory on free tier
      setInterval(async () => {
        await cleanupEmptyRooms();
      }, EMPTY_ROOM_CLEANUP_MS);

      // Traffic monitor cleanup
      setInterval(() => {
        trafficMonitor.cleanup();
      }, 60000);

      // Broadcast traffic status to all connected clients
      setInterval(async () => {
        try {
          const status = await trafficMonitor.getTrafficStatus(io);
          // Only broadcast if traffic is high or critical
          if (status.level !== "normal") {
            io.emit("traffic_status", status);
          }
        } catch (error) {
          console.error("Error broadcasting traffic status:", error);
        }
      }, TRAFFIC_BROADCAST_MS);

      console.log(
        `Periodic room cleanup started (every ${CLEANUP_INTERVAL_MS / 1000}s)`
      );
      console.log(
        `Empty room cleanup started (every ${EMPTY_ROOM_CLEANUP_MS / 1000}s)`
      );
      console.log(
        `Traffic status broadcast started (every ${
          TRAFFIC_BROADCAST_MS / 1000
        }s)`
      );
    });
  } catch (error) {
    console.log(error);
  }
};

start();
