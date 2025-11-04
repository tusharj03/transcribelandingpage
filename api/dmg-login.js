const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and password required' 
      });
    }

    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    // Check subscription status
    const isSubscribed = ['trialing', 'active', 'past_due'].includes(user.status);
    
    if (!isSubscribed) {
      return res.status(401).json({ 
        success: false,
        error: 'No active subscription found. Please subscribe first.' 
      });
    }

    // Update last login
    await usersCollection.updateOne(
      { email },
      { $set: { lastLogin: new Date() } }
    );
    
    // Create JWT token for DMG app
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email,
        plan: user.plan,
        type: 'dmg_app'
      },
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

  } catch (error) {
    console.error('DMG login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Database error' 
    });
  }
};