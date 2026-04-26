# Multiplayer Backend

## Stack
Express 5 + Socket.IO 4 + Redis 4 + Firebase Admin SDK

## Key Files
- `src/index.ts` — Server entry point, Express routes, Socket.IO server creation
- `src/core/socketManager.ts` — Socket.IO initialization, Redis adapter, auth middleware, connection handler
- `src/config/redis.ts` — Redis pub/sub client setup
- `src/config/firebase.ts` — Firebase Admin SDK initialization, token verification
- `src/constants/index.ts` — GameId enum, SOCKET_EVENTS constants
- `src/socketHandlers/roomHandlers.ts` — Room join/disconnect/chat/kick/ban logic
- `src/socketHandlers/pigGameHandler.ts` — Pig game-specific logic
- `src/socketHandlers/index.ts` — Game handler registry
- `src/rooms/redisRoomState.ts` — Redis helpers for game state CRUD
- `src/types/socket.ts` — TypeScript interfaces for socket events

## Redis Key Patterns
```
room:{roomId}:game           — game type string
room:{roomId}:playerIds      — HASH { playerId -> playerName }
room:{roomId}:playerSockets  — HASH { playerId -> socketId }
room:{roomId}:status         — HASH { playerId -> JSON(PlayerStatus) }
room:{roomId}:chat           — LIST of JSON(ChatMessage)
game:state:{roomId}          — JSON string of game state
```

## Environment Variables
```
PORT=4000
REDIS_URL=redis://localhost:6379
CORS_ORIGIN=http://localhost:5173
FIREBASE_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccountKey.json
```

## Local Run
Start Redis from the repo root, then run the backend:

```bash
docker compose up redis -d
cd multiplayer-backend
npm install
npm run dev
```

Backend health check:

```text
http://localhost:4000
```

## Public Hosting
- Deploy to a Node/WebSocket-capable host such as Render, Railway, Fly.io, Google Cloud Run, AWS ECS, or a VPS
- Use a managed Redis provider such as Upstash, Redis Cloud, Railway Redis, or Render Redis
- Set `REDIS_URL` to the managed Redis URL, usually `rediss://...` when TLS is required
- Set `CORS_ORIGIN` to the deployed frontend URL
- Store Firebase Admin credentials as a secret or mounted file; do not commit service account JSON

## Auth Middleware (socketManager.ts)
- Google users: `socket.handshake.auth.token` verified via Firebase Admin → sets `socket.data.userId`, `socket.data.displayName`, `socket.data.authType = 'google'`
- Guest users: `socket.handshake.auth.guestId` → sets `socket.data.userId = guestId`, `socket.data.authType = 'guest'`
- Connections without valid auth are rejected

## Disconnect Flow
- Player marked offline immediately, cleanup scheduled after 5-minute timeout
- Game state (scores) preserved during timeout window
- On reconnect within window: socket mapping updated, player restored to active
