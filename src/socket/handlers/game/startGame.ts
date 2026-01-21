import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { mappedGamePacks } from "../../../utils.ts/data";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";

export default function startGame({ io }: { io: any }) {
  return async ({ roomCode }: { roomCode: string }, cb: any) => {
    // Clean up stale players before processing action
    const room = await getRoomWithCleanup(roomCode, io);
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
