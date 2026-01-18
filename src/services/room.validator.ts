import { Socket } from "socket.io";
import { pubClient } from "../socket/redis/client";
import { getFullRoom } from "./room.service";

/**
 * Check if a player is still in the room
 * Used to detect when user has been removed (e.g., after sleep/disconnect)
 */
export async function isPlayerInRoom(
  socketId: string,
  roomCode: string
): Promise<boolean> {
  try {
    const playerKey = `room:${roomCode}:players`;
    const playersRaw = await pubClient.hGetAll(playerKey);

    if (!playersRaw || Object.keys(playersRaw).length === 0) {
      return false; // Room doesn't exist or is empty
    }

    // Check if player exists in room
    const playerExists = Object.keys(playersRaw).includes(socketId);
    
    if (!playerExists) {
      return false; // Player not in room
    }

    // Also check if heartbeat key exists (player is still active)
    const heartbeatExists = await pubClient.exists(
      `player:${roomCode}:${socketId}`
    );

    return heartbeatExists === 1;
  } catch (error) {
    console.error(`Error checking player membership for ${socketId} in ${roomCode}:`, error);
    return false;
  }
}

/**
 * Validate player membership and return room or null
 * If player is not in room, emits error event to socket
 */
export async function validatePlayerInRoom(
  socket: Socket,
  roomCode: string,
  io?: any
): Promise<{ room: any; isValid: boolean }> {
  const isValid = await isPlayerInRoom(socket.id, roomCode);

  if (!isValid) {
    // Player has been removed from room
    const room = await getFullRoom(roomCode);
    
    // Emit event to inform client they've been removed
    socket.emit("player_removed_from_room", {
      roomCode,
      message: "You have been removed from the room",
      reason: "disconnected",
    });

    // Also emit room_not_found to trigger redirect
    socket.emit("room_not_found", { roomCode });

    return { room: null, isValid: false };
  }

  // Player is valid, get room data
  const room = await getFullRoom(roomCode);
  return { room, isValid: true };
}
