const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index2', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index2.html'));
});

app.get('/index3', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index3.html'));
});

// Store active rooms and their passwords in memory
const roomPasswords = {};

// Store chat history per room in memory
const roomHistory = {};

// Socket.io setup
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ name, roomId, roomPass }) => {
    if (!name || !roomId || !roomPass) {
      return socket.emit('join-response', { success: false, message: 'All fields are required.' });
    }

    const cleanRoomId = roomId.trim().toUpperCase();

    // Check if room exists and validate password
    if (roomPasswords[cleanRoomId]) {
      if (roomPasswords[cleanRoomId] !== roomPass) {
        return socket.emit('join-response', { success: false, message: 'Incorrect password for this room.' });
      }
    } else {
      // Create new room with provided password
      roomPasswords[cleanRoomId] = roomPass;
      roomHistory[cleanRoomId] = [];
    }

    // Join Socket.io room
    socket.join(cleanRoomId);
    socket.userData = { name, roomId: cleanRoomId };

    // Emit join response along with full room history
    socket.emit('join-response', { 
      success: true, 
      name: name,
      roomId: cleanRoomId, 
      history: roomHistory[cleanRoomId] || [] 
    });

    // Notify room of new user
    const systemMessage = {
      name: 'System',
      message: `${name} joined the room.`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (roomHistory[cleanRoomId]) {
      roomHistory[cleanRoomId].push(systemMessage);
    }

    // Send the join message to other users in the room
    socket.to(cleanRoomId).emit('chat-message', systemMessage);
  });

  // Handler supporting both text & file payloads
  socket.on('chat-message', (data) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;

    let messageText = typeof data === 'string' ? data : data.message;
    let fileData = typeof data === 'object' ? data.file : null;

    if ((messageText && messageText.trim() !== '') || fileData) {
      const msgData = {
        name: user.name,
        message: messageText ? messageText.trim() : '',
        file: fileData,
        isSystem: false,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      // Store message in room history
      if (roomHistory[user.roomId]) {
        roomHistory[user.roomId].push(msgData);
      }

      // Broadcast to all room members (including sender)
      io.to(user.roomId).emit('chat-message', msgData);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userData) {
      const { name, roomId } = socket.userData;

      const disconnectMessage = {
        name: 'System',
        message: `${name} disconnected.`,
        isSystem: true,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      if (roomHistory[roomId]) {
        roomHistory[roomId].push(disconnectMessage);
      }

      io.to(roomId).emit('chat-message', disconnectMessage);
      
      // Note: History and room passwords are kept in memory so messages remain available when users re-join.
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
