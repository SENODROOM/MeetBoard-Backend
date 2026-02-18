import { Router } from 'express';
import { getChatHistory, deleteMessage, editMessage } from '../controllers/chatController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/:roomId/history', authenticateToken, getChatHistory);
router.delete('/messages/:messageId', authenticateToken, deleteMessage);
router.put('/messages/:messageId', authenticateToken, editMessage);

export default router;
