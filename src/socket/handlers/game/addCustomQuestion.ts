import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { nanoid } from "nanoid";
import { pubClient } from "../../redis/client";
import { getFullRoom } from "../../../services/room.service";
import { validatePlayerInRoom } from "../../../services/room.validator";

export default function addCustomQuestion({ socket, io }: { socket: Socket; io: any }) {
  return async ({
    roomCode,
    question,
  }: {
    roomCode: string;
    question: string;
  }) => {
    // Validate player is still in room before allowing action
    const { isValid } = await validatePlayerInRoom(socket, roomCode, io);
    if (!isValid) return; // Player not in room - validation already emitted events

    const room = await getRoomWithCleanup(roomCode);
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
