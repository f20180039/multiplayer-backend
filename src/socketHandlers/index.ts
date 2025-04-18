// src/socketHandlers/index.ts
import { GameId } from "../types/games";
import { pigGameHandler } from "./pigGameHandler";

export const gameHandlers: Record<GameId, typeof pigGameHandler> = {
  pig: pigGameHandler, // Add other game handlers if you have more games
};
