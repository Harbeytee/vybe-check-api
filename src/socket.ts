// import { Server, Socket } from "socket.io";
// import { Server as HttpServer } from "http";
// import { nanoid } from "nanoid";
// import { createClient } from "redis";
// import { mappedGamePacks } from "./utils.ts/data";
// import config from "./config/config";
// import { Room } from "./types/interfaces";

// const SERVER_ID = config.redis.serverId || "server-1";
// const ROOM_TTL = 3600; // 1 hour
// const PLAYER_TTL = 15; // 15 seconds - players must heartbeat within this time
// const HEARTBEAT_INTERVAL = 5000;

// const redis = createClient({
//   socket: {
//     host: config.redis.host,
//     port: 11115,
//     keepAlive: true,
//     noDelay: true,
//     reconnectStrategy: (retries) => {
//       if (retries > 10) {
//         console.error("Max Redis reconnection attempts reached");
//         return new Error("Too many reconnection attempts");
//       }
//       return Math.min(retries * 100, 3000);
//     },
//     connectTimeout: 10000,
//   },
//   password: config.redis.password,
// });

// redis.on("error", (err) => console.error("Redis Error:", err));
// redis.on("reconnecting", () => console.log("Redis reconnecting..."));
// redis.on("ready", () => console.log("Redis connected"));
// redis.connect();

// /* ======================================================
//    CONCURRENCY HELPER This is for operations where two or more players can trigger n action in a room at the same time e.g joining a room
// ====================================================== */
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

//       if (result) return modifiedRoom;
//       retries--;
//     } catch (e: any) {
//       if (e.name === "WatchError") {
//         //if there is watch error, add small delay before retrying
//         await new Promise((res) => setTimeout(res, Math.random() * 50));
//       } else {
//         console.error("Actual Redis Error:", e);
//         retries = 0; // Stop retrying on serious errors
//       }
//       retries--;
//     }
//   }
//   return null;
// }

// /* ======================================================
//    ROOM VALIDATION & CLEANUP
// ====================================================== */
// async function getRoomWithCleanup(roomCode: string): Promise<Room | null> {
//   const roomData = await redis.get(`room:${roomCode}`);
//   if (!roomData) return null;

//   const room = JSON.parse(roomData) as Room;
//   const activePlayerIds = new Set<string>();

//   // check if each player's separate heartbeat key still exists in Redis. if it does, it means the player is still active
//   for (const player of room.players) {
//     const exists = await redis.exists(`player:${roomCode}:${player.id}`);
//     if (exists) {
//       activePlayerIds.add(player.id);
//     }
//   }

//   // If the number of active players matches the number of players in the JSON,
//   // we stop here. We don't need to call updateRoom or touch the JSON!
//   if (activePlayerIds.size === room.players.length) {
//     return room;
//   }

//   // 4. THE CLEANUP (Only runs if someone is actually missing)
//   const updated = await updateRoom(roomCode, (newRoom) => {
//     const originalCount = newRoom.players.length; // Record count before filtering

//     // Filter the list to keep only those whose "bells" were ringing
//     newRoom.players = newRoom.players.filter((p) => activePlayerIds.has(p.id));

//     // THE SECOND GATE (Optimization)
//     // If the count is the same, no changes are needed.
//     // Returning 'r' tells updateRoom to abort the transaction.
//     if (newRoom.players.length === originalCount) {
//       return newRoom;
//     }

//     // If everyone is gone, signal updateRoom to delete the room
//     if (newRoom.players.length === 0) return null;

//     // RE-ASSIGN HOST
//     // If the host was one of the people who left, make the next person the host
//     if (!newRoom.players.some((p) => p.isHost)) {
//       newRoom.players[0].isHost = true;
//     }

//     // ADJUST TURN INDEX
//     // Ensure we aren't pointing to a player index that no longer exists
//     if (newRoom.currentPlayerIndex >= newRoom.players.length) {
//       newRoom.currentPlayerIndex = Math.max(0, newRoom.players.length - 1);
//     }

//     return newRoom;
//   });

//   // If the room is now empty, wipe the metadata from Redis
//   if (!updated || updated.players.length === 0) {
//     await redis.del(`room:${roomCode}`);
//     await redis.del(`room:${roomCode}:owner`);
//     return null;
//   }

//   return updated;
// }

// /* ======================================================
//    SOCKET LOGIC
// ====================================================== */
// let io: Server;

// export const initSocket = (httpServer: HttpServer) => {
//   io = new Server(httpServer, {
//     cors: { origin: "*" },
//     pingTimeout: 60000,
//     pingInterval: 25000,
//   });

//   io.use(async (socket, next) => {
//     if (!redis.isOpen) {
//       try {
//         await redis.connect();
//         next();
//       } catch (err) {
//         console.error("Redis Connection Middleware Error:", err);
//         // This stops the connection entirely if Redis is down
//         next(new Error("Database connection unavailable"));
//       }
//     } else {
//       next();
//     }
//   });

//   io.on("connection", (socket: Socket) => {
//     console.log(`Player connected: ${socket.id}`);
//     socket.data.roomCode = null;

//     const roomBroadcastIntervals = new Map<string, NodeJS.Timeout>();

//     function startRoomBroadcast(roomCode: string) {
//       // Don't create duplicate intervals
//       if (roomBroadcastIntervals.has(roomCode)) {
//         return;
//       }

//       const interval = setInterval(async () => {
//         try {
//           const room = await getRoomWithCleanup(roomCode);

//           if (!room || room.players.length === 0) {
//             stopRoomBroadcast(roomCode);
//             return;
//           }

//           // Send current room state to all players
//           io.to(roomCode).emit("room_state_sync", room);
//         } catch (error) {
//           console.error(`Room broadcast error for ${roomCode}:`, error);
//         }
//       }, 10000); // Every 10 seconds

//       roomBroadcastIntervals.set(roomCode, interval);
//       console.log(`📡 Started room broadcast for ${roomCode}`);
//     }

//     function stopRoomBroadcast(roomCode: string) {
//       const interval = roomBroadcastIntervals.get(roomCode);
//       if (interval) {
//         clearInterval(interval);
//         roomBroadcastIntervals.delete(roomCode);
//         console.log(`📡 Stopped room broadcast for ${roomCode}`);
//       }
//     }

//     /* 1. CREATE ROOM */
//     socket.on("create_room", async ({ playerName }, cb) => {
//       try {
//         let code = "";
//         let created = false;

//         // Generate a unique room code. this is to prevent two rooms from having the same code
//         while (!created) {
//           const candidate = nanoid(6).toUpperCase();

//           const result = await redis.set(`room:${candidate}`, "PENDING", {
//             NX: true,
//             EX: ROOM_TTL,
//           });

//           if (result === "OK") {
//             code = candidate;
//             created = true;
//           }
//         }

//         // Now that code is guaranteed to exist, build the room
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

//         // Overwrite placeholder with real room data
//         await redis.set(`room:${code}`, JSON.stringify(room), {
//           XX: true,
//           KEEPTTL: true,
//         });

//         await redis.set(`room:${code}:owner`, SERVER_ID, { EX: ROOM_TTL });

//         // Heartbeat
//         await redis.set(`player:${code}:${socket.id}`, Date.now().toString(), {
//           EX: PLAYER_TTL,
//         });

//         socket.data.roomCode = code;
//         socket.join(code);

//         startRoomBroadcast(code);
//         cb({ success: true, room, player: room.players[0] });
//       } catch (error) {
//         console.error("Create room error:", error);
//         cb({ success: false, message: "Failed to create room" });
//       }
//     });

//     /* 2. JOIN ROOM */
//     socket.on("join_room", async ({ roomCode, playerName }, cb) => {
//       try {
//         const code = roomCode.toUpperCase();

//         // Check if room exists first
//         const roomExists = await redis.exists(`room:${code}`);
//         if (!roomExists) {
//           return cb({ success: false, message: "Room not found" });
//         }

//         const updated = await updateRoom(code, (room) => {
//           // Check if player already exists (reconnection case)
//           const existingPlayer = room.players.find((p) => p.id === socket.id);
//           if (existingPlayer) {
//             existingPlayer.lastSeen = Date.now();
//             return room;
//           }

//           //Check by name too (reconnection with new socket ID)
//           const existingByName = room.players.find(
//             (p) => p.name === playerName
//           );
//           if (existingByName) {
//             existingByName.id = socket.id;
//             existingByName.lastSeen = Date.now();
//             return room;
//           }

//           // Add new player
//           room.players.push({
//             id: socket.id,
//             name: playerName,
//             isHost: false,
//             lastSeen: Date.now(),
//           });
//           return room;
//         });

//         if (updated) {
//           socket.data.roomCode = code;
//           socket.join(code);

//           // Create player heartbeat marker
//           await redis.set(
//             `player:${code}:${socket.id}`,
//             Date.now().toString(),
//             {
//               EX: PLAYER_TTL,
//             }
//           );
//           startRoomBroadcast(code);

//           io.to(code).emit("room_updated", updated);
//           cb({
//             success: true,
//             room: updated,
//             player:
//               updated.players.find((p) => p.id === socket.id) ||
//               updated.players[updated.players.length - 1],
//           });
//         } else {
//           cb({ success: false, message: "Room not found or full" });
//         }
//       } catch (error) {
//         console.error("Join room error:", error);
//         cb({ success: false, message: "Failed to join room" });
//       }
//     });

//     /* 3. REJOIN ROOM (for reconnections) */
//     socket.on("rejoin_room", async ({ roomCode, playerName }, cb) => {
//       try {
//         const code = roomCode.toUpperCase();
//         const room = await getRoomWithCleanup(code);

//         if (!room) {
//           return cb({ success: false, message: "Room no longer exists" });
//         }

//         // Check if player was in the room before
//         const existingPlayer = room.players.find((p) => p.name === playerName);

//         if (existingPlayer) {
//           // Update socket ID (they reconnected with new socket)
//           await updateRoom(code, (r) => {
//             const p = r.players.find((p) => p.name === playerName);
//             if (p) {
//               p.id = socket.id;
//               p.lastSeen = Date.now();
//             }
//             return r;
//           });
//         } else {
//           // They weren't in the room, treat as new join
//           return socket.emit("join_room", { roomCode, playerName }, cb);
//         }

//         socket.data.roomCode = code;
//         socket.join(code);

//         // Refresh heartbeat marker
//         await redis.set(`player:${code}:${socket.id}`, Date.now().toString(), {
//           EX: PLAYER_TTL,
//         });

//         startRoomBroadcast(code);
//         const updatedRoom = await redis.get(`room:${code}`);
//         if (updatedRoom) {
//           const roomData = JSON.parse(updatedRoom);
//           cb({
//             success: true,
//             room: roomData,
//             player: roomData.players.find((p: any) => p.id === socket.id),
//           });
//         }
//       } catch (error) {
//         console.error("Rejoin room error:", error);
//         cb({ success: false, message: "Failed to rejoin room" });
//       }
//     });

//     socket.on("heartbeat", async ({ roomCode }) => {
//       try {
//         const now = Date.now();

//         // 1️⃣ Refresh player TTL
//         await redis.set(`player:${roomCode}:${socket.id}`, now.toString(), {
//           EX: PLAYER_TTL,
//         });

//         // 2️⃣ Refresh room TTL
//         await redis.expire(`room:${roomCode}`, ROOM_TTL);
//         await redis.expire(`room:${roomCode}:owner`, ROOM_TTL);
//       } catch (error) {
//         console.error("Heartbeat error:", error);
//       }
//     });

//     /* 5. SELECT PACK */
//     socket.on("select_pack", async ({ roomCode, packId }) => {
//       try {
//         const room = await getRoomWithCleanup(roomCode);
//         if (!room) {
//           return socket.emit("error", { message: "Room not found" });
//         }

//         if (!room.players.find((p) => p.id === socket.id)?.isHost) {
//           return socket.emit("error", { message: "Only host can select pack" });
//         }

//         room.selectedPack = packId;

//         await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//           KEEPTTL: true,
//         });

//         io.to(roomCode).emit("room_updated", room);
//       } catch (error) {
//         console.error("Select pack error:", error);
//         socket.emit("error", { message: "Failed to select pack" });
//       }
//     });

//     /* 6. CUSTOM QUESTIONS */
//     socket.on("add_custom_question", async ({ roomCode, question }) => {
//       try {
//         const room = await getRoomWithCleanup(roomCode);
//         if (!room) {
//           return socket.emit("room_not_found", { roomCode });
//         }

//         room.customQuestions.push({ id: nanoid(), text: question });

//         await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//           KEEPTTL: true,
//         });

//         io.to(roomCode).emit("room_updated", room);
//       } catch (error) {
//         console.error("Add custom question error:", error);
//         socket.emit("error", { message: "Failed to add question" });
//       }
//     });

//     socket.on("remove_custom_question", async ({ roomCode, questionId }) => {
//       try {
//         const room = await getRoomWithCleanup(roomCode);
//         if (!room) {
//           return socket.emit("room_not_found", { roomCode });
//         }

//         room.customQuestions = room.customQuestions.filter(
//           (q) => q.id !== questionId
//         );

//         await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//           KEEPTTL: true,
//         });

//         io.to(roomCode).emit("room_updated", room);
//       } catch (error) {
//         console.error("Remove custom question error:", error);
//         socket.emit("error", { message: "Failed to remove question" });
//       }
//     });

//     /* 7. START GAME */
//     socket.on("start_game", async ({ roomCode }, cb) => {
//       try {
//         const room = await getRoomWithCleanup(roomCode);
//         if (!room) {
//           return cb({ success: false, message: "Room not found" });
//         }

//         const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
//         if (!pack || !room.players.find((p) => p.id === socket.id)?.isHost) {
//           return cb({ success: false, message: "Cannot start game" });
//         }

//         const pool = [...pack.questions, ...room.customQuestions];
//         const first = pool[Math.floor(Math.random() * pool.length)];

//         room.isStarted = true;
//         room.currentQuestion = first.text;
//         room.totalQuestions = pool.length;
//         room.answeredQuestions = [first.id];
//         room.currentPlayerIndex = Math.floor(
//           Math.random() * room.players.length
//         );

//         await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//           KEEPTTL: true,
//         });

//         io.to(roomCode).emit("game_started", room);
//         io.to(roomCode).emit("room_updated", room);
//         cb({ success: true });
//       } catch (error) {
//         console.error("Start game error:", error);
//         cb({ success: false, message: "Failed to start game" });
//       }
//     });

//     /* 8. FLIP CARD */
//     socket.on("flip_card", async ({ roomCode }) => {
//       try {
//         const room = await getRoomWithCleanup(roomCode);
//         if (!room) {
//           return socket.emit("room_not_found", { roomCode });
//         }

//         room.isFlipped = true;

//         await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//           KEEPTTL: true,
//         });

//         io.to(roomCode).emit("room_updated", room);
//       } catch (error) {
//         console.error("Flip card error:", error);
//         socket.emit("error", { message: "Failed to flip card" });
//       }
//     });

//     /* 9. NEXT QUESTION */
//     socket.on("next_question", async ({ roomCode }) => {
//       try {
//         const room = await getRoomWithCleanup(roomCode);
//         if (!room) {
//           return socket.emit("room_not_found", { roomCode });
//         }

//         if (room.isTransitioning) return;

//         room.isTransitioning = true;
//         room.isFlipped = false;

//         const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
//         const pool = [...(pack?.questions || []), ...room.customQuestions];
//         const available = pool.filter(
//           (q) => !room.answeredQuestions.includes(q.id)
//         );

//         if (available.length === 0) {
//           // Game Over
//           room.isTransitioning = false;

//           await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//             KEEPTTL: true,
//           });

//           io.to(roomCode).emit("game_over", {
//             message: "No more questions! Game complete!",
//           });
//           return;
//         }

//         const next = available[Math.floor(Math.random() * available.length)];
//         room.currentQuestion = next.text;
//         room.answeredQuestions.push(next.id);
//         room.currentPlayerIndex =
//           (room.currentPlayerIndex + 1) % room.players.length;
//         room.isTransitioning = false;

//         await redis.set(`room:${roomCode}`, JSON.stringify(room), {
//           KEEPTTL: true,
//         });

//         io.to(roomCode).emit("room_updated", room);
//       } catch (error) {
//         console.error("Next question error:", error);
//         socket.emit("error", { message: "Failed to get next question" });
//       }
//     });

//     /* 10. DISCONNECT */
//     socket.on("disconnect", async () => {
//       console.log(`Player disconnected: ${socket.id}`);
//       const code = socket.data.roomCode;
//       if (!code) return;

//       try {
//         // Delete player heartbeat marker
//         await redis.del(`player:${code}:${socket.id}`);

//         const updated = await updateRoom(code, (room) => {
//           const idx = room.players.findIndex((p) => p.id === socket.id);
//           if (idx === -1) return null;

//           const leavingPlayer = room.players[idx];
//           let newHost = null;
//           const wasHost = room.players[idx].isHost;
//           room.players.splice(idx, 1);

//           if (wasHost && room.players.length > 0) {
//             room.players[0].isHost = true;
//             newHost = room.players[0];
//             //  Notify about new host
//             io.to(code).emit("new_host_toast", { name: room.players[0].name });
//           }

//           if (idx < room.currentPlayerIndex) {
//             room.currentPlayerIndex--;
//           } else if (room.players.length > 0) {
//             room.currentPlayerIndex %= room.players.length;
//           }

//           io.to(code).emit("player_left", {
//             leavingPlayer,
//             newHost,
//             room,
//           });

//           return room;
//         });

//         // Cleanup empty rooms
//         if (!updated || updated.players.length === 0) {
//           await redis.del(`room:${code}`);
//           await redis.del(`room:${code}:owner`);

//           stopRoomBroadcast(code);
//           io.to(code).emit("room_deleted", {
//             message: "Room has been closed",
//           });
//         } else {
//           io.to(code).emit("room_updated", updated);
//         }
//       } catch (error) {
//         console.error("Disconnect error:", error);
//       }
//     });
//   });

//   return io;
// };

import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { nanoid } from "nanoid";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { mappedGamePacks } from "./utils.ts/data";
import config from "./config/config";
import { Player, Room } from "./types/interfaces";

const ROOM_TTL = 3600;
const PLAYER_TTL = 15;

const pubClient = createClient({
  socket: {
    host: config.redis.host,
    port: 11115,
    keepAlive: true,
    connectTimeout: 10000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
  password: config.redis.password,
});

pubClient.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});
const subClient = pubClient.duplicate();

subClient.on("error", (err) => {
  console.error("❌ Redis Sub Client Error:", err);
});

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  console.log("✅ Redis Hash-Store Connected");
});

/* ======================================================
   HELPERS
   ====================================================== */

async function getFullRoom(roomCode: string): Promise<Room | null> {
  const metaKey = `room:${roomCode}:meta`;
  const playerKey = `room:${roomCode}:players`;

  const [meta, playersRaw] = await Promise.all([
    pubClient.hGetAll(metaKey),
    pubClient.hGetAll(playerKey),
  ]);

  if (!meta || Object.keys(meta).length === 0) return null;

  const players: Player[] = Object.values(playersRaw)
    .map((p) => JSON.parse(p))
    .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1));

  return {
    code: roomCode,
    players,
    selectedPack: meta.selectedPack || null,
    isStarted: meta.isStarted === "true",
    isFlipped: meta.isFlipped === "true",
    isTransitioning: meta.isTransitioning === "true",
    currentPlayerIndex: parseInt(meta.currentPlayerIndex || "0"),
    currentQuestion: meta.currentQuestion || null,
    answeredQuestions: meta.answeredQuestions
      ? JSON.parse(meta.answeredQuestions)
      : [],
    customQuestions: meta.customQuestions
      ? JSON.parse(meta.customQuestions)
      : [],
    totalQuestions: parseInt(meta.totalQuestions || "0"),
  } as Room;
}

async function getRoomWithCleanup(roomCode: string): Promise<Room | null> {
  const playerKey = `room:${roomCode}:players`;
  const playersRaw = await pubClient.hGetAll(playerKey);

  // If no players exist, room is dead
  if (!playersRaw || Object.keys(playersRaw).length === 0) return null;

  let needsUpdate = false;

  // Loop through players and check heartbeat keys
  for (const socketId of Object.keys(playersRaw)) {
    const active = await pubClient.exists(`player:${roomCode}:${socketId}`);

    // Player heartbeat expired → remove them
    if (!active) {
      await pubClient.hDel(playerKey, socketId);
      needsUpdate = true;
    }
  }

  const room = await getFullRoom(roomCode);
  if (!room || room.players.length === 0) {
    await pubClient.del([`room:${roomCode}:meta`, `room:${roomCode}:players`]);
    return null;
  }

  if (needsUpdate && !room.players.some((p) => p.isHost)) {
    room.players[0].isHost = true;
    await pubClient.hSet(
      playerKey,
      room.players[0].id,
      JSON.stringify(room.players[0])
    );
  }
  return room;
}

/* ======================================================
   SOCKET INIT
   ====================================================== */

export const initSocket = (httpServer: HttpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    adapter: createAdapter(pubClient, subClient),
  });

  io.on("connection", (socket: Socket) => {
    //create room
    socket.on("create_room", async ({ playerName }, cb) => {
      try {
        let code = "";
        let created = false;
        let attempts = 0;

        // Try up to 5 times to generate a unique room code
        while (!created && attempts < 5) {
          const candidate = nanoid(6).toUpperCase();
          const reserve = await pubClient.set(
            `room:${candidate}:meta`,
            "RESERVED",
            { NX: true, EX: 30 }
          );
          if (reserve === "OK") {
            code = candidate;
            created = true;
          }
          attempts++;
        }
        if (!created)
          return cb({ success: false, message: "Could not generate code" });

        const player: Player = {
          id: socket.id,
          name: playerName,
          isHost: true,
          lastSeen: Date.now(),
        };
        const pipeline = pubClient.multi();
        pipeline.del(`room:${code}:meta`);
        pipeline.hSet(`room:${code}:meta`, {
          isStarted: "false",
          isFlipped: "false",
          currentPlayerIndex: "0",
          customQuestions: "[]",
          answeredQuestions: "[]",
        });
        pipeline.hSet(
          `room:${code}:players`,
          socket.id,
          JSON.stringify(player)
        );
        pipeline.set(`player:${code}:${socket.id}`, "active", {
          EX: PLAYER_TTL,
        });
        pipeline.expire(`room:${code}:meta`, ROOM_TTL);
        pipeline.expire(`room:${code}:players`, ROOM_TTL);
        await pipeline.exec();

        socket.data.roomCode = code;
        socket.join(code);
        cb({ success: true, room: await getFullRoom(code), player });
      } catch (e) {
        cb({ success: false });
      }
    });

    //join room
    socket.on("join_room", async ({ roomCode, playerName }, cb) => {
      const code = roomCode.toUpperCase();
      const room = await getRoomWithCleanup(code);
      if (!room) return cb({ success: false, message: "Room not found" });

      const player: Player = {
        id: socket.id,
        name: playerName,
        isHost: false,
        lastSeen: Date.now(),
      };

      // Save player and heartbeat
      await pubClient.hSet(
        `room:${code}:players`,
        socket.id,
        JSON.stringify(player)
      );
      await pubClient.set(`player:${code}:${socket.id}`, "active", {
        EX: PLAYER_TTL,
      });

      socket.data.roomCode = code;
      socket.join(code);
      const updated = await getFullRoom(code);

      // Broadcast updated room
      io.to(code).emit("room_updated", updated);
      cb({ success: true, room: updated, player });
    });

    //rejoin room
    socket.on("rejoin_room", async ({ roomCode, playerName }, cb) => {
      const code = roomCode.toUpperCase();
      const room = await getRoomWithCleanup(code);
      if (!room) return cb({ success: false, message: "Session expired" });

      const existing = room.players.find((p) => p.name === playerName);
      if (existing) {
        await pubClient.hDel(`room:${code}:players`, existing.id);
        existing.id = socket.id;
        await pubClient.hSet(
          `room:${code}:players`,
          socket.id,
          JSON.stringify(existing)
        );
        await pubClient.set(`player:${code}:${socket.id}`, "active", {
          EX: PLAYER_TTL,
        });
        socket.data.roomCode = code;
        socket.join(code);
        cb({ success: true, room: await getFullRoom(code), player: existing });
      } else {
        cb({ success: false });
      }
    });

    //Added Room Broadcast to Heartbeat ---
    socket.on("heartbeat", async ({ roomCode }) => {
      if (!roomCode) return;

      // Mark player as active by refreshing heartbeat
      await pubClient.set(`player:${roomCode}:${socket.id}`, "active", {
        EX: PLAYER_TTL,
      });

      // Periodic Broadcast: Clean and sync room state for everyone
      const room = await getRoomWithCleanup(roomCode);
      if (room) {
        io.to(roomCode).emit("room_updated", room);
      }
    });

    //select pack
    socket.on("select_pack", async ({ roomCode, packId }) => {
      const room = await getRoomWithCleanup(roomCode);
      if (!room || !room.players.find((p) => p.id === socket.id)?.isHost)
        return;
      await pubClient.hSet(`room:${roomCode}:meta`, "selectedPack", packId);
      io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
    });

    //start game
    socket.on("start_game", async ({ roomCode }, cb) => {
      const room = await getRoomWithCleanup(roomCode);
      const pack = mappedGamePacks.find((p) => p.id == room?.selectedPack);
      if (!room || !pack) return cb({ success: false });

      const pool = [...pack.questions, ...room.customQuestions];
      const first = pool[Math.floor(Math.random() * pool.length)];

      await pubClient.hSet(`room:${roomCode}:meta`, {
        isStarted: "true",
        currentQuestion: first.text,
        answeredQuestions: JSON.stringify([first.id]),
        currentPlayerIndex: Math.floor(
          Math.random() * room.players.length
        ).toString(),
      });
      io.to(roomCode).emit("game_started", await getFullRoom(roomCode));
      cb({ success: true });
    });

    //flip card
    socket.on("flip_card", async ({ roomCode }) => {
      await pubClient.hSet(`room:${roomCode}:meta`, "isFlipped", "true");
      io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
    });

    //next question
    socket.on("next_question", async ({ roomCode }) => {
      const room = await getRoomWithCleanup(roomCode);
      if (!room) return;
      const pack = mappedGamePacks.find((p) => p.id == room.selectedPack);
      const pool = [...(pack?.questions || []), ...room.customQuestions];
      const available = pool.filter(
        (q) => !room.answeredQuestions.includes(q.id)
      );

      if (available.length === 0) return io.to(roomCode).emit("game_over");

      const next = available[Math.floor(Math.random() * available.length)];
      await pubClient.hSet(`room:${roomCode}:meta`, {
        currentQuestion: next.text,
        isFlipped: "false",
        answeredQuestions: JSON.stringify([...room.answeredQuestions, next.id]),
        currentPlayerIndex: (
          (room.currentPlayerIndex + 1) %
          room.players.length
        ).toString(),
      });
      io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
    });

    //add and remove custom question
    socket.on("add_custom_question", async ({ roomCode, question }) => {
      const room = await getRoomWithCleanup(roomCode);
      if (!room) return;
      const list = [...room.customQuestions, { id: nanoid(), text: question }];
      await pubClient.hSet(
        `room:${roomCode}:meta`,
        "customQuestions",
        JSON.stringify(list)
      );
      io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
    });

    socket.on("remove_custom_question", async ({ roomCode, questionId }) => {
      const room = await getRoomWithCleanup(roomCode);
      if (!room) return;
      const list = room.customQuestions.filter((q: any) => q.id !== questionId);
      await pubClient.hSet(
        `room:${roomCode}:meta`,
        "customQuestions",
        JSON.stringify(list)
      );
      io.to(roomCode).emit("room_updated", await getFullRoom(roomCode));
    });

    //disconnect
    socket.on("disconnect", async () => {
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
      await pubClient.hSet(
        metaKey,
        "currentPlayerIndex",
        currentIdx.toString()
      );

      // 5. Final Sync
      const finalRoom = await getFullRoom(code);
      io.to(code).emit("player_left", { leavingPlayer, room: finalRoom });
      io.to(code).emit("room_updated", finalRoom);
    });
  });
};
