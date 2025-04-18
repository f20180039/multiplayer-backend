// src/constants/index.ts
export const SOCKET_EVENTS = {
    JOIN_ROOM: "join_room",
    ROOM_JOINED: "room_joined",
    USER_JOINED: "user_joined",
    GAME_MOVE: "game_move",
  
    PIG: {
      JOIN_ROOM: "pig:join-room",
      ROLL_DICE: "pig:roll-dice",
      BANK_SCORE: "pig:bank",
      NEW_BANNED: "pig:new-banned",
      UPDATE: "pig:update",
    },
  } as const;
  