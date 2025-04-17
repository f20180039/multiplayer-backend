export interface ClientToServerEvents {
  join_room: (roomId: string) => void;
  game_move: (data: { roomId: string; move: any }) => void;
}

export interface ServerToClientEvents {
  user_joined: (userId: string) => void;
  game_move: (move: any) => void;
}
