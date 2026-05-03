// src/constants/index.ts
export enum GameId {
  PIG_GAME = "pig-game",
  DICE_ELIMINATION = "dice-elimination",
  PANIC_POTATO = "panic-potato",
}

export const PANIC_POTATO_LIMITS = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  STARTING_LIVES: 3,
  FUSE_MIN_MS: 8000,
  FUSE_MAX_MS: 22000,
  RECEIVE_COOLDOWN_MS: 500,
  DASH_COOLDOWN_MS: 2500,
  GLUE_LOCK_MS: 1500,
  ROUND_START_COUNTDOWN_MS: 3000,
  POST_EXPLOSION_DELAY_MS: 2000,
} as const;

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
  CHAT_HISTORY: "chat_history",

  // Game lifecycle events
  GAME_START: "game_start",
  GAME_END: "game_end",
  GAME_RESET: "game_reset",
  GAME_RESTART: "game_restart",

  // Player actions
  PLAYER_KICKED: "player_kicked",
  PLAYER_BANNED: "player_banned",
  PLAYER_STATUS_UPDATE: "player_status_update",

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

  // Specific game events (Dice Elimination)
  DICE_ELIMINATION: {
    JOIN_GAME: "dice-elimination:join_game",
    ROLL_DICE: "dice-elimination:roll_dice",
    RESET_GAME: "dice-elimination:reset_game",
    UPDATE: "dice-elimination:update",
  },

  // Specific game events (Panic Potato)
  PANIC_POTATO: {
    JOIN_GAME: "panic-potato:join_game",
    INPUT: "panic-potato:input",
    PASS_POTATO: "panic-potato:pass_potato",
    USE_POWER_UP: "panic-potato:use_power_up",
    REMATCH: "panic-potato:rematch",
    UPDATE: "panic-potato:update",
    ERROR: "panic-potato:error",
  },
} as const;
