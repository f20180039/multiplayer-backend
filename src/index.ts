import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

// Add an HTTP route to handle GET requests to the root URL
app.get("/", (req, res) => {
  res.send("Hello from Multiplayer Game Backend!"); // You can replace this with any HTML content if needed.
});

const corsOrigin = process.env.CORS_ORIGIN || "*";
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin },
});

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pubClient = createClient({ url: redisUrl });
const subClient = pubClient.duplicate();

async function startServer() {
  try {
    await pubClient.connect();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));

    io.on("connection", (socket) => {
      console.log("✅ User connected:", socket.id);

      // Adjusted to accept gameId and roomId as an object
      socket.on("join_room", ({ gameId, roomId }) => {
        console.log(
          `User ${socket.id} joining room ${roomId} for game ${gameId}`
        );
        socket.join(roomId);
        socket.emit("room_joined", { roomId });
        socket.to(roomId).emit("user_joined", socket.id);
      });

      socket.on("game_move", (data: { roomId: string; move: any }) => {
        socket.to(data.roomId).emit("game_move", data.move);
      });

      socket.on("disconnect", () => {
        console.log("❌ User disconnected:", socket.id);
      });
    });

    const PORT = 4000;
    pubClient.set("testKey", "Hello from Redis").then(() => {
      pubClient.get("testKey").then((value) => {
        console.log("Redis value:", value); // Should output: "Hello from Redis"
      });
    });

    server.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Redis connection error:", error);
  }
}

startServer();
