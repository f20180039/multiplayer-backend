// /src/rooms/redisRoomState.ts
import { pubClient } from "../config/redis";

export const getRoomState = async <T>(roomId: string): Promise<T | null> => {
  const data = await pubClient.get(`game:state:${roomId}`);
  return data ? JSON.parse(data) : null;
};

export const setRoomState = async (roomId: string, state: any) => {
  await pubClient.set(`game:state:${roomId}`, JSON.stringify(state));
};

export const deleteRoomState = async (roomId: string) => {
  await pubClient.del(`game:state:${roomId}`);
};


