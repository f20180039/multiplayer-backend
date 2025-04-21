// src/constants/index.ts
export enum GameId {
  PIG_GAME = "pig-game",
  // Add other games here
}

export const SOCKET_EVENTS = {
  // General room lifecycle
  JOIN_ROOM: "join_room",
  ROOM_JOINED: "room_joined",
  USER_JOINED: "user_joined",
  USER_LEFT: "user_left",
  ROOM_CLOSED: "room_closed",
  ROOM_FULL: "room_full",
  ROOM_PLAYERS: "room_players",

  // Chat events
  CHAT_MESSAGE: "chat_message",

  // Game lifecycle events
  GAME_START: "game_start",
  GAME_END: "game_end",
  GAME_RESET: "game_reset",
  GAME_RESTART: "game_restart",

  // Player actions
  PLAYER_KICKED: "player_kicked",
  PLAYER_BANNED: "player_banned",

  // Internal utility events
  REGISTER_GAME_HANDLER: "register_game_handler",

  // Specific game events (Pig)
  PIG: {
    JOIN_ROOM: "pig:join_room",
    ROLL_DICE: "pig:roll_dice",
    BANK_SCORE: "pig:bank_score",
    NEW_BANNED: "pig:new_banned",
    UPDATE: "pig:update",
    ROOM_CLOSED: "pig:room_closed",
    GAME_START: "pig:game_start",
  },
} as const;
