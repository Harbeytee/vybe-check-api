import { Socket } from "socket.io";
import { pubClient } from "../redis/client";
import { Player } from "../../types/interfaces";
import { getFullRoom } from "../../services/room.service";

export default function disconnect({
  socket,
  io,
}: {
  socket: Socket;
  io: any;
}) {
  return async () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const playerKey = `room:${code}:players`;
    const metaKey = `room:${code}:meta`;

    // 1. Get current players to identify the leaving player
    const playersRaw = await pubClient.hGetAll(playerKey);
    const players: Player[] = Object.values(playersRaw).map((p) =>
      JSON.parse(p)
    );

    const idx = players.findIndex((p) => p.id === socket.id);
    if (idx === -1) return;

    const leavingPlayer = players[idx];
    const wasHost = leavingPlayer.isHost;

    // 2. Remove leaving player from Redis
    await pubClient.hDel(playerKey, socket.id);
    await pubClient.del(`player:${code}:${socket.id}`);

    // 3. Get room metadata to handle turn logic
    const meta = await pubClient.hGetAll(metaKey);
    let currentIdx = parseInt(meta.currentPlayerIndex || "0");

    // 4. Fetch remaining players
    const remainingPlayersRaw = await pubClient.hGetAll(playerKey);
    const remainingPlayers: Player[] = Object.values(remainingPlayersRaw)
      .map((p) => JSON.parse(p))
      .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1));

    // Check if room is empty
    if (remainingPlayers.length === 0) {
      await pubClient.del([metaKey, playerKey]);
      return;
    }

    // if leaving player was the host, reassign host
    if (wasHost) {
      remainingPlayers[0].isHost = true;
      await pubClient.hSet(
        playerKey,
        remainingPlayers[0].id,
        JSON.stringify(remainingPlayers[0])
      );
      io.to(code).emit("new_host_toast", { name: remainingPlayers[0].name });
    }

    if (idx === currentIdx) {
      // The active player left. Move to next player.
      // If they were the last in the list, loop back to 0.
      currentIdx = currentIdx % remainingPlayers.length;

      // If it was the active player's turn, we also reset the "flipped" state
      // so the new player starts with a fresh card.
      await pubClient.hSet(metaKey, "isFlipped", "false");
    } else if (idx < currentIdx) {
      // Someone before the active player left.
      // Shift index down by 1 to keep the pointer on the same person.
      currentIdx = Math.max(0, currentIdx - 1);
    }

    // Save the updated index
    await pubClient.hSet(metaKey, "currentPlayerIndex", currentIdx.toString());

    // 5. Final Sync
    const finalRoom = await getFullRoom(code);
    io.to(code).emit("player_left", { leavingPlayer, room: finalRoom });
    io.to(code).emit("room_updated", finalRoom);
  };
}
