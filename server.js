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

// Store chat state
const chatState = {
  users: [],
  messages: []
};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // Send current chat state to new user
  socket.emit('userListUpdate', chatState.users);
  
  // Send last 50 messages
  const recentMessages = chatState.messages.slice(-50);
  socket.emit('chatHistory', recentMessages);

  // Handle user joining
  socket.on('userJoined', (username) => {
    console.log(`👤 ${username} joined the chat`);
    
    // Add user to chat state
    const user = {
      id: socket.id,
      username: username,
      joinedAt: new Date()
    };
    
    chatState.users.push(user);
    
    // Broadcast updated user list to everyone
    io.emit('userListUpdate', chatState.users);
    
    // Broadcast join message
    const joinMessage = {
      id: Date.now().toString(),
      username: 'System',
      message: `${username} joined the chat`,
      timestamp: new Date(),
      type: 'system'
    };
    
    chatState.messages.push(joinMessage);
    io.emit('newMessage', joinMessage);
  });

  // Handle new messages
  socket.on('sendMessage', (data) => {
    console.log(`💬 ${data.username}: ${data.message}`);
    
    const message = {
      id: Date.now().toString(),
      username: data.username,
      message: data.message,
      timestamp: new Date(),
      userId: socket.id,
      type: 'user'
    };
    
    // Store message
    chatState.messages.push(message);
    
    // Broadcast to all users
    io.emit('newMessage', message);
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    console.log('👋 User disconnected:', socket.id);
    
    // Find and remove user
    const userIndex = chatState.users.findIndex(user => user.id === socket.id);
    if (userIndex !== -1) {
      const user = chatState.users[userIndex];
      
      // Remove user
      chatState.users.splice(userIndex, 1);
      
      // Broadcast updated user list
      io.emit('userListUpdate', chatState.users);
      
      // Broadcast leave message
      const leaveMessage = {
        id: Date.now().toString(),
        username: 'System',
        message: `${user.username} left the chat`,
        timestamp: new Date(),
        type: 'system'
      };
      
      chatState.messages.push(leaveMessage);
      io.emit('newMessage', leaveMessage);
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Real-Time Chat Server',
    status: 'running',
    onlineUsers: chatState.users.length,
    totalMessages: chatState.messages.length,
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Chat server running on port ${PORT}`);
  console.log(`💬 Real-Time Chat Server Ready!`);
});
