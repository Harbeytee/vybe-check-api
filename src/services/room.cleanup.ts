import { pubClient } from "../socket/redis/client";
import { Room, Player } from "../types/interfaces";
import { getFullRoom } from "./room.service";

/**
 * Aggressively clean up empty rooms to free memory on free tier
 * This runs more frequently than the full cleanup
 */
export async function cleanupEmptyRooms(): Promise<number> {
  let cleanedCount = 0;
  let cursor: string = "0";
  const batchSize = 50;

  try {
    do {
      const result = await pubClient.scan(cursor, {
        MATCH: "room:*:players",
        COUNT: batchSize,
      });
      cursor = result.cursor.toString();

      // Check each room's player count
      for (const key of result.keys) {
        try {
          const players = await pubClient.hGetAll(key);
          // If room has no players, delete it immediately
          if (!players || Object.keys(players).length === 0) {
            const match = key.match(/^room:([A-Z0-9]+):players$/);
            if (match) {
              const code = match[1];
              const pipeline = pubClient.multi();
              pipeline.del(`room:${code}:meta`);
              pipeline.del(`room:${code}:players`);
              await pipeline.exec();
              cleanedCount++;
            }
          }
        } catch (error) {
          // Continue with other rooms if one fails
          console.error(`Error checking room ${key}:`, error);
        }
      }
    } while (cursor !== "0");
  } catch (error) {
    console.error("Error in empty room cleanup:", error);
  }

  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} empty rooms`);
  }

  return cleanedCount;
}

/**
 * Periodic cleanup job to remove stale players from all rooms
 * This ensures cleanup happens even when disconnect events fail
 * Uses SCAN instead of KEYS for non-blocking operation (critical for scale)
 */
export async function cleanupAllRooms(io: any): Promise<void> {
  try {
    const roomCodes = new Set<string>();
    let cursor: string = "0";
    const batchSize = 100; // Process in batches to avoid blocking

    // Use SCAN instead of KEYS to avoid blocking Redis
    do {
      const result = await pubClient.scan(cursor, {
        MATCH: "room:*:meta",
        COUNT: batchSize,
      });
      cursor = result.cursor.toString();

      // Extract room codes from keys
      for (const key of result.keys) {
        const match = key.match(/^room:([A-Z0-9]+):meta$/);
        if (match) {
          roomCodes.add(match[1]);
        }
      }

      // Process batch to avoid memory buildup
      if (roomCodes.size >= batchSize) {
        await processRoomCleanupBatch(Array.from(roomCodes), io);
        roomCodes.clear();
      }
    } while (cursor !== "0");

    // Process remaining rooms
    if (roomCodes.size > 0) {
      await processRoomCleanupBatch(Array.from(roomCodes), io);
    }
  } catch (error) {
    console.error("Error in periodic room cleanup:", error);
  }
}

/**
 * Process a batch of rooms for cleanup
 */
async function processRoomCleanupBatch(
  roomCodes: string[],
  io: any
): Promise<void> {
  // Process in parallel batches to improve performance
  const batchSize = 10;
  for (let i = 0; i < roomCodes.length; i += batchSize) {
    const batch = roomCodes.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (code) => {
        try {
          const cleanedRoom = await getRoomWithCleanup(code);
          if (cleanedRoom && io) {
            // Broadcast updated room state to remaining players
            io.to(code).emit("room_updated", cleanedRoom);
          }
        } catch (error) {
          console.error(`Error cleaning up room ${code}:`, error);
        }
      })
    );
  }
}

export async function getRoomWithCleanup(
  roomCode: string
): Promise<Room | null> {
  const playerKey = `room:${roomCode}:players`;
  const metaKey = `room:${roomCode}:meta`;
  const playersRaw = await pubClient.hGetAll(playerKey);

  // If no players exist, room is dead
  if (!playersRaw || Object.keys(playersRaw).length === 0) return null;

  let needsUpdate = false;
  let wasHostRemoved = false;
  const removedSocketIds: string[] = [];

  // Get current room state before cleanup to track indices
  const roomBefore = await getFullRoom(roomCode);
  if (!roomBefore) return null;

  // Loop through players and check heartbeat keys
  for (const socketId of Object.keys(playersRaw)) {
    const active = await pubClient.exists(`player:${roomCode}:${socketId}`);

    // Player heartbeat expired → remove them
    if (!active) {
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

  // Get room after cleanup
  const room = await getFullRoom(roomCode);
  if (!room || room.players.length === 0) {
    // Aggressively clean up empty rooms immediately to free memory
    const pipeline = pubClient.multi();
    pipeline.del(metaKey);
    pipeline.del(playerKey);
    // Clean up any remaining heartbeat keys
    for (const socketId of removedSocketIds) {
      pipeline.del(`player:${roomCode}:${socketId}`);
    }
    await pipeline.exec();
    return null;
  }

  if (needsUpdate) {
    // if host was removed, reassign host
    if (wasHostRemoved && !room.players.some((p) => p.isHost)) {
      room.players[0].isHost = true;
      await pubClient.hSet(
        playerKey,
        room.players[0].id,
        JSON.stringify(room.players[0])
      );
    }

    // Handle turn index updates if players were removed
    if (removedSocketIds.length > 0 && room.players.length > 0) {
      const meta = await pubClient.hGetAll(metaKey);
      let currentIdx = parseInt(meta.currentPlayerIndex || "0");

      // Get the indices of removed players in the original player list
      const removedIndices = roomBefore.players
        .map((p, idx) => (removedSocketIds.includes(p.id) ? idx : -1))
        .filter((idx) => idx !== -1)
        .sort((a, b) => a - b); // Sort to process from lowest to highest

      let wasCurrentPlayerRemoved = false;

      // Count how many players were removed before currentIdx
      let playersRemovedBeforeCurrent = 0;
      for (const removedIdx of removedIndices) {
        if (removedIdx === currentIdx) {
          wasCurrentPlayerRemoved = true;
          break; // Once we find current player was removed, we'll handle it separately
        } else if (removedIdx < currentIdx) {
          playersRemovedBeforeCurrent++;
        }
      }

      if (wasCurrentPlayerRemoved) {
        // The active player was removed. Move to next player.
        // Use modulo to wrap around or clamp to valid range
        currentIdx =
          currentIdx >= room.players.length
            ? currentIdx % room.players.length
            : Math.min(currentIdx, room.players.length - 1);
        // Reset flipped state since the active player is gone
        await pubClient.hSet(metaKey, "isFlipped", "false");
      } else {
        // Adjust currentIdx by subtracting the number of players removed before it
        currentIdx = Math.max(0, currentIdx - playersRemovedBeforeCurrent);
      }

      // Ensure currentIdx is within bounds after all adjustments
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
