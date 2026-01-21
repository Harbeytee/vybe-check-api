import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { connectRedis, getRedisAdapter } from "./socket/redis/client";
import createRoom from "./socket/handlers/room/createRoom";
import joinRoom from "./socket/handlers/room/joinRoom";
import rejoinRoom from "./socket/handlers/room/rejoinRoom";
import startGame from "./socket/handlers/game/startGame";
import flipCard from "./socket/handlers/game/flipCard";
import nextQuestion from "./socket/handlers/game/nextQuestion";
import addCustomQuestion from "./socket/handlers/game/addCustomQuestion";
import removeCustomQuestion from "./socket/handlers/game/removeCustomQuestion";
import disconnect from "./socket/handlers/disconnect";
import heartbeat from "./socket/handlers/room/heartbeat";
import kickPlayer from "./socket/handlers/room/kickPlayer";
import selectPack from "./socket/handlers/game/selectPack";

export const initSocket = async (httpServer: HttpServer) => {
  await connectRedis();

  const io = new Server(httpServer, {
    cors: { origin: "*" },
    adapter: getRedisAdapter(),
    // Aggressive connection timeout to detect PC sleep/disconnects
    pingTimeout: 10000, // 10 seconds - time to wait for pong response (reduced from 20s)
    pingInterval: 5000, // 5 seconds - interval between pings (reduced from 10s)
    // This ensures connections are dropped quickly if client doesn't respond
    // Critical for detecting when PC sleeps and browser can't respond to pings
    connectTimeout: 10000, // 10 seconds to establish connection
  });

  io.on("connection", (socket: Socket) => {
    // Room events
    socket.on("create_room", createRoom({ socket }));
    socket.on("join_room", joinRoom({ io, socket }));
    socket.on("rejoin_room", rejoinRoom({ socket, io }));
    socket.on("heartbeat", heartbeat({ socket, io }));
    socket.on("kick_player", kickPlayer({ socket, io }));

    // Game events
    socket.on("select_pack", selectPack({ socket, io }));
    socket.on("start_game", startGame({ io }));
    socket.on("flip_card", flipCard({ io }));
    socket.on("next_question", nextQuestion({ io }));
    socket.on("add_custom_question", addCustomQuestion({ io }));
    socket.on("remove_custom_question", removeCustomQuestion({ io }));

    //disconnect
    socket.on("disconnect", disconnect({ socket, io }));
  });

  return io;
};
