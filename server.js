const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const roomPasswords = {};
const roomHistory = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ name, roomId, roomPass }) => {
    if (!name || !roomId || !roomPass) {
      return socket.emit('join-response', { success: false, message: 'All fields are required.' });
    }

    const cleanRoomId = roomId.trim().toUpperCase();

    if (roomPasswords[cleanRoomId]) {
      if (roomPasswords[cleanRoomId] !== roomPass) {
        return socket.emit('join-response', { success: false, message: 'Incorrect password for this room.' });
      }
    } else {
      roomPasswords[cleanRoomId] = roomPass;
      roomHistory[cleanRoomId] = [];
    }

    socket.join(cleanRoomId);
    socket.userData = { name, roomId: cleanRoomId };

    socket.emit('join-response', { 
      success: true, 
      name: name,
      roomId: cleanRoomId, 
      history: roomHistory[cleanRoomId] || [] 
    });

    const systemMessage = {
      name: 'System',
      message: `${name} joined the room.`,
      isSystem: true,
      timestamp: new Date().toISOString()
    };

    if (roomHistory[cleanRoomId]) {
      roomHistory[cleanRoomId].push(systemMessage);
    }

    io.to(cleanRoomId).emit('chat-message', systemMessage);
  });

  socket.on('chat-message', (messageText) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;

    if (messageText && messageText.trim() !== '') {
      const msgData = {
        name: user.name,
        message: messageText.trim(),
        isSystem: false,
        timestamp: new Date().toISOString()
      };

      if (roomHistory[user.roomId]) {
        roomHistory[user.roomId].push(msgData);
      }

      io.to(user.roomId).emit('chat-message', msgData);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userData) {
      const { name, roomId } = socket.userData;

      const disconnectMessage = {
        name: 'System',
        message: `${name} left the room.`,
        isSystem: true,
        timestamp: new Date().toISOString()
      };

      if (roomHistory[roomId]) {
        roomHistory[roomId].push(disconnectMessage);
      }

      io.to(roomId).emit('chat-message', disconnectMessage);
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
