import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import Room from "./models/room";
import QuestionPack from "./models/question-pack";
import { nanoid } from "nanoid";

let io: Server;

export const initSocket = async (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket: Socket) => {
    console.log(`Connected: ${socket.id}`);

    // CREATE ROOM
    socket.on("create_room", async ({ playerName }, callback) => {
      try {
        const code = nanoid(6).toUpperCase();
        const player = { id: socket.id, name: playerName, isHost: true };
        const newRoom = new Room({ code, players: [player] });
        await newRoom.save();
        socket.join(code);
        callback({ success: true, room: newRoom, player });
      } catch (error) {
        callback({ success: false, message: "Failed to create room" });
      }
    });

    // JOIN ROOM
    socket.on("join_room", async ({ roomCode, playerName }, callback) => {
      try {
        const room = await Room.findOne({ code: roomCode.toUpperCase() });
        if (!room)
          return callback({ success: false, message: "Room not found" });

        const player = { id: socket.id, name: playerName, isHost: false };
        room.players.push(player);
        await room.save();
        socket.join(room.code);
        io.to(room.code).emit("room_updated", room);
        callback({ success: true, room, player });
      } catch (error) {
        callback({ success: false, message: "Error joining room" });
      }
    });

    // NEXT QUESTION
    socket.on("next_question", async ({ roomCode }: { roomCode: string }) => {
      try {
        const room = await Room.findOne({ code: roomCode });
        const pack = await QuestionPack.findOne({ id: room?.selectedPack });
        if (!room || !pack) return;

        const pool = [...pack.questions, ...room.customQuestions];
        const available = pool.filter(
          (q) => !room.answeredQuestions.includes(q.id)
        );

        // IF NO QUESTIONS LEFT: Clean up
        if (available.length === 0) {
          // 1. Delete the room from the DB
          await Room.deleteOne({ code: roomCode });
          //Tell all players the room is gone
          return io
            .to(roomCode)
            .emit("room_deleted", { message: "Game Over!" });
        }

        const selected =
          available[Math.floor(Math.random() * available.length)];
        room.currentQuestion = selected.text as string;
        room.answeredQuestions.push(selected.id);
        room.currentPlayerIndex =
          (room.currentPlayerIndex + 1) % room.players.length;

        await room.save();
        io.to(roomCode).emit("room_updated", room);
      } catch (error) {
        io.to(roomCode).emit("error", {
          message: "Something went wrong while getting the next question.",
        });
      }
    });

    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${socket.id}`);

      // 1. Find the room this player was in
      const room = await Room.findOne({ "players.id": socket.id });
      if (!room) return;

      // 2. Identify the player who is leaving
      const leavingPlayer = room.players.find((p) => p.id === socket.id);
      const wasHost = leavingPlayer?.isHost;

      // 3. Remove the player from the array
      room.players = room.players.filter((p) => p.id !== socket.id);

      //if noone is left in the room, delete the room
      if (room.players.length === 0) {
        await Room.deleteOne({ code: room.code });
        // if host left make another player the host
      } else if (wasHost) {
        room.players[0].isHost = true;

        // Save the changes
        await room.save();

        // Notify everyone about the new host
        io.to(room.code).emit("room_updated", room);
        io.to(room.code).emit("new_host_toast", {
          name: room.players[0].name,
        });
      } else {
        await room.save();
        io.to(room.code).emit("room_updated", room);
      }
    });
  });

  return io;
};

// This allows other files to use 'io' if needed (e.g., for global broadcasts)
export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};
