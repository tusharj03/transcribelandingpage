const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production';

let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }
    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db('audio_transcriber');
    cachedDb = db;
    return db;
}

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Verification token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        // First find user by email only
        const user = await usersCollection.findOne({ email: decoded.email });

        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        // Check if already verified
        if (user.emailVerified) {
            return res.json({
                success: true,
                message: 'Email already verified! You can log in.'
            });
        }

        // Now check token match
        if (user.verificationToken !== token) {
            return res.status(400).json({ error: 'Invalid or expired verification token' });
        }

        // Update user as verified
        await usersCollection.updateOne(
            { email: decoded.email },
            {
                $set: {
                    emailVerified: true,
                    verificationToken: null,
                    status: 'active', // Set to active
                    plan: 'pro'      // Set to pro plan (Free Pro for everyone)
                }
            }
        );

        // Generate session token for auto-login
        const autologinToken = jwt.sign({
            userId: user._id,
            email: user.email
        }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            message: 'Email verified successfully! Logging you in...',
            token: autologinToken,
            user: {
                id: user._id,
                email: user.email,
                plan: 'pro',
                status: 'active',
                emailVerified: true
            }
        });

    } catch (error) {
        console.error('Email verification error:', error);
        res.status(400).json({ error: 'Invalid or expired verification token' });
    }
};
