// src/socketHandlers/index.ts
import { GameId } from "../constants";
import { pigGameHandler } from "./pigGameHandler";
import { diceEliminationGameHandler } from "./diceEliminationGameHandler";

export const gameHandlers: Record<GameId, typeof pigGameHandler> = {
  [GameId.PIG_GAME]: pigGameHandler,
  [GameId.DICE_ELIMINATION]: diceEliminationGameHandler,
};
