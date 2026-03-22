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
  isActive: boolean;
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

    // Check if player is reconnecting (match by name for score preservation)
    const existingPlayer = room.players.find(
      (p) => p.name === playerName && !p.isActive
    );
    if (existingPlayer) {
      // Restore disconnected player with new socket id, preserving scores
      existingPlayer.id = socket.id;
      existingPlayer.isActive = true;
    } else {
      // Add player if not already in room
      const alreadyInRoom = room.players.some((p) => p.id === socket.id);
      if (!alreadyInRoom) {
        const player: Player = {
          id: socket.id,
          name: playerName || "Player",
          frozenScore: 0,
          tempScore: 0,
          isActive: true,
        };
        room.players.push(player);
      }
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

      const player = room.players.find((p) => p.id === socket.id);
      if (!player) continue;

      // Mark player as inactive instead of removing (preserve scores)
      player.isActive = false;

      // If it was this player's turn, skip to next active player
      const activePlayers = room.players.filter((p) => p.isActive);
      if (
        room.players[room.activePlayerIndex]?.id === socket.id &&
        activePlayers.length > 0
      ) {
        // Find next active player
        let nextIndex = (room.activePlayerIndex + 1) % room.players.length;
        while (!room.players[nextIndex].isActive) {
          nextIndex = (nextIndex + 1) % room.players.length;
        }
        room.activePlayerIndex = nextIndex;
      }

      // Reassign leader if needed
      const wasLeader = socket.id === room.leaderId;
      if (wasLeader && activePlayers.length > 0) {
        room.leaderId = activePlayers[0].id;
      }

      // If no active players remain, schedule cleanup after 5 minutes
      if (activePlayers.length === 0) {
        await setRoomState(roomId, room);
        setTimeout(async () => {
          const currentRoom = await getRoomState<RoomState>(roomId);
          if (!currentRoom) return;
          const stillActive = currentRoom.players.some((p) => p.isActive);
          if (!stillActive) {
            console.log(`[${roomId}] Room closed (all players inactive for 5 min).`);
            io.to(roomId).emit(SOCKET_EVENTS.ROOM_CLOSED);
            await deleteRoomState(roomId);
          }
        }, 5 * 60 * 1000);
        continue;
      }

      await setRoomState(roomId, room);

      console.log(
        `[${roomId}] Player disconnected (scores preserved). Active: ${activePlayers.length}`
      );
      io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
    }
  });
};
