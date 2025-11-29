const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify Authentication
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }

        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ email: decoded.email });

        if (!user || !user.stripeCustomerId) {
            return res.status(400).json({ error: 'No billing account found' });
        }

        // This is the URL to which the customer will be redirected after they are
        // done managing their billing with the portal.
        // Use the Referer header or default to the base URL
        const returnUrl = `${process.env.BASE_URL || 'https://resonote.vercel.app'}/account.html`;

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: returnUrl,
        });

        res.json({ url: portalSession.url });

    } catch (error) {
        console.error('Portal session error:', error);
        res.status(500).json({ error: 'Failed to create portal session' });
    }
};
