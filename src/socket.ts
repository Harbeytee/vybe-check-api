import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { Sentry } from "./instrument";
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

/** Wraps a socket handler so uncaught errors and promise rejections are sent to Sentry */
function withSentry(
  eventName: string,
  handler: (...args: unknown[]) => void | Promise<unknown>
) {
  return (...args: unknown[]) => {
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        result.catch((err) => {
          Sentry.captureException(err, {
            tags: { source: "socket", event: eventName },
          });
        });
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { source: "socket", event: eventName },
      });
    }
  };
}

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
    socket.on(
      "create_room",
      withSentry(
        "create_room",
        createRoom({ socket }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );
    socket.on(
      "join_room",
      withSentry(
        "join_room",
        joinRoom({ io, socket }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );
    socket.on(
      "rejoin_room",
      withSentry(
        "rejoin_room",
        rejoinRoom({ socket, io }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );
    socket.on(
      "heartbeat",
      withSentry(
        "heartbeat",
        heartbeat({ socket, io }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );
    socket.on(
      "kick_player",
      withSentry(
        "kick_player",
        kickPlayer({ socket, io }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );

    // Game events
    socket.on(
      "select_pack",
      withSentry(
        "select_pack",
        selectPack({ socket, io }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );
    socket.on(
      "start_game",
      withSentry(
        "start_game",
        startGame({ io }) as (...args: unknown[]) => void | Promise<unknown>
      )
    );
    socket.on(
      "flip_card",
      withSentry(
        "flip_card",
        flipCard({ io }) as (...args: unknown[]) => void | Promise<unknown>
      )
    );
    socket.on(
      "next_question",
      withSentry(
        "next_question",
        nextQuestion({ io }) as (...args: unknown[]) => void | Promise<unknown>
      )
    );
    socket.on(
      "add_custom_question",
      withSentry(
        "add_custom_question",
        addCustomQuestion({ io }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );
    socket.on(
      "remove_custom_question",
      withSentry(
        "remove_custom_question",
        removeCustomQuestion({ io }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );

    // disconnect
    socket.on(
      "disconnect",
      withSentry(
        "disconnect",
        disconnect({ socket, io }) as (
          ...args: unknown[]
        ) => void | Promise<unknown>
      )
    );
  });

  return io;
};
