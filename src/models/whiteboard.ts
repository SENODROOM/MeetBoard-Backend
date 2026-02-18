import mongoose, { Schema, Document } from 'mongoose';
import { WhiteboardAction } from '../types';

interface WhiteboardDocument extends WhiteboardAction, Document { }

const whiteboardSchema = new Schema<WhiteboardDocument>({
    roomId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    action: { type: String, enum: ['draw', 'erase', 'clear', 'undo'], required: true },
    data: { type: Schema.Types.Mixed, required: true },
    timestamp: { type: Date, default: Date.now, index: true },
    version: { type: Number, required: true },
});

whiteboardSchema.index({ roomId: 1, timestamp: -1 });

export const WhiteboardModel = mongoose.model<WhiteboardDocument>('Whiteboard', whiteboardSchema);
