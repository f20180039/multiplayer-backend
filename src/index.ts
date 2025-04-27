// src/index.ts
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { initializeSocketServer } from "./core/socketManager";
import { pubClient } from "./config/redis";

dotenv.config();

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || "*";

app.use(cors());
app.get("/", (_, res) => {
  res.send("Hello from Multiplayer Game Backend!"); // You can replace this with any HTML content if needed.
});

app.get("/api/check-room-existence/:gameId/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const players = await pubClient.hGetAll(`room:${roomId}:players`);
  if (players && Object.keys(players).length > 0) {
    res.status(200).json({ exists: true });
  } else {
    res.status(404).json({ exists: false });
  }
});
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });

const PORT = process.env.PORT || 4000;

initializeSocketServer(io).then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
});
