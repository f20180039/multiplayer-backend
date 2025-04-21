// src/socketHandlers/roomHandlers.ts
import { Server, Socket } from "socket.io";
import { SOCKET_EVENTS } from "../constants";
import { pubClient } from "../config/redis";

interface JoinRoomPayload {
  roomId: string;
  playerName: string;
  gameId: string;
}

export const registerRoomHandlers = (io: Server, socket: Socket) => {
  // Player joins a room
  socket.on(SOCKET_EVENTS.JOIN_ROOM, async (data: JoinRoomPayload) => {
    const { roomId, playerName, gameId } = data;

    console.log(
      `🎮 [JOIN_ROOM] ${playerName} (${socket.id}) joining room ${roomId}`
    );

    await pubClient.set(`room:${roomId}:game`, gameId);

    const currentPlayers = await pubClient.hGetAll(`room:${roomId}:players`);

    // 🛑 Prevent duplicate joins for same playerName
    const isPlayerAlreadyInRoom =
      Object.values(currentPlayers).includes(playerName);
    if (isPlayerAlreadyInRoom) {
      console.log(
        `⚠️ Player ${playerName} already in room ${roomId}, skipping re-register`
      );
      socket.join(roomId); // Still let them join the room to receive events
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, { roomId });
      socket.emit(SOCKET_EVENTS.ROOM_PLAYERS, currentPlayers);
      return;
    }

    // Prevent joining if room is full (example limit of 6 players)
    if (Object.keys(currentPlayers).length >= 6) {
      socket.emit(SOCKET_EVENTS.ROOM_FULL, "Room capacity reached");
      return;
    }

    // ✅ Register new player
    await pubClient.hSet(`room:${roomId}:players`, socket.id, playerName);
    socket.join(roomId);

    socket.emit(SOCKET_EVENTS.ROOM_JOINED, { roomId });
    socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, {
      socketId: socket.id,
      playerName,
    });

    const players = await pubClient.hGetAll(`room:${roomId}:players`);
    io.in(roomId).emit(SOCKET_EVENTS.ROOM_PLAYERS, players);
  });

  // Chat message sent by player
  socket.on(SOCKET_EVENTS.CHAT_MESSAGE, ({ roomId, playerName, message }) => {
    if (!roomId || !message?.trim()) return;

    const chatMessage = {
      playerName,
      message,
      timestamp: new Date().toISOString(),
    };

    io.to(roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage);
  });

  // Player leaves room or disconnects
  socket.on("disconnect", async () => {
    console.log("❌ User disconnected:", socket.id);
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
    for (const roomId of rooms) {
      // Remove player by socket ID from Redis
      await pubClient.hDel(`room:${roomId}:players`, socket.id);
      
      // Broadcast updated player list
      const updatedPlayers = await pubClient.hGetAll(`room:${roomId}:players`);
      io.to(roomId).emit(SOCKET_EVENTS.ROOM_PLAYERS, updatedPlayers);

      // Leader handoff logic (if the player was the room leader)
      let roomStateString = await pubClient.get(`game:state:${roomId}`);
      let roomState = roomStateString ? JSON.parse(roomStateString) : null;

      if (roomState && roomState.leaderId === socket.id) {
        const remainingPlayers = Object.keys(updatedPlayers);
        roomState.leaderId = remainingPlayers[0] || null;
        await pubClient.set(`game:state:${roomId}`, JSON.stringify(roomState));
      }

      // If room is empty, clean up and emit ROOM_CLOSED event
      if (Object.keys(updatedPlayers).length === 0) {
        await pubClient.del(`room:${roomId}:game`);
        await pubClient.del(`game:state:${roomId}`);
        await pubClient.del(`room:${roomId}:players`);
        io.to(roomId).emit(SOCKET_EVENTS.ROOM_CLOSED);
      }
    }
  });

  // General room closure (when no players remain)
  socket.on(SOCKET_EVENTS.ROOM_CLOSED, async ({ roomId }) => {
    const players = await pubClient.hGetAll(`room:${roomId}:players`);
    if (Object.keys(players).length === 0) {
      await pubClient.del(`room:${roomId}:game`);
      io.to(roomId).emit(SOCKET_EVENTS.ROOM_CLOSED);
    }
  });

  // Game-specific event to trigger game start (general)
  socket.on(SOCKET_EVENTS.GAME_START, async (data) => {
    const { roomId } = data;
    io.to(roomId).emit(SOCKET_EVENTS.GAME_START, {
      message: "The game has started!",
    });
  });

  // Handle generic game reset
  socket.on(SOCKET_EVENTS.GAME_RESET, async ({ roomId }) => {
    const resetState = { players: [], gameStarted: false };
    await pubClient.set(`game:state:${roomId}`, JSON.stringify(resetState));
    io.to(roomId).emit(SOCKET_EVENTS.GAME_RESET);
  });

  // Handle generic game restart (same state reset)
  socket.on(SOCKET_EVENTS.GAME_RESTART, async ({ roomId }) => {
    const restartState = { players: [], gameStarted: false };
    await pubClient.set(`game:state:${roomId}`, JSON.stringify(restartState));
    io.to(roomId).emit(SOCKET_EVENTS.GAME_RESTART);
  });

  // Player action - Kick player
  socket.on(SOCKET_EVENTS.PLAYER_KICKED, async (data) => {
    const { roomId, playerId } = data;
    await pubClient.hDel(`room:${roomId}:players`, playerId);
    io.to(roomId).emit(SOCKET_EVENTS.PLAYER_KICKED, { playerId });
  });

  // Player ban event
  socket.on(SOCKET_EVENTS.PLAYER_BANNED, async (data) => {
    const { roomId, playerId } = data;
    await pubClient.hDel(`room:${roomId}:players`, playerId);
    io.to(roomId).emit(SOCKET_EVENTS.PLAYER_BANNED, { playerId });
  });
};
