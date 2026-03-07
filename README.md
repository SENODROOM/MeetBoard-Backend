# ⬡ QuantumMeet Server

The backend signaling server and REST API for **QuantumMeet**. This Node.js server acts as the central hub for room orchestration, Socket.io signaling (for WebRTC handshakes), state synchronization, and database persistence.

## ⚙️ Core Responsibilities

1. **Signaling Server**: Coordinates the exchange of SDP Offers, Answers, and ICE Candidates between peers to establish P2P WebRTC connections.
2. **Room Management**: Keeps track of active users, host status, and metadata per active session.
3. **State Synchronization**: Relays events for Chat Messages, Polls, Q&A, Hand raising, and video/audio toggle states.
4. **Database Persistence**: Stores room histories, settings, and optionally manages authentication against a MongoDB instance.

## 🛠️ Built With

- **Node.js**
- **Express.js** (for REST endpoints)
- **Socket.io** (for WebSockets)
- **Mongoose / MongoDB** (for persistence)

## 🚀 Running The Server Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Establish `.env` variables:
   ```bash
   cp .env.example .env
   ```
   Provide a valid `MONGO_URI` (though the server will fallback gracefully if MongoDB is uncontactable). Ensure `PORT` and `CLIENT_URL` are set.

3. Start server in development mode:
   ```bash
   npm run dev
   ```
   Starts `nodemon` to watch for file changes automatically. The server runs on `http://localhost:5000` by default.

---

<p align="center">The core engine powering QuantumMeet.</p>
