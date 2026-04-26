# Multiplayer Backend

Express + Socket.IO backend for the multiplayer game platform. It verifies Firebase Google tokens, accepts guest users, manages rooms, stores live state in Redis, and dispatches game-specific socket handlers.

## Run Locally

Start Redis from the project root:

```bash
docker compose up redis -d
```

Then start the backend:

```bash
cd multiplayer-backend
npm install
npm run dev
```

The server runs at `http://localhost:4000`.

## Environment Variables

Create `multiplayer-backend/.env`:

```env
PORT=4000
REDIS_URL=redis://localhost:6379
CORS_ORIGIN=http://localhost:5173
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
```

For Google login, download a Firebase Admin service account JSON file from Firebase Console > Project settings > Service accounts and save it as `serviceAccountKey.json` in this folder. Do not commit it.

## Commands

```bash
npm run dev      # ts-node-dev development server
npm run build    # TypeScript compile to dist/
npm start        # build, then run dist/index.js
```

## Public Hosting

Host this backend on a Node service that supports WebSockets, such as Render, Railway, Fly.io, Google Cloud Run, AWS ECS, or a VPS.

Production env example:

```env
PORT=4000
REDIS_URL=rediss://your-managed-redis-url
CORS_ORIGIN=https://your-frontend-domain.com
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
```

Use a managed Redis provider such as Upstash, Redis Cloud, Railway Redis, or Render Redis. If the provider requires TLS, the URL will usually start with `rediss://`.

## Key Files

- `src/index.ts`: Express routes and Socket.IO server creation
- `src/core/socketManager.ts`: Redis adapter, socket auth middleware, connection setup
- `src/config/redis.ts`: Redis client setup
- `src/config/firebase.ts`: Firebase Admin SDK setup and token verification
- `src/socketHandlers/roomHandlers.ts`: room join, disconnect, chat, kick, ban logic
- `src/socketHandlers/pigGameHandler.ts`: Pig game logic
- `src/socketHandlers/index.ts`: game handler registry
- `src/rooms/redisRoomState.ts`: Redis helpers for game state
- `src/constants/index.ts`: backend game IDs and socket event names

## Redis Key Patterns

```text
room:{roomId}:game           # game type string
room:{roomId}:playerIds      # HASH { playerId -> playerName }
room:{roomId}:playerSockets  # HASH { playerId -> socketId }
room:{roomId}:status         # HASH { playerId -> JSON(PlayerStatus) }
room:{roomId}:chat           # LIST of JSON(ChatMessage)
game:state:{roomId}          # JSON string of game state
```

## Auth Flow

- Google users send `socket.handshake.auth.token`; the backend verifies it with Firebase Admin.
- Guest users send `socket.handshake.auth.guestId` and `playerName`.
- Invalid or missing auth is rejected before room/game handlers run.

## Adding Another Game Handler

1. Add `src/socketHandlers/newGameHandler.ts`.
2. Register it in `src/socketHandlers/index.ts`.
3. Add the game ID and socket events in `src/constants/index.ts`.
4. Store shared game state in Redis through `src/rooms/redisRoomState.ts`.
