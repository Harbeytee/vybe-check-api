import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { isPlayerInRoom } from "../../../services/room.validator";
import { PLAYER_TTL } from "../../../utils.ts/data";
import { pubClient } from "../../redis/client";

const ROOM_TTL = 1800; // 30 minutes - same as createRoom

export default function heartbeat({ socket, io }: { socket: Socket; io: any }) {
  return async ({ roomCode }: { roomCode: string }) => {
    if (!roomCode) return;

    // CRITICAL: Check if player is still in room before processing heartbeat
    // This detects when user was removed after sleep/disconnect
    const playerStillInRoom = await isPlayerInRoom(socket.id, roomCode);

    if (!playerStillInRoom) {
      // Player has been removed - notify them immediately
      socket.emit("player_removed_from_room", {
        roomCode,
        message: "You have been removed from the room",
        reason: "disconnected",
      });
      socket.emit("room_not_found", { roomCode });
      return; // Don't process heartbeat if not in room
    }

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
