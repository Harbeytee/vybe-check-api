import { createClient } from "redis";
import config from "../../config/config";
import { createAdapter } from "@socket.io/redis-adapter";

export const pubClient = createClient({
  socket: {
    host: config.redis.host,
    port: 11115,
    keepAlive: true,
    connectTimeout: 10000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
  password: config.redis.password,
});

export const subClient = pubClient.duplicate();

pubClient.on("error", (err) => console.error("❌ Redis Client Error:", err));
subClient.on("error", (err) =>
  console.error("❌ Redis Sub Client Error:", err)
);

export const getRedisAdapter = () => createAdapter(pubClient, subClient);

export async function connectRedis() {
  await Promise.all([pubClient.connect(), subClient.connect()]);
  console.log("✅ Redis Hash-Store Connectedd");
}
