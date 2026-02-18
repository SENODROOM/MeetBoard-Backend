import { Router } from 'express';
import { createRoom, getRoom, listRooms, joinRoom, leaveRoom, endRoom } from '../controllers/roomController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/', authenticateToken, createRoom);
router.get('/', authenticateToken, listRooms);
router.get('/:roomId', authenticateToken, getRoom);
router.post('/:roomId/join', authenticateToken, joinRoom);
router.post('/:roomId/leave', authenticateToken, leaveRoom);
router.post('/:roomId/end', authenticateToken, endRoom);

export default router;
