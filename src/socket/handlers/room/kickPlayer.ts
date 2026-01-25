import { Socket } from "socket.io";
import { pubClient } from "../../redis/client";
import { Player } from "../../../types/interfaces";
import { getFullRoom } from "../../../services/room.service";

export default function kickPlayer({
  socket,
  io,
}: {
  socket: Socket;
  io: any;
}) {
  return async (
    { roomCode, playerIdToKick }: { roomCode: string; playerIdToKick: string },
    cb: any
  ) => {
    const code = roomCode.toUpperCase();
    const playerKey = `room:${code}:players`;
    const metaKey = `room:${code}:meta`;

    // Skip cleanup - we know exactly which player to remove, no need to check all players
    // This removes the main bottleneck (~100-200ms saved)

    // 1. Get players and metadata in parallel (faster than sequential)
    const [playersRaw, meta] = await Promise.all([
      pubClient.hGetAll(playerKey),
      pubClient.hGetAll(metaKey),
    ]);

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

    // 3. Disconnect kicked player's socket asap (before Redis operations)
    // disconnect happens fast so ui is instant ( helps with ux)
    const kickedPlayerSocket = io.sockets.sockets.get(playerIdToKick);
    if (kickedPlayerSocket) {
      kickedPlayerSocket.leave(code);
      kickedPlayerSocket.data.roomCode = undefined;
      kickedPlayerSocket.emit("player_kicked", {
        roomCode: code,
        message: "You have been kicked from the room by the host",
      });
    }

    // 4. Get current turn index and calculate adjustments
    let currentIdx = parseInt(meta.currentPlayerIndex || "0");
    const kickedPlayerIdx = players.findIndex((p) => p.id === playerIdToKick);
    const remainingCount = players.length - 1;

    // 5. Handle empty room case
    if (remainingCount === 0) {
      await pubClient.del([
        metaKey,
        playerKey,
        `player:${code}:${playerIdToKick}`,
      ]);
      return cb({ success: true, message: "Player kicked, room is now empty" });
    }

    // 6. Prepare Redis operations using pipeline (faster than individual operations)
    const pipeline = pubClient.multi();
    pipeline.hDel(playerKey, playerIdToKick);
    pipeline.del(`player:${code}:${playerIdToKick}`);

    // 7. Handle turn index adjustment
    if (kickedPlayerIdx === currentIdx) {
      // The active player was kicked. Move to next player.
      currentIdx = currentIdx % remainingCount;
      pipeline.hSet(metaKey, "isFlipped", "false");
    } else if (kickedPlayerIdx < currentIdx) {
      // Someone before the active player was kicked.
      currentIdx = Math.max(0, currentIdx - 1);
    }

    pipeline.hSet(metaKey, "currentPlayerIndex", currentIdx.toString());

    // 8. Execute all Redis operations in one batch (much faster)
    await pipeline.exec();

    // 9. Get updated room and broadcast IMMEDIATELY
    const finalRoom = await getFullRoom(code);

    // Emit events immediately - don't wait for anything else
    io.to(code).emit("player_left", {
      leavingPlayer: targetPlayer,
      room: finalRoom,
      kicked: true,
    });
    io.to(code).emit("room_updated", finalRoom);
  };
}
