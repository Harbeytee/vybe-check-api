import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";

export default function flipCard({ io }: { io: any }) {
  return async ({ roomCode }: { roomCode: string }) => {
    await pubClient.hSet(`room:${roomCode}:meta`, "isFlipped", "true");
    io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
  };
}
