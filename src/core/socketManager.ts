// src/core/socketManager.ts
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { GameId, SOCKET_EVENTS } from "../constants";
import { pubClient, subClient } from "../config/redis";
import { gameHandlers } from "../socketHandlers";
import { registerRoomHandlers } from "../socketHandlers/roomHandlers";

export const initializeSocketServer = async (io: Server) => {
  await pubClient.connect();
  await subClient.connect();

  io.adapter(createAdapter(pubClient, subClient));

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
