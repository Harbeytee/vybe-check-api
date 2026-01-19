import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { connectRedis, getRedisAdapter } from "./socket/redis/client";
import createRoom from "./socket/handlers/room/createRoom";
import joinRoom from "./socket/handlers/room/joinRoom";
import rejoinRoom from "./socket/handlers/room/rejoinRoom";
import checkMembership from "./socket/handlers/room/checkMembership";
import startGame from "./socket/handlers/game/startGame";
import flipCard from "./socket/handlers/game/flipCard";
import nextQuestion from "./socket/handlers/game/nextQuestion";
import addCustomQuestion from "./socket/handlers/game/addCustomQuestion";
import removeCustomQuestion from "./socket/handlers/game/removeCustomQuestion";
import disconnect from "./socket/handlers/disconnect";
import heartbeat from "./socket/handlers/room/heartbeat";
import selectPack from "./socket/handlers/game/selectPack";

export const initSocket = async (httpServer: HttpServer) => {
  await connectRedis();

  const io = new Server(httpServer, {
    cors: { origin: "*" },
    adapter: getRedisAdapter(),
    // Connection timeout configuration to detect dead connections
    pingTimeout: 20000, // 20 seconds - time to wait for pong response
    pingInterval: 10000, // 10 seconds - interval between pings
    // This ensures connections are dropped if client doesn't respond
    // Works even when browser suspends tabs
  });

  io.on("connection", (socket: Socket) => {
    // Room events
    socket.on("create_room", createRoom({ socket, io }));
    socket.on("join_room", joinRoom({ io, socket }));
    socket.on("rejoin_room", rejoinRoom({ socket }));
    socket.on("heartbeat", heartbeat({ socket, io }));
    socket.on("check_membership", checkMembership({ socket, io })); // Check if still in room

    // Game events
    socket.on("select_pack", selectPack({ socket, io }));
    socket.on("start_game", startGame({ socket, io }));
    socket.on("flip_card", flipCard({ socket, io }));
    socket.on("next_question", nextQuestion({ socket, io }));
    socket.on("add_custom_question", addCustomQuestion({ socket, io }));
    socket.on("remove_custom_question", removeCustomQuestion({ socket, io }));

    //disconnect
    socket.on("disconnect", disconnect({ socket, io }));
  });

  return io;
};
