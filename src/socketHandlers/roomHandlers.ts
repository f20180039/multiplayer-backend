// src/socketHandlers/roomHandlers.ts
import { Server, Socket } from "socket.io";
import { GameId, PANIC_POTATO_LIMITS, SOCKET_EVENTS } from "../constants";
import { pubClient } from "../config/redis";

const OFFLINE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

interface JoinRoomPayload {
  roomId: string;
  playerName: string;
  playerId: string;
  gameId: string;
}

export const registerRoomHandlers = (io: Server, socket: Socket) => {
  // Player joins a room
  socket.on(SOCKET_EVENTS.JOIN_ROOM, async (data: JoinRoomPayload) => {
    const { roomId, playerName, playerId, gameId } = data;

    console.log(
      `🎮 [JOIN_ROOM] ${playerName} (${playerId}, socket: ${socket.id}) joining room ${roomId}`
    );

    await pubClient.set(`room:${roomId}:game`, gameId);

    if (gameId === GameId.PANIC_POTATO) {
      const currentPlayers = await pubClient.hGetAll(`room:${roomId}:playerIds`);
      const alreadyInRoom = Object.prototype.hasOwnProperty.call(
        currentPlayers,
        playerId
      );
      if (
        !alreadyInRoom &&
        Object.keys(currentPlayers).length >= PANIC_POTATO_LIMITS.MAX_PLAYERS
      ) {
        socket.emit(SOCKET_EVENTS.ROOM_FULL, { roomId });
        return;
      }
    }

    // Remove any previous socket for this playerId (if exists)
    const prevSocketId = await pubClient.hGet(`room:${roomId}:playerSockets`, playerId);
    if (prevSocketId && prevSocketId !== socket.id) {
      // Optionally: disconnect previous socket
      // io.sockets.sockets.get(prevSocketId)?.disconnect(true);
    }

    // Update mappings
    await pubClient.hSet(`room:${roomId}:playerIds`, playerId, playerName);
    await pubClient.hSet(`room:${roomId}:playerSockets`, playerId, socket.id);
    await pubClient.hSet(
      `room:${roomId}:status`,
      playerId,
      JSON.stringify({
        name: playerName,
        lastSeen: Date.now(),
        isOnline: true,
      })
    );

    socket.join(roomId);

    // Send chat history
    const chatHistory = await pubClient.lRange(`room:${roomId}:chat`, 0, -1);
    const messages = chatHistory.map((msg: string) => JSON.parse(msg));
    socket.emit(SOCKET_EVENTS.CHAT_HISTORY, messages);

    // Broadcast player status update
    const playerStatuses = await getPlayerStatuses(roomId);
    io.to(roomId).emit(SOCKET_EVENTS.PLAYER_STATUS_UPDATE, playerStatuses);

    // Broadcast updated player list
    const players = await pubClient.hGetAll(`room:${roomId}:playerIds`);
    io.in(roomId).emit(SOCKET_EVENTS.ROOM_PLAYERS, players);

    socket.emit(SOCKET_EVENTS.ROOM_JOINED, { roomId });
    socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, {
      playerId,
      playerName,
    });
  });

  // Consolidated disconnect logic
  socket.on("disconnect", async () => {
    console.log("❌ User disconnected:", socket.id);
    // Find all rooms this socket was mapped to
    const keys = await pubClient.keys("room:*:playerSockets");
    for (const key of keys) {
      const roomId = key.split(":")[1];
      const playerSockets = await pubClient.hGetAll(key);
      const playerId = Object.entries(playerSockets).find(
        ([, sId]) => sId === socket.id
      )?.[0];
      if (!playerId) continue;

      // Mark player as offline but don't remove immediately
      await pubClient.hSet(
        `room:${roomId}:status`,
        playerId,
        JSON.stringify({
          name: await pubClient.hGet(`room:${roomId}:playerIds`, playerId),
          lastSeen: Date.now(),
          isOnline: false,
        })
      );

      // Schedule cleanup after timeout
      setTimeout(async () => {
        const status = await pubClient.hGet(`room:${roomId}:status`, playerId);
        if (status) {
          const playerStatus = JSON.parse(status);
          if (
            !playerStatus.isOnline &&
            Date.now() - playerStatus.lastSeen >= OFFLINE_TIMEOUT
          ) {
            await pubClient.hDel(`room:${roomId}:playerIds`, playerId);
            await pubClient.hDel(`room:${roomId}:playerSockets`, playerId);
            await pubClient.hDel(`room:${roomId}:status`, playerId);

            // Broadcast updated player list
            const updatedPlayers = await pubClient.hGetAll(
              `room:${roomId}:playerIds`
            );
            io.to(roomId).emit(SOCKET_EVENTS.ROOM_PLAYERS, updatedPlayers);

            // If room is empty, clean up and emit ROOM_CLOSED event
            if (Object.keys(updatedPlayers).length === 0) {
              await pubClient.del(`room:${roomId}:game`);
              await pubClient.del(`game:state:${roomId}`);
              await pubClient.del(`room:${roomId}:playerIds`);
              await pubClient.del(`room:${roomId}:playerSockets`);
              await pubClient.del(`room:${roomId}:status`);
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
  // statuses is { [playerId]: stringified PlayerStatus }
  return Object.entries(statuses).map(([id, status]) => {
    try {
      const parsed = JSON.parse(status as string);
      return {
        id,
        ...parsed,
      };
    } catch {
      return { id, name: "Unknown", lastSeen: 0, isOnline: false };
    }
  });
}
