import { nanoid } from "nanoid";
import { Socket } from "socket.io";
import { Sentry } from "../../../instrument";
import { pubClient } from "../../redis/client";
import { Player } from "../../../types/interfaces";
import { getFullRoom } from "../../../services/room.service";
import { PLAYER_TTL } from "../../../utils.ts/data";
import { trafficMonitor } from "../../../services/trafficMonitor";

export default function createRoom({ socket }: { socket: Socket }) {
  return async ({ playerName }: { playerName: string }, cb: any) => {
    const ROOM_TTL = 3600;

    // Check traffic before allowing room creation
    const trafficCheck = await trafficMonitor.checkRoomCreationAllowed();
    if (!trafficCheck.allowed) {
      return cb({
        success: false,
        message:
          trafficCheck.message ||
          "High traffic detected. Please try again in a moment.",
        highTraffic: true,
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
      pipeline.expire(`room:${code}:meta`, ROOM_TTL);
      pipeline.expire(`room:${code}:players`, ROOM_TTL);
      await pipeline.exec();

      socket.data.roomCode = code;
      socket.join(code);
      cb({ success: true, room: await getFullRoom(code), player });
    } catch (e) {
      Sentry.captureException(e, {
        tags: { source: "socket", handler: "create_room" },
      });
      cb({ success: false });
    }
  };
}
