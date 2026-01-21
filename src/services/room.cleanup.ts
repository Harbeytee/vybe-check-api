import { pubClient } from "../socket/redis/client";
import { Room } from "../types/interfaces";
import { getFullRoom } from "./room.service";

export async function getRoomWithCleanup(
  roomCode: string
): Promise<Room | null> {
  const playerKey = `room:${roomCode}:players`;
  const playersRaw = await pubClient.hGetAll(playerKey);

  // If no players exist, room is dead
  if (!playersRaw || Object.keys(playersRaw).length === 0) return null;

  let needsUpdate = false;

  // Loop through players and check heartbeat keys
  for (const socketId of Object.keys(playersRaw)) {
    const active = await pubClient.exists(`player:${roomCode}:${socketId}`);

    // Player heartbeat expired → remove them
    if (!active) {
      await pubClient.hDel(playerKey, socketId);
      needsUpdate = true;
    }
  }

  const room = await getFullRoom(roomCode);
  if (!room || room.players.length === 0) {
    await pubClient.del([`room:${roomCode}:meta`, `room:${roomCode}:players`]);
    return null;
  }

  if (needsUpdate && !room.players.some((p) => p.isHost)) {
    room.players[0].isHost = true;
    await pubClient.hSet(
      playerKey,
      room.players[0].id,
      JSON.stringify(room.players[0])
    );
  }
  return room;
}
