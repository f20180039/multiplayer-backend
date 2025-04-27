// src/socketHandlers/roomHandlers.ts
import { Server, Socket } from "socket.io";
import { SOCKET_EVENTS } from "../constants";
import { pubClient } from "../config/redis";

const OFFLINE_TIMEOUT = 2 * 60 * 1000; // 2 minutes in milliseconds

interface JoinRoomPayload {
  roomId: string;
  playerName: string;
  gameId: string;
}

interface PlayerStatus {
  name: string;
  lastSeen: number;
  isOnline: boolean;
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

    // Remove any previous socketId for this playerName
    for (const [id, name] of Object.entries(currentPlayers)) {
      if (name === playerName && id !== socket.id) {
        await pubClient.hDel(`room:${roomId}:players`, id);
        await pubClient.hDel(`room:${roomId}:status`, id);
      }
    }

    // Update player status
    await pubClient.hSet(
      `room:${roomId}:status`,
      socket.id,
      JSON.stringify({
        name: playerName,
        lastSeen: Date.now(),
        isOnline: true,
      })
    );

    // Register new player (always by socket.id)
    await pubClient.hSet(`room:${roomId}:players`, socket.id, playerName);
    socket.join(roomId);

    // Send chat history
    const chatHistory = await pubClient.lRange(`room:${roomId}:chat`, 0, -1);
    const messages = chatHistory.map((msg) => JSON.parse(msg));
    socket.emit(SOCKET_EVENTS.CHAT_HISTORY, messages);

    // Broadcast player status update
    const playerStatuses = await getPlayerStatuses(roomId);
    io.to(roomId).emit(SOCKET_EVENTS.PLAYER_STATUS_UPDATE, playerStatuses);

    // Broadcast updated player list
    const players = await pubClient.hGetAll(`room:${roomId}:players`);
    io.in(roomId).emit(SOCKET_EVENTS.ROOM_PLAYERS, players);

    socket.emit(SOCKET_EVENTS.ROOM_JOINED, { roomId });
    socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, {
      socketId: socket.id,
      playerName,
    });
  });

  // Consolidated disconnect logic
  socket.on("disconnect", async () => {
    console.log("❌ User disconnected:", socket.id);
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);

    for (const roomId of rooms) {
      // Mark player as offline but don't remove immediately
      await pubClient.hSet(
        `room:${roomId}:status`,
        socket.id,
        JSON.stringify({
          name: await pubClient.hGet(`room:${roomId}:players`, socket.id),
          lastSeen: Date.now(),
          isOnline: false,
        })
      );

      // Schedule cleanup after timeout
      setTimeout(async () => {
        const status = await pubClient.hGet(`room:${roomId}:status`, socket.id);
        if (status) {
          const playerStatus = JSON.parse(status);
          if (
            !playerStatus.isOnline &&
            Date.now() - playerStatus.lastSeen >= OFFLINE_TIMEOUT
          ) {
            await pubClient.hDel(`room:${roomId}:players`, socket.id);
            await pubClient.hDel(`room:${roomId}:status`, socket.id);

            // Broadcast updated player list
            const updatedPlayers = await pubClient.hGetAll(
              `room:${roomId}:players`
            );
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
        }
      }, OFFLINE_TIMEOUT);
    }
  });

  // Chat message sent by player
  socket.on(
    SOCKET_EVENTS.CHAT_MESSAGE,
    async ({ roomId, playerName, message }) => {
      const chatMessage = {
        playerName,
        message,
        timestamp: new Date().toISOString(),
      };

      // Store message in Redis
      await pubClient.rPush(`room:${roomId}:chat`, JSON.stringify(chatMessage));
      // Trim chat history to last 100 messages
      await pubClient.lTrim(`room:${roomId}:chat`, -100, -1);

      io.to(roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage);
    }
  );

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

async function getPlayerStatuses(roomId: string) {
  const statuses = await pubClient.hGetAll(`room:${roomId}:status`);
  // statuses is { [socketId]: stringified PlayerStatus }
  return Object.entries(statuses).map(([id, status]) => {
    try {
      const parsed = JSON.parse(status);
      return {
        id,
        ...parsed,
      };
    } catch {
      return { id, name: "Unknown", lastSeen: 0, isOnline: false };
    }
  });
}
