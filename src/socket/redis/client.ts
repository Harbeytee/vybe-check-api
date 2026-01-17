import { createClient } from "redis";
import config from "../../config/config";
import { createAdapter } from "@socket.io/redis-adapter";

// Optimized Redis client for free tier with connection pooling
export const pubClient = createClient({
  socket: {
    host: config.redis.host,
    port: 11115,
    keepAlive: true,
    connectTimeout: 10000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
  password: config.redis.password,
  // Disable expensive commands to save memory
  disableClientInfo: true,
});

export const subClient = pubClient.duplicate();

pubClient.on("error", (err) => console.error("❌ Redis Client Error:", err));
subClient.on("error", (err) =>
  console.error("❌ Redis Sub Client Error:", err)
);

// Monitor connection to detect issues early
pubClient.on("connect", () => {
  console.log("🔄 Redis connecting...");
});

pubClient.on("ready", () => {
  console.log("✅ Redis ready");
});

subClient.on("connect", () => {
  console.log("🔄 Redis Sub connecting...");
});

subClient.on("ready", () => {
  console.log("✅ Redis Sub ready");
});

export const getRedisAdapter = () => createAdapter(pubClient, subClient);

export async function connectRedis() {
  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log("✅ Redis Hash-Store Connected");
  } catch (error) {
    console.error("❌ Redis connection failed:", error);
    throw error;
  }
}
