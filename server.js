// server.js
require('dotenv').config(); // MUST be first so env vars exist before requiring stripe

console.log('Stripe secret:', process.env.STRIPE_SECRET_KEY ? '✅ loaded' : '❌ missing');

const express = require('express');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// === Plan prices (server authoritative) ===
const PLAN_PRICES = {
  basic: 900,      // $9.00
  pro: 1900,       // $19.00
  enterprise: 4900 // $49.00
};

// === Middleware ===
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === Routes ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/payment.html', (req, res) => res.sendFile(path.join(__dirname, 'payment.html')));
app.get('/download.html', (req, res) => res.sendFile(path.join(__dirname, 'download.html')));

// Return Stripe publishable key for frontend
app.get('/api/config', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || null;
  if (!publishableKey) return res.status(500).json({ error: 'Stripe not configured' });
  res.json({ publishableKey });
});

// Create PaymentIntent
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { email, plan } = req.body;
    if (!email || !plan) return res.status(400).json({ error: 'Missing email or plan' });

    const amount = PLAN_PRICES[plan];
    if (!amount) return res.status(400).json({ error: 'Invalid plan' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      receipt_email: email,
      metadata: { plan, customer_email: email }
    });

    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (err) {
  console.error('create-payment-intent error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
}

});

// Verify payment
app.post('/api/payment-success', async (req, res) => {
  try {
    const { paymentIntentId, email, plan } = req.body;
    if (!paymentIntentId || !email || !plan) return res.status(400).json({ error: 'Missing parameters' });

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status === 'succeeded') {
      console.log(`✅ Payment verified for ${email} (plan=${plan}, id=${paymentIntentId})`);
      return res.json({ success: true, message: 'Payment verified', paymentId: paymentIntent.id });
    } else {
      return res.status(400).json({ success: false, error: `Payment not completed: ${paymentIntent.status}` });
    }
  } catch (err) {
    console.error('payment-success error:', err);
    return res.status(500).json({ error: 'Error verifying payment' });
  }
});

// Developer bypass endpoint
app.post('/api/developer-bypass', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ success: false, error: 'Missing email or code' });

  const expected = process.env.DEV_BYPASS_CODE || '';
  if (!expected) return res.status(500).json({ success: false, error: 'Developer bypass not available' });

  if (code === expected) {
    console.log(`🔓 Developer bypass granted for ${email}`);
    return res.json({ success: true, message: 'Developer access granted' });
  } else {
    return res.status(401).json({ success: false, error: 'Invalid developer code' });
  }
});

// === Optional Stripe webhook (commented) ===
// const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
// if (webhookSecret) {
//   app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
//     const sig = req.headers['stripe-signature'];
//     let event;
//     try {
//       event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
//     } catch (err) {
//       console.error('Webhook signature verification failed:', err.message);
//       return res.status(400).send(`Webhook Error: ${err.message}`);
//     }
//     switch (event.type) {
//       case 'payment_intent.succeeded':
//         console.log('Webhook: PaymentIntent succeeded', event.data.object.id);
//         break;
//       default:
//         console.log(`Webhook: unhandled event type ${event.type}`);
//     }
//     res.json({ received: true });
//   });
// }

// === Start server ===
app.listen(PORT, () => {
  console.log(`🚀 Server listening: http://localhost:${PORT}`);
  console.log(`💳 Stripe secret loaded: ${process.env.STRIPE_SECRET_KEY ? '✅' : '❌'}`);
  console.log(`🔑 Publishable key loaded: ${process.env.STRIPE_PUBLISHABLE_KEY ? '✅' : '❌'}`);
  console.log(`🔧 Dev bypass configured: ${process.env.DEV_BYPASS_CODE ? '✅' : '❌'}`);
});

// === Process-level error logging ===
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('unhandledRejection', (reason, p) => console.error('Unhandled Rejection at:', p, 'reason:', reason));
