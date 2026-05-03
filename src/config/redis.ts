// src/config/redis.ts
import { createClient } from "redis";

const isProduction = process.env.NODE_ENV === "production";

// Use standard Redis client for BOTH local and production
// This ensures Socket.IO adapter works correctly with pub/sub
const redisUrl = isProduction
  ? process.env.REDIS_URL // Upstash Redis protocol URL (rediss://...)
  : (process.env.REDIS_URL || "redis://localhost:6379"); // Local Redis

console.log(`🔧 Connecting to Redis: ${isProduction ? 'Upstash (production)' : 'Local (development)'}`);

const pubClient = createClient({ url: redisUrl });
const subClient = pubClient.duplicate();

export { pubClient, subClient };

export const connectRedisClients = async () => {
  try {
    await pubClient.connect();
    await subClient.connect();
    console.log("✅ Redis pub/sub clients connected");
  } catch (err) {
    console.error("❌ Redis connection failed:", err);
    throw err;
  }
};
