import { Socket } from "socket.io";
import { getRoomWithCleanup } from "../../../services/room.cleanup";
import { getFullRoom } from "../../../services/room.service";
import { PLAYER_TTL } from "../../../utils.ts/data";
import { pubClient } from "../../redis/client";

export default function rejoinRoom({ socket }: { socket: Socket }) {
  return async (
    { roomCode, playerName }: { roomCode: string; playerName: string },
    cb: any
  ) => {
    const code = roomCode.toUpperCase();
    const room = await getRoomWithCleanup(code);
    if (!room) return cb({ success: false, message: "Session expired" });

    const existing = room.players.find((p) => p.name === playerName);
    if (existing) {
      await pubClient.hDel(`room:${code}:players`, existing.id);
      existing.id = socket.id;
      await pubClient.hSet(
        `room:${code}:players`,
        socket.id,
        JSON.stringify(existing)
      );
      await pubClient.set(`player:${code}:${socket.id}`, "active", {
        EX: PLAYER_TTL,
      });
      socket.data.roomCode = code;
      socket.join(code);
      cb({ success: true, room: await getFullRoom(code), player: existing });
    } else {
      cb({ success: false });
    }
  };
}
