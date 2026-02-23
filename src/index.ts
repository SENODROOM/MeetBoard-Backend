import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import database connections
import { connectMongoDB, connectRedis } from './config/database';

// Import routes
import authRoutes from './routes/auth';
import roomRoutes from './routes/rooms';
import chatRoutes from './routes/chat';
import fileRoutes from './routes/files';

// Import socket handlers
import { setupWebRTCSignaling } from './sockets/webrtcSignaling';
import { setupChat } from './sockets/chat';
import { setupWhiteboard } from './sockets/whiteboard';

// Import middleware
import { apiLimiter } from './middleware/rateLimiter';

const app = express();
const httpServer = createServer(app);

// Socket.io setup
const io = new Server(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL?.split(',') || ['http://localhost:3000'],
        credentials: true,
    },
    maxHttpBufferSize: 1e8, // 100MB for file transfers
});

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Configure based on your needs
}));

app.use(cors({
    origin: process.env.FRONTEND_URL?.split(',') || ['http://localhost:3000'],
    credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
    res.json({ status: 'ready' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/files', fileRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Setup Socket.io handlers
setupWebRTCSignaling(io);
setupChat(io);
setupWhiteboard(io);

// Initialize database connections and start server
async function startServer() {
    try {
        // Connect to databases
        await connectMongoDB();
        await connectRedis();

        const PORT = process.env.PORT || 3001;

        httpServer.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV}`);
            console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    httpServer.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    httpServer.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

startServer();

export { app, io };
