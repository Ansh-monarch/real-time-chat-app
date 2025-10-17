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

// Function to broadcast room updates to ALL users
function broadcastRoomUpdates() {
  const roomData = Object.keys(rooms).map(id => ({
    id: id,
    name: rooms[id].name,
    userCount: rooms[id].users.length
  }));
  
  io.emit('roomsUpdate', roomData);
}

io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // Send initial room data
  broadcastRoomUpdates();

  // Join room
  socket.on('joinRoom', (data) => {
    console.log('📨 joinRoom received:', data);
    
    const { username, roomId } = data;
    
    if (!username || !roomId) {
      socket.emit('error', { message: 'Username and room ID are required' });
      return;
    }
    
    if (!rooms[roomId]) {
      socket.emit('error', { message: `Room not found` });
      return;
    }
    
    // Leave previous room
    if (socket.roomId) {
      console.log(`🚪 Leaving previous room: ${socket.roomId}`);
      const oldRoom = rooms[socket.roomId];
      const userIndex = oldRoom.users.findIndex(user => user.id === socket.id);
      if (userIndex !== -1) {
        oldRoom.users.splice(userIndex, 1);
      }
      
      // Notify old room and update counts
      socket.to(socket.roomId).emit('userLeft', { 
        username: socket.username, 
        users: oldRoom.users 
      });
      broadcastRoomUpdates(); // Update all room counts
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
    
    // Update all room counts for everyone
    broadcastRoomUpdates();
  });

  // Send message
  socket.on('sendMessage', (data) => {
    console.log('📨 sendMessage received:', data);
    
    const { message, roomId } = data;
    
    if (!socket.roomId || !socket.username || socket.roomId !== roomId) {
      return;
    }
    
    const messageObj = {
      id: Date.now(),
      username: socket.username,
      message: message,
      timestamp: new Date(),
      userId: socket.id
    };
    
    rooms[roomId].messages.push(messageObj);
    io.to(roomId).emit('newMessage', messageObj);
  });

  // Handle user leaving room manually
  socket.on('leaveRoom', () => {
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      const userIndex = room.users.findIndex(user => user.id === socket.id);
      
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);
        
        socket.leave(socket.roomId);
        
        // Notify room
        socket.to(socket.roomId).emit('userLeft', {
          username: username,
          users: room.users
        });
        
        // Update counts for everyone
        broadcastRoomUpdates();
        
        console.log(`🚪 ${username} manually left ${socket.roomId}`);
        
        // Reset user's room
        socket.roomId = null;
      }
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('👋 User disconnected:', socket.id);
    
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      const userIndex = room.users.findIndex(user => user.id === socket.id);
      
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);
        
        // Notify room
        socket.to(socket.roomId).emit('userLeft', {
          username: username,
          users: room.users
        });
        
        // Update counts for everyone
        broadcastRoomUpdates();
        
        console.log(`🚪 ${username} disconnected from ${socket.roomId}`);
      }
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: '3-Room Chat Server - FIXED USER COUNTS',
    status: 'running',
    rooms: Object.keys(rooms).map(id => ({
      id: id,
      name: rooms[id].name,
      users: rooms[id].users.length,
      messages: rooms[id].messages.length
    }))
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Fixed Chat server running on port ${PORT}`);
});
