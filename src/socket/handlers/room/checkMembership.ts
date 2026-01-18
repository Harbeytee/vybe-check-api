import { Socket } from "socket.io";
import { validatePlayerInRoom } from "../../../services/room.validator";

/**
 * Check room membership - allows frontend to poll if user is still in room
 * Used to detect when user has been removed after sleep/disconnect
 */
export default function checkMembership({ socket, io }: { socket: Socket; io: any }) {
  return async ({ roomCode }: { roomCode: string }, cb: any) => {
    if (!roomCode) {
      return cb({ success: false, inRoom: false });
    }

    const { room, isValid } = await validatePlayerInRoom(socket, roomCode, io);

    if (!isValid) {
      // Player not in room - already emitted events in validatePlayerInRoom
      return cb({ 
        success: false, 
        inRoom: false,
        roomCode,
        redirect: `/?${roomCode}`,
      });
    }

    // Player is still in room
    return cb({ 
      success: true, 
      inRoom: true, 
      room,
    });
  };
}
