import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../types';

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const token = req.cookies?.accessToken || req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        req.user = {
            id: decoded.userId,
            email: decoded.email,
            username: decoded.username,
        };

        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

export const verifyToken = async (token: string): Promise<any> => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        return {
            id: decoded.userId,
            email: decoded.email,
            username: decoded.username,
        };
    } catch (error) {
        throw new Error('Invalid token');
    }
};
