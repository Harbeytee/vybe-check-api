import { Socket } from "socket.io";
import { pubClient } from "../../redis/client";
import { Player } from "../../../types/interfaces";
import { getFullRoom } from "../../../services/room.service";
import { getRoomWithCleanup } from "../../../services/room.cleanup";

export default function kickPlayer({ socket, io }: { socket: Socket; io: any }) {
  return async (
    { roomCode, playerIdToKick }: { roomCode: string; playerIdToKick: string },
    cb: any
  ) => {
    const code = roomCode.toUpperCase();
    const playerKey = `room:${code}:players`;
    const metaKey = `room:${code}:meta`;

    // Clean up stale players first
    await getRoomWithCleanup(code, io);

    // 1. Verify requester is in the room and is the host
    const playersRaw = await pubClient.hGetAll(playerKey);
    const players: Player[] = Object.values(playersRaw).map((p) =>
      JSON.parse(p)
    );

    const requester = players.find((p) => p.id === socket.id);
    if (!requester) {
      return cb({ success: false, message: "You are not in this room" });
    }

    if (!requester.isHost) {
      return cb({ success: false, message: "Only the host can kick players" });
    }

    // 2. Verify target player exists and is not the host
    const targetPlayer = players.find((p) => p.id === playerIdToKick);
    if (!targetPlayer) {
      return cb({ success: false, message: "Player not found" });
    }

    if (targetPlayer.isHost) {
      return cb({ success: false, message: "Cannot kick the host" });
    }

    // 3. Get room metadata to handle turn logic
    const meta = await pubClient.hGetAll(metaKey);
    let currentIdx = parseInt(meta.currentPlayerIndex || "0");

    // 4. Remove kicked player from Redis
    await pubClient.hDel(playerKey, playerIdToKick);
    await pubClient.del(`player:${code}:${playerIdToKick}`);

    // 5. Get remaining players
    const remainingPlayersRaw = await pubClient.hGetAll(playerKey);
    const remainingPlayers: Player[] = Object.values(remainingPlayersRaw)
      .map((p) => JSON.parse(p))
      .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1));

    // Check if room is empty
    if (remainingPlayers.length === 0) {
      await pubClient.del([metaKey, playerKey]);
      return cb({ success: true, message: "Player kicked, room is now empty" });
    }

    // 6. Handle turn index adjustment if kicked player was current player
    const kickedPlayerIdx = players.findIndex((p) => p.id === playerIdToKick);

    if (kickedPlayerIdx === currentIdx) {
      // The active player was kicked. Move to next player.
      currentIdx = currentIdx % remainingPlayers.length;
      // Reset flipped state since active player is gone
      await pubClient.hSet(metaKey, "isFlipped", "false");
    } else if (kickedPlayerIdx < currentIdx) {
      // Someone before the active player was kicked.
      // Shift index down by 1 to keep the pointer on the same person.
      currentIdx = Math.max(0, currentIdx - 1);
    }

    // Save the updated index
    await pubClient.hSet(metaKey, "currentPlayerIndex", currentIdx.toString());

    // 7. Disconnect the kicked player's socket
    const kickedPlayerSocket = io.sockets.sockets.get(playerIdToKick);
    if (kickedPlayerSocket) {
      kickedPlayerSocket.leave(code);
      kickedPlayerSocket.data.roomCode = undefined;
      kickedPlayerSocket.emit("player_kicked", {
        roomCode: code,
        message: "You have been kicked from the room by the host",
      });
    }

    // 8. Get updated room and broadcast
    const finalRoom = await getFullRoom(code);
    io.to(code).emit("player_left", {
      leavingPlayer: targetPlayer,
      room: finalRoom,
      kicked: true, // Indicate this was a kick, not a voluntary leave
    });
    io.to(code).emit("room_updated", finalRoom);

    cb({ success: true, message: `${targetPlayer.name} has been kicked` });
  };
}
