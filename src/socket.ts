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

        const existing = await Room.findOne({ code });
        if (existing) {
          // If it exists, just try again (or handle error)
          return socket.emit("error", {
            message: "Room code collision, try again!",
          });
        }
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
        const formattedCode = roomCode.toUpperCase();
        const player = { id: socket.id, name: playerName, isHost: false };

        const room = await Room.findOneAndUpdate(
          { code: formattedCode },
          { $push: { players: player } },
          { new: true, runValidators: true }
        );

        if (!room) {
          return callback({ success: false, message: "Room not found" });
        }

        socket.join(room.code);
        io.to(room.code).emit("room_updated", room);
        callback({ success: true, room, player });
      } catch (error) {
        callback({ success: false, message: "Error joining room" });
      }
    });

    socket.on("select_pack", async ({ roomCode, packId }) => {
      try {
        const formattedCode = roomCode.toUpperCase();

        // We find the room AND verify the sender is the host in one atomic query
        const room = await Room.findOneAndUpdate(
          {
            code: formattedCode,
            "players.id": socket.id,
            "players.isHost": true,
          },
          { $set: { selectedPack: packId } },
          { new: true }
        );

        if (!room) return;

        // Tell everyone so their UI updates (e.g., highlights the chosen pack)
        io.to(roomCode).emit("room_updated", room);
      } catch (err) {
        console.error(err);
      }
    });

    //START GAME
    socket.on("start_game", async ({ roomCode }, callback) => {
      try {
        const roomData = await Room.findOne({ code: roomCode });
        if (!roomData) return;

        // 1. Fetch the actual pack data
        const pack = await QuestionPack.findOne({ id: roomData.selectedPack });
        if (!pack) {
          return socket.emit("error", { message: "Selected pack not found" });
        }

        // 2. Combine all available questions (Pack + Custom)
        const pool = [...pack.questions, ...roomData.customQuestions];

        if (pool.length === 0) {
          return socket.emit("error", {
            message: "This pack has no questions!",
          });
        }

        // 4. Pick the first question correctly
        const randomIndex = Math.floor(Math.random() * pack.questions.length);
        const firstQuestion = pool[randomIndex];

        const room = await Room.findOneAndUpdate(
          {
            code: roomCode,
            "players.id": socket.id,
            "players.isHost": true,
          },
          {
            $set: {
              isStarted: true,
              currentPlayerIndex: Math.floor(
                Math.random() * roomData.players.length
              ),
              totalQuestions: pool.length,
              currentQuestion: firstQuestion.text,
              answeredQuestions: [firstQuestion.id], // Start the history with the first ID
            },
          },
          { new: true }
        );

        if (!room) {
          return callback({
            success: false,
            message: "Unauthorized or Room error",
          });
        }

        // 6. Notify everyone
        io.to(roomCode).emit("game_started", room);
        // Also emit room_updated to sync the players/question immediately
        io.to(roomCode).emit("room_updated", room);
        callback({ success: true });
      } catch (error) {
        callback({
          success: false,
          message: "Failed to start game. Try refreshing.",
        });
      }
    });

    //FLIP CARD
    socket.on("flip_card", async ({ roomCode }) => {
      const room = await Room.findOneAndUpdate(
        { code: roomCode },
        { $set: { isFlipped: true } },
        { new: true }
      );

      if (room) {
        io.to(roomCode).emit("room_updated", room);
      }
    });

    // NEXT QUESTION
    socket.on("next_question", async ({ roomCode }: { roomCode: string }) => {
      try {
        // 1. START TRANSITION (Atomic Update)
        // We set isTransitioning to true and isFlipped to false immediately
        const transitioningRoom = await Room.findOneAndUpdate(
          { code: roomCode },
          { $set: { isTransitioning: true, isFlipped: false } },
          { new: true }
        );

        if (!transitioningRoom) return;
        io.to(roomCode).emit("room_updated", transitioningRoom);

        // 2. PREPARE DATA (Logic Phase)
        // We use the data from transitioningRoom instead of a new findOne
        const pack = await QuestionPack.findOne({
          id: transitioningRoom.selectedPack,
        });

        setTimeout(async () => {
          try {
            const pool = [
              ...(pack?.questions || []),
              ...transitioningRoom.customQuestions,
            ];
            const available = pool.filter(
              (q) => !transitioningRoom.answeredQuestions.includes(q.id)
            );

            // 3. GAME OVER LOGIC
            if (available.length === 0) {
              await Room.deleteOne({ code: roomCode });
              return io
                .to(roomCode)
                .emit("room_deleted", { message: "Game Over!" });
            }

            // 4. CALCULATE NEXT STATE
            const selected =
              available[Math.floor(Math.random() * available.length)];
            const nextPlayerIndex =
              (transitioningRoom.currentPlayerIndex + 1) %
              transitioningRoom.players.length;

            // 5. UPDATE TO NEW QUESTION (Atomic Update)
            const finalRoom = await Room.findOneAndUpdate(
              { code: roomCode },
              {
                $set: {
                  currentQuestion: selected.text,
                  currentPlayerIndex: nextPlayerIndex,
                  isTransitioning: false,
                },
                // Use $addToSet to safely add the ID to the array without duplicates
                $addToSet: { answeredQuestions: selected.id },
              },
              { new: true }
            );

            if (finalRoom) {
              io.to(roomCode).emit("room_updated", finalRoom);
            }
          } catch (innerError) {
            console.error("Timeout logic error:", innerError);
          }
        }, 400);
      } catch (error) {
        console.error("Next Question Error:", error);
        io.to(roomCode).emit("error", {
          message: "Something went wrong while getting the next question.",
        });
      }
    });

    // 1. ADD CUSTOM QUESTION
    socket.on("add_custom_question", async ({ roomCode, question }) => {
      try {
        const newQuestion = {
          id: String(nanoid()),
          text: question,
        };

        const room = await Room.findOneAndUpdate(
          { code: roomCode },
          {
            $push: {
              customQuestions: newQuestion,
            },
          },

          { new: true }
        );

        if (!room) return socket.emit("error", { message: "Room not found" });

        io.to(roomCode).emit("room_updated", room);
      } catch (error) {
        socket.emit("error", { message: "Error adding custom question" });
      }
    });

    socket.on("remove_custom_question", async ({ roomCode, questionId }) => {
      try {
        const room = await Room.findOneAndUpdate(
          { code: roomCode.toUpperCase() },
          {
            $pull: {
              customQuestions: { id: questionId },
            },
          },
          { new: true }
        );

        if (!room) {
          return socket.emit("error", { message: "Room not found" });
        }

        io.to(room.code).emit("room_updated", room);
      } catch (error) {
        socket.emit("error", { message: "Error removing question" });
      }
    });

    socket.on("disconnect", async () => {
      try {
        console.log(`User disconnected: ${socket.id}`);

        // 1. Fetch the room state to see who is leaving
        const roomData = await Room.findOne({ "players.id": socket.id });
        if (!roomData) return;

        const leavingPlayer = roomData.players.find((p) => p.id === socket.id);
        const wasHost = leavingPlayer?.isHost;

        // 2. Calculate the NEW player list
        const remainingPlayers = roomData.players.filter(
          (p) => p.id !== socket.id
        );

        // PATH A: NO ONE LEFT
        if (remainingPlayers.length === 0) {
          await Room.deleteOne({ code: roomData.code });
          return io
            .to(roomData.code)
            .emit("room_deleted", { message: "Room empty" });
        }

        // PATH B: PEOPLE LEFT -> ATOMIC UPDATE
        // If the host left, promote the next person in the array
        if (wasHost && remainingPlayers.length > 0) {
          remainingPlayers[0].isHost = true;
          io.to(roomData.code).emit("new_host_toast", {
            name: remainingPlayers[0].name,
          });
        }

        // Ensure current player index is still valid
        let newIndex = roomData.currentPlayerIndex;
        if (newIndex >= remainingPlayers.length) {
          newIndex = 0;
        }

        // Apply all changes in one atomic "findOneAndUpdate"
        const updatedRoom = await Room.findOneAndUpdate(
          { code: roomData.code },
          {
            $set: {
              players: remainingPlayers,
              currentPlayerIndex: newIndex,
            },
          },
          { new: true }
        );

        if (updatedRoom) {
          io.to(updatedRoom.code).emit("room_updated", updatedRoom);
        }
      } catch (err) {
        console.error("Disconnect error:", err);
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
