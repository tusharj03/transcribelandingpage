export default function handler(req, res) {
  res.status(200).json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_XXXX',
    devBypassCode: process.env.DEV_BYPASS_CODE || ''
  });
}
