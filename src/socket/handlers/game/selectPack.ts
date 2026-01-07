import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";

export default function selectPack({
  socket,
  io,
}: {
  socket: Socket;
  io: any;
}) {
  return async ({ roomCode, packId }: { roomCode: string; packId: string }) => {
    const room = await getRoomWithCleanup(roomCode);
    if (!room || !room.players.find((p) => p.id === socket.id)?.isHost) return;
    await pubClient.hSet(`room:${roomCode}:meta`, "selectedPack", packId);
    io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
  };
}
