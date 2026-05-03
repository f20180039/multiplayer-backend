// src/socketHandlers/index.ts
import { GameId } from "../constants";
import { pigGameHandler } from "./pigGameHandler";
import { diceEliminationGameHandler } from "./diceEliminationGameHandler";
import { panicPotatoGameHandler } from "./panicPotatoGameHandler";

export const gameHandlers: Record<GameId, typeof pigGameHandler> = {
  [GameId.PIG_GAME]: pigGameHandler,
  [GameId.DICE_ELIMINATION]: diceEliminationGameHandler,
  [GameId.PANIC_POTATO]: panicPotatoGameHandler,
};
