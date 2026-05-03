// src/config/redis.ts
import { createClient } from "redis";
import { env } from "./env";
import { InMemoryRedis } from "./inMemoryRedis";

console.log(
  `Connecting to Redis: ${
    env.useInMemoryRedis
      ? "in-memory local development"
      : env.isProduction
        ? "production"
        : "development"
  }`
);

export const isInMemoryRedis = env.useInMemoryRedis;

const pubClient = env.useInMemoryRedis
  ? new InMemoryRedis()
  : createClient({ url: env.redisUrl });
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
