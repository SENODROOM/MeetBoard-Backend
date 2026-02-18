# Real-Time Communication Backend

Backend server for the real-time communication application with video calling, screen sharing, whiteboard, chat, and file sharing capabilities.

## Features

- **Authentication**: JWT-based authentication with refresh tokens
- **WebRTC Signaling**: Real-time video/audio communication
- **Chat**: Real-time messaging with MongoDB storage
- **Whiteboard**: Collaborative whiteboard with version control
- **File Sharing**: Encrypted file upload/download with S3
- **Room Management**: Create, join, and manage meeting rooms

## Tech Stack

- Node.js 20+ with TypeScript
- Express.js
- Socket.io for WebSocket communication
- PostgreSQL for user data and sessions
- MongoDB for chat and whiteboard history
- Redis for caching and pub/sub
- AWS S3 / MinIO for file storage

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- MongoDB 7+
- Redis 7+
- MinIO or AWS S3

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Update `.env` with your configuration

4. Run database migrations:
```bash
npm run migrate
```

## Development

Start the development server:
```bash
npm run dev
```

The server will run on `http://localhost:3001`

## Building

Build for production:
```bash
npm run build
```

## Running in Production

```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/profile` - Get user profile

### Rooms
- `POST /api/rooms` - Create room
- `GET /api/rooms` - List rooms
- `GET /api/rooms/:roomId` - Get room details
- `POST /api/rooms/:roomId/join` - Join room
- `POST /api/rooms/:roomId/leave` - Leave room
- `POST /api/rooms/:roomId/end` - End room (host only)

### Chat
- `GET /api/chat/:roomId/history` - Get chat history
- `DELETE /api/chat/messages/:messageId` - Delete message
- `PUT /api/chat/messages/:messageId` - Edit message

### Files
- `POST /api/files/upload` - Upload file
- `GET /api/files/:fileId/url` - Get file download URL
- `GET /api/files/room/:roomId` - List room files
- `DELETE /api/files/:fileId` - Delete file

## WebSocket Events

### WebRTC Signaling
- `join-room` - Join a room
- `offer` - Send WebRTC offer
- `answer` - Send WebRTC answer
- `ice-candidate` - Send ICE candidate
- `toggle-media` - Toggle audio/video
- `start-screen-share` - Start screen sharing
- `stop-screen-share` - Stop screen sharing
- `leave-room` - Leave room

### Chat
- `chat-message` - Send chat message
- `typing-start` - User started typing
- `typing-stop` - User stopped typing

### Whiteboard
- `whiteboard-draw` - Draw on whiteboard
- `whiteboard-get-history` - Get whiteboard history

## Docker

Build Docker image:
```bash
docker build -t rtc-backend .
```

Run with Docker Compose (see root docker-compose.yml)

## Environment Variables

See `.env.example` for all required environment variables.

## Security

- Passwords hashed with bcrypt (cost factor 12)
- JWT tokens with short expiration
- httpOnly, secure cookies
- Rate limiting on all endpoints
- Input validation and sanitization
- CORS protection
- Helmet security headers

## License

MIT
