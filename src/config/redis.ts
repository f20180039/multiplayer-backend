// src/config/redis.ts
import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const pubClient = createClient({ url: redisUrl });
export const subClient = pubClient.duplicate();
