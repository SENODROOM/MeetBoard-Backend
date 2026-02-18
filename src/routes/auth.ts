import { Router } from 'express';
import { register, login, logout, refreshAccessToken, getProfile } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', authenticateToken, logout);
router.post('/refresh', refreshAccessToken);
router.get('/profile', authenticateToken, getProfile);

export default router;
