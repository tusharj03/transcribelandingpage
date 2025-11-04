// pages/api/config.js (or wherever your API route is)
export default function handler(req, res) {
  try {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    const devBypassCode = process.env.DEV_BYPASS_CODE || '';

    if (!publishableKey) {
      console.warn('⚠️ STRIPE_PUBLISHABLE_KEY is not set.');
    }

    res.status(200).json({
      publishableKey: publishableKey || 'pk_test_XXXX', // fallback to test key
      devBypassCode
    });
  } catch (error) {
    console.error('Error in /api/config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
