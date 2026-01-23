import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { Player } from "../../../types/interfaces";
import { pubClient } from "../../redis/client";
import { PLAYER_TTL } from "../../../utils.ts/data";
import { getFullRoom } from "../../../services/room.service";

export default function joinRoom({ socket, io }: { socket: Socket; io: any }) {
  return async (
    { roomCode, playerName }: { roomCode: string; playerName: string },
    cb: any
  ) => {
    const code = roomCode.toUpperCase();
    // Clean up stale players before joining
    const room = await getRoomWithCleanup(code, io);
    if (!room) return cb({ success: false, message: "Room not found" });

    const player: Player = {
      id: socket.id,
      name: playerName,
      isHost: false,
      lastSeen: Date.now(),
    };

    // Save player and heartbeat
    await pubClient.hSet(
      `room:${code}:players`,
      socket.id,
      JSON.stringify(player)
    );
    await pubClient.set(`player:${code}:${socket.id}`, "active", {
      EX: PLAYER_TTL,
    });

    socket.data.roomCode = code;
    socket.join(code);
    const updated = await getFullRoom(code);

    // Broadcast updated room
    io.to(code).emit("room_updated", updated);
    cb({ success: true, room: updated, player });
  };
}
