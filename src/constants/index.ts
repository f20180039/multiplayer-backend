// src/constants/index.ts
export enum GameId {
  PIG_GAME = "pig-game",
  // Add other games here
}

export const SOCKET_EVENTS = {
  // Room lifecycle
  JOIN_ROOM: "room:join",
  ROOM_JOINED: "room:joined",
  USER_JOINED: "room:user-joined",
  ROOM_CLOSED: "room:closed",

  // Game lifecycle
  GAME_START: "game:start",
  UPDATE: "game:update",

  // Chat
  CHAT_MESSAGE: "chat:message",
  CHAT_BROADCAST: "chat:broadcast",

  // Game-specific events
  PIG: {
    JOIN_ROOM: "pig:join-room",
    ROLL_DICE: "pig:roll-dice",
    BANK_SCORE: "pig:bank",
    NEW_BANNED: "pig:new-banned",
  },

  // Future games can follow this pattern
  // TICTACTOE: {
  //   MAKE_MOVE: "tictactoe:make-move",
  //   RESET_GAME: "tictactoe:reset",
  // },
} as const;
