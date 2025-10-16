const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// SIMPLE 3 ROOMS
const rooms = {
  'room1': { name: 'Room 1', users: [], messages: [] },
  'room2': { name: 'Room 2', users: [], messages: [] },
  'room3': { name: 'Room 3', users: [], messages: [] }
};

console.log('🚀 Server starting with rooms:', Object.keys(rooms));

io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // Send room list
  socket.emit('roomsList', Object.keys(rooms).map(id => ({
    id: id,
    name: rooms[id].name,
    userCount: rooms[id].users.length
  })));

  // Join room
  socket.on('joinRoom', (data) => {
    console.log('📨 joinRoom received:', data);
    
    const { username, roomId } = data;
    
    if (!username || !roomId) {
      console.log('❌ Missing username or roomId');
      socket.emit('error', { message: 'Username and room ID are required' });
      return;
    }
    
    // Check if room exists
    if (!rooms[roomId]) {
      console.log('❌ Room not found:', roomId);
      console.log('✅ Available rooms:', Object.keys(rooms));
      socket.emit('error', { message: `Room "${roomId}" not found. Available: ${Object.keys(rooms).join(', ')}` });
      return;
    }
    
    // Leave previous room
    if (socket.roomId) {
      console.log(`🚪 Leaving previous room: ${socket.roomId}`);
      const oldRoom = rooms[socket.roomId];
      oldRoom.users = oldRoom.users.filter(user => user.id !== socket.id);
      socket.to(socket.roomId).emit('userLeft', { 
        username: socket.username, 
        users: oldRoom.users 
      });
    }
    
    // Join new room
    console.log(`✅ Joining room: ${roomId}`);
    socket.roomId = roomId;
    socket.username = username;
    socket.join(roomId);
    
    // Add user to room
    const userObj = { id: socket.id, username: username };
    rooms[roomId].users.push(userObj);
    
    console.log(`👤 ${username} joined ${roomId}. Room now has ${rooms[roomId].users.length} users`);
    
    // Send success to user
    socket.emit('roomJoined', {
      room: rooms[roomId],
      users: rooms[roomId].users,
      roomId: roomId
    });
    
    // Tell others in the room
    socket.to(roomId).emit('userJoined', {
      username: username,
      users: rooms[roomId].users
    });
  });

  // Send message
  socket.on('sendMessage', (data) => {
    console.log('📨 sendMessage received:', data);
    
    const { message, roomId } = data;
    
    if (!socket.roomId || !socket.username) {
      console.log('❌ User not in a room or no username');
      return;
    }
    
    if (socket.roomId !== roomId) {
      console.log(`❌ User in ${socket.roomId} but trying to send to ${roomId}`);
      return;
    }
    
    const messageObj = {
      id: Date.now(),
      username: socket.username,
      message: message,
      timestamp: new Date(),
      userId: socket.id
    };
    
    // Store message
    rooms[roomId].messages.push(messageObj);
    console.log(`💬 Message stored in ${roomId}: ${message}`);
    
    // Send to everyone in room
    io.to(roomId).emit('newMessage', messageObj);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('👋 User disconnected:', socket.id);
    
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      room.users = room.users.filter(user => user.id !== socket.id);
      
      socket.to(socket.roomId).emit('userLeft', { 
        username: socket.username, 
        users: room.users 
      });
      
      console.log(`🚪 ${socket.username} left ${socket.roomId}`);
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: '3-Room Chat Server - DEBUG VERSION',
    status: 'running',
    rooms: Object.keys(rooms).map(id => ({
      id: id,
      name: rooms[id].name,
      users: rooms[id].users.length,
      messages: rooms[id].messages.length
    }))
  });
});

app.get('/debug', (req, res) => {
  res.json({
    rooms: rooms,
    totalConnections: io.engine.clientsCount
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 DEBUG Chat server running on port ${PORT}`);
  console.log('✅ Rooms ready: room1, room2, room3');
  console.log('📍 Test URL: http://localhost:' + PORT);
});
