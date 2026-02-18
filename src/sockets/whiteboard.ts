import { Server, Socket } from 'socket.io';
import { WhiteboardModel } from '../models/whiteboard';

export function setupWhiteboard(io: Server) {
    io.on('connection', (socket: Socket) => {

        socket.on('whiteboard-draw', async ({ roomId, action, data }) => {
            try {
                // Get latest version
                const latestAction = await WhiteboardModel
                    .findOne({ roomId })
                    .sort({ version: -1 })
                    .lean();

                const version = latestAction ? latestAction.version + 1 : 1;

                // Save to MongoDB
                const whiteboardAction = new WhiteboardModel({
                    roomId,
                    userId: socket.data.user.id,
                    action,
                    data,
                    version,
                });

                await whiteboardAction.save();

                // Broadcast to all other participants
                socket.to(roomId).emit('whiteboard-update', {
                    action,
                    data,
                    userId: socket.data.user.id,
                    username: socket.data.user.username,
                    version,
                });
            } catch (error) {
                console.error('Whiteboard error:', error);
                socket.emit('error', { message: 'Failed to update whiteboard' });
            }
        });

        socket.on('whiteboard-get-history', async ({ roomId, fromVersion = 0 }) => {
            try {
                const actions = await WhiteboardModel
                    .find({ roomId, version: { $gt: fromVersion } })
                    .sort({ version: 1 })
                    .lean();

                socket.emit('whiteboard-history', { actions });
            } catch (error) {
                console.error('Get whiteboard history error:', error);
                socket.emit('error', { message: 'Failed to get whiteboard history' });
            }
        });
    });
}
