import { Server, Socket } from "socket.io";
import { GameId, PANIC_POTATO_LIMITS, SOCKET_EVENTS } from "../constants";
import {
  deleteRoomState,
  getRoomState,
  setRoomState,
} from "../rooms/redisRoomState";

type PanicPotatoPhase =
  | "LOBBY"
  | "COUNTDOWN"
  | "ROUND_ACTIVE"
  | "ROUND_END"
  | "MATCH_END";

type PanicPotatoPowerUpType = "DASH_PEPPER" | "GLUE_HANDS" | "SWAP_SAUCE";

interface Vector2 {
  x: number;
  y: number;
}

interface PanicPotatoObstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PanicPotatoArena {
  name: string;
  width: number;
  height: number;
  obstacles: PanicPotatoObstacle[];
  spawnPoints: Vector2[];
  powerUpSpawnPoints: Vector2[];
}

interface PanicPotatoPowerUp {
  id: string;
  type: PanicPotatoPowerUpType;
  x: number;
  y: number;
  active: boolean;
  respawnAt: number | null;
}

interface PanicPotatoPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  lives: number;
  isConnected: boolean;
  isSpectator: boolean;
  isEliminated: boolean;
  powerUp: PanicPotatoPowerUpType | null;
  receiveCooldownUntil: number;
  glueLockedUntil: number;
  dashCooldownUntil: number;
  facing: Vector2;
}

interface PanicPotatoExplosion {
  id: string;
  playerId: string;
  playerName: string;
  at: number;
}

interface PanicPotatoRoomState {
  gameId: GameId.PANIC_POTATO;
  roomId: string;
  phase: PanicPotatoPhase;
  round: number;
  players: PanicPotatoPlayer[];
  potatoHolderId: string | null;
  winnerId: string | null;
  countdownEndsAt: number | null;
  lastExplosion: PanicPotatoExplosion | null;
  lastEvent: string;
  arena: PanicPotatoArena;
  powerUps: PanicPotatoPowerUp[];
  serverTime: number;
}

interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

interface PanicPotatoRuntime {
  state: PanicPotatoRoomState | null;
  inputs: Map<string, PlayerInput>;
  tickTimer: ReturnType<typeof setInterval> | null;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  fuseTimer: ReturnType<typeof setTimeout> | null;
  roundEndTimer: ReturnType<typeof setTimeout> | null;
  emptyCleanupTimer: ReturnType<typeof setTimeout> | null;
  fuseToken: number;
  lastTickAt: number;
  tickBusy: boolean;
}

const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 210;
const PASS_RANGE = 78;
const PICKUP_RANGE = 28;
const BASE_DASH_DISTANCE = 92;
const PEPPER_DASH_DISTANCE = 155;
const SERVER_TICK_MS = 50;
const POWER_UP_RESPAWN_MS = 9000;
const EMPTY_ROOM_CLEANUP_MS = 5 * 60 * 1000;

const PLAYER_COLORS = [
  "#0f766e",
  "#b7791f",
  "#be123c",
  "#2563eb",
  "#7c3aed",
  "#15803d",
  "#dc2626",
  "#0891b2",
];

const ARENA: PanicPotatoArena = {
  name: "Kitchen Panic",
  width: 900,
  height: 600,
  obstacles: [
    { id: "prep-table", x: 168, y: 122, width: 146, height: 68 },
    { id: "center-island", x: 382, y: 260, width: 148, height: 92 },
    { id: "stove-bank", x: 640, y: 96, width: 72, height: 168 },
    { id: "sink", x: 122, y: 380, width: 120, height: 70 },
    { id: "pantry", x: 642, y: 410, width: 142, height: 72 },
  ],
  spawnPoints: [
    { x: 82, y: 82 },
    { x: 818, y: 82 },
    { x: 82, y: 518 },
    { x: 818, y: 518 },
    { x: 450, y: 90 },
    { x: 450, y: 510 },
    { x: 94, y: 292 },
    { x: 806, y: 292 },
  ],
  powerUpSpawnPoints: [
    { x: 450, y: 190 },
    { x: 312, y: 468 },
    { x: 586, y: 468 },
    { x: 760, y: 332 },
  ],
};

const POWER_UP_TYPES: PanicPotatoPowerUpType[] = [
  "DASH_PEPPER",
  "GLUE_HANDS",
  "SWAP_SAUCE",
];

const roomRuntimes = new Map<string, PanicPotatoRuntime>();

const createRuntime = (): PanicPotatoRuntime => ({
  state: null,
  inputs: new Map(),
  tickTimer: null,
  countdownTimer: null,
  fuseTimer: null,
  roundEndTimer: null,
  emptyCleanupTimer: null,
  fuseToken: 0,
  lastTickAt: Date.now(),
  tickBusy: false,
});

const getRuntime = (roomId: string) => {
  let runtime = roomRuntimes.get(roomId);
  if (!runtime) {
    runtime = createRuntime();
    roomRuntimes.set(roomId, runtime);
  }
  return runtime;
};

const randomPowerUpType = () =>
  POWER_UP_TYPES[Math.floor(Math.random() * POWER_UP_TYPES.length)];

const randomFuseMs = () =>
  PANIC_POTATO_LIMITS.FUSE_MIN_MS +
  Math.floor(
    Math.random() *
      (PANIC_POTATO_LIMITS.FUSE_MAX_MS - PANIC_POTATO_LIMITS.FUSE_MIN_MS + 1)
  );

const createPowerUps = (): PanicPotatoPowerUp[] =>
  ARENA.powerUpSpawnPoints.map((point, index) => ({
    id: `power-${index}`,
    type: randomPowerUpType(),
    x: point.x,
    y: point.y,
    active: true,
    respawnAt: null,
  }));

const createInitialRoom = (roomId: string): PanicPotatoRoomState => ({
  gameId: GameId.PANIC_POTATO,
  roomId,
  phase: "LOBBY",
  round: 0,
  players: [],
  potatoHolderId: null,
  winnerId: null,
  countdownEndsAt: null,
  lastExplosion: null,
  lastEvent: "Waiting for at least two players.",
  arena: ARENA,
  powerUps: createPowerUps(),
  serverTime: Date.now(),
});

const createPlayer = (
  playerId: string,
  playerName: string,
  room: PanicPotatoRoomState,
  isSpectator: boolean
): PanicPotatoPlayer => {
  const spawn =
    ARENA.spawnPoints[room.players.length % ARENA.spawnPoints.length];

  return {
    id: playerId,
    name: cleanPlayerName(playerName),
    x: spawn.x,
    y: spawn.y,
    radius: PLAYER_RADIUS,
    color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
    lives: isSpectator ? 0 : PANIC_POTATO_LIMITS.STARTING_LIVES,
    isConnected: true,
    isSpectator,
    isEliminated: isSpectator,
    powerUp: null,
    receiveCooldownUntil: 0,
    glueLockedUntil: 0,
    dashCooldownUntil: 0,
    facing: { x: 1, y: 0 },
  };
};

const cleanPlayerName = (name: string) => {
  const trimmed = name.trim() || "Player";
  return trimmed.slice(0, 32);
};

const publicRoomState = (
  room: PanicPotatoRoomState
): PanicPotatoRoomState => ({
  ...room,
  serverTime: Date.now(),
  players: room.players.map((player) => ({ ...player })),
  powerUps: room.powerUps.map((powerUp) => ({ ...powerUp })),
  arena: {
    ...room.arena,
    obstacles: room.arena.obstacles.map((obstacle) => ({ ...obstacle })),
    spawnPoints: room.arena.spawnPoints.map((point) => ({ ...point })),
    powerUpSpawnPoints: room.arena.powerUpSpawnPoints.map((point) => ({
      ...point,
    })),
  },
});

const saveAndEmit = async (
  io: Server,
  roomId: string,
  room: PanicPotatoRoomState
) => {
  const publicState = publicRoomState(room);
  await setRoomState(roomId, publicState);
  io.to(roomId).emit(SOCKET_EVENTS.PANIC_POTATO.UPDATE, publicState);
};

const normalizeInput = (input?: Partial<PlayerInput>): PlayerInput => ({
  up: Boolean(input?.up),
  down: Boolean(input?.down),
  left: Boolean(input?.left),
  right: Boolean(input?.right),
});

const loadRoom = async (roomId: string) => {
  const runtime = getRuntime(roomId);
  if (runtime.state) return runtime.state;

  const stored = await getRoomState<Partial<PanicPotatoRoomState>>(roomId);
  if (stored?.gameId === GameId.PANIC_POTATO) {
    runtime.state = normalizeRoom(stored as PanicPotatoRoomState, roomId);
  } else {
    runtime.state = createInitialRoom(roomId);
  }

  return runtime.state;
};

const normalizeRoom = (
  room: PanicPotatoRoomState,
  roomId: string
): PanicPotatoRoomState => {
  const normalized: PanicPotatoRoomState = {
    ...createInitialRoom(roomId),
    ...room,
    roomId,
    gameId: GameId.PANIC_POTATO,
    arena: ARENA,
    powerUps: room.powerUps?.length ? room.powerUps : createPowerUps(),
    players: room.players ?? [],
    serverTime: Date.now(),
  };

  normalized.players = normalized.players.map((player, index) => ({
    ...player,
    radius: player.radius ?? PLAYER_RADIUS,
    color: player.color ?? PLAYER_COLORS[index % PLAYER_COLORS.length],
    lives: player.lives ?? PANIC_POTATO_LIMITS.STARTING_LIVES,
    isConnected: Boolean(player.isConnected),
    isSpectator: Boolean(player.isSpectator),
    isEliminated: Boolean(player.isEliminated),
    powerUp: player.powerUp ?? null,
    receiveCooldownUntil: player.receiveCooldownUntil ?? 0,
    glueLockedUntil: player.glueLockedUntil ?? 0,
    dashCooldownUntil: player.dashCooldownUntil ?? 0,
    facing: player.facing ?? { x: 1, y: 0 },
  }));

  if (normalized.phase !== "LOBBY" && normalized.phase !== "MATCH_END") {
    normalized.phase = "LOBBY";
    normalized.potatoHolderId = null;
    normalized.countdownEndsAt = null;
    normalized.lastEvent = "Room recovered. Waiting for players.";
  }

  return normalized;
};

const getLivingPlayers = (room: PanicPotatoRoomState) =>
  room.players.filter(
    (player) =>
      player.isConnected &&
      !player.isSpectator &&
      !player.isEliminated &&
      player.lives > 0
  );

const isLivingPlayer = (
  player: PanicPotatoPlayer | undefined
): player is PanicPotatoPlayer =>
  Boolean(
    player &&
      player.isConnected &&
      !player.isSpectator &&
      !player.isEliminated &&
      player.lives > 0
  );

const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
  if (timer) clearTimeout(timer);
};

const clearRoundTimers = (runtime: PanicPotatoRuntime) => {
  clearTimer(runtime.countdownTimer);
  clearTimer(runtime.fuseTimer);
  clearTimer(runtime.roundEndTimer);
  runtime.countdownTimer = null;
  runtime.fuseTimer = null;
  runtime.roundEndTimer = null;
  runtime.fuseToken += 1;
};

const ensureTick = (io: Server, roomId: string) => {
  const runtime = getRuntime(roomId);
  if (runtime.tickTimer) return;

  runtime.lastTickAt = Date.now();
  runtime.tickTimer = setInterval(() => {
    void tickRoom(io, roomId);
  }, SERVER_TICK_MS);
};

const stopRuntime = (roomId: string) => {
  const runtime = roomRuntimes.get(roomId);
  if (!runtime) return;

  clearRoundTimers(runtime);
  if (runtime.tickTimer) clearInterval(runtime.tickTimer);
  if (runtime.emptyCleanupTimer) clearTimeout(runtime.emptyCleanupTimer);
  roomRuntimes.delete(roomId);
};

const maybeScheduleEmptyCleanup = (io: Server, roomId: string) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room) return;

  const connectedPlayers = room.players.filter((player) => player.isConnected);
  if (connectedPlayers.length > 0) {
    if (runtime.emptyCleanupTimer) {
      clearTimeout(runtime.emptyCleanupTimer);
      runtime.emptyCleanupTimer = null;
    }
    return;
  }

  if (runtime.emptyCleanupTimer) return;

  runtime.emptyCleanupTimer = setTimeout(async () => {
    const currentRoom = runtime.state;
    if (!currentRoom) return;

    if (currentRoom.players.some((player) => player.isConnected)) {
      runtime.emptyCleanupTimer = null;
      return;
    }

    io.to(roomId).emit(SOCKET_EVENTS.ROOM_CLOSED);
    await deleteRoomState(roomId);
    stopRuntime(roomId);
  }, EMPTY_ROOM_CLEANUP_MS);
};

const startCountdown = async (
  io: Server,
  roomId: string,
  room: PanicPotatoRoomState
) => {
  const runtime = getRuntime(roomId);
  clearRoundTimers(runtime);

  const livingPlayers = getLivingPlayers(room);
  if (livingPlayers.length < PANIC_POTATO_LIMITS.MIN_PLAYERS) {
    room.phase = "LOBBY";
    room.potatoHolderId = null;
    room.countdownEndsAt = null;
    room.lastEvent = "Waiting for at least two players.";
    await saveAndEmit(io, roomId, room);
    return;
  }

  room.phase = "COUNTDOWN";
  room.round += 1;
  room.winnerId = null;
  room.potatoHolderId = null;
  room.countdownEndsAt = Date.now() + PANIC_POTATO_LIMITS.ROUND_START_COUNTDOWN_MS;
  room.lastEvent = `Round ${room.round} starts soon.`;
  positionLivingPlayers(room);

  runtime.countdownTimer = setTimeout(() => {
    void activateRound(io, roomId, runtime.fuseToken);
  }, PANIC_POTATO_LIMITS.ROUND_START_COUNTDOWN_MS);

  await saveAndEmit(io, roomId, room);
};

const activateRound = async (
  io: Server,
  roomId: string,
  countdownToken: number
) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room || runtime.fuseToken !== countdownToken) return;

  const livingPlayers = getLivingPlayers(room);
  if (livingPlayers.length <= 1) {
    await finishMatch(io, roomId, room);
    return;
  }

  const holder =
    livingPlayers[Math.floor(Math.random() * livingPlayers.length)];
  room.phase = "ROUND_ACTIVE";
  room.potatoHolderId = holder.id;
  room.countdownEndsAt = null;
  room.lastExplosion = null;
  room.lastEvent = `${holder.name} has the potato.`;
  runtime.countdownTimer = null;

  startHiddenFuse(io, roomId);
  await saveAndEmit(io, roomId, room);
};

const startHiddenFuse = (io: Server, roomId: string) => {
  const runtime = getRuntime(roomId);
  clearTimer(runtime.fuseTimer);

  runtime.fuseToken += 1;
  const token = runtime.fuseToken;
  runtime.fuseTimer = setTimeout(() => {
    void explodePotato(io, roomId, token);
  }, randomFuseMs());
};

const explodePotato = async (io: Server, roomId: string, token: number) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room || room.phase !== "ROUND_ACTIVE" || runtime.fuseToken !== token) {
    return;
  }

  const holder = room.players.find((player) => player.id === room.potatoHolderId);
  if (!isLivingPlayer(holder)) {
    await reconcilePotatoHolder(io, roomId, room);
    return;
  }

  holder.lives = Math.max(0, holder.lives - 1);
  holder.powerUp = null;
  holder.receiveCooldownUntil = 0;
  holder.glueLockedUntil = 0;

  if (holder.lives === 0) {
    holder.isEliminated = true;
    holder.isSpectator = true;
  }

  room.phase = "ROUND_END";
  room.potatoHolderId = null;
  room.countdownEndsAt = null;
  room.lastExplosion = {
    id: `${holder.id}-${Date.now()}`,
    playerId: holder.id,
    playerName: holder.name,
    at: Date.now(),
  };
  room.lastEvent =
    holder.lives === 0
      ? `${holder.name} exploded and was eliminated.`
      : `${holder.name} exploded and lost a life.`;

  clearTimer(runtime.fuseTimer);
  runtime.fuseTimer = null;
  runtime.roundEndTimer = setTimeout(() => {
    void continueAfterExplosion(io, roomId);
  }, PANIC_POTATO_LIMITS.POST_EXPLOSION_DELAY_MS);

  await saveAndEmit(io, roomId, room);
};

const continueAfterExplosion = async (io: Server, roomId: string) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room || room.phase !== "ROUND_END") return;

  runtime.roundEndTimer = null;
  const livingPlayers = getLivingPlayers(room);
  if (livingPlayers.length > 1) {
    await startCountdown(io, roomId, room);
  } else {
    await finishMatch(io, roomId, room);
  }
};

const finishMatch = async (
  io: Server,
  roomId: string,
  room: PanicPotatoRoomState
) => {
  const runtime = getRuntime(roomId);
  clearRoundTimers(runtime);

  const livingPlayers = getLivingPlayers(room);
  const winner = livingPlayers[0] ?? null;

  room.phase = "MATCH_END";
  room.winnerId = winner?.id ?? null;
  room.potatoHolderId = null;
  room.countdownEndsAt = null;
  room.lastEvent = winner
    ? `${winner.name} wins Panic Potato.`
    : "The match ended with no winner.";

  await saveAndEmit(io, roomId, room);
};

const maybeStartGame = async (
  io: Server,
  roomId: string,
  room: PanicPotatoRoomState
) => {
  if (room.phase !== "LOBBY") {
    await saveAndEmit(io, roomId, room);
    return;
  }

  if (getLivingPlayers(room).length >= PANIC_POTATO_LIMITS.MIN_PLAYERS) {
    await startCountdown(io, roomId, room);
    return;
  }

  room.lastEvent = "Waiting for at least two players.";
  await saveAndEmit(io, roomId, room);
};

const resetForRematch = async (
  io: Server,
  roomId: string,
  room: PanicPotatoRoomState
) => {
  const runtime = getRuntime(roomId);
  clearRoundTimers(runtime);

  room.players = room.players
    .filter((player) => player.isConnected)
    .map((player, index) => {
      const spawn = ARENA.spawnPoints[index % ARENA.spawnPoints.length];
      return {
        ...player,
        x: spawn.x,
        y: spawn.y,
        lives: PANIC_POTATO_LIMITS.STARTING_LIVES,
        isSpectator: false,
        isEliminated: false,
        powerUp: null,
        receiveCooldownUntil: 0,
        glueLockedUntil: 0,
        dashCooldownUntil: 0,
        facing: { x: 1, y: 0 },
      };
    });

  room.phase = "LOBBY";
  room.round = 0;
  room.winnerId = null;
  room.potatoHolderId = null;
  room.countdownEndsAt = null;
  room.lastExplosion = null;
  room.powerUps = createPowerUps();
  room.lastEvent = "Rematch ready.";

  await maybeStartGame(io, roomId, room);
};

const positionLivingPlayers = (room: PanicPotatoRoomState) => {
  getLivingPlayers(room).forEach((player, index) => {
    const spawn = ARENA.spawnPoints[index % ARENA.spawnPoints.length];
    player.x = spawn.x;
    player.y = spawn.y;
    player.receiveCooldownUntil = 0;
    player.glueLockedUntil = 0;
    player.facing = { x: 1, y: 0 };
  });
};

const tickRoom = async (io: Server, roomId: string) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room || runtime.tickBusy) return;

  runtime.tickBusy = true;
  try {
    const now = Date.now();
    const deltaSeconds = Math.min((now - runtime.lastTickAt) / 1000, 0.12);
    runtime.lastTickAt = now;

    const changed =
      stepPlayers(room, runtime, deltaSeconds, now) ||
      stepPowerUps(room, now);

    if (changed) {
      await saveAndEmit(io, roomId, room);
    }
  } finally {
    runtime.tickBusy = false;
  }
};

const stepPlayers = (
  room: PanicPotatoRoomState,
  runtime: PanicPotatoRuntime,
  deltaSeconds: number,
  now: number
) => {
  if (room.phase === "MATCH_END") return false;

  let changed = false;
  for (const player of room.players) {
    if (!isLivingPlayer(player)) continue;

    const input = runtime.inputs.get(player.id);
    if (!input) {
      nudgeIfStuck(player);
      continue;
    }

    const direction = getInputDirection(input);
    if (direction.x === 0 && direction.y === 0) {
      nudgeIfStuck(player);
      continue;
    }

    player.facing = direction;
    const moved = movePlayerBy(
      player,
      direction.x * PLAYER_SPEED * deltaSeconds,
      direction.y * PLAYER_SPEED * deltaSeconds
    );
    changed = moved || changed;

    const pickedUp = maybePickUpPowerUp(room, player, now);
    changed = pickedUp || changed;
  }

  return changed;
};

const stepPowerUps = (room: PanicPotatoRoomState, now: number) => {
  let changed = false;

  for (const powerUp of room.powerUps) {
    if (!powerUp.active && powerUp.respawnAt && now >= powerUp.respawnAt) {
      powerUp.type = randomPowerUpType();
      powerUp.active = true;
      powerUp.respawnAt = null;
      changed = true;
    }
  }

  return changed;
};

const maybePickUpPowerUp = (
  room: PanicPotatoRoomState,
  player: PanicPotatoPlayer,
  now: number
) => {
  for (const powerUp of room.powerUps) {
    if (!powerUp.active) continue;

    const distance = getDistance(player, powerUp);
    if (distance > player.radius + PICKUP_RANGE) continue;

    player.powerUp = powerUp.type;
    powerUp.active = false;
    powerUp.respawnAt = now + POWER_UP_RESPAWN_MS;
    room.lastEvent = `${player.name} picked up ${formatPowerUp(powerUp.type)}.`;
    return true;
  }

  return false;
};

const getInputDirection = (input: PlayerInput): Vector2 => {
  const x = Number(input.right) - Number(input.left);
  const y = Number(input.down) - Number(input.up);
  const length = Math.hypot(x, y);

  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
};

const movePlayerBy = (player: PanicPotatoPlayer, dx: number, dy: number) => {
  const originalX = player.x;
  const originalY = player.y;

  tryMoveAxis(player, dx, 0);
  tryMoveAxis(player, 0, dy);
  nudgeIfStuck(player);

  return player.x !== originalX || player.y !== originalY;
};

const tryMoveAxis = (
  player: PanicPotatoPlayer,
  dx: number,
  dy: number
) => {
  const next = {
    x: clamp(player.x + dx, player.radius, ARENA.width - player.radius),
    y: clamp(player.y + dy, player.radius, ARENA.height - player.radius),
  };

  if (!isBlocked(next.x, next.y, player.radius)) {
    player.x = next.x;
    player.y = next.y;
  }
};

const movePlayerBySweep = (
  player: PanicPotatoPlayer,
  direction: Vector2,
  distance: number
) => {
  const steps = Math.max(1, Math.ceil(distance / 10));
  let moved = false;

  for (let step = 0; step < steps; step += 1) {
    const beforeX = player.x;
    const beforeY = player.y;
    movePlayerBy(player, (direction.x * distance) / steps, (direction.y * distance) / steps);
    moved = moved || player.x !== beforeX || player.y !== beforeY;

    if (player.x === beforeX && player.y === beforeY) break;
  }

  return moved;
};

const nudgeIfStuck = (player: PanicPotatoPlayer) => {
  if (!isBlocked(player.x, player.y, player.radius)) return;

  const safeSpawn = ARENA.spawnPoints.find(
    (point) => !isBlocked(point.x, point.y, player.radius)
  );
  if (!safeSpawn) return;

  player.x = safeSpawn.x;
  player.y = safeSpawn.y;
};

const isBlocked = (x: number, y: number, radius: number) => {
  if (
    x < radius ||
    y < radius ||
    x > ARENA.width - radius ||
    y > ARENA.height - radius
  ) {
    return true;
  }

  return ARENA.obstacles.some((obstacle) =>
    circleIntersectsRect(x, y, radius, obstacle)
  );
};

const circleIntersectsRect = (
  circleX: number,
  circleY: number,
  radius: number,
  rect: PanicPotatoObstacle
) => {
  const closestX = clamp(circleX, rect.x, rect.x + rect.width);
  const closestY = clamp(circleY, rect.y, rect.y + rect.height);
  const dx = circleX - closestX;
  const dy = circleY - closestY;

  return dx * dx + dy * dy < radius * radius;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getDistance = (a: Vector2, b: Vector2) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const handleDash = async (
  io: Server,
  roomId: string,
  playerId: string,
  input: PlayerInput
) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room || room.phase === "MATCH_END") return;

  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!isLivingPlayer(player)) return;

  const now = Date.now();
  if (now < player.dashCooldownUntil) return;

  const inputDirection = getInputDirection(input);
  const direction =
    inputDirection.x === 0 && inputDirection.y === 0
      ? player.facing
      : inputDirection;
  const hasPepper = player.powerUp === "DASH_PEPPER";
  const distance = hasPepper ? PEPPER_DASH_DISTANCE : BASE_DASH_DISTANCE;

  if (hasPepper) {
    player.powerUp = null;
  }

  player.dashCooldownUntil = now + PANIC_POTATO_LIMITS.DASH_COOLDOWN_MS;
  if (movePlayerBySweep(player, direction, distance)) {
    room.lastEvent = hasPepper
      ? `${player.name} burned a Dash Pepper.`
      : `${player.name} dashed.`;
    await saveAndEmit(io, roomId, room);
  }
};

const handlePass = async (
  io: Server,
  roomId: string,
  playerId: string,
  targetId?: string
) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room || room.phase !== "ROUND_ACTIVE") return;

  const now = Date.now();
  const holder = room.players.find((player) => player.id === playerId);
  if (!isLivingPlayer(holder) || room.potatoHolderId !== playerId) return;
  if (holder.receiveCooldownUntil > now || holder.glueLockedUntil > now) return;

  const target = getPassTarget(room, holder, targetId);
  if (!target) return;

  room.potatoHolderId = target.id;
  target.receiveCooldownUntil = now + PANIC_POTATO_LIMITS.RECEIVE_COOLDOWN_MS;

  if (holder.powerUp === "GLUE_HANDS") {
    holder.powerUp = null;
    target.glueLockedUntil = Math.max(
      target.glueLockedUntil,
      now + PANIC_POTATO_LIMITS.GLUE_LOCK_MS
    );
    room.lastEvent = `${holder.name} glued ${target.name} with the potato.`;
  } else {
    room.lastEvent = `${holder.name} passed the potato to ${target.name}.`;
  }

  await saveAndEmit(io, roomId, room);
};

const getPassTarget = (
  room: PanicPotatoRoomState,
  holder: PanicPotatoPlayer,
  targetId?: string
) => {
  const candidates = getLivingPlayers(room).filter(
    (player) => player.id !== holder.id
  );

  if (targetId) {
    const target = candidates.find((candidate) => candidate.id === targetId);
    if (target && getDistance(holder, target) <= PASS_RANGE) return target;
    return null;
  }

  return (
    candidates
      .map((candidate) => ({
        player: candidate,
        distance: getDistance(holder, candidate),
      }))
      .filter(({ distance }) => distance <= PASS_RANGE)
      .sort((a, b) => a.distance - b.distance)[0]?.player ?? null
  );
};

const handleUsePowerUp = async (
  io: Server,
  roomId: string,
  playerId: string
) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state;
  if (!room || room.phase === "MATCH_END") return;

  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!isLivingPlayer(player) || player.powerUp !== "SWAP_SAUCE") return;

  const candidates = getLivingPlayers(room).filter(
    (candidate) => candidate.id !== player.id
  );
  if (candidates.length === 0) return;

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const playerPosition = { x: player.x, y: player.y };
  player.x = target.x;
  player.y = target.y;
  target.x = playerPosition.x;
  target.y = playerPosition.y;
  player.powerUp = null;
  room.lastEvent = `${player.name} swapped places with ${target.name}.`;

  await saveAndEmit(io, roomId, room);
};

const handleDisconnectFromRoom = async (
  io: Server,
  roomId: string,
  playerId: string
) => {
  const runtime = getRuntime(roomId);
  const room = runtime.state ?? (await loadRoom(roomId));
  if (room.gameId !== GameId.PANIC_POTATO) return;

  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) return;

  runtime.inputs.delete(playerId);
  player.isConnected = false;

  if (room.phase === "LOBBY" || room.phase === "COUNTDOWN") {
    room.players = room.players.filter((candidate) => candidate.id !== playerId);
    if (
      room.phase === "COUNTDOWN" &&
      getLivingPlayers(room).length < PANIC_POTATO_LIMITS.MIN_PLAYERS
    ) {
      clearRoundTimers(runtime);
      room.phase = "LOBBY";
      room.countdownEndsAt = null;
      room.round = Math.max(0, room.round - 1);
      room.lastEvent = "Countdown cancelled. Waiting for players.";
    }
  } else if (!player.isSpectator && !player.isEliminated) {
    player.isSpectator = true;
    player.isEliminated = true;
    player.lives = 0;
    player.powerUp = null;
    room.lastEvent = `${player.name} left the match.`;
  }

  if (room.phase === "ROUND_ACTIVE" && room.potatoHolderId === playerId) {
    await reconcilePotatoHolder(io, roomId, room);
  } else if (
    (room.phase === "ROUND_ACTIVE" || room.phase === "ROUND_END") &&
    getLivingPlayers(room).length <= 1
  ) {
    await finishMatch(io, roomId, room);
  } else {
    await saveAndEmit(io, roomId, room);
  }

  maybeScheduleEmptyCleanup(io, roomId);
};

const reconcilePotatoHolder = async (
  io: Server,
  roomId: string,
  room: PanicPotatoRoomState
) => {
  const livingPlayers = getLivingPlayers(room);

  if (livingPlayers.length <= 1) {
    await finishMatch(io, roomId, room);
    return;
  }

  const nextHolder =
    livingPlayers[Math.floor(Math.random() * livingPlayers.length)];
  room.potatoHolderId = nextHolder.id;
  room.lastEvent = `${nextHolder.name} caught the loose potato.`;
  await saveAndEmit(io, roomId, room);
};

const formatPowerUp = (powerUp: PanicPotatoPowerUpType) => {
  if (powerUp === "DASH_PEPPER") return "Dash Pepper";
  if (powerUp === "GLUE_HANDS") return "Glue Hands";
  return "Swap Sauce";
};

export const panicPotatoGameHandler = (io: Server, socket: Socket) => {
  if (socket.data.panicPotatoHandlerRegistered) return;
  socket.data.panicPotatoHandlerRegistered = true;

  socket.on(
    SOCKET_EVENTS.PANIC_POTATO.JOIN_GAME,
    async ({ roomId, playerName }: { roomId: string; playerName: string }) => {
      const playerId = socket.data.userId || socket.id;
      const room = await loadRoom(roomId);
      const runtime = getRuntime(roomId);
      socket.join(roomId);
      ensureTick(io, roomId);

      if (runtime.emptyCleanupTimer) {
        clearTimeout(runtime.emptyCleanupTimer);
        runtime.emptyCleanupTimer = null;
      }

      const existingPlayer = room.players.find(
        (player) => player.id === playerId
      );

      if (existingPlayer) {
        existingPlayer.name = cleanPlayerName(playerName);
        existingPlayer.isConnected = true;
      } else {
        const connectedPlayers = room.players.filter(
          (player) => player.isConnected
        );
        if (connectedPlayers.length >= PANIC_POTATO_LIMITS.MAX_PLAYERS) {
          socket.emit(SOCKET_EVENTS.PANIC_POTATO.ERROR, {
            message: "Room is full.",
          });
          return;
        }

        const joinsAsSpectator =
          room.phase === "ROUND_ACTIVE" ||
          room.phase === "ROUND_END" ||
          room.phase === "MATCH_END";
        room.players.push(
          createPlayer(playerId, playerName, room, joinsAsSpectator)
        );

        if (joinsAsSpectator) {
          room.lastEvent = `${cleanPlayerName(
            playerName
          )} joined as a spectator.`;
        }
      }

      await maybeStartGame(io, roomId, room);
    }
  );

  socket.on(
    SOCKET_EVENTS.PANIC_POTATO.INPUT,
    async ({
      roomId,
      input,
      dash,
    }: {
      roomId: string;
      input?: Partial<PlayerInput>;
      dash?: boolean;
    }) => {
      const playerId = socket.data.userId || socket.id;
      const runtime = getRuntime(roomId);
      const normalizedInput = normalizeInput(input);
      runtime.inputs.set(playerId, normalizedInput);

      if (dash) {
        await handleDash(io, roomId, playerId, normalizedInput);
      }
    }
  );

  socket.on(
    SOCKET_EVENTS.PANIC_POTATO.PASS_POTATO,
    async ({ roomId, targetId }: { roomId: string; targetId?: string }) => {
      const playerId = socket.data.userId || socket.id;
      await handlePass(io, roomId, playerId, targetId);
    }
  );

  socket.on(
    SOCKET_EVENTS.PANIC_POTATO.USE_POWER_UP,
    async ({ roomId }: { roomId: string }) => {
      const playerId = socket.data.userId || socket.id;
      await handleUsePowerUp(io, roomId, playerId);
    }
  );

  socket.on(
    SOCKET_EVENTS.PANIC_POTATO.REMATCH,
    async ({ roomId }: { roomId: string }) => {
      const room = await loadRoom(roomId);
      if (room.phase !== "MATCH_END") return;
      await resetForRematch(io, roomId, room);
    }
  );

  socket.on("disconnect", async () => {
    const playerId = socket.data.userId || socket.id;
    const rooms = Array.from(socket.rooms).filter((roomId) => roomId !== socket.id);

    for (const roomId of rooms) {
      await handleDisconnectFromRoom(io, roomId, playerId);
    }
  });
};
