import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = 4000;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', (roomId: string) => {
    socket.join(roomId);
    socket.to(roomId).emit('user_joined', socket.id);
  });

  socket.on('game_move', (data: { roomId: string; move: any }) => {
    socket.to(data.roomId).emit('game_move', data.move);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.get('/', (_req, res) => {
  res.send('Multiplayer Game Server Running');
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
