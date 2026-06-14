const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// rooms: { roomId: { sender: socketId, receiver: socketId | null, fileName, fileSize } }
const rooms = {};

app.get('/', (req, res) => {
  res.json({ status: 'P2P WebShare Signaling Server running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: Object.keys(rooms).length });
});

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // Sender creates a room
  socket.on('create-room', ({ fileName, fileSize, fileType }) => {
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    rooms[roomId] = { sender: socket.id, receiver: null, fileName, fileSize, fileType };
    socket.join(roomId);
    socket.emit('room-created', { roomId, fileName, fileSize, fileType });
    console.log(`[Room] Created: ${roomId} by ${socket.id} | File: ${fileName}`);
  });

  // Receiver joins a room
  socket.on('join-room', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', { message: 'Room not found or link is invalid.' });
      return;
    }
    if (room.receiver) {
      socket.emit('error', { message: 'Room is already occupied.' });
      return;
    }
    room.receiver = socket.id;
    socket.join(roomId);
    socket.emit('room-joined', { roomId, fileName: room.fileName, fileSize: room.fileSize, fileType: room.fileType });
    // Notify sender that receiver is ready
    io.to(room.sender).emit('receiver-joined', { receiverId: socket.id });
    console.log(`[Room] ${socket.id} joined room ${roomId}`);
  });

  // WebRTC signaling relay
  socket.on('offer', ({ roomId, offer }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.sender === socket.id ? room.receiver : room.sender;
    if (target) io.to(target).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ roomId, answer }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.sender === socket.id ? room.receiver : room.sender;
    if (target) io.to(target).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.sender === socket.id ? room.receiver : room.sender;
    if (target) io.to(target).emit('ice-candidate', { candidate, from: socket.id });
  });

  // Transfer events relay
  socket.on('transfer-started', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.sender === socket.id ? room.receiver : room.sender;
    if (target) io.to(target).emit('transfer-started');
  });

  socket.on('transfer-complete', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.sender === socket.id ? room.receiver : room.sender;
    if (target) io.to(target).emit('transfer-complete');
    // Clean up room after a delay
    setTimeout(() => { delete rooms[roomId]; }, 30000);
  });

  socket.on('disconnect', () => {
    console.log(`[-] Socket disconnected: ${socket.id}`);
    // Notify peers in any room this socket was part of
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.sender === socket.id || room.receiver === socket.id) {
        const other = room.sender === socket.id ? room.receiver : room.sender;
        if (other) io.to(other).emit('peer-disconnected');
        delete rooms[roomId];
        console.log(`[Room] Deleted room ${roomId} due to disconnect`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
