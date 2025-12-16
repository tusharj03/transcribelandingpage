const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const emailService = require('../email-service');

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production';
const DEV_BYPASS_CODE = process.env.DEV_BYPASS_CODE || 'dev123';

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

function authenticateToken(req) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return null;

    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const action = req.query.action;

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        switch (action) {
            case 'login':
                return await handleLogin(req, res, usersCollection);
            case 'register':
                return await handleRegister(req, res, usersCollection);
            case 'dmg-login':
                return await handleDmgLogin(req, res, usersCollection);
            case 'user-profile':
                return await handleUserProfile(req, res, usersCollection);
            case 'developer-bypass':
                return await handleDeveloperBypass(req, res, usersCollection);
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error(`Auth error (${action}):`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

async function handleLogin(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    // Check if email is verified
    if (!user.emailVerified) {
        return res.status(401).json({ error: 'Please verify your email address before logging in' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid email or password' });

    await usersCollection.updateOne({ email }, { $set: { lastLogin: new Date() } });

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
        success: true,
        user: {
            id: user._id,
            email: user.email,
            plan: user.plan,
            status: user.status,
            subscribedAt: user.subscribedAt,
            currentPeriodEnd: user.currentPeriodEnd,
            emailVerified: user.emailVerified
        },
        token
    });
}

async function handleRegister(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long' });

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const verificationToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });

    const user = {
        email,
        password: hashedPassword,
        status: 'unverified',
        plan: 'inactive',
        createdAt: new Date(),
        lastLogin: null,
        emailVerified: false,
        verificationToken,
        signupMetadata: getSignupMetadata(req)
    };

    const result = await usersCollection.insertOne(user);

    // Send verification email
    try {
        await emailService.sendVerificationEmail(email, verificationToken);
    } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        // Continue even if email fails, user can resend later
    }

    // We don't return a login token anymore, user must verify first
    res.json({
        success: true,
        message: 'Registration successful! Please check your email for verification.',
        user: {
            id: result.insertedId,
            email: user.email,
            status: user.status,
            plan: user.plan,
            emailVerified: false
        }
    });
}

async function handleDmgLogin(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const isSubscribed = ['trialing', 'active', 'past_due'].includes(user.status);
    if (!isSubscribed) return res.status(401).json({ success: false, error: 'No active subscription found. Please subscribe first.' });

    await usersCollection.updateOne({ email }, { $set: { lastLogin: new Date() } });

    const token = jwt.sign(
        { userId: user._id, email: user.email, plan: user.plan, type: 'dmg_app' },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    res.json({
        success: true,
        user: {
            id: user._id,
            email: user.email,
            plan: user.plan,
            status: user.status,
            subscribedAt: user.subscribedAt,
            currentPeriodEnd: user.currentPeriodEnd
        },
        token
    });
}

async function handleUserProfile(req, res, usersCollection) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userAuth = authenticateToken(req);
    if (!userAuth) return res.status(401).json({ error: 'Invalid or missing authentication token' });

    const userData = await usersCollection.findOne(
        { _id: new ObjectId(userAuth.userId) },
        { projection: { password: 0, resetToken: 0, resetTokenExpires: 0 } }
    );

    if (!userData) return res.status(404).json({ error: 'User not found' });

    res.json({
        user: {
            id: userData._id,
            email: userData.email,
            plan: userData.plan,
            status: userData.status,
            subscribedAt: userData.subscribedAt,
            currentPeriodEnd: userData.currentPeriodEnd,
            cancelAtPeriodEnd: userData.cancelAtPeriodEnd,
            createdAt: userData.createdAt,
            lastLogin: userData.lastLogin
        }
    });
}

async function handleDeveloperBypass(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, code } = req.body;

    if (!email || !code) return res.status(400).json({ success: false, error: 'Missing email or code' });
    if (code !== DEV_BYPASS_CODE) return res.status(401).json({ success: false, error: 'Invalid developer code' });

    await usersCollection.updateOne(
        { email },
        {
            $set: {
                plan: 'pro',
                status: 'active',
                subscribedAt: new Date(),
                lastLogin: new Date()
            },
            $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
    );

    res.json({ success: true, message: 'Developer access granted' });
}

function getSignupMetadata(req) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';

    // Vercel specific headers for location
    const city = req.headers['x-vercel-ip-city'] || null;
    const country = req.headers['x-vercel-ip-country'] || null;
    const region = req.headers['x-vercel-ip-country-region'] || null;

    let os = 'Unknown';
    if (userAgent.includes('Mac')) os = 'Mac';
    else if (userAgent.includes('Win')) os = 'Windows';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

    return {
        ip,
        userAgent,
        os,
        location: {
            city,
            country,
            region
        }
    };
}
