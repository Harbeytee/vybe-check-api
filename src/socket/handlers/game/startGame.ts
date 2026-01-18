import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { mappedGamePacks } from "../../../utils.ts/data";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";
import { validatePlayerInRoom } from "../../../services/room.validator";

export default function startGame({ socket, io }: { socket: Socket; io: any }) {
  return async ({ roomCode }: { roomCode: string }, cb: any) => {
    // Validate player is still in room before allowing action
    const { isValid } = await validatePlayerInRoom(socket, roomCode, io);
    if (!isValid) {
      return cb({ success: false, message: "You are no longer in this room" });
    }

    const room = await getRoomWithCleanup(roomCode);
    const pack = mappedGamePacks.find((p) => p.id == room?.selectedPack);
    if (!room || !pack) return cb({ success: false });

    const pool = [...pack.questions, ...room.customQuestions];
    const first = pool[Math.floor(Math.random() * pool.length)];

    await pubClient.hSet(`room:${roomCode}:meta`, {
      isStarted: "true",
      currentQuestion: first.text,
      answeredQuestions: JSON.stringify([first.id]),
      currentPlayerIndex: Math.floor(
        Math.random() * room.players.length
      ).toString(),
      totalQuestions: pool.length,
    });
    io.to(roomCode).emit("game_started", await getFullRoom(roomCode));
    cb({ success: true });
  };
}
