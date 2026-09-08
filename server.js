const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const roomHistory = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ name, roomId }) => {
        socket.join(roomId);
        socket.userData = { name, roomId };

        if (!roomHistory[roomId]) {
            roomHistory[roomId] = [];
        }

        socket.emit('room-history', roomHistory[roomId]);

        const systemMessage = {
            name: 'System',
            message: `${name} joined the room.`,
            isSystem: true,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: new Date().toISOString()
        };

        roomHistory[roomId].push(systemMessage);
        io.to(roomId).emit('chat-message', systemMessage);
    });

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
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
                message: `${name} disconnected.`,
                isSystem: true,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                timestamp: new Date().toISOString()
            };

            if (roomHistory[roomId]) {
                roomHistory[roomId].push(disconnectMessage);
            }

            io.to(roomId).emit('chat-message', disconnectMessage);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
