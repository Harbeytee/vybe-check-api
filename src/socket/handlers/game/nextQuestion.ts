import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { mappedGamePacks } from "../../../utils.ts/data";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";

export default function nextQuestion({ io }: { io: any }) {
  return async ({ roomCode }: { roomCode: string }) => {
    // Clean up stale players before processing action
    const room = await getRoomWithCleanup(roomCode, io);
    if (!room) return;
    const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
    const pool = [...(pack?.questions || []), ...room.customQuestions];
    const available = pool.filter(
      (q) => !room.answeredQuestions.includes(q.id)
    );

    //if (available.length === 0)   return io.to(roomCode).emit("game_over");

    if (available.length === 0) {
      await pubClient.hSet(`room:${roomCode}:meta`, "isFinished", "true");
      io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
      return;
    }

    const next = available[Math.floor(Math.random() * available.length)];
    await pubClient.hSet(`room:${roomCode}:meta`, {
      currentQuestion: next.text,
      isFlipped: "false",
      answeredQuestions: JSON.stringify([...room.answeredQuestions, next.id]),
      currentPlayerIndex: (
        (room.currentPlayerIndex + 1) %
        room.players.length
      ).toString(),
    });
    io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
  };
}
