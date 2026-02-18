import { Request } from 'express';

export interface User {
    id: string;
    email: string;
    username: string;
    passwordHash: string;
    publicKey?: string;
    createdAt: Date;
    updatedAt: Date;
    lastLogin?: Date;
    isActive: boolean;
}

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        username: string;
    };
}

export interface RoomParticipant {
    socketId: string;
    userId: string;
    username: string;
    isAudioEnabled: boolean;
    isVideoEnabled: boolean;
}

export interface Room {
    id: string;
    name: string;
    createdBy: string;
    roomType: 'public' | 'private' | 'scheduled';
    maxParticipants: number;
    isActive: boolean;
    createdAt: Date;
    scheduledAt?: Date;
    endedAt?: Date;
}

export interface FileMetadata {
    id: string;
    roomId: string;
    uploadedBy: string;
    filename: string;
    originalFilename: string;
    fileSize: number;
    mimeType: string;
    storagePath: string;
    iv: string;
    checksum: string;
    uploadedAt: Date;
    isDeleted: boolean;
}

export interface ChatMessage {
    roomId: string;
    userId: string;
    username: string;
    message: string;
    messageType: 'text' | 'file' | 'system';
    timestamp: Date;
    editedAt?: Date;
    isDeleted: boolean;
    replyTo?: string;
}

export interface WhiteboardAction {
    roomId: string;
    userId: string;
    action: 'draw' | 'erase' | 'clear' | 'undo';
    data: any;
    timestamp: Date;
    version: number;
}
