const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
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
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.json({ 
        subscribed: false, 
        error: 'No account found with this email' 
      });
    }

    const isSubscribed = ['trialing', 'active', 'past_due'].includes(user.status);
    
    res.json({
      subscribed: isSubscribed,
      plan: user.plan,
      status: user.status,
      email: user.email,
      subscribedAt: user.subscribedAt,
      currentPeriodEnd: user.currentPeriodEnd,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd
    });
  } catch (error) {
    console.error('Check subscription error:', error);
    res.status(500).json({ error: 'Database error' });
  }
};