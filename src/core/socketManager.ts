// src/core/socketManager.ts
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { SOCKET_EVENTS } from "../constants";
import { pubClient, subClient } from "../config/redis";
import { GameId } from "../types/games";
import { gameHandlers } from "../socketHandlers";

export const initializeSocketServer = async (io: Server) => {
  await pubClient.connect();
  await subClient.connect();
  io.adapter(createAdapter(pubClient, subClient));
  const registeredHandlers = new Set<GameId>();
  io.on("connection", (socket: Socket) => {
    console.log("✅ User connected:", socket.id);

    socket.on(SOCKET_EVENTS.JOIN_ROOM, ({ gameId, roomId }) => {
      console.log(`🎮 [${gameId}] - ${socket.id} joining room ${roomId}`);
      socket.join(roomId);
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, { roomId });
      socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, socket.id);

      if (!registeredHandlers.has(gameId)) {
        const handler = gameHandlers[gameId as GameId];
        if (handler) {
          handler(io, socket);
          registeredHandlers.add(gameId);
          console.log(`🧩 Handler registered for game: ${gameId}`);
        } else {
          console.warn(`⚠️ No handler found for game: ${gameId}`);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("❌ User disconnected:", socket.id);
    });
  });
};
