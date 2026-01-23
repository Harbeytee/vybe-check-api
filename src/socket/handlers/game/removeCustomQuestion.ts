import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";

export default function removeCustomQuestion({ io }: { io: any }) {
  return async ({
    roomCode,
    questionId,
  }: {
    roomCode: string;
    questionId: string;
  }) => {
    // Clean up stale players before processing action
    const room = await getRoomWithCleanup(roomCode, io);
    if (!room) return;
    const list = room.customQuestions.filter((q: any) => q.id !== questionId);
    await pubClient.hSet(
      `room:${roomCode}:meta`,
      "customQuestions",
      JSON.stringify(list)
    );
    io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
  };
}
