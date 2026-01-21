import { pubClient } from "../socket/redis/client";
import { Room, Player } from "../types/interfaces";
import { getFullRoom } from "./room.service";

/**
 * Clean up stale players from a room
 *
 * Removes players when BOTH conditions are met:
 * 1. Heartbeat expired (player hasn't sent heartbeat in PLAYER_TTL seconds)
 * 2. Socket.IO connection is disconnected (Socket.IO ping/pong detected disconnect)
 *
 * Socket.IO automatically disconnects clients that don't respond to pings within pingTimeout.
 * With pingInterval: 5000ms and pingTimeout: 10000ms, dead connections (e.g., from PC sleep)
 * are detected within 10-15 seconds and automatically disconnected by Socket.IO.
 *
 * This prevents removing active players who are just taking time to think.
 */
export async function getRoomWithCleanup(
  roomCode: string,
  io?: any
): Promise<Room | null> {
  const playerKey = `room:${roomCode}:players`;
  const metaKey = `room:${roomCode}:meta`;
  const playersRaw = await pubClient.hGetAll(playerKey);

  // If no players exist, room is dead
  if (!playersRaw || Object.keys(playersRaw).length === 0) return null;

  // Get room state before cleanup to track indices
  const roomBefore = await getFullRoom(roomCode);
  if (!roomBefore) return null;

  let needsUpdate = false;
  let wasHostRemoved = false;
  const removedSocketIds: string[] = [];

  // Loop through players and check heartbeat keys
  for (const socketId of Object.keys(playersRaw)) {
    const heartbeatActive = await pubClient.exists(
      `player:${roomCode}:${socketId}`
    );

    // Only remove if heartbeat expired AND socket is disconnected
    if (!heartbeatActive) {
      // Check if socket is still connected via Socket.IO
      // Socket.IO automatically sets socket.connected = false when ping/pong fails
      // This happens when PC sleeps and can't respond to pings within pingTimeout (10s)
      let socketConnected = false;
      if (io) {
        const socket = io.sockets.sockets.get(socketId);
        socketConnected = socket?.connected === true;
      }

      // Only remove if socket is actually disconnected (not just heartbeat expired)
      // Socket.IO's ping/pong mechanism ensures this is accurate for PC sleep scenarios
      if (!socketConnected) {
        const player = roomBefore.players.find((p) => p.id === socketId);
        if (player?.isHost) {
          wasHostRemoved = true;
        }
        removedSocketIds.push(socketId);
        await pubClient.hDel(playerKey, socketId);
        await pubClient.del(`player:${roomCode}:${socketId}`);
        needsUpdate = true;
      }
    }
  }

  // Get room after cleanup
  const room = await getFullRoom(roomCode);
  if (!room || room.players.length === 0) {
    // Aggressively clean up empty rooms
    const pipeline = pubClient.multi();
    pipeline.del(metaKey);
    pipeline.del(playerKey);
    for (const socketId of removedSocketIds) {
      pipeline.del(`player:${roomCode}:${socketId}`);
    }
    await pipeline.exec();
    return null;
  }

  if (needsUpdate) {
    // Reassign host if needed
    if (wasHostRemoved && !room.players.some((p) => p.isHost)) {
      room.players[0].isHost = true;
      await pubClient.hSet(
        playerKey,
        room.players[0].id,
        JSON.stringify(room.players[0])
      );
    }

    // Handle turn index adjustment if players were removed
    if (removedSocketIds.length > 0 && room.players.length > 0) {
      const meta = await pubClient.hGetAll(metaKey);
      let currentIdx = parseInt(meta.currentPlayerIndex || "0");

      // Get indices of removed players in the original player list
      const removedIndices = roomBefore.players
        .map((p, idx) => (removedSocketIds.includes(p.id) ? idx : -1))
        .filter((idx) => idx !== -1)
        .sort((a, b) => a - b);

      let wasCurrentPlayerRemoved = false;
      let playersRemovedBeforeCurrent = 0;

      for (const removedIdx of removedIndices) {
        if (removedIdx === currentIdx) {
          wasCurrentPlayerRemoved = true;
          break;
        } else if (removedIdx < currentIdx) {
          playersRemovedBeforeCurrent++;
        }
      }

      if (wasCurrentPlayerRemoved) {
        // The active player was removed - move to next player
        currentIdx =
          currentIdx >= room.players.length
            ? currentIdx % room.players.length
            : Math.min(currentIdx, room.players.length - 1);
        // Reset flipped state since active player is gone
        await pubClient.hSet(metaKey, "isFlipped", "false");
      } else {
        // Adjust currentIdx by subtracting players removed before it
        currentIdx = Math.max(0, currentIdx - playersRemovedBeforeCurrent);
      }

      // Ensure currentIdx is within bounds
      currentIdx = Math.min(currentIdx, room.players.length - 1);

      // Save the updated index
      await pubClient.hSet(
        metaKey,
        "currentPlayerIndex",
        currentIdx.toString()
      );
    }
  }

  return room;
}
