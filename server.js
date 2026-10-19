const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// Set max buffer size to 500 MB to support large files/videos
const io = new Server(server, { 
  cors: { origin: '*' },
  maxHttpBufferSize: 500 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Connect to MongoDB Atlas (Falls back to local MongoDB if URI isn't set)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/flux-chat';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define Database Schema for Rooms & Messages
const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  history: { type: Array, default: [] }
});
const Room = mongoose.model('Room', roomSchema);

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', async ({ name, roomId, roomPass }) => {
    if (!name || !roomId || !roomPass) {
      return socket.emit('join-response', { success: false, message: 'All fields are required.' });
    }

    const cleanRoomId = roomId.trim().toUpperCase();

    try {
      let room = await Room.findOne({ roomId: cleanRoomId });

      if (room) {
        if (room.password !== roomPass) {
          return socket.emit('join-response', { success: false, message: 'Incorrect password for this room.' });
        }
      } else {
        room = new Room({ roomId: cleanRoomId, password: roomPass, history: [] });
        await room.save();
      }

      socket.join(cleanRoomId);
      socket.userData = { name, roomId: cleanRoomId };

      socket.emit('join-response', { 
        success: true, 
        name: name,
        roomId: cleanRoomId, 
        history: room.history 
      });

      const systemMessage = {
        id: Math.random().toString(36).substring(2, 9),
        name: 'System',
        message: `${name} joined the room.`,
        isSystem: true,
        timestamp: new Date().toISOString()
      };

      room.history.push(systemMessage);
      room.markModified('history');
      await room.save();

      io.to(cleanRoomId).emit('chat-message', systemMessage);
    } catch (err) {
      console.error('Error joining room:', err);
      socket.emit('join-response', { success: false, message: 'Database error.' });
    }
  });

  socket.on('chat-message', async (data) => {
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

      try {
        const room = await Room.findOne({ roomId: user.roomId });
        if (room) {
          room.history.push(msgData);
          room.markModified('history');
          await room.save();
          io.to(user.roomId).emit('chat-message', msgData);
        }
      } catch (err) {
        console.error('Error saving chat message:', err);
      }
    }
  });

  socket.on('edit-message', async ({ id, newText }) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;
    
    try {
      const room = await Room.findOne({ roomId: user.roomId });
      if (room) {
        const msg = room.history.find(m => m.id === id);
        if (msg && msg.name === user.name) {
          msg.message = newText.trim();
          msg.edited = true;
          room.markModified('history');
          await room.save();
          io.to(user.roomId).emit('message-updated', { id, message: msg.message, edited: true });
        }
      }
    } catch (err) {
      console.error('Error editing message:', err);
    }
  });

  socket.on('delete-messages', async ({ ids }) => {
    const user = socket.userData;
    if (!user || !user.roomId || !Array.isArray(ids)) return;

    try {
      const room = await Room.findOne({ roomId: user.roomId });
      if (room) {
        const validIdsToDelete = [];
        ids.forEach(id => {
          const index = room.history.findIndex(m => m.id === id && m.name === user.name);
          if (index !== -1) {
            room.history.splice(index, 1);
            validIdsToDelete.push(id);
          }
        });

        if (validIdsToDelete.length > 0) {
          room.markModified('history');
          await room.save();
          io.to(user.roomId).emit('messages-removed', { ids: validIdsToDelete });
        }
      }
    } catch (err) {
      console.error('Error deleting messages:', err);
    }
  });

  socket.on('toggle-reaction', async ({ messageId, emoji }) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;

    try {
      const room = await Room.findOne({ roomId: user.roomId });
      if (room) {
        const msg = room.history.find(m => m.id === messageId);
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
          room.markModified('history');
          await room.save();
          io.to(user.roomId).emit('reaction-updated', { messageId, reactions: msg.reactions });
        }
      }
    } catch (err) {
      console.error('Error toggling reaction:', err);
    }
  });

  socket.on('typing', (isTyping) => {
    const user = socket.userData;
    if (!user || !user.roomId) return;
    socket.to(user.roomId).emit('user-typing', { name: user.name, isTyping });
  });

  socket.on('disconnect', async () => {
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

      try {
        const room = await Room.findOne({ roomId });
        if (room) {
          room.history.push(disconnectMessage);
          room.markModified('history');
          await room.save();
          io.to(roomId).emit('chat-message', disconnectMessage);
        }
      } catch (err) {
        console.error('Error saving disconnect message:', err);
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});