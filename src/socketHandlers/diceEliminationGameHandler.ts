import { Server, Socket } from "socket.io";
import { SOCKET_EVENTS } from "../constants";
import {
  deleteRoomState,
  getRoomState,
  setRoomState,
} from "../rooms/redisRoomState";

interface DiceEliminationPlayer {
  id: string;
  name: string;
  isActive: boolean;
  isEliminated: boolean;
  roll: number | null;
  lastRoundRoll: number | null;
}

interface DiceRollRecord {
  round: number;
  playerId: string;
  playerName: string;
  roll: number;
  rolledAt: string;
}

interface DiceEliminationRoomState {
  players: DiceEliminationPlayer[];
  currentTurnPlayerId: string | null;
  round: number;
  phase: "waiting" | "rolling" | "round_result" | "finished";
  eliminatedPlayerIds: string[];
  winnerId: string | null;
  lastMessage: string;
  leaderId: string;
  rollHistory: DiceRollRecord[];
}

const rollDie = () => Math.floor(Math.random() * 6) + 1;

const getActivePlayers = (room: DiceEliminationRoomState) =>
  room.players.filter((player) => !player.isEliminated);

const getNextTurnPlayerId = (room: DiceEliminationRoomState) =>
  getActivePlayers(room).find((player) => player.roll === null)?.id ?? null;

const createInitialRoom = (leaderId: string): DiceEliminationRoomState => ({
  players: [],
  currentTurnPlayerId: null,
  round: 1,
  phase: "waiting",
  eliminatedPlayerIds: [],
  winnerId: null,
  lastMessage: "Waiting for players to join.",
  leaderId,
  rollHistory: [],
});

const startNextRound = (room: DiceEliminationRoomState) => {
  room.round += 1;
  room.eliminatedPlayerIds = [];
  room.phase = "rolling";
  room.players.forEach((player) => {
    player.roll = null;
    player.lastRoundRoll = null;
  });
  room.currentTurnPlayerId = getNextTurnPlayerId(room);
};

const normalizeRoom = (room: DiceEliminationRoomState) => {
  room.rollHistory ??= [];
  room.eliminatedPlayerIds ??= [];
  room.players.forEach((player) => {
    player.lastRoundRoll ??= null;
  });
};

const finishRoundIfReady = (room: DiceEliminationRoomState) => {
  const activePlayers = getActivePlayers(room);

  if (activePlayers.length <= 1) {
    const winner = activePlayers[0];
    room.phase = "finished";
    room.winnerId = winner?.id ?? null;
    room.currentTurnPlayerId = null;
    room.lastMessage = winner
      ? `${winner.name} wins the game!`
      : "No winner this time.";
    return;
  }

  const allRolled = activePlayers.every((player) => player.roll !== null);
  if (!allRolled) {
    room.currentTurnPlayerId = getNextTurnPlayerId(room);
    return;
  }

  activePlayers.forEach((player) => {
    player.lastRoundRoll = player.roll;
  });

  const lowestRoll = Math.min(
    ...activePlayers.map((player) => player.roll ?? 6)
  );
  const lowestPlayers = activePlayers.filter(
    (player) => player.roll === lowestRoll
  );

  if (lowestPlayers.length === activePlayers.length) {
    room.players.forEach((player) => {
      if (!player.isEliminated) {
        player.roll = null;
      }
    });
    room.currentTurnPlayerId = getNextTurnPlayerId(room);
    room.lastMessage = `Everyone rolled ${lowestRoll}. Round ${room.round} restarts.`;
    return;
  }

  lowestPlayers.forEach((player) => {
    player.isEliminated = true;
  });
  room.eliminatedPlayerIds = lowestPlayers.map((player) => player.id);

  const remainingPlayers = getActivePlayers(room);
  if (remainingPlayers.length <= 1) {
    const winner = remainingPlayers[0];
    room.phase = "finished";
    room.winnerId = winner?.id ?? null;
    room.currentTurnPlayerId = null;
    room.lastMessage = winner
      ? `${winner.name} wins the game!`
      : "Everyone was eliminated.";
    return;
  }

  room.phase = "round_result";
  room.currentTurnPlayerId = null;
  room.lastMessage = `${lowestPlayers
    .map((player) => player.name)
    .join(", ")} rolled the lowest (${lowestRoll}) and ${
    lowestPlayers.length === 1 ? "is" : "are"
  } eliminated.`;
};

export const diceEliminationGameHandler = (io: Server, socket: Socket) => {
  socket.on(
    SOCKET_EVENTS.DICE_ELIMINATION.JOIN_GAME,
    async ({ roomId, playerName }: { roomId: string; playerName: string }) => {
      const playerId = socket.data.userId || socket.id;
      socket.join(roomId);

      let room = await getRoomState<DiceEliminationRoomState>(roomId);
      if (!room) {
        room = createInitialRoom(playerId);
      } else {
        normalizeRoom(room);
      }

      const existingPlayer = room.players.find(
        (player) => player.id === playerId
      );

      if (existingPlayer) {
        existingPlayer.name = playerName || existingPlayer.name;
        existingPlayer.isActive = true;
      } else if (room.phase === "waiting" || room.phase === "rolling") {
        room.players.push({
          id: playerId,
          name: playerName || "Player",
          isActive: true,
          isEliminated: false,
          roll: null,
          lastRoundRoll: null,
        });
      }

      if (room.players.length >= 2 && room.phase === "waiting") {
        room.phase = "rolling";
        room.currentTurnPlayerId = getNextTurnPlayerId(room);
        room.lastMessage = "Game started. Roll low and you are out.";
      } else if (room.players.length < 2) {
        room.lastMessage = "Waiting for at least 2 players.";
      }

      if (!room.leaderId) {
        room.leaderId = playerId;
      }

      await setRoomState(roomId, room);
      io.to(roomId).emit(SOCKET_EVENTS.DICE_ELIMINATION.UPDATE, room);
    }
  );

  socket.on(
    SOCKET_EVENTS.DICE_ELIMINATION.ROLL_DICE,
    async ({ roomId }: { roomId: string }) => {
      const playerId = socket.data.userId || socket.id;
      const room = await getRoomState<DiceEliminationRoomState>(roomId);
      if (!room || room.phase !== "rolling") return;
      normalizeRoom(room);
      if (room.currentTurnPlayerId !== playerId) return;

      const player = room.players.find((candidate) => candidate.id === playerId);
      if (!player || player.isEliminated || player.roll !== null) return;

      player.roll = rollDie();
      room.rollHistory.push({
        round: room.round,
        playerId: player.id,
        playerName: player.name,
        roll: player.roll,
        rolledAt: new Date().toISOString(),
      });
      room.lastMessage = `${player.name} rolled ${player.roll}.`;
      finishRoundIfReady(room);

      await setRoomState(roomId, room);
      io.to(roomId).emit(SOCKET_EVENTS.DICE_ELIMINATION.UPDATE, room);
    }
  );

  socket.on(
    SOCKET_EVENTS.DICE_ELIMINATION.RESET_GAME,
    async ({ roomId }: { roomId: string }) => {
      const playerId = socket.data.userId || socket.id;
      const room = await getRoomState<DiceEliminationRoomState>(roomId);
      if (!room || room.leaderId !== playerId) return;
      normalizeRoom(room);

      const resetRoom = createInitialRoom(playerId);
      resetRoom.players = room.players.map((player) => ({
        ...player,
        isEliminated: false,
        roll: null,
        lastRoundRoll: null,
      }));
      resetRoom.phase = resetRoom.players.length >= 2 ? "rolling" : "waiting";
      resetRoom.currentTurnPlayerId = getNextTurnPlayerId(resetRoom);
      resetRoom.lastMessage =
        resetRoom.players.length >= 2
          ? "New game started."
          : "Waiting for at least 2 players.";

      await setRoomState(roomId, resetRoom);
      io.to(roomId).emit(SOCKET_EVENTS.DICE_ELIMINATION.UPDATE, resetRoom);
    }
  );

  socket.on("disconnect", async () => {
    const rooms = Array.from(socket.rooms).filter((roomId) => roomId !== socket.id);

    for (const roomId of rooms) {
      const room = await getRoomState<DiceEliminationRoomState>(roomId);
      if (!room) continue;
      normalizeRoom(room);

      const player = room.players.find(
        (candidate) => candidate.id === socket.data.userId
      );
      if (!player) continue;

      player.isActive = false;

      const activeConnectedPlayers = room.players.filter(
        (candidate) => candidate.isActive
      );
      if (room.leaderId === player.id && activeConnectedPlayers.length > 0) {
        room.leaderId = activeConnectedPlayers[0].id;
      }

      if (room.currentTurnPlayerId === player.id) {
        room.currentTurnPlayerId = getNextTurnPlayerId(room);
      }

      if (activeConnectedPlayers.length === 0) {
        await setRoomState(roomId, room);
        setTimeout(async () => {
          const currentRoom =
            await getRoomState<DiceEliminationRoomState>(roomId);
          if (!currentRoom) return;
          const hasActivePlayer = currentRoom.players.some(
            (candidate) => candidate.isActive
          );
          if (!hasActivePlayer) {
            io.to(roomId).emit(SOCKET_EVENTS.ROOM_CLOSED);
            await deleteRoomState(roomId);
          }
        }, 5 * 60 * 1000);
        continue;
      }

      await setRoomState(roomId, room);
      io.to(roomId).emit(SOCKET_EVENTS.DICE_ELIMINATION.UPDATE, room);
    }
  });

  socket.on(SOCKET_EVENTS.GAME_START, async ({ roomId }: { roomId: string }) => {
    const room = await getRoomState<DiceEliminationRoomState>(roomId);
    if (!room || room.phase !== "round_result") return;
    normalizeRoom(room);

    startNextRound(room);
    room.lastMessage = `Round ${room.round} started.`;

    await setRoomState(roomId, room);
    io.to(roomId).emit(SOCKET_EVENTS.DICE_ELIMINATION.UPDATE, room);
  });
};
