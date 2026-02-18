import { Response } from 'express';
import { pgPool } from '../config/database';
import { AuthRequest } from '../types';

export const createRoom = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { name, roomType = 'public', maxParticipants = 50, scheduledAt } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Room name is required' });
        }

        const result = await client.query(
            `INSERT INTO rooms (name, created_by, room_type, max_participants, scheduled_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, room_type, max_participants, created_at, scheduled_at`,
            [name, req.user!.id, roomType, maxParticipants, scheduledAt || null]
        );

        const room = result.rows[0];

        // Add creator as host
        await client.query(
            `INSERT INTO room_participants (room_id, user_id, role)
       VALUES ($1, $2, 'host')`,
            [room.id, req.user!.id]
        );

        res.status(201).json({ success: true, room });
    } catch (error) {
        console.error('Create room error:', error);
        res.status(500).json({ error: 'Failed to create room' });
    } finally {
        client.release();
    }
};

export const getRoom = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { roomId } = req.params;

        const result = await client.query(
            `SELECT r.*, u.username as creator_username
       FROM rooms r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.id = $1 AND r.is_active = true`,
            [roomId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }

        const room = result.rows[0];

        // Get participants
        const participantsResult = await client.query(
            `SELECT rp.*, u.username
       FROM room_participants rp
       JOIN users u ON rp.user_id = u.id
       WHERE rp.room_id = $1 AND rp.left_at IS NULL`,
            [roomId]
        );

        room.participants = participantsResult.rows;

        res.json({ success: true, room });
    } catch (error) {
        console.error('Get room error:', error);
        res.status(500).json({ error: 'Failed to get room' });
    } finally {
        client.release();
    }
};

export const listRooms = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { type = 'public', limit = 20, offset = 0 } = req.query;

        const result = await client.query(
            `SELECT r.*, u.username as creator_username,
              COUNT(rp.id) as participant_count
       FROM rooms r
       LEFT JOIN users u ON r.created_by = u.id
       LEFT JOIN room_participants rp ON r.id = rp.room_id AND rp.left_at IS NULL
       WHERE r.is_active = true AND r.room_type = $1
       GROUP BY r.id, u.username
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
            [type, limit, offset]
        );

        res.json({ success: true, rooms: result.rows });
    } catch (error) {
        console.error('List rooms error:', error);
        res.status(500).json({ error: 'Failed to list rooms' });
    } finally {
        client.release();
    }
};

export const joinRoom = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { roomId } = req.params;

        // Check if room exists and is active
        const roomResult = await client.query(
            'SELECT id, max_participants FROM rooms WHERE id = $1 AND is_active = true',
            [roomId]
        );

        if (roomResult.rows.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }

        const room = roomResult.rows[0];

        // Check participant count
        const countResult = await client.query(
            'SELECT COUNT(*) as count FROM room_participants WHERE room_id = $1 AND left_at IS NULL',
            [roomId]
        );

        if (parseInt(countResult.rows[0].count) >= room.max_participants) {
            return res.status(403).json({ error: 'Room is full' });
        }

        // Check if already joined
        const existingResult = await client.query(
            'SELECT id FROM room_participants WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL',
            [roomId, req.user!.id]
        );

        if (existingResult.rows.length > 0) {
            return res.json({ success: true, message: 'Already in room' });
        }

        // Add participant
        await client.query(
            `INSERT INTO room_participants (room_id, user_id, role)
       VALUES ($1, $2, 'participant')`,
            [roomId, req.user!.id]
        );

        res.json({ success: true, message: 'Joined room successfully' });
    } catch (error) {
        console.error('Join room error:', error);
        res.status(500).json({ error: 'Failed to join room' });
    } finally {
        client.release();
    }
};

export const leaveRoom = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { roomId } = req.params;

        await client.query(
            `UPDATE room_participants 
       SET left_at = CURRENT_TIMESTAMP 
       WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
            [roomId, req.user!.id]
        );

        res.json({ success: true, message: 'Left room successfully' });
    } catch (error) {
        console.error('Leave room error:', error);
        res.status(500).json({ error: 'Failed to leave room' });
    } finally {
        client.release();
    }
};

export const endRoom = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { roomId } = req.params;

        // Check if user is host
        const hostResult = await client.query(
            `SELECT id FROM room_participants 
       WHERE room_id = $1 AND user_id = $2 AND role = 'host'`,
            [roomId, req.user!.id]
        );

        if (hostResult.rows.length === 0) {
            return res.status(403).json({ error: 'Only host can end the room' });
        }

        // End room
        await client.query(
            `UPDATE rooms 
       SET is_active = false, ended_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
            [roomId]
        );

        // Mark all participants as left
        await client.query(
            `UPDATE room_participants 
       SET left_at = CURRENT_TIMESTAMP 
       WHERE room_id = $1 AND left_at IS NULL`,
            [roomId]
        );

        res.json({ success: true, message: 'Room ended successfully' });
    } catch (error) {
        console.error('End room error:', error);
        res.status(500).json({ error: 'Failed to end room' });
    } finally {
        client.release();
    }
};
