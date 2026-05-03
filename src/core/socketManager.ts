// src/core/socketManager.ts
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { GameId, SOCKET_EVENTS } from "../constants";
import { isInMemoryRedis, pubClient, subClient } from "../config/redis";
import { gameHandlers } from "../socketHandlers";
import { registerRoomHandlers } from "../socketHandlers/roomHandlers";
import { verifyIdToken } from "../config/firebase";

export const initializeSocketServer = async (io: Server) => {
  await pubClient.connect();
  await subClient.connect();

  if (!isInMemoryRedis) {
    io.adapter(createAdapter(pubClient, subClient));
  }

  // Auth middleware: verify Google token or accept guest credentials
  io.use(async (socket, next) => {
    const { token, guestId, playerName } = socket.handshake.auth;

    if (token) {
      const user = await verifyIdToken(token);
      if (!user) {
        return next(new Error("Invalid authentication token"));
      }
      socket.data.userId = user.uid;
      socket.data.displayName = user.name;
      socket.data.authType = "google";
      return next();
    }

    if (guestId) {
      socket.data.userId = guestId;
      socket.data.displayName = playerName || "Guest";
      socket.data.authType = "guest";
      return next();
    }

    return next(new Error("Authentication required: provide token or guestId"));
  });

  io.on("connection", (socket: Socket) => {
    console.log("✅ User connected:", socket.id);

    // 🔌 Register room-level (non-game specific) handlers
    registerRoomHandlers(io, socket);

    // 🎮 Handle game-specific handler setup per socket
    socket.on(
      SOCKET_EVENTS.REGISTER_GAME_HANDLER,
      async ({ gameId }: { gameId: GameId }) => {
        try {
          const handler = gameHandlers[gameId];
          if (handler) {
            handler(io, socket);
            console.log(
              `🧩 Handler registered for socket ${socket.id}, game: ${gameId}`
            );
          } else {
            console.warn(`⚠️ No handler found for game: ${gameId}`);
          }
        } catch (err) {
          console.error("❌ Error registering game handler:", err);
          socket.emit("error", "Unable to initialize game session.");
        }
      }
    );
  });
};
