// src/socketHandlers/pigGameHandler.ts
import { Server, Socket } from "socket.io";
import { SOCKET_EVENTS } from "../constants";

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
}

const gameRooms: Record<string, RoomState> = {};
const WINNING_SCORE = 50;

export const pigGameHandler = (io: Server, socket: Socket) => {
  socket.on(SOCKET_EVENTS.PIG.JOIN_ROOM, ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!gameRooms[roomId]) {
      gameRooms[roomId] = {
        players: [],
        activePlayerIndex: 0,
        diceRoll: 1,
        bannedNumber: 1,
        winner: null,
      };
    }

    const room = gameRooms[roomId];

    const player: Player = {
      id: socket.id,
      name: playerName || "Player",
      frozenScore: 0,
      tempScore: 0,
    };

    const alreadyInRoom = room.players.some((p) => p.id === socket.id);
    if (!alreadyInRoom) {
      room.players.push(player);
      io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
    }
  });

  socket.on(SOCKET_EVENTS.PIG.ROLL_DICE, ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room || room.winner) return;

    const dice = Math.ceil(Math.random() * 6);
    const current = room.players[room.activePlayerIndex];

    room.diceRoll = dice;

    if (dice === room.bannedNumber) {
      current.tempScore = 0;
      room.activePlayerIndex =
        (room.activePlayerIndex + 1) % room.players.length;
    } else {
      current.tempScore += dice;
    }

    io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
  });

  socket.on(SOCKET_EVENTS.PIG.BANK_SCORE, ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room || room.winner) return;

    const current = room.players[room.activePlayerIndex];
    current.frozenScore += current.tempScore;
    current.tempScore = 0;

    if (current.frozenScore >= WINNING_SCORE) {
      room.winner = `${current.name} wins! 🎉`;
    } else {
      room.activePlayerIndex =
        (room.activePlayerIndex + 1) % room.players.length;
    }

    io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
  });

  socket.on(SOCKET_EVENTS.PIG.NEW_BANNED, ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room) return;

    room.bannedNumber = Math.ceil(Math.random() * 6);
    io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
  });

  socket.on("disconnect", () => {
    for (const roomId in gameRooms) {
      const room = gameRooms[roomId];
      room.players = room.players.filter((p) => p.id !== socket.id);
      if (room.activePlayerIndex >= room.players.length) {
        room.activePlayerIndex = 0;
      }
      io.to(roomId).emit(SOCKET_EVENTS.PIG.UPDATE, room);
      if (room.players.length === 0) {
        io.to(roomId).emit(SOCKET_EVENTS.PIG.ROOM_CLOSED);
        delete gameRooms[roomId];
      }
    }
  });
};
