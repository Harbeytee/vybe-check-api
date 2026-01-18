import { Socket } from "socket.io";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";
import { validatePlayerInRoom } from "../../../services/room.validator";

export default function flipCard({ socket, io }: { socket: Socket; io: any }) {
  return async ({ roomCode }: { roomCode: string }) => {
    // Validate player is still in room before allowing action
    const { isValid } = await validatePlayerInRoom(socket, roomCode, io);
    if (!isValid) return; // Player not in room - validation already emitted events

    await pubClient.hSet(`room:${roomCode}:meta`, "isFlipped", "true");
    io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
  };
}
