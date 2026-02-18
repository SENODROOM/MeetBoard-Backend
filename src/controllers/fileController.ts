import { Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../config/s3';
import { pgPool } from '../config/database';
import { AuthRequest } from '../types';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
    },
});

export const uploadMiddleware = upload.single('file');

export const uploadFile = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const { filename, iv, roomId } = req.body;

        if (!filename || !iv || !roomId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify user is in room
        const participantResult = await client.query(
            'SELECT id FROM room_participants WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL',
            [roomId, req.user!.id]
        );

        if (participantResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not a participant of this room' });
        }

        // Generate unique filename
        const uniqueFilename = `${crypto.randomUUID()}-${filename}`;
        const storagePath = `rooms/${roomId}/${uniqueFilename}`;

        // Calculate checksum
        const checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

        // Upload to S3
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET!,
            Key: storagePath,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
            ServerSideEncryption: 'AES256',
        }));

        // Save metadata to database
        const result = await client.query(
            `INSERT INTO files (room_id, uploaded_by, filename, original_filename, file_size, mime_type, storage_path, iv, checksum)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, filename, original_filename, file_size, mime_type, uploaded_at`,
            [roomId, req.user!.id, uniqueFilename, filename, req.file.size, req.file.mimetype, storagePath, iv, checksum]
        );

        res.json({ success: true, file: result.rows[0] });
    } catch (error) {
        console.error('Upload file error:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    } finally {
        client.release();
    }
};

export const getFileUrl = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { fileId } = req.params;

        // Get file metadata
        const result = await client.query(
            `SELECT f.*, rp.user_id
       FROM files f
       JOIN room_participants rp ON f.room_id = rp.room_id
       WHERE f.id = $1 AND f.is_deleted = false AND rp.user_id = $2 AND rp.left_at IS NULL`,
            [fileId, req.user!.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'File not found or access denied' });
        }

        const file = result.rows[0];

        // Generate presigned URL (valid for 1 hour)
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET!,
            Key: file.storage_path,
        });

        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        res.json({
            success: true,
            url,
            file: {
                id: file.id,
                filename: file.original_filename,
                size: file.file_size,
                mimeType: file.mime_type,
                iv: file.iv,
            },
        });
    } catch (error) {
        console.error('Get file URL error:', error);
        res.status(500).json({ error: 'Failed to get file URL' });
    } finally {
        client.release();
    }
};

export const listRoomFiles = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { roomId } = req.params;

        // Verify user is in room
        const participantResult = await client.query(
            'SELECT id FROM room_participants WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL',
            [roomId, req.user!.id]
        );

        if (participantResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not a participant of this room' });
        }

        // Get files
        const result = await client.query(
            `SELECT f.id, f.original_filename, f.file_size, f.mime_type, f.uploaded_at, u.username as uploaded_by_username
       FROM files f
       JOIN users u ON f.uploaded_by = u.id
       WHERE f.room_id = $1 AND f.is_deleted = false
       ORDER BY f.uploaded_at DESC`,
            [roomId]
        );

        res.json({ success: true, files: result.rows });
    } catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ error: 'Failed to list files' });
    } finally {
        client.release();
    }
};

export const deleteFile = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { fileId } = req.params;

        // Check if user uploaded the file
        const result = await client.query(
            'SELECT id FROM files WHERE id = $1 AND uploaded_by = $2 AND is_deleted = false',
            [fileId, req.user!.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'File not found or access denied' });
        }

        // Soft delete
        await client.query(
            'UPDATE files SET is_deleted = true WHERE id = $1',
            [fileId]
        );

        res.json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    } finally {
        client.release();
    }
};
