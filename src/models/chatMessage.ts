import mongoose, { Schema, Document } from 'mongoose';
import { ChatMessage } from '../types';

interface ChatMessageDocument extends ChatMessage, Document { }

const chatMessageSchema = new Schema<ChatMessageDocument>({
    roomId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    message: { type: String, required: true },
    messageType: { type: String, enum: ['text', 'file', 'system'], default: 'text' },
    timestamp: { type: Date, default: Date.now, index: true },
    editedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    replyTo: { type: Schema.Types.ObjectId, ref: 'ChatMessage' },
});

chatMessageSchema.index({ roomId: 1, timestamp: -1 });

export const ChatMessageModel = mongoose.model<ChatMessageDocument>('ChatMessage', chatMessageSchema);
