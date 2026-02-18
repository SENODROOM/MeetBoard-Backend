import { Server, Socket } from 'socket.io';
import { verifyToken } from '../middleware/auth';
import { RoomParticipant } from '../types';

const rooms = new Map<string, Map<string, RoomParticipant>>();

export function setupWebRTCSignaling(io: Server) {
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            const user = await verifyToken(token);
            socket.data.user = user;
            next();
        } catch (error) {
            next(new Error('Authentication failed'));
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log(`User connected: ${socket.data.user.username} (${socket.id})`);

        // Join room
        socket.on('join-room', async ({ roomId }) => {
            try {
                socket.join(roomId);

                if (!rooms.has(roomId)) {
                    rooms.set(roomId, new Map());
                }

                const room = rooms.get(roomId)!;
                const participant: RoomParticipant = {
                    socketId: socket.id,
                    userId: socket.data.user.id,
                    username: socket.data.user.username,
                    isAudioEnabled: true,
                    isVideoEnabled: true,
                };

                room.set(socket.id, participant);

                // Notify existing participants
                const existingParticipants = Array.from(room.values())
                    .filter(p => p.socketId !== socket.id);

                socket.emit('existing-participants', existingParticipants);

                // Notify others about new participant
                socket.to(roomId).emit('participant-joined', participant);

                console.log(`User ${socket.data.user.username} joined room ${roomId}`);
            } catch (error) {
                console.error('Join room error:', error);
                socket.emit('error', { message: 'Failed to join room' });
            }
        });

        // WebRTC offer
        socket.on('offer', ({ to, offer }) => {
            const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
            if (roomId) {
                const room = rooms.get(roomId);
                const participant = room?.get(socket.id);

                socket.to(to).emit('offer', {
                    from: socket.id,
                    offer,
                    participant,
                });
            }
        });

        // WebRTC answer
        socket.on('answer', ({ to, answer }) => {
            socket.to(to).emit('answer', {
                from: socket.id,
                answer,
            });
        });

        // ICE candidate
        socket.on('ice-candidate', ({ to, candidate }) => {
            socket.to(to).emit('ice-candidate', {
                from: socket.id,
                candidate,
            });
        });

        // Toggle audio/video
        socket.on('toggle-media', ({ roomId, type, enabled }) => {
            const room = rooms.get(roomId);
            if (room) {
                const participant = room.get(socket.id);
                if (participant) {
                    if (type === 'audio') participant.isAudioEnabled = enabled;
                    if (type === 'video') participant.isVideoEnabled = enabled;

                    socket.to(roomId).emit('participant-media-changed', {
                        socketId: socket.id,
                        type,
                        enabled,
                    });
                }
            }
        });

        // Screen share start
        socket.on('start-screen-share', ({ roomId }) => {
            socket.to(roomId).emit('participant-screen-share-started', {
                socketId: socket.id,
                userId: socket.data.user.id,
                username: socket.data.user.username,
            });
        });

        // Screen share stop
        socket.on('stop-screen-share', ({ roomId }) => {
            socket.to(roomId).emit('participant-screen-share-stopped', {
                socketId: socket.id,
            });
        });

        // Leave room
        socket.on('leave-room', (roomId) => {
            handleLeaveRoom(socket, roomId);
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.data.user.username} (${socket.id})`);

            // Clean up all rooms
            rooms.forEach((room, roomId) => {
                if (room.has(socket.id)) {
                    handleLeaveRoom(socket, roomId);
                }
            });
        });
    });
}

function handleLeaveRoom(socket: Socket, roomId: string) {
    const room = rooms.get(roomId);
    if (room) {
        room.delete(socket.id);
        socket.to(roomId).emit('participant-left', { socketId: socket.id });
        socket.leave(roomId);

        if (room.size === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} is now empty and removed`);
        }
    }
}
