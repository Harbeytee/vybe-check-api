import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";
import { getRoomWithCleanup } from "../../../services/room.cleanup";

export default function flipCard({ io }: { io: any }) {
  return async ({ roomCode }: { roomCode: string }) => {
    // Clean up stale players before processing action
    const room = await getRoomWithCleanup(roomCode, io);
    if (!room) return;

    await pubClient.hSet(`room:${roomCode}:meta`, "isFlipped", "true");
    io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
  };
}
