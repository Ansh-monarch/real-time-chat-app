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

// Store chat state with rooms
const chatState = {
  rooms: {
    'general': {
      name: 'General Chat',
      users: [],
      messages: [],
      createdAt: new Date()
    },
    'gaming': {
      name: 'Gaming',
      users: [],
      messages: [],
      createdAt: new Date()
    },
    'random': {
      name: 'Random',
      users: [],
      messages: [],
      createdAt: new Date()
    }
  },
  activeUsers: new Map()
};

// Helper functions
function getAvailableRooms() {
  return Object.entries(chatState.rooms).map(([id, room]) => ({
    id: id,
    name: room.name,
    userCount: room.users.length,
    messageCount: room.messages.length,
    createdAt: room.createdAt
  }));
}

function joinRoom(userId, username, roomId) {
  if (!chatState.rooms[roomId]) {
    return false;
  }
  
  const user = {
    id: userId,
    username: username,
    joinedAt: new Date()
  };
  
  // Remove user from any other rooms first
  Object.keys(chatState.rooms).forEach(roomKey => {
    const userIndex = chatState.rooms[roomKey].users.findIndex(user => user.id === userId);
    if (userIndex !== -1) {
      chatState.rooms[roomKey].users.splice(userIndex, 1);
    }
  });
  
  // Add user to new room
  chatState.rooms[roomId].users.push(user);
  chatState.activeUsers.set(userId, { username, roomId });
  
  // Join socket room
  const socket = io.sockets.sockets.get(userId);
  if (socket) {
    socket.join(roomId);
  }
  
  return true;
}

function leaveRoom(userId, roomId) {
  if (!chatState.rooms[roomId]) return null;
  
  const userIndex = chatState.rooms[roomId].users.findIndex(user => user.id === userId);
  if (userIndex !== -1) {
    const user = chatState.rooms[roomId].users[userIndex];
    chatState.rooms[roomId].users.splice(userIndex, 1);
    
    const socket = io.sockets.sockets.get(userId);
    if (socket) {
      socket.leave(roomId);
    }
    
    chatState.activeUsers.delete(userId);
    return user;
  }
  return null;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // Send available rooms to new user
  socket.emit('availableRooms', getAvailableRooms());

  // Handle user joining a room
  socket.on('joinRoom', (data) => {
    const { username, roomId } = data;
    
    if (!username || !roomId) {
      socket.emit('error', { message: 'Username and room ID are required' });
      return;
    }
    
    // Leave previous room if any
    if (socket.roomId) {
      const leftUser = leaveRoom(socket.id, socket.roomId);
      if (leftUser) {
        socket.to(socket.roomId).emit('userLeftRoom', {
          username: leftUser.username,
          roomId: socket.roomId,
          users: chatState.rooms[socket.roomId].users
        });
      }
    }
    
    // Join new room
    const joinSuccess = joinRoom(socket.id, username, roomId);
    
    if (!joinSuccess) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    socket.roomId = roomId;
    socket.username = username;
    
    // Send room data to the joining user
    socket.emit('roomJoined', {
      room: chatState.rooms[roomId],
      users: chatState.rooms[roomId].users
    });
    
    // Notify room about new user
    socket.to(roomId).emit('userJoinedRoom', {
      username,
      roomId,
      users: chatState.rooms[roomId].users
    });
    
    console.log(`👤 ${username} joined room: ${roomId}`);
  });

  // Handle new messages
  socket.on('sendMessage', (data) => {
    const { username, message, roomId } = data;
    
    if (!username || !message || !roomId) {
      socket.emit('error', { message: 'Missing required fields' });
      return;
    }
    
    if (!chatState.rooms[roomId]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    console.log(`💬 ${username} in ${roomId}: ${message}`);
    
    const messageObj = {
      id: Date.now().toString(),
      username: username,
      message: message.trim(),
      timestamp: new Date(),
      userId: socket.id,
      type: 'user'
    };
    
    // Store message in room
    chatState.rooms[roomId].messages.push(messageObj);
    
    // Keep only last 500 messages per room
    if (chatState.rooms[roomId].messages.length > 500) {
      chatState.rooms[roomId].messages = chatState.rooms[roomId].messages.slice(-500);
    }
    
    // Broadcast to room
    io.to(roomId).emit('newMessage', messageObj);
  });

  // Handle typing indicators
  socket.on('typing', (data) => {
    const { username, roomId } = data;
    
    if (roomId && chatState.rooms[roomId]) {
      socket.to(roomId).emit('userTyping', { 
        username: username,
        roomId: roomId
      });
    }
  });

  socket.on('stopTyping', (data) => {
    const { roomId } = data;
    
    if (roomId && chatState.rooms[roomId]) {
      socket.to(roomId).emit('userStopTyping', {
        roomId: roomId
      });
    }
  });

  // Handle room creation
  socket.on('createRoom', (data) => {
    const { roomId, roomName } = data;
    
    if (!roomId || !roomName) {
      socket.emit('error', { message: 'Room ID and name are required' });
      return;
    }
    
    if (roomId.length < 3) {
      socket.emit('error', { message: 'Room ID must be at least 3 characters' });
      return;
    }
    
    if (chatState.rooms[roomId]) {
      socket.emit('error', { message: 'Room already exists' });
      return;
    }
    
    // Create new room
    chatState.rooms[roomId] = {
      name: roomName,
      users: [],
      messages: [],
      createdAt: new Date()
    };
    
    // Notify all users about new room
    io.emit('roomCreated', {
      roomId: roomId,
      name: roomName,
      userCount: 0
    });
    
    console.log(`🚀 New room created: ${roomName} (${roomId})`);
  });

  // Handle get rooms request
  socket.on('getRooms', () => {
    socket.emit('availableRooms', getAvailableRooms());
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    console.log('👋 User disconnected:', socket.id);
    
    if (socket.roomId) {
      const leftUser = leaveRoom(socket.id, socket.roomId);
      
      if (leftUser) {
        socket.to(socket.roomId).emit('userLeftRoom', {
          username: leftUser.username,
          roomId: socket.roomId,
          users: chatState.rooms[socket.roomId].users
        });
        
        console.log(`👋 ${leftUser.username} left room: ${socket.roomId}`);
      }
    }
  });
});

// API Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Multi-Room Chat Server',
    status: 'running',
    totalRooms: Object.keys(chatState.rooms).length,
    totalUsers: chatState.activeUsers.size,
    uptime: process.uptime(),
    timestamp: new Date()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

app.get('/rooms', (req, res) => {
  res.json({
    rooms: getAvailableRooms(),
    totalUsers: chatState.activeUsers.size,
    serverTime: new Date()
  });
});

app.get('/rooms/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = chatState.rooms[roomId];
  
  if (room) {
    res.json({
      roomId: roomId,
      name: room.name,
      userCount: room.users.length,
      messageCount: room.messages.length,
      users: room.users.map(user => ({
        username: user.username,
        joinedAt: user.joinedAt
      })),
      recentMessages: room.messages.slice(-50),
      createdAt: room.createdAt
    });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

app.get('/stats', (req, res) => {
  const roomStats = Object.entries(chatState.rooms).map(([id, room]) => ({
    id: id,
    name: room.name,
    users: room.users.length,
    messages: room.messages.length,
    createdAt: room.createdAt
  }));
  
  res.json({
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connections: io.engine.clientsCount
    },
    rooms: roomStats,
    totalUsers: chatState.activeUsers.size,
    activeRooms: Object.keys(chatState.rooms).length
  });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Multi-Room Chat server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`💬 Room-based Chat Server Ready!`);
  console.log(`📊 Initial rooms: ${Object.keys(chatState.rooms).join(', ')}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
