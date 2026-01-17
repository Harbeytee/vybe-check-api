import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { PLAYER_TTL } from "../../../utils.ts/data";
import { pubClient } from "../../redis/client";

const ROOM_TTL = 1800; // 30 minutes - same as createRoom

export default function heartbeat({ socket, io }: { socket: Socket; io: any }) {
  return async ({ roomCode }: { roomCode: string }) => {
    if (!roomCode) return;

    const playerKey = `room:${roomCode}:players`;
    const metaKey = `room:${roomCode}:meta`;

    // Mark player as active by refreshing heartbeat
    await pubClient.set(`player:${roomCode}:${socket.id}`, "active", {
      EX: PLAYER_TTL,
    });

    // Refresh room TTL to prevent deletion during active gameplay
    // This ensures rooms stay alive as long as players are active
    const pipeline = pubClient.multi();
    pipeline.expire(metaKey, ROOM_TTL);
    pipeline.expire(playerKey, ROOM_TTL);
    await pipeline.exec();

    // Periodic Broadcast: Clean and sync room state for everyone
    const room = await getRoomWithCleanup(roomCode);
    if (room) {
      io.to(roomCode).emit("room_updated", room);
    }
  };
}
