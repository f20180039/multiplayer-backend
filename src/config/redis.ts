// src/config/redis.ts
import { Redis } from "@upstash/redis";
import { createClient } from "redis";

const isProduction = process.env.NODE_ENV === "production";

// For production: Use Upstash REST API
// For development: Use local Redis with standard client
let pubClient: any;
let subClient: any;

if (isProduction && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  // Production: Upstash REST API (works with serverless)
  console.log("🌐 Using Upstash Redis REST API");

  const upstashClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Wrap Upstash client to match redis client interface
  pubClient = {
    ...upstashClient,
    connect: async () => {}, // No connection needed for REST
    disconnect: async () => {},
    quit: async () => {},
  };

  subClient = pubClient; // For Upstash, pub/sub uses same client

} else {
  // Development: Standard Redis client for local Redis
  console.log("🔧 Using local Redis connection");

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  pubClient = createClient({ url: redisUrl });
  subClient = pubClient.duplicate();
}

export { pubClient, subClient };

export const connectRedisClients = async () => {
  try {
    // Only connect if using standard Redis (local development)
    if (!isProduction || (!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN)) {
      await pubClient.connect();
      await subClient.connect();
      console.log("✅ Local Redis clients connected");
    } else {
      console.log("✅ Upstash Redis REST API ready");
    }
  } catch (err) {
    console.error("❌ Redis connection failed:", err);
    throw err;
  }
};
