// multiplayer-backend/src/socketHandlers/pig/pigGameHandler.ts
import { Server, Socket } from "socket.io";
import { SOCKET_EVENTS } from "../constants";
import {
  deleteRoomState,
  getRoomState,
  setRoomState,
} from "../rooms/redisRoomState";

interface Player {
  id: string;
  name: string;
  frozenScore: number;
  tempScore: number;
}

interface RoomState {
  players: Player[];
  activePlayerIndex: number;
  diceRoll: number;
  bannedNumber: number;
  winner: string | null;
  gameStarted: boolean;
  leaderId: string;
}

const WINNING_SCORE = 50;

export const pigGameHandler = (io: Server, socket: Socket) => {
  socket.on(SOCKET_EVENTS.PIG.JOIN_ROOM, async ({ roomId, playerName }) => {
    socket.join(roomId);

    // Fetch current room state from Redis
    let room = await getRoomState<RoomState>(roomId);

    if (!room) {
      room = {
        players: [],
        activePlayerIndex: 0,
        diceRoll: 1,
        bannedNumber: 1,
        winner: null,
        gameStarted: false,
        leaderId: socket.id, // Initially set leader as the first player
      };
    }

    // Add player if not already in room
    const alreadyInRoom = room.players.some((p) => p.id === socket.id);
    if (!alreadyInRoom) {
      const player: Player = {
        id: socket.id,
        name: playerName || "Player",
        frozenScore: 0,
        tempScore: 0,
      };
      room.players.push(player);
    }

    // Assign leader if room just started and no leader
    if (room.players.length === 1) {
      room.leaderId = socket.id;
    }

    // Start game once the first player joins
    if (!room.gameStarted && room.players.length >= 1) {
      room.gameStarted = true;
    }

    // Save room state to Redis
    await setRoomState(roomId, room);

    console.log(`[${roomId}] Player joined: ${playerName}`);
    io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
    socket.emit(SOCKET_EVENTS.PIG.UPDATE, room);
  });

  socket.on(SOCKET_EVENTS.PIG.ROLL_DICE, async ({ roomId }) => {
    const room = await getRoomState<RoomState>(roomId);
    if (!room || room.winner) return;

    const current = room.players[room.activePlayerIndex];
    if (current.id !== socket.id) return;

    const dice = Math.ceil(Math.random() * 6);
    room.diceRoll = dice;

    // Handle if the rolled dice matches the banned number
    if (dice === room.bannedNumber) {
      current.tempScore = 0;
      room.activePlayerIndex =
        (room.activePlayerIndex + 1) % room.players.length;
    } else {
      current.tempScore += dice;
    }

    // Save updated room state to Redis
    await setRoomState(roomId, room);

    console.log(`[${roomId}] ${current.name} rolled: ${dice}`);
    io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
  });

  socket.on(SOCKET_EVENTS.PIG.BANK_SCORE, async ({ roomId }) => {
    const room = await getRoomState<RoomState>(roomId);
    if (!room || room.winner) return;

    const current = room.players[room.activePlayerIndex];
    if (current.id !== socket.id) return;

    current.frozenScore += current.tempScore;
    current.tempScore = 0;

    // Check if the current player wins
    if (current.frozenScore >= WINNING_SCORE) {
      room.winner = `${current.name} wins! 🎉`;
    } else {
      room.activePlayerIndex =
        (room.activePlayerIndex + 1) % room.players.length;
    }

    // Save updated room state to Redis
    await setRoomState(roomId, room);

    console.log(
      `[${roomId}] ${current.name} banked. Total: ${current.frozenScore}`
    );
    io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
  });

  socket.on(SOCKET_EVENTS.PIG.NEW_BANNED, async ({ roomId }) => {
    const room = await getRoomState<RoomState>(roomId);
    if (!room) return;

    // Assign new banned number
    room.bannedNumber = Math.ceil(Math.random() * 6);

    // Save updated room state to Redis
    await setRoomState(roomId, room);

    console.log(`[${roomId}] New banned number: ${room.bannedNumber}`);
    io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
  });

  socket.on("disconnect", async () => {
    // Get the rooms the socket is part of (excluding the socket's own room)
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);

    for (const roomId of rooms) {
      const room = await getRoomState<RoomState>(roomId);
      if (!room) continue;

      // Check if the socket was the leader
      const wasLeader = socket.id === room.leaderId;
      room.players = room.players.filter((p) => p.id !== socket.id);

      // Adjust active player index if necessary
      if (room.activePlayerIndex >= room.players.length) {
        room.activePlayerIndex = 0;
      }

      // Assign a new leader if the previous one disconnected
      if (wasLeader && room.players.length > 0) {
        room.leaderId = room.players[0].id;
      }

      // If no players left, delete the room state from Redis
      if (room.players.length === 0) {
        console.log(`[${roomId}] Room closed (empty).`);
        io.to(roomId).emit(SOCKET_EVENTS.ROOM_CLOSED);
        await deleteRoomState(roomId);
        continue;
      }

      // Save the updated room state to Redis
      await setRoomState(roomId, room);

      console.log(
        `[${roomId}] Player disconnected. Remaining: ${room.players.length}`
      );
      io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
    }
  });
};
