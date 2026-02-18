import { Response } from 'express';
import { ChatMessageModel } from '../models/chatMessage';
import { pgPool } from '../config/database';
import { AuthRequest } from '../types';

export const getChatHistory = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { roomId } = req.params;
        const { limit = 50, before } = req.query;

        // Verify user is in room
        const participantResult = await client.query(
            'SELECT id FROM room_participants WHERE room_id = $1 AND user_id = $2',
            [roomId, req.user!.id]
        );

        if (participantResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not a participant of this room' });
        }

        // Build query
        const query: any = { roomId, isDeleted: false };
        if (before) {
            query.timestamp = { $lt: new Date(before as string) };
        }

        const messages = await ChatMessageModel
            .find(query)
            .sort({ timestamp: -1 })
            .limit(Number(limit))
            .lean();

        res.json({ success: true, messages: messages.reverse() });
    } catch (error) {
        console.error('Get chat history error:', error);
        res.status(500).json({ error: 'Failed to get chat history' });
    } finally {
        client.release();
    }
};

export const deleteMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { messageId } = req.params;

        const message = await ChatMessageModel.findById(messageId);

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.userId !== req.user!.id) {
            return res.status(403).json({ error: 'Not authorized to delete this message' });
        }

        message.isDeleted = true;
        message.message = '[Deleted]';
        await message.save();

        res.json({ success: true, message: 'Message deleted successfully' });
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
};

export const editMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { messageId } = req.params;
        const { message: newMessage } = req.body;

        if (!newMessage) {
            return res.status(400).json({ error: 'Message content is required' });
        }

        const message = await ChatMessageModel.findById(messageId);

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.userId !== req.user!.id) {
            return res.status(403).json({ error: 'Not authorized to edit this message' });
        }

        message.message = newMessage;
        message.editedAt = new Date();
        await message.save();

        res.json({ success: true, message });
    } catch (error) {
        console.error('Edit message error:', error);
        res.status(500).json({ error: 'Failed to edit message' });
    }
};
