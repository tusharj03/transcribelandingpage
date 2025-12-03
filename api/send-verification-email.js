const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');
const emailService = require('../email-service');

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

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.emailVerified) {
            return res.status(400).json({ error: 'Email already verified' });
        }

        // Generate new verification token
        const verificationToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });

        // Update user with new token
        await usersCollection.updateOne(
            { email },
            { $set: { verificationToken } }
        );

        // Send verification email
        await emailService.sendVerificationEmail(email, verificationToken);

        res.json({
            success: true,
            message: 'Verification email sent successfully!'
        });

    } catch (error) {
        console.error('Send verification email error:', error);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
};
