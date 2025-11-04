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

function authenticateToken(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return null;
  }

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
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = authenticateToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or missing authentication token' });
    }

    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    
    const userData = await usersCollection.findOne(
      { _id: new require('mongodb').ObjectId(user.userId) },
      { projection: { password: 0, resetToken: 0, resetTokenExpires: 0 } } // Exclude sensitive fields
    );

    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

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

  } catch (error) {
    console.error('User profile error:', error);
    res.status(500).json({ error: 'Database error' });
  }
};