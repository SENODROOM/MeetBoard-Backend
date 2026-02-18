import { Server, Socket } from 'socket.io';
import { ChatMessageModel } from '../models/chatMessage';

export function setupChat(io: Server) {
    io.on('connection', (socket: Socket) => {

        socket.on('chat-message', async ({ roomId, message, messageType = 'text', replyTo }) => {
            try {
                // Save message to MongoDB
                const chatMessage = new ChatMessageModel({
                    roomId,
                    userId: socket.data.user.id,
                    username: socket.data.user.username,
                    message,
                    messageType,
                    replyTo: replyTo || undefined,
                });

                await chatMessage.save();

                // Broadcast to room
                io.to(roomId).emit('chat-message', {
                    id: chatMessage._id,
                    roomId: chatMessage.roomId,
                    userId: chatMessage.userId,
                    username: chatMessage.username,
                    message: chatMessage.message,
                    messageType: chatMessage.messageType,
                    timestamp: chatMessage.timestamp,
                    replyTo: chatMessage.replyTo,
                });
            } catch (error) {
                console.error('Chat message error:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        socket.on('typing-start', ({ roomId }) => {
            socket.to(roomId).emit('user-typing', {
                userId: socket.data.user.id,
                username: socket.data.user.username,
            });
        });

        socket.on('typing-stop', ({ roomId }) => {
            socket.to(roomId).emit('user-stopped-typing', {
                userId: socket.data.user.id,
            });
        });
    });
}
