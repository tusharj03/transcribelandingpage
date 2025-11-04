const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
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
    const { email, code } = req.body;
    
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Missing email or code' });
    }

    if (code !== DEV_BYPASS_CODE) {
      return res.status(401).json({ success: false, error: 'Invalid developer code' });
    }

    const db = await connectToDatabase();
    const usersCollection = db.collection('users');

    // Create or update user with active subscription
    await usersCollection.updateOne(
      { email },
      {
        $set: {
          plan: 'pro',
          status: 'active',
          subscribedAt: new Date(),
          lastLogin: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log(`🔓 Developer bypass granted for ${email}`);
    res.json({ success: true, message: 'Developer access granted' });

  } catch (error) {
    console.error('Developer bypass error:', error);
    res.status(500).json({ success: false, error: 'Database error: ' + error.message });
  }
};