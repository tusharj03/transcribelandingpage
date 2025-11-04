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

  try {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || null;
    
    if (!publishableKey) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const PLANS = {
      basic: {
        price: 900,
        name: 'Basic',
        features: ['5 hours transcription/month', 'Audio file support', 'Basic export']
      },
      pro: {
        price: 1900,
        name: 'Pro', 
        features: ['20 hours transcription/month', 'Audio & video support', 'Screen recording', 'AI analysis']
      },
      enterprise: {
        price: 4900,
        name: 'Enterprise',
        features: ['Unlimited transcription', 'All Pro features', 'Team collaboration', 'Custom vocabulary']
      }
    };

    res.json({ 
      publishableKey,
      plans: PLANS
    });
  } catch (error) {
    console.error('Config error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};