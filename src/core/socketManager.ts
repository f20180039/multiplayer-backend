// src/core/socketManager.ts
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { GameId, SOCKET_EVENTS } from "../constants";
import { pubClient, subClient } from "../config/redis";
import { gameHandlers } from "../socketHandlers";

interface JoinRoomPayload {
  gameId: GameId;
  roomId: string;
  playerName: string;
}

export const initializeSocketServer = async (io: Server) => {
  await pubClient.connect();
  await subClient.connect();

  io.adapter(createAdapter(pubClient, subClient));

  const registeredHandlers = new Set<GameId>();

  io.on("connection", (socket: Socket) => {
    console.log("✅ User connected:", socket.id);

    socket.on(SOCKET_EVENTS.JOIN_ROOM, async (data: JoinRoomPayload) => {
      const { gameId, roomId, playerName } = data;
      console.log(
        `🎮 [${gameId}] - ${playerName} (${socket.id}) joining room ${roomId}`
      );

      // Store game info for the room in Redis
      await pubClient.set(`room:${roomId}:game`, gameId);

      // Get the current players in the room
      const currentPlayers = await pubClient.hGetAll(`room:${roomId}:players`);
      if (Object.keys(currentPlayers).length >= 6) {
        socket.emit("room:full", "Room capacity reached");
        return;
      }

      // Save player info in Redis
      await pubClient.hSet(`room:${roomId}:players`, socket.id, playerName);
      socket.join(roomId);

      // Emit to the user that they joined
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, { roomId });

      // Inform other users
      socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, {
        socketId: socket.id,
        playerName,
      });

      // Emit full player list
      const players = await pubClient.hGetAll(`room:${roomId}:players`);
      io.in(roomId).emit("room:players", players);

      // Handle leader logic
      let roomStateString = await pubClient.get(`game:state:${roomId}`);
      let roomState = roomStateString
        ? JSON.parse(roomStateString)
        : {
            players: [],
            activePlayerIndex: 0,
            leaderId: socket.id, // Default leader is the first player who joins
          };

      if (!registeredHandlers.has(gameId)) {
        const handler = gameHandlers[gameId];
        if (handler) {
          handler(io, socket);
          registeredHandlers.add(gameId);
          console.log(`🧩 Handler registered for game: ${gameId}`);
        } else {
          console.warn(`⚠️ No handler found for game: ${gameId}`);
        }
      }
    });

    socket.on("disconnect", async () => {
      console.log("❌ User disconnected:", socket.id);

      // Try to remove from all rooms the socket was in
      const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
      for (const roomId of rooms) {
        await pubClient.hDel(`room:${roomId}:players`, socket.id);
        const players = await pubClient.hGetAll(`room:${roomId}:players`);
        io.to(roomId).emit("room:players", players);

        // If the leader disconnected, find the next leader
        let roomStateString = await pubClient.get(`game:state:${roomId}`);
        let roomState = roomStateString ? JSON.parse(roomStateString) : null;

        if (roomState && roomState.leaderId === socket.id) {
          // Get the players list from Redis and parse it
          const players = await pubClient.hGetAll(`room:${roomId}:players`);

          // Assign the first player as the new leader
          roomState.leaderId = Object.keys(players)[0]; // Assign the first player as the new leader

          // Save the updated room state back to Redis
          await pubClient.set(
            `game:state:${roomId}`,
            JSON.stringify(roomState)
          );
        }
      }
    });
  });
};
