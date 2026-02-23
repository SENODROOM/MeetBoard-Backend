import { Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Pool } from 'pg';
import { pgPool } from '../config/database';
import { AuthRequest } from '../types';

export const register = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { email, username, password } = req.body;

        // Validate input
        if (!email || !username || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (password.length < 12) {
            return res.status(400).json({ error: 'Password must be at least 12 characters' });
        }

        // Check if user exists
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'User already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const result = await client.query(
            `INSERT INTO users (email, username, password_hash) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, username, created_at`,
            [email, username, passwordHash]
        );

        const user = result.rows[0];

        res.status(201).json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                createdAt: user.created_at,
            },
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    } finally {
        client.release();
    }
};

export const login = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const result = await client.query(
            'SELECT id, email, username, password_hash FROM users WHERE email = $1 AND is_active = true',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate tokens
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET!,
            { expiresIn: '15m' }
        );

        const refreshToken = jwt.sign(
            { userId: user.id },
            process.env.JWT_REFRESH_SECRET!,
            { expiresIn: '7d' }
        );

        // Save session
        const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await client.query(
            `INSERT INTO sessions (user_id, token_hash, refresh_token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
            [user.id, tokenHash, refreshTokenHash, expiresAt, req.ip, req.headers['user-agent']]
        );

        // Update last login
        await client.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );

        // Set httpOnly cookies
        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000,
        });

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    } finally {
        client.release();
    }
};

export const logout = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const token = req.cookies?.accessToken;

        if (token) {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            await client.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
        }

        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    } finally {
        client.release();
    }
};

export const refreshAccessToken = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const refreshToken = req.cookies?.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }

        // Verify refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any;

        // Check if session exists
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const sessionResult = await client.query(
            'SELECT user_id FROM sessions WHERE refresh_token_hash = $1',
            [refreshTokenHash]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(403).json({ error: 'Invalid refresh token' });
        }

        // Get user
        const userResult = await client.query(
            'SELECT id, email, username FROM users WHERE id = $1 AND is_active = true',
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(403).json({ error: 'User not found' });
        }

        const user = userResult.rows[0];

        // Generate new access token
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET!,
            { expiresIn: '15m' }
        );

        // Update session
        const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await client.query(
            'UPDATE sessions SET token_hash = $1, expires_at = $2 WHERE refresh_token_hash = $3',
            [tokenHash, expiresAt, refreshTokenHash]
        );

        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000,
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(403).json({ error: 'Token refresh failed' });
    } finally {
        client.release();
    }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
    const client = await pgPool.connect();

    try {
        const result = await client.query(
            'SELECT id, email, username, created_at, last_login FROM users WHERE id = $1',
            [req.user!.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    } finally {
        client.release();
    }
};
