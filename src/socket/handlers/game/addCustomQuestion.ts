import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { nanoid } from "nanoid";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";

export default function addCustomQuestion({ io }: { io: any }) {
  return async ({
    roomCode,
    question,
  }: {
    roomCode: string;
    question: string;
  }) => {
    // Clean up stale players before processing action
    const room = await getRoomWithCleanup(roomCode, io);
    if (!room) return;
    const list = [...room.customQuestions, { id: nanoid(), text: question }];
    await pubClient.hSet(
      `room:${roomCode}:meta`,
      "customQuestions",
      JSON.stringify(list)
    );
    io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
  };
}
