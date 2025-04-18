// src/socketHandlers/index.ts
import { GameId } from "../constants";
import { pigGameHandler } from "./pigGameHandler";

export const gameHandlers: Record<GameId, typeof pigGameHandler> = {
  [GameId.PIG_GAME]: pigGameHandler, // Add other game handlers if you have more games
};
