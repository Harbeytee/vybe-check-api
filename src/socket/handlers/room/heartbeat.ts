import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { PLAYER_TTL } from "../../../utils.ts/data";
import { pubClient } from "../../redis/client";

export default function heartbeat({ socket, io }: { socket: Socket; io: any }) {
  return async ({ roomCode }: { roomCode: string }) => {
    if (!roomCode) return;

    // Mark player as active by refreshing heartbeat
    await pubClient.set(`player:${roomCode}:${socket.id}`, "active", {
      EX: PLAYER_TTL,
    });

    // Periodic Broadcast: Clean and sync room state for everyone
    const room = await getRoomWithCleanup(roomCode);
    if (room) {
      io.to(roomCode).emit("room_updated", room);
    }
  };
}
