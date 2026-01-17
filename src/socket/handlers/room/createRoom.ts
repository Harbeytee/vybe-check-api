import { nanoid } from "nanoid";
import { pubClient } from "../../redis/client";
import { Player } from "../../../types/interfaces";
import { getFullRoom } from "../../../services/room.service";
import { Socket } from "socket.io";
import { PLAYER_TTL } from "../../../utils.ts/data";
import { checkRateLimit } from "../../../services/rateLimiter";
import { trafficMonitor } from "../../../services/trafficMonitor";

export default function createRoom({
  socket,
  io,
}: {
  socket: Socket;
  io: any;
}) {
  return async ({ playerName }: { playerName: string }, cb: any) => {
    const ROOM_TTL = 1800; // Reduced from 3600 to 30 min to free memory faster

    // Check traffic status - pause room creation if traffic is critical
    const trafficStatus = await trafficMonitor.getTrafficStatus(io);
    if (!trafficStatus.roomCreationEnabled) {
      return cb({
        success: false,
        message:
          trafficStatus.message ||
          "Room creation temporarily paused due to high traffic. Please try again shortly.",
        trafficStatus: {
          level: trafficStatus.level,
          retryAfter: 30, // seconds
        },
      });
    }

    // Rate limiting - prevent spam on free tier
    const rateLimit = await checkRateLimit(`create_room:${socket.id}`, {
      windowMs: 60000, // 1 minute
      maxRequests: 5, // 5 rooms per minute per socket
    });

    if (!rateLimit.allowed) {
      return cb({
        success: false,
        message: `Rate limit exceeded. Try again in ${Math.ceil(
          (rateLimit.resetAt - Date.now()) / 1000
        )}s`,
      });
    }

    // Check if we should allow room creation based on traffic
    if (!trafficMonitor.shouldAllowRoomCreation()) {
      return cb({
        success: false,
        message:
          "High traffic detected. Room creation temporarily paused. Please try again in a moment.",
        trafficStatus: {
          level: "high",
          retryAfter: 15, // seconds
        },
      });
    }

    try {
      let code = "";
      let created = false;
      let attempts = 0;

      // Try up to 5 times to generate a unique room code
      while (!created && attempts < 5) {
        const candidate = nanoid(6).toUpperCase();
        const reserve = await pubClient.set(
          `room:${candidate}:meta`,
          "RESERVED",
          { NX: true, EX: 30 }
        );
        if (reserve === "OK") {
          code = candidate;
          created = true;
        }
        attempts++;
      }
      if (!created)
        return cb({ success: false, message: "Could not generate code" });

      const player: Player = {
        id: socket.id,
        name: playerName,
        isHost: true,
        lastSeen: Date.now(),
      };
      const pipeline = pubClient.multi();
      pipeline.del(`room:${code}:meta`);
      pipeline.hSet(`room:${code}:meta`, {
        isStarted: "false",
        isFlipped: "false",
        currentPlayerIndex: "0",
        customQuestions: "[]",
        answeredQuestions: "[]",
        isFinished: "false",
      });
      pipeline.hSet(`room:${code}:players`, socket.id, JSON.stringify(player));
      pipeline.set(`player:${code}:${socket.id}`, "active", {
        EX: PLAYER_TTL,
      });
      // Set TTLs with aggressive cleanup for empty rooms
      pipeline.expire(`room:${code}:meta`, ROOM_TTL);
      pipeline.expire(`room:${code}:players`, ROOM_TTL);
      // Heartbeat keys auto-expire - no need to set TTL

      await pipeline.exec();

      socket.data.roomCode = code;
      socket.join(code);

      // Record room creation for traffic monitoring
      trafficMonitor.recordRoomCreation();

      cb({ success: true, room: await getFullRoom(code), player });
    } catch (e) {
      cb({ success: false });
    }
  };
}
