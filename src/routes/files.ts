import { Router } from 'express';
import { uploadFile, uploadMiddleware, getFileUrl, listRoomFiles, deleteFile } from '../controllers/fileController';
import { authenticateToken } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/upload', authenticateToken, uploadLimiter, uploadMiddleware, uploadFile);
router.get('/:fileId/url', authenticateToken, getFileUrl);
router.get('/room/:roomId', authenticateToken, listRoomFiles);
router.delete('/:fileId', authenticateToken, deleteFile);

export default router;
