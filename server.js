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

// Store chat state with fixed 3 rooms
const chatState = {
  rooms: {
    'room1': {
      name: 'Room 1',
      users: [],
      messages: [],
      createdAt: new Date(),
      owner: null
    },
    'room2': {
      name: 'Room 2',
      users: [],
      messages: [],
      createdAt: new Date(),
      owner: null
    },
    'room3': {
      name: 'Room 3', 
      users: [],
      messages: [],
      createdAt: new Date(),
      owner: null
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
    owner: room.owner
  }));
}

function joinRoom(userId, username, roomId) {
  if (!chatState.rooms[roomId]) {
    return false;
  }
  
  const user = {
    id: userId,
    username: username,
    joinedAt: new Date(),
    isOwner: false
  };
  
  // Set as owner if room has no owner
  if (!chatState.rooms[roomId].owner) {
    chatState.rooms[roomId].owner = userId;
    user.isOwner = true;
  } else if (chatState.rooms[roomId].owner === userId) {
    user.isOwner = true;
  }
  
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
    
    // If owner leaves, assign new owner or clear owner
    if (chatState.rooms[roomId].owner === userId) {
      if (chatState.rooms[roomId].users.length > 0) {
        chatState.rooms[roomId].owner = chatState.rooms[roomId].users[0].id;
        chatState.rooms[roomId].users[0].isOwner = true;
      } else {
        chatState.rooms[roomId].owner = null;
      }
    }
    
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
    const userData = chatState.rooms[roomId].users.find(user => user.id === socket.id);
    socket.emit('roomJoined', {
      room: chatState.rooms[roomId],
      users: chatState.rooms[roomId].users,
      isOwner: userData ? userData.isOwner : false
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
    
    // Keep only last 200 messages per room
    if (chatState.rooms[roomId].messages.length > 200) {
      chatState.rooms[roomId].messages = chatState.rooms[roomId].messages.slice(-200);
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

  // Handle get rooms request
  socket.on('getRooms', () => {
    socket.emit('availableRooms', getAvailableRooms());
  });

  // Handle clear chat (owner only)
  socket.on('clearChat', (data) => {
    const { roomId } = data;
    
    if (!roomId || !chatState.rooms[roomId]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    // Check if user is owner
    if (chatState.rooms[roomId].owner !== socket.id) {
      socket.emit('error', { message: 'Only room owner can clear chat' });
      return;
    }
    
    // Clear messages
    chatState.rooms[roomId].messages = [];
    
    // Notify room
    io.to(roomId).emit('chatCleared', {
      clearedBy: socket.username,
      roomId: roomId
    });
    
    console.log(`🗑️ ${socket.username} cleared chat in ${roomId}`);
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
    message: '3-Room Chat Server',
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
    totalUsers: chatState.activeUsers.size
  });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 3-Room Chat server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`💬 Fixed Rooms: Room 1, Room 2, Room 3`);
});
