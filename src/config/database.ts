import { Pool } from 'pg';
import mongoose from 'mongoose';
import { createClient } from 'redis';

// PostgreSQL connection
export const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// MongoDB connection
export const connectMongoDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI!);
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

// Redis connection
export const redisClient = createClient({
    url: process.env.REDIS_URL,
});

export const connectRedis = async () => {
    try {
        await redisClient.connect();
        console.log('Redis connected successfully');
    } catch (error) {
        console.error('Redis connection error:', error);
        process.exit(1);
    }
};

redisClient.on('error', (err) => console.error('Redis Client Error', err));
