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
      id: Math.random().toString(36).substring(2, 9),
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

  socket.on('chat-message', (data) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;

    if (data) {
      const msgData = {
        id: Math.random().toString(36).substring(2, 9),
        name: user.name,
        message: typeof data === 'string' ? data.trim() : (data.message ? data.message.trim() : ''),
        file: typeof data === 'object' ? data.file : null,
        replyTo: typeof data === 'object' ? data.replyTo : null,
        reactions: {},
        isSystem: false,
        timestamp: new Date().toISOString()
      };

      if (roomHistory[user.roomId]) {
        roomHistory[user.roomId].push(msgData);
      }

      io.to(user.roomId).emit('chat-message', msgData);
    }
  });

  socket.on('edit-message', ({ id, newText }) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;
    const history = roomHistory[user.roomId];
    if (history) {
      const msg = history.find(m => m.id === id);
      if (msg && msg.name === user.name) {
        msg.message = newText.trim();
        msg.edited = true;
        io.to(user.roomId).emit('message-updated', { id, message: msg.message, edited: true });
      }
    }
  });

  socket.on('delete-messages', ({ ids }) => {
    const user = socket.userData;
    if (!user || !user.roomId || !Array.isArray(ids)) return;
    const history = roomHistory[user.roomId];
    if (history) {
      const validIdsToDelete = [];
      ids.forEach(id => {
        const index = history.findIndex(m => m.id === id && m.name === user.name);
        if (index !== -1) {
          history.splice(index, 1);
          validIdsToDelete.push(id);
        }
      });

      if (validIdsToDelete.length > 0) {
        io.to(user.roomId).emit('messages-removed', { ids: validIdsToDelete });
      }
    }
  });

  socket.on('toggle-reaction', ({ messageId, emoji }) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;
    const history = roomHistory[user.roomId];
    if (history) {
      const msg = history.find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = {};
        if (!msg.reactions[emoji]) {
          msg.reactions[emoji] = [];
        }
        const userIndex = msg.reactions[emoji].indexOf(user.name);
        if (userIndex > -1) {
          msg.reactions[emoji].splice(userIndex, 1);
          if (msg.reactions[emoji].length === 0) {
            delete msg.reactions[emoji];
          }
        } else {
          msg.reactions[emoji].push(user.name);
        }
        io.to(user.roomId).emit('reaction-updated', { messageId, reactions: msg.reactions });
      }
    }
  });

  socket.on('typing', (isTyping) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;
    socket.to(user.roomId).emit('user-typing', { name: user.name, isTyping });
  });

  socket.on('disconnect', () => {
    if (socket.userData) {
      const { name, roomId } = socket.userData;
      socket.to(roomId).emit('user-typing', { name, isTyping: false });

      const disconnectMessage = {
        id: Math.random().toString(36).substring(2, 9),
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
