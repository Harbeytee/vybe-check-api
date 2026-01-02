// import { Server, Socket } from "socket.io";
// import { Server as HttpServer } from "http";
// import Room from "./models/room";
// import QuestionPack from "./models/question-pack";
// import { nanoid } from "nanoid";

// let io: Server;

// export const initSocket = async (httpServer: HttpServer) => {
//   io = new Server(httpServer, {
//     cors: { origin: "*" },
//   });

//   io.on("connection", (socket: Socket) => {
//     console.log(`Connected: ${socket.id}`);

//     // CREATE ROOM
//     socket.on("create_room", async ({ playerName }, callback) => {
//       try {
//         const code = nanoid(6).toUpperCase();

//         const existing = await Room.findOne({ code });
//         if (existing) {
//           // If it exists, just try again (or handle error)
//           return socket.emit("error", {
//             message: "Room code collision, try again!",
//           });
//         }
//         const player = { id: socket.id, name: playerName, isHost: true };
//         const newRoom = new Room({ code, players: [player] });
//         await newRoom.save();
//         socket.join(code);
//         callback({ success: true, room: newRoom, player });
//       } catch (error) {
//         callback({ success: false, message: "Failed to create room" });
//       }
//     });

//     // JOIN ROOM
//     socket.on("join_room", async ({ roomCode, playerName }, callback) => {
//       try {
//         const formattedCode = roomCode.toUpperCase();
//         const player = { id: socket.id, name: playerName, isHost: false };

//         const room = await Room.findOneAndUpdate(
//           { code: formattedCode },
//           { $push: { players: player } },
//           { new: true, runValidators: true }
//         );

//         if (!room) {
//           return callback({ success: false, message: "Room not found" });
//         }

//         socket.join(room.code);
//         io.to(room.code).emit("room_updated", room);
//         callback({ success: true, room, player });
//       } catch (error) {
//         callback({ success: false, message: "Error joining room" });
//       }
//     });

//     socket.on("select_pack", async ({ roomCode, packId }) => {
//       try {
//         const formattedCode = roomCode.toUpperCase();

//         // We find the room AND verify the sender is the host in one atomic query
//         const room = await Room.findOneAndUpdate(
//           {
//             code: formattedCode,
//             "players.id": socket.id,
//             "players.isHost": true,
//           },
//           { $set: { selectedPack: packId } },
//           { new: true }
//         );

//         if (!room) return;

//         // Tell everyone so their UI updates (e.g., highlights the chosen pack)
//         io.to(roomCode).emit("room_updated", room);
//       } catch (err) {
//         console.error(err);
//       }
//     });

//     //START GAME
//     socket.on("start_game", async ({ roomCode }, callback) => {
//       try {
//         const roomData = await Room.findOne({ code: roomCode });
//         if (!roomData) return;

//         // 1. Fetch the actual pack data
//         const pack = await QuestionPack.findOne({ id: roomData.selectedPack });
//         if (!pack) {
//           return socket.emit("error", { message: "Selected pack not found" });
//         }

//         // 2. Combine all available questions (Pack + Custom)
//         const pool = [...pack.questions, ...roomData.customQuestions];

//         if (pool.length === 0) {
//           return socket.emit("error", {
//             message: "This pack has no questions!",
//           });
//         }

//         // 4. Pick the first question correctly
//         const randomIndex = Math.floor(Math.random() * pack.questions.length);
//         const firstQuestion = pool[randomIndex];

//         const room = await Room.findOneAndUpdate(
//           {
//             code: roomCode,
//             "players.id": socket.id,
//             "players.isHost": true,
//           },
//           {
//             $set: {
//               isStarted: true,
//               currentPlayerIndex: Math.floor(
//                 Math.random() * roomData.players.length
//               ),
//               totalQuestions: pool.length,
//               currentQuestion: firstQuestion.text,
//               answeredQuestions: [firstQuestion.id], // Start the history with the first ID
//             },
//           },
//           { new: true }
//         );

//         if (!room) {
//           return callback({
//             success: false,
//             message: "Unauthorized or Room error",
//           });
//         }

//         // 6. Notify everyone
//         io.to(roomCode).emit("game_started", room);
//         // Also emit room_updated to sync the players/question immediately
//         io.to(roomCode).emit("room_updated", room);
//         callback({ success: true });
//       } catch (error) {
//         callback({
//           success: false,
//           message: "Failed to start game. Try refreshing.",
//         });
//       }
//     });

//     //FLIP CARD
//     socket.on("flip_card", async ({ roomCode }) => {
//       const room = await Room.findOneAndUpdate(
//         { code: roomCode },
//         { $set: { isFlipped: true } },
//         { new: true }
//       );

//       if (room) {
//         io.to(roomCode).emit("room_updated", room);
//       }
//     });

//     // NEXT QUESTION
//     socket.on("next_question", async ({ roomCode }: { roomCode: string }) => {
//       try {
//         // 1. START TRANSITION (Atomic Update)
//         // We set isTransitioning to true and isFlipped to false immediately
//         const transitioningRoom = await Room.findOneAndUpdate(
//           { code: roomCode },
//           { $set: { isTransitioning: true, isFlipped: false } },
//           { new: true }
//         );

//         if (!transitioningRoom) return;
//         io.to(roomCode).emit("room_updated", transitioningRoom);

//         // 2. PREPARE DATA (Logic Phase)
//         // We use the data from transitioningRoom instead of a new findOne
//         const pack = await QuestionPack.findOne({
//           id: transitioningRoom.selectedPack,
//         });

//         setTimeout(async () => {
//           try {
//             const pool = [
//               ...(pack?.questions || []),
//               ...transitioningRoom.customQuestions,
//             ];
//             const available = pool.filter(
//               (q) => !transitioningRoom.answeredQuestions.includes(q.id)
//             );

//             // 3. GAME OVER LOGIC
//             if (available.length === 0) {
//               await Room.deleteOne({ code: roomCode });
//               return io
//                 .to(roomCode)
//                 .emit("room_deleted", { message: "Game Over!" });
//             }

//             // 4. CALCULATE NEXT STATE
//             const selected =
//               available[Math.floor(Math.random() * available.length)];
//             const nextPlayerIndex =
//               (transitioningRoom.currentPlayerIndex + 1) %
//               transitioningRoom.players.length;

//             // 5. UPDATE TO NEW QUESTION (Atomic Update)
//             const finalRoom = await Room.findOneAndUpdate(
//               { code: roomCode },
//               {
//                 $set: {
//                   currentQuestion: selected.text,
//                   currentPlayerIndex: nextPlayerIndex,
//                   isTransitioning: false,
//                 },
//                 // Use $addToSet to safely add the ID to the array without duplicates
//                 $addToSet: { answeredQuestions: selected.id },
//               },
//               { new: true }
//             );

//             if (finalRoom) {
//               io.to(roomCode).emit("room_updated", finalRoom);
//             }
//           } catch (innerError) {
//             console.error("Timeout logic error:", innerError);
//           }
//         }, 400);
//       } catch (error) {
//         console.error("Next Question Error:", error);
//         io.to(roomCode).emit("error", {
//           message: "Something went wrong while getting the next question.",
//         });
//       }
//     });

//     // 1. ADD CUSTOM QUESTION
//     socket.on("add_custom_question", async ({ roomCode, question }) => {
//       try {
//         const newQuestion = {
//           id: String(nanoid()),
//           text: question,
//         };

//         const room = await Room.findOneAndUpdate(
//           { code: roomCode },
//           {
//             $push: {
//               customQuestions: newQuestion,
//             },
//           },

//           { new: true }
//         );

//         if (!room) return socket.emit("error", { message: "Room not found" });

//         io.to(roomCode).emit("room_updated", room);
//       } catch (error) {
//         socket.emit("error", { message: "Error adding custom question" });
//       }
//     });

//     socket.on("remove_custom_question", async ({ roomCode, questionId }) => {
//       try {
//         const room = await Room.findOneAndUpdate(
//           { code: roomCode.toUpperCase() },
//           {
//             $pull: {
//               customQuestions: { id: questionId },
//             },
//           },
//           { new: true }
//         );

//         if (!room) {
//           return socket.emit("error", { message: "Room not found" });
//         }

//         io.to(room.code).emit("room_updated", room);
//       } catch (error) {
//         socket.emit("error", { message: "Error removing question" });
//       }
//     });

//     socket.on("disconnect", async () => {
//       try {
//         console.log(`User disconnected: ${socket.id}`);

//         // 1. Fetch the room state to see who is leaving
//         const roomData = await Room.findOne({ "players.id": socket.id });
//         if (!roomData) return;

//         const leavingPlayer = roomData.players.find((p) => p.id === socket.id);
//         const wasHost = leavingPlayer?.isHost;

//         // 2. Calculate the NEW player list
//         const remainingPlayers = roomData.players.filter(
//           (p) => p.id !== socket.id
//         );

//         // PATH A: NO ONE LEFT
//         if (remainingPlayers.length === 0) {
//           await Room.deleteOne({ code: roomData.code });
//           return io
//             .to(roomData.code)
//             .emit("room_deleted", { message: "Room empty" });
//         }

//         // PATH B: PEOPLE LEFT -> ATOMIC UPDATE
//         // If the host left, promote the next person in the array
//         if (wasHost && remainingPlayers.length > 0) {
//           remainingPlayers[0].isHost = true;
//           io.to(roomData.code).emit("new_host_toast", {
//             name: remainingPlayers[0].name,
//           });
//         }

//         // Ensure current player index is still valid
//         let newIndex = roomData.currentPlayerIndex;
//         if (newIndex >= remainingPlayers.length) {
//           newIndex = 0;
//         }

//         // Apply all changes in one atomic "findOneAndUpdate"
//         const updatedRoom = await Room.findOneAndUpdate(
//           { code: roomData.code },
//           {
//             $set: {
//               players: remainingPlayers,
//               currentPlayerIndex: newIndex,
//             },
//           },
//           { new: true }
//         );

//         if (updatedRoom) {
//           io.to(updatedRoom.code).emit("room_updated", updatedRoom);
//         }
//       } catch (err) {
//         console.error("Disconnect error:", err);
//       }
//     });
//   });

//   return io;
// };

// // This allows other files to use 'io' if needed (e.g., for global broadcasts)
// export const getIO = () => {
//   if (!io) throw new Error("Socket.io not initialized!");
//   return io;
// };

// import { Server, Socket } from "socket.io";
// import { Server as HttpServer } from "http";
// import { nanoid } from "nanoid";
// import { createClient } from "redis";
// import QuestionPack from "./models/question-pack";
// import { gamePacks, mappedGamePacks } from "./utils.ts/data";

// /* ======================================================
//    CONFIG
// ====================================================== */

// const SERVER_ID = process.env.SERVER_ID || "server-1";
// const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// const HEARTBEAT_INTERVAL = 5000; // client sends every 5s
// const PLAYER_TIMEOUT = 15000; // 15s = ghost
// const ROOM_TTL = 60 * 60; // 1 hour TTL in seconds

// /* ======================================================
//    REDIS
// ====================================================== */

// // const redis = createClient({
// //   url: REDIS_URL,
// //   username: "default",
// //   password: process.env.REDIS_PASSWORD || "",
// // });

// const redis = createClient({
//   username: "default",
//   password: "JrYrfvbBKXybJ3b0iPpw6wFdoEuEW7Al",
//   socket: {
//     host: "redis-11115.c277.us-east-1-3.ec2.cloud.redislabs.com",
//     port: 11115,
//   },
// });

// redis.on("error", (err) => console.log("Redis Client Error", err));
// redis.connect();

// /* ======================================================
//    TYPES
// ====================================================== */

// type Player = {
//   id: string;
//   name: string;
//   isHost: boolean;
//   lastSeen: number;
// };

// type Question = {
//   id: string;
//   text: string;
// };

// type Room = {
//   code: string;
//   players: Player[];
//   selectedPack?: string;
//   customQuestions: Question[];
//   isStarted: boolean;
//   isFlipped: boolean;
//   isTransitioning: boolean;
//   currentPlayerIndex: number;
//   currentQuestion?: string | null;
//   answeredQuestions: string[];
//   totalQuestions: number;
// };

// /* ======================================================
//    SOCKET INIT
// ====================================================== */

// let io: Server;

// export const initSocket = (httpServer: HttpServer) => {
//   io = new Server(httpServer, { cors: { origin: "*" } });

//   io.on("connection", (socket: Socket) => {
//     console.log("Connected:", socket.id);

//     /* -------------------- CREATE ROOM -------------------- */
//     socket.on("create_room", async ({ playerName }, cb) => {
//       try {
//         let code = "";
//         let claimed = false;

//         while (!claimed) {
//           code = nanoid(6).toUpperCase();
//           const result = await redis.set(`room:${code}:owner`, SERVER_ID, {
//             NX: true,
//             EX: ROOM_TTL,
//           });
//           claimed = result === "OK";
//         }

//         const room: Room = {
//           code,
//           players: [
//             {
//               id: socket.id,
//               name: playerName,
//               isHost: true,
//               lastSeen: Date.now(),
//             },
//           ],
//           customQuestions: [],
//           isStarted: false,
//           isFlipped: false,
//           isTransitioning: false,
//           currentPlayerIndex: 0,
//           currentQuestion: null,
//           answeredQuestions: [],
//           totalQuestions: 0,
//         };

//         // Save room in Redis
//         await redis.set(`room:${code}`, JSON.stringify(room), { EX: ROOM_TTL });

//         socket.join(code);
//         cb({ success: true, room, player: room.players[0] });
//       } catch {
//         cb({ success: false });
//       }
//     });

//     /* -------------------- JOIN ROOM -------------------- */
//     socket.on("join_room", async ({ roomCode, playerName }, cb) => {
//       const code = roomCode.toUpperCase();
//       const owner = await redis.get(`room:${code}:owner`);

//       if (!owner) return cb({ success: false, message: "Room not found" });
//       if (owner !== SERVER_ID) return cb({ redirect: owner });

//       const roomJson = await redis.get(`room:${code}`);
//       if (!roomJson) return cb({ success: false });

//       const room: Room = JSON.parse(roomJson);

//       const player: Player = {
//         id: socket.id,
//         name: playerName,
//         isHost: false,
//         lastSeen: Date.now(),
//       };
//       room.players.push(player);

//       await redis.set(`room:${code}`, JSON.stringify(room), { EX: ROOM_TTL });
//       socket.join(code);

//       io.to(code).emit("room_updated", room);
//       cb({ success: true, room, player });
//     });

//     /* -------------------- HEARTBEAT -------------------- */
//     socket.on("heartbeat", async ({ roomCode }) => {
//       const roomJson = await redis.get(`room:${roomCode}`);
//       if (!roomJson) return;

//       const room: Room = JSON.parse(roomJson);
//       const player = room.players.find((p) => p.id === socket.id);
//       if (!player) return;

//       player.lastSeen = Date.now();

//       await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//         EX: ROOM_TTL,
//       });
//     });

//     /* -------------------- FLIP CARD -------------------- */
//     socket.on("flip_card", async ({ roomCode }) => {
//       const key = `room:${roomCode}`;
//       await redis.watch(key);
//       const roomJson = await redis.get(key);
//       console.log({ roomJson });
//       if (!roomJson) return await redis.unwatch();

//       const room: Room = JSON.parse(roomJson);
//       room.isFlipped = true;

//       const ttl = await redis.ttl(key);
//       const multi = redis.multi();
//       multi.set(key, JSON.stringify(room), { EX: ttl > 0 ? ttl : ROOM_TTL });
//       const execResult = await multi.exec();

//       if (execResult === null) return; // retry on race

//       io.to(roomCode).emit("room_updated", room);
//     });

//     /* -------------------- SELECT PACK -------------------- */
//     socket.on("select_pack", async ({ roomCode, packId }) => {
//       const key = `room:${roomCode}`;
//       const roomJson = await redis.get(key);
//       if (!roomJson) return;

//       const room: Room = JSON.parse(roomJson);
//       const host = room.players.find((p) => p.id === socket.id && p.isHost);
//       if (!host) return;

//       room.selectedPack = packId;
//       await redis.set(key, JSON.stringify(room), { EX: ROOM_TTL });
//       io.to(roomCode).emit("room_updated", room);
//     });

//     /* -------------------- ADD CUSTOM QUESTION -------------------- */
//     socket.on("add_custom_question", async ({ roomCode, question }) => {
//       const key = `room:${roomCode}`;
//       const roomJson = await redis.get(key);
//       if (!roomJson) return;

//       const room: Room = JSON.parse(roomJson);
//       room.customQuestions.push({ id: nanoid(), text: question });
//       await redis.set(key, JSON.stringify(room), { EX: ROOM_TTL });
//       io.to(roomCode).emit("room_updated", room);
//     });

//     /* -------------------- REMOVE CUSTOM QUESTION -------------------- */
//     socket.on("remove_custom_question", async ({ roomCode, questionId }) => {
//       const key = `room:${roomCode}`;
//       const roomJson = await redis.get(key);
//       if (!roomJson) return;

//       const room: Room = JSON.parse(roomJson);
//       room.customQuestions = room.customQuestions.filter(
//         (q) => q.id !== questionId
//       );
//       await redis.set(key, JSON.stringify(room), { EX: ROOM_TTL });
//       io.to(roomCode).emit("room_updated", room);
//     });

//     /* -------------------- START GAME -------------------- */
//     socket.on("start_game", async ({ roomCode }, cb) => {
//       const key = `room:${roomCode}`;
//       const roomJson = await redis.get(key);
//       if (!roomJson) return cb({ success: false });

//       const room: Room = JSON.parse(roomJson);
//       const host = room.players.find((p) => p.id === socket.id && p.isHost);
//       if (!host) return cb({ success: false });

//       const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
//       if (!pack) return cb({ success: false });

//       const pool = [...pack.questions, ...room.customQuestions];
//       const first = pool[Math.floor(Math.random() * pool.length)];

//       room.isStarted = true;
//       room.currentQuestion = first.text;
//       room.totalQuestions = pool.length;
//       room.answeredQuestions = [first.id];
//       room.currentPlayerIndex = Math.floor(Math.random() * room.players.length);

//       await redis.set(key, JSON.stringify(room), { EX: ROOM_TTL });

//       io.to(roomCode).emit("game_started", room);
//       io.to(roomCode).emit("room_updated", room);
//       cb({ success: true });
//     });

//     /* -------------------- NEXT QUESTION -------------------- */
//     socket.on("next_question", async ({ roomCode }) => {
//       const key = `room:${roomCode}`;
//       const roomJson = await redis.get(key);
//       if (!roomJson) return;

//       const room: Room = JSON.parse(roomJson);
//       if (room.isTransitioning) return;

//       room.isTransitioning = true;
//       room.isFlipped = false;
//       io.to(roomCode).emit("room_updated", room);

//       const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
//       const pool = [...(pack?.questions || []), ...room.customQuestions];
//       const available = pool.filter(
//         (q) => !room.answeredQuestions.includes(q.id)
//       );

//       if (available.length === 0) {
//         await redis.del(`room:${roomCode}:owner`);
//         await redis.del(`room:${roomCode}`);
//         io.to(roomCode).emit("room_deleted", { message: "Game Over" });
//         return;
//       }

//       const next = available[Math.floor(Math.random() * available.length)];
//       room.currentQuestion = next.text;
//       room.answeredQuestions.push(next.id);
//       room.currentPlayerIndex =
//         (room.currentPlayerIndex + 1) % room.players.length;
//       room.isTransitioning = false;

//       await redis.set(key, JSON.stringify(room), { EX: ROOM_TTL });
//       io.to(roomCode).emit("room_updated", room);
//     });

//     /* -------------------- DISCONNECT -------------------- */
//     // socket.on("disconnect", async () => {
//     //   // Iterate all rooms in Redis
//     //   const keys = await redis.keys("room:*");

//     //   for (const key of keys) {
//     //     if (key.endsWith(":owner")) continue;
//     //     const roomJson = await redis.get(key);
//     //     if (!roomJson) continue;

//     //     const room: Room = JSON.parse(roomJson);
//     //     const index = room.players.findIndex((p) => p.id === socket.id);
//     //     if (index === -1) continue;

//     //     const wasHost = room.players[index].isHost;
//     //     room.players.splice(index, 1);

//     //     if (wasHost && room.players.length > 0) {
//     //       room.players[0].isHost = true;
//     //       io.to(room.code).emit("new_host_toast", {
//     //         name: room.players[0].name,
//     //       });
//     //     }

//     //     if (room.players.length === 0) {
//     //       await redis.del(`room:${room.code}:owner`);
//     //       await redis.del(`room:${room.code}`);
//     //       io.to(room.code).emit("room_deleted");
//     //     } else {
//     //       await redis.set(`room:${room.code}`, JSON.stringify(room), {
//     //         EX: ROOM_TTL,
//     //       });
//     //       io.to(room.code).emit("room_updated", room);
//     //     }
//     //   }
//     // });

//     socket.on("disconnect", async () => {
//       // Iterate all rooms in Redis
//       const keys = await redis.keys("room:*");

//       for (const key of keys) {
//         if (key.endsWith(":owner")) continue;

//         const roomJson = await redis.get(key);
//         if (!roomJson) continue;

//         const room: Room = JSON.parse(roomJson);
//         const leavingIndex = room.players.findIndex((p) => p.id === socket.id);
//         if (leavingIndex === -1) continue;

//         const wasHost = room.players[leavingIndex].isHost;
//         const leavingPlayerIndex = leavingIndex;

//         // Remove the player
//         room.players.splice(leavingIndex, 1);

//         // Handle host promotion
//         if (wasHost && room.players.length > 0) {
//           room.players[0].isHost = true;
//           io.to(room.code).emit("new_host_toast", {
//             name: room.players[0].name,
//           });
//         }

//         // Adjust currentPlayerIndex if needed
//         if (leavingPlayerIndex < room.currentPlayerIndex) {
//           // If someone before the current player leaves, decrement the index
//           room.currentPlayerIndex -= 1;
//         } else if (leavingPlayerIndex === room.currentPlayerIndex) {
//           // If current player leaves, point to next available player
//           room.currentPlayerIndex =
//             room.currentPlayerIndex % room.players.length;
//         }

//         // Delete room if empty
//         if (room.players.length === 0) {
//           await redis.del(`room:${room.code}:owner`);
//           await redis.del(`room:${room.code}`);
//           io.to(room.code).emit("room_deleted", { message: "Room empty" });
//         } else {
//           // Save updated room back to Redis
//           await redis.set(`room:${room.code}`, JSON.stringify(room), {
//             EX: ROOM_TTL,
//           });
//           io.to(room.code).emit("room_updated", room);
//         }
//       }
//     });
//   });

//   return io;
// };

// /* ======================================================
//    GHOST PLAYER CLEANUP
// ====================================================== */

// setInterval(async () => {
//   const keys = await redis.keys("room:*");
//   const now = Date.now();

//   for (const key of keys) {
//     if (key.endsWith(":owner")) continue;
//     const roomJson = await redis.get(key);
//     if (!roomJson) continue;
//     // if (!roomJson) {
//     //     socket.emit("room_not_found", {
//     //       message: "Room not found or has expired"
//     //     });
//     //     return;
//     //   }

//     const room: Room = JSON.parse(roomJson);
//     const before = room.players.length;

//     room.players = room.players.filter(
//       (p) => now - p.lastSeen < PLAYER_TIMEOUT
//     );

//     if (room.currentPlayerIndex >= room.players.length)
//       room.currentPlayerIndex = 0;

//     if (room.players.length === 0) {
//       await redis.del(`room:${room.code}:owner`);
//       await redis.del(key);
//       io?.to(room.code).emit("room_deleted", { message: "Room expired" });
//       continue;
//     }

//     if (before !== room.players.length) {
//       await redis.set(key, JSON.stringify(room), { EX: ROOM_TTL });
//       io?.to(room.code).emit("room_updated", room);
//     }
//   }
// }, HEARTBEAT_INTERVAL);

// import { Server, Socket } from "socket.io";
// import { Server as HttpServer } from "http";
// import { nanoid } from "nanoid";
// import { createClient } from "redis";
// import { gamePacks, mappedGamePacks } from "./utils.ts/data";
// import config from "./config/config";
// import { Room } from "./types/interfaces";

// /* ======================================================
//    CONFIG & REDIS INIT
// ====================================================== */
// const SERVER_ID = config.redis.serverId || "server-1";
// const ROOM_TTL = 3600; // 1 hour
// const PLAYER_TIMEOUT = 15000;
// const HEARTBEAT_INTERVAL = 5000;

// const redis = createClient({
//   socket: {
//     host: config.redis.host,
//     port: 11115,
//   },
//   password: config.redis.password,
// });

// redis.on("error", (err) => console.error("Redis Error:", err));
// redis.connect();

// /* ======================================================
//    CONCURRENCY HELPER (The "Fix")
// ====================================================== */
// /**
//  * Safely updates a room using Redis WATCH/MULTI to prevent race conditions.
//  * Replaces the "Watched keys changed" error with an automatic retry.
//  */
// async function updateRoom(
//   roomCode: string,
//   updateFn: (room: Room) => Room | null
// ) {
//   const key = `room:${roomCode}`;
//   let retries = 10;

//   while (retries > 0) {
//     try {
//       await redis.watch(key);
//       const data = await redis.get(key);
//       if (!data) {
//         await redis.unwatch();
//         return null;
//       }

//       const room = JSON.parse(data) as Room;
//       const modifiedRoom = updateFn(room);

//       if (!modifiedRoom) {
//         await redis.unwatch();
//         return null;
//       }

//       const result = await redis
//         .multi()
//         .set(key, JSON.stringify(modifiedRoom), { KEEPTTL: true })
//         .exec();

//       if (result) return modifiedRoom; // Success
//       retries--; // Failed due to external change, retry
//     } catch (e) {
//       retries--;
//     }
//   }
//   return null;
// }

// /* ======================================================
//    SOCKET LOGIC
// ====================================================== */
// let io: Server;

// export const initSocket = (httpServer: HttpServer) => {
//   io = new Server(httpServer, { cors: { origin: "*" } });

//   io.on("connection", (socket: Socket) => {
//     // Optimization: Store roomCode on socket to avoid redis.keys("*")
//     socket.data.roomCode = null;

//     /* 1. CREATE ROOM */
//     socket.on("create_room", async ({ playerName }, cb) => {
//       const code = nanoid(6).toUpperCase();
//       const room: Room = {
//         code,
//         players: [
//           {
//             id: socket.id,
//             name: playerName,
//             isHost: true,
//             lastSeen: Date.now(),
//           },
//         ],
//         customQuestions: [],
//         isStarted: false,
//         isFlipped: false,
//         isTransitioning: false,
//         currentPlayerIndex: 0,
//         currentQuestion: null,
//         answeredQuestions: [],
//         totalQuestions: 0,
//       };

//       await redis.set(`room:${code}:owner`, SERVER_ID, { EX: ROOM_TTL });
//       await redis.set(`room:${code}`, JSON.stringify(room), { EX: ROOM_TTL });

//       socket.data.roomCode = code;
//       socket.join(code);
//       cb({ success: true, room, player: room.players[0] });
//     });

//     /* 2. JOIN ROOM */
//     socket.on("join_room", async ({ roomCode, playerName }, cb) => {
//       const code = roomCode.toUpperCase();
//       const updated = await updateRoom(code, (room) => {
//         room.players.push({
//           id: socket.id,
//           name: playerName,
//           isHost: false,
//           lastSeen: Date.now(),
//         });
//         return room;
//       });

//       if (updated) {
//         socket.data.roomCode = code;
//         socket.join(code);
//         io.to(code).emit("room_updated", updated);
//         cb({
//           success: true,
//           room: updated,
//           player: updated.players[updated.players.length - 1],
//         });
//       } else {
//         cb({ success: false, message: "Room not found or full" });
//       }
//     });

//     /* 3. HEARTBEAT */
//     socket.on("heartbeat", async ({ roomCode }) => {
//       await updateRoom(roomCode, (room) => {
//         const p = room.players.find((p) => p.id === socket.id);
//         if (p) p.lastSeen = Date.now();
//         return room;
//       });
//     });

//     /* 4. SELECT PACK */
//     socket.on("select_pack", async ({ roomCode, packId }) => {
//       const updated = await updateRoom(roomCode, (room) => {
//         if (!room.players.find((p) => p.id === socket.id)?.isHost) return null;
//         room.selectedPack = packId;
//         return room;
//       });
//       if (updated) io.to(roomCode).emit("room_updated", updated);
//     });

//     /* 5. CUSTOM QUESTIONS */
//     socket.on("add_custom_question", async ({ roomCode, question }) => {
//       const updated = await updateRoom(roomCode, (room) => {
//         room.customQuestions.push({ id: nanoid(), text: question });
//         return room;
//       });
//       if (updated) io.to(roomCode).emit("room_updated", updated);
//     });

//     socket.on("remove_custom_question", async ({ roomCode, questionId }) => {
//       const updated = await updateRoom(roomCode, (room) => {
//         room.customQuestions = room.customQuestions.filter(
//           (q) => q.id !== questionId
//         );
//         return room;
//       });
//       if (updated) io.to(roomCode).emit("room_updated", updated);
//     });

//     /* 6. START GAME */
//     socket.on("start_game", async ({ roomCode }, cb) => {
//       const updated = await updateRoom(roomCode, (room) => {
//         const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
//         if (!pack || !room.players.find((p) => p.id === socket.id)?.isHost)
//           return null;

//         const pool = [...pack.questions, ...room.customQuestions];
//         const first = pool[Math.floor(Math.random() * pool.length)];

//         room.isStarted = true;
//         room.currentQuestion = first.text;
//         room.totalQuestions = pool.length;
//         room.answeredQuestions = [first.id];
//         room.currentPlayerIndex = Math.floor(
//           Math.random() * room.players.length
//         );
//         return room;
//       });

//       if (updated) {
//         io.to(roomCode).emit("game_started", updated);
//         io.to(roomCode).emit("room_updated", updated);
//         cb({ success: true });
//       } else cb({ success: false });
//     });

//     /* 7. FLIP CARD */
//     socket.on("flip_card", async ({ roomCode }) => {
//       const updated = await updateRoom(roomCode, (room) => {
//         room.isFlipped = true;
//         return room;
//       });
//       // console.log({ updated });
//       if (updated)
//         io.to(roomCode).emit("room_updated", updated),
//           console.log("it is updated");
//       else console.log("not updated");
//     });

//     /* 8. NEXT QUESTION */
//     socket.on("next_question", async ({ roomCode }) => {
//       const updated = await updateRoom(roomCode, (room) => {
//         if (room.isTransitioning) return null;
//         room.isTransitioning = true;
//         room.isFlipped = false;

//         const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
//         const pool = [...(pack?.questions || []), ...room.customQuestions];
//         const available = pool.filter(
//           (q) => !room.answeredQuestions.includes(q.id)
//         );

//         if (available.length === 0) return null; // Logic for Game Over can be added here

//         const next = available[Math.floor(Math.random() * available.length)];
//         room.currentQuestion = next.text;
//         room.answeredQuestions.push(next.id);
//         room.currentPlayerIndex =
//           (room.currentPlayerIndex + 1) % room.players.length;
//         room.isTransitioning = false;
//         return room;
//       });
//       if (updated) io.to(roomCode).emit("room_updated", updated);
//     });

//     /* 9. DISCONNECT (O(1) Scalability) */
//     socket.on("disconnect", async () => {
//       const code = socket.data.roomCode;
//       if (!code) return;

//       await updateRoom(code, (room) => {
//         const idx = room.players.findIndex((p) => p.id === socket.id);
//         if (idx === -1) return null;

//         const wasHost = room.players[idx].isHost;
//         room.players.splice(idx, 1);

//         if (wasHost && room.players.length > 0) room.players[0].isHost = true;
//         if (idx < room.currentPlayerIndex) room.currentPlayerIndex--;
//         else if (room.players.length > 0)
//           room.currentPlayerIndex %= room.players.length;

//         return room;
//       });

//       // Cleanup empty rooms
//       const remaining = await redis.get(`room:${code}`);
//       if (remaining && JSON.parse(remaining).players.length === 0) {
//         await redis.del(`room:${code}`);
//         await redis.del(`room:${code}:owner`);
//       } else {
//         io.to(code).emit("room_updated", JSON.parse(remaining || "{}"));
//       }
//     });
//   });
//   return io;
// };

// /* ======================================================
//    GHOST PLAYER CLEANUP (Fixed for Typescript)
// ====================================================== */
// setInterval(async () => {
//   const now = Date.now();

//   try {
//     // We use the scanIterator to go through keys one by one
//     const iterator = redis.scanIterator({ MATCH: "room:*" });

//     for await (const key of iterator) {
//       // FIX: Ensure 'key' is treated as a string.
//       // If your version of Redis returns an array, we take the first element.
//       const currentKey = Array.isArray(key) ? key[0] : key;

//       // Now .endsWith() will work because currentKey is definitely a string
//       if (!currentKey || currentKey.endsWith(":owner")) continue;

//       const roomCode = currentKey.replace("room:", "");

//       const updatedRoom = await updateRoom(roomCode, (room) => {
//         const initialCount = room.players.length;
//         console.log({ updateRoom });
//         // Remove players who haven't sent a heartbeat within 15s
//         room.players = room.players.filter(
//           (p) => now - p.lastSeen < PLAYER_TIMEOUT
//         );

//         if (room.players.length === initialCount) return null;

//         // If host left, assign new one
//         if (room.players.length > 0 && !room.players.some((p) => p.isHost)) {
//           room.players[0].isHost = true;
//         }

//         return room;
//       });

//       if (updatedRoom) {
//         if (updatedRoom.players.length === 0) {
//           await redis.del(`room:${roomCode}`);
//           await redis.del(`room:${roomCode}:owner`);
//         } else {
//           io.to(roomCode).emit("room_updated", updatedRoom);
//         }
//       }
//     }
//   } catch (err) {
//     console.error("Cleanup Loop Error:", err);
//   }
// }, HEARTBEAT_INTERVAL);

import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { nanoid } from "nanoid";
import { createClient } from "redis";
import { mappedGamePacks } from "./utils.ts/data";
import config from "./config/config";
import { Room } from "./types/interfaces";

/* ======================================================
   CONFIG & REDIS INIT
====================================================== */
const SERVER_ID = config.redis.serverId || "server-1";
const ROOM_TTL = 3600; // 1 hour
const PLAYER_TTL = 15; // 15 seconds - players must heartbeat within this time
const HEARTBEAT_INTERVAL = 5000;

const redis = createClient({
  socket: {
    host: config.redis.host,
    port: 11115,
  },
  password: config.redis.password,
});

redis.on("error", (err) => console.error("Redis Error:", err));
redis.connect();

/* ======================================================
   CONCURRENCY HELPER (Optimized with Better Error Handling)
====================================================== */
async function updateRoom(
  roomCode: string,
  updateFn: (room: Room) => Room | null
) {
  const key = `room:${roomCode}`;
  let retries = 10;

  while (retries > 0) {
    try {
      await redis.watch(key);
      const data = await redis.get(key);
      if (!data) {
        await redis.unwatch();
        return null;
      }

      const room = JSON.parse(data) as Room;
      const modifiedRoom = updateFn(room);

      if (!modifiedRoom) {
        await redis.unwatch();
        return null;
      }

      //   const result = await redis
      //     .multi()
      //     .set(key, JSON.stringify(modifiedRoom), { KEEPTTL: true })
      //     .exec();

      const result = await redis
        .multi()
        .set(key, JSON.stringify(modifiedRoom))
        .expire(key, ROOM_TTL) // 👈 refresh TTL on every update
        .exec();

      if (result) return modifiedRoom;
      retries--;
    } catch (e) {
      console.error("Update room error:", e);
      retries--;
    }
  }
  return null;
}

/* ======================================================
   ROOM VALIDATION & CLEANUP
====================================================== */
async function getRoomWithCleanup(roomCode: string): Promise<Room | null> {
  const roomData = await redis.get(`room:${roomCode}`);
  if (!roomData) return null;

  const room = JSON.parse(roomData) as Room;
  const now = Date.now();
  const activePlayerIds = new Set<string>();

  // Check which players still have active heartbeat markers
  for (const player of room.players) {
    const exists = await redis.exists(`player:${roomCode}:${player.id}`);
    if (exists) {
      activePlayerIds.add(player.id);
    }
  }

  // If all players are active, return as-is
  if (activePlayerIds.size === room.players.length) {
    return room;
  }

  // Clean up expired players
  const updated = await updateRoom(roomCode, (r) => {
    r.players = r.players.filter((p) => activePlayerIds.has(p.id));

    if (r.players.length === 0) return null;

    // Reassign host if needed
    if (!r.players.some((p) => p.isHost)) {
      r.players[0].isHost = true;
    }

    // Adjust current player index
    if (r.currentPlayerIndex >= r.players.length) {
      r.currentPlayerIndex = r.players.length - 1;
    }

    return r;
  });

  // Delete room if empty
  if (!updated || updated.players.length === 0) {
    await redis.del(`room:${roomCode}`);
    await redis.del(`room:${roomCode}:owner`);
    return null;
  }

  return updated;
}

/* ======================================================
   SOCKET LOGIC
====================================================== */
let io: Server;

export const initSocket = (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on("connection", (socket: Socket) => {
    console.log(`Player connected: ${socket.id}`);
    socket.data.roomCode = null;

    /* 1. CREATE ROOM */
    // socket.on("create_room", async ({ playerName }, cb) => {
    //   try {
    //     const code = nanoid(6).toUpperCase();
    //     const room: Room = {
    //       code,
    //       players: [
    //         {
    //           id: socket.id,
    //           name: playerName,
    //           isHost: true,
    //           lastSeen: Date.now(),
    //         },
    //       ],
    //       customQuestions: [],
    //       isStarted: false,
    //       isFlipped: false,
    //       isTransitioning: false,
    //       currentPlayerIndex: 0,
    //       currentQuestion: null,
    //       answeredQuestions: [],
    //       totalQuestions: 0,
    //     };

    //     await redis.set(`room:${code}:owner`, SERVER_ID, { EX: ROOM_TTL });
    //     await redis.set(`room:${code}`, JSON.stringify(room), { EX: ROOM_TTL });

    //     // Create player heartbeat marker
    //     await redis.set(`player:${code}:${socket.id}`, Date.now().toString(), {
    //       EX: PLAYER_TTL,
    //     });

    //     socket.data.roomCode = code;
    //     socket.join(code);
    //     cb({ success: true, room, player: room.players[0] });
    //   } catch (error) {
    //     console.error("Create room error:", error);
    //     cb({ success: false, message: "Failed to create room" });
    //   }
    // });

    socket.on("create_room", async ({ playerName }, cb) => {
      try {
        let code = "";
        let created = false;

        // Generate a unique room code
        while (!created) {
          const candidate = nanoid(6).toUpperCase();

          const result = await redis.set(`room:${candidate}`, "PENDING", {
            NX: true,
            EX: ROOM_TTL,
          });

          if (result === "OK") {
            code = candidate;
            created = true;
          }
        }

        // Now that code is guaranteed to exist, build the room
        const room: Room = {
          code,
          players: [
            {
              id: socket.id,
              name: playerName,
              isHost: true,
              lastSeen: Date.now(),
            },
          ],
          customQuestions: [],
          isStarted: false,
          isFlipped: false,
          isTransitioning: false,
          currentPlayerIndex: 0,
          currentQuestion: null,
          answeredQuestions: [],
          totalQuestions: 0,
        };

        // Overwrite placeholder with real room data
        await redis.set(`room:${code}`, JSON.stringify(room), {
          XX: true,
          KEEPTTL: true,
        });

        await redis.set(`room:${code}:owner`, SERVER_ID, { EX: ROOM_TTL });

        // Heartbeat
        await redis.set(`player:${code}:${socket.id}`, Date.now().toString(), {
          EX: PLAYER_TTL,
        });

        socket.data.roomCode = code;
        socket.join(code);

        cb({ success: true, room, player: room.players[0] });
      } catch (error) {
        console.error("Create room error:", error);
        cb({ success: false, message: "Failed to create room" });
      }
    });

    /* 2. JOIN ROOM */
    socket.on("join_room", async ({ roomCode, playerName }, cb) => {
      try {
        const code = roomCode.toUpperCase();

        // Check if room exists first
        const roomExists = await redis.exists(`room:${code}`);
        if (!roomExists) {
          return cb({ success: false, message: "Room not found" });
        }

        const updated = await updateRoom(code, (room) => {
          // Check if player already exists (reconnection case)
          const existingPlayer = room.players.find((p) => p.id === socket.id);
          if (existingPlayer) {
            existingPlayer.lastSeen = Date.now();
            return room;
          }

          // Add new player
          room.players.push({
            id: socket.id,
            name: playerName,
            isHost: false,
            lastSeen: Date.now(),
          });
          return room;
        });

        if (updated) {
          socket.data.roomCode = code;
          socket.join(code);

          // Create player heartbeat marker
          await redis.set(
            `player:${code}:${socket.id}`,
            Date.now().toString(),
            {
              EX: PLAYER_TTL,
            }
          );

          io.to(code).emit("room_updated", updated);
          cb({
            success: true,
            room: updated,
            player:
              updated.players.find((p) => p.id === socket.id) ||
              updated.players[updated.players.length - 1],
          });
        } else {
          cb({ success: false, message: "Room not found or full" });
        }
      } catch (error) {
        console.error("Join room error:", error);
        cb({ success: false, message: "Failed to join room" });
      }
    });

    /* 3. REJOIN ROOM (for reconnections) */
    socket.on("rejoin_room", async ({ roomCode, playerName }, cb) => {
      try {
        const code = roomCode.toUpperCase();
        const room = await getRoomWithCleanup(code);

        if (!room) {
          return cb({ success: false, message: "Room no longer exists" });
        }

        // Check if player was in the room before
        const existingPlayer = room.players.find((p) => p.name === playerName);

        if (existingPlayer) {
          // Update socket ID (they reconnected with new socket)
          await updateRoom(code, (r) => {
            const p = r.players.find((p) => p.name === playerName);
            if (p) {
              p.id = socket.id;
              p.lastSeen = Date.now();
            }
            return r;
          });
        } else {
          // They weren't in the room, treat as new join
          return socket.emit("join_room", { roomCode, playerName }, cb);
        }

        socket.data.roomCode = code;
        socket.join(code);

        // Refresh heartbeat marker
        await redis.set(`player:${code}:${socket.id}`, Date.now().toString(), {
          EX: PLAYER_TTL,
        });

        const updatedRoom = await redis.get(`room:${code}`);
        if (updatedRoom) {
          const roomData = JSON.parse(updatedRoom);
          cb({
            success: true,
            room: roomData,
            player: roomData.players.find((p: any) => p.id === socket.id),
          });
        }
      } catch (error) {
        console.error("Rejoin room error:", error);
        cb({ success: false, message: "Failed to rejoin room" });
      }
    });

    /* 4. HEARTBEAT */
    socket.on("heartbeat", async ({ roomCode }) => {
      try {
        // Refresh player's heartbeat marker
        await redis.set(
          `player:${roomCode}:${socket.id}`,
          Date.now().toString(),
          {
            EX: PLAYER_TTL,
          }
        );

        await updateRoom(roomCode, (room) => {
          const p = room.players.find((p) => p.id === socket.id);
          if (p) p.lastSeen = Date.now();
          return room;
        });
      } catch (error) {
        console.error("Heartbeat error:", error);
      }
    });

    /* 5. SELECT PACK */
    socket.on("select_pack", async ({ roomCode, packId }) => {
      try {
        const updated = await updateRoom(roomCode, (room) => {
          if (!room.players.find((p) => p.id === socket.id)?.isHost)
            return null;
          room.selectedPack = packId;
          return room;
        });

        if (updated) {
          io.to(roomCode).emit("room_updated", updated);
        } else {
          socket.emit("error", { message: "Only host can select pack" });
        }
      } catch (error) {
        console.error("Select pack error:", error);
        socket.emit("error", { message: "Failed to select pack" });
      }
    });

    /* 6. CUSTOM QUESTIONS */
    socket.on("add_custom_question", async ({ roomCode, question }) => {
      try {
        const updated = await updateRoom(roomCode, (room) => {
          room.customQuestions.push({ id: nanoid(), text: question });
          return room;
        });

        if (updated) {
          io.to(roomCode).emit("room_updated", updated);
        } else {
          socket.emit("room_not_found", { roomCode });
        }
      } catch (error) {
        console.error("Add custom question error:", error);
        socket.emit("error", { message: "Failed to add question" });
      }
    });

    socket.on("remove_custom_question", async ({ roomCode, questionId }) => {
      try {
        const updated = await updateRoom(roomCode, (room) => {
          room.customQuestions = room.customQuestions.filter(
            (q) => q.id !== questionId
          );
          return room;
        });

        if (updated) {
          io.to(roomCode).emit("room_updated", updated);
        } else {
          socket.emit("room_not_found", { roomCode });
        }
      } catch (error) {
        console.error("Remove custom question error:", error);
        socket.emit("error", { message: "Failed to remove question" });
      }
    });

    /* 7. START GAME */
    socket.on("start_game", async ({ roomCode }, cb) => {
      try {
        const updated = await updateRoom(roomCode, (room) => {
          const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
          if (!pack || !room.players.find((p) => p.id === socket.id)?.isHost)
            return null;

          const pool = [...pack.questions, ...room.customQuestions];
          const first = pool[Math.floor(Math.random() * pool.length)];

          room.isStarted = true;
          room.currentQuestion = first.text;
          room.totalQuestions = pool.length;
          room.answeredQuestions = [first.id];
          room.currentPlayerIndex = Math.floor(
            Math.random() * room.players.length
          );
          return room;
        });

        if (updated) {
          io.to(roomCode).emit("game_started", updated);
          io.to(roomCode).emit("room_updated", updated);
          cb({ success: true });
        } else {
          cb({ success: false, message: "Failed to start game" });
        }
      } catch (error) {
        console.error("Start game error:", error);
        cb({ success: false, message: "Failed to start game" });
      }
    });

    /* 8. FLIP CARD */
    socket.on("flip_card", async ({ roomCode }) => {
      try {
        const updated = await updateRoom(roomCode, (room) => {
          room.isFlipped = true;
          return room;
        });

        if (updated) {
          io.to(roomCode).emit("room_updated", updated);
        } else {
          socket.emit("room_not_found", { roomCode });
        }
      } catch (error) {
        console.error("Flip card error:", error);
        socket.emit("error", { message: "Failed to flip card" });
      }
    });

    /* 9. NEXT QUESTION */
    socket.on("next_question", async ({ roomCode }) => {
      try {
        const updated = await updateRoom(roomCode, (room) => {
          if (room.isTransitioning) return null;
          room.isTransitioning = true;
          room.isFlipped = false;

          const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
          const pool = [...(pack?.questions || []), ...room.customQuestions];
          const available = pool.filter(
            (q) => !room.answeredQuestions.includes(q.id)
          );

          if (available.length === 0) {
            // Game Over
            room.isTransitioning = false;
            io.to(roomCode).emit("game_over", {
              message: "No more questions! Game complete!",
            });
            return room;
          }

          const next = available[Math.floor(Math.random() * available.length)];
          room.currentQuestion = next.text;
          room.answeredQuestions.push(next.id);
          room.currentPlayerIndex =
            (room.currentPlayerIndex + 1) % room.players.length;
          room.isTransitioning = false;
          return room;
        });

        if (updated) {
          io.to(roomCode).emit("room_updated", updated);
        } else {
          socket.emit("room_not_found", { roomCode });
        }
      } catch (error) {
        console.error("Next question error:", error);
        socket.emit("error", { message: "Failed to get next question" });
      }
    });

    /* 10. DISCONNECT */
    socket.on("disconnect", async () => {
      console.log(`Player disconnected: ${socket.id}`);
      const code = socket.data.roomCode;
      if (!code) return;

      try {
        // Delete player heartbeat marker
        await redis.del(`player:${code}:${socket.id}`);

        const updated = await updateRoom(code, (room) => {
          const idx = room.players.findIndex((p) => p.id === socket.id);
          if (idx === -1) return null;

          const wasHost = room.players[idx].isHost;
          room.players.splice(idx, 1);

          if (wasHost && room.players.length > 0) {
            room.players[0].isHost = true;
            // Notify about new host
            io.to(code).emit("new_host_toast", { name: room.players[0].name });
          }

          if (idx < room.currentPlayerIndex) {
            room.currentPlayerIndex--;
          } else if (room.players.length > 0) {
            room.currentPlayerIndex %= room.players.length;
          }

          return room;
        });

        // Cleanup empty rooms
        if (!updated || updated.players.length === 0) {
          await redis.del(`room:${code}`);
          await redis.del(`room:${code}:owner`);
          io.to(code).emit("room_deleted", {
            message: "Room has been closed",
          });
        } else {
          io.to(code).emit("room_updated", updated);
        }
      } catch (error) {
        console.error("Disconnect error:", error);
      }
    });
  });

  return io;
};

/* ======================================================
   PERIODIC CLEANUP (Lightweight - only checks metadata)
====================================================== */
setInterval(async () => {
  try {
    const iterator = redis.scanIterator({ MATCH: "room:*", COUNT: 100 });

    for await (const key of iterator) {
      const currentKey = Array.isArray(key) ? key[0] : key;
      if (!currentKey || currentKey.endsWith(":owner")) continue;

      const roomCode = currentKey.replace("room:", "");

      // Use the cleanup function instead of manual checks
      const room = await getRoomWithCleanup(roomCode);

      if (room && room.players.length === 0) {
        await redis.del(`room:${roomCode}`);
        await redis.del(`room:${roomCode}:owner`);
      } else if (room) {
        io.to(roomCode).emit("room_updated", room);
      }
    }
  } catch (err) {
    console.error("Cleanup Loop Error:", err);
  }
}, 30000);
