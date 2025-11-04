require('dotenv').config();

console.log('Stripe secret:', process.env.STRIPE_SECRET_KEY ? '✅ loaded' : '❌ missing');
console.log('MongoDB URI:', process.env.MONGODB_URI ? '✅ loaded' : '❌ missing');

const express = require('express');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production';

// === MongoDB Setup ===
let db;
let usersCollection, subscriptionsCollection, downloadsCollection;

async function connectToDatabase() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('audio_transcriber');
    
    usersCollection = db.collection('users');
    subscriptionsCollection = db.collection('subscriptions');
    downloadsCollection = db.collection('downloads');
    
    // Create indexes
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await subscriptionsCollection.createIndex({ userEmail: 1 });
    await downloadsCollection.createIndex({ userEmail: 1 });
    
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// === Plan Configuration ===
const PLANS = {
  basic: {
    price: 900,
    name: 'Basic',
    features: ['5 hours transcription/month', 'Audio file support', 'Basic export'],
    stripePriceId: process.env.STRIPE_BASIC_PRICE_ID
  },
  pro: {
    price: 1900,
    name: 'Pro', 
    features: ['20 hours transcription/month', 'Audio & video support', 'Screen recording', 'AI analysis'],
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID
  },
  enterprise: {
    price: 4900,
    name: 'Enterprise',
    features: ['Unlimited transcription', 'All Pro features', 'Team collaboration', 'Custom vocabulary'],
    stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID
  }
};

// === Middleware ===
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// === Routes ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/payment.html', (req, res) => res.sendFile(path.join(__dirname, 'payment.html')));
app.get('/download.html', (req, res) => res.sendFile(path.join(__dirname, 'download.html')));
app.get('/success.html', (req, res) => res.sendFile(path.join(__dirname, 'success.html')));
app.get('/account.html', (req, res) => res.sendFile(path.join(__dirname, 'account.html')));

// Return Stripe publishable key for frontend
app.get('/api/config', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || null;
  if (!publishableKey) return res.status(500).json({ error: 'Stripe not configured' });
  
  res.json({ 
    publishableKey,
    plans: Object.keys(PLANS).reduce((acc, planKey) => {
      acc[planKey] = {
        name: PLANS[planKey].name,
        price: PLANS[planKey].price,
        features: PLANS[planKey].features
      };
      return acc;
    }, {})
  });
});

// User Registration & Login (for website)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check if user exists
    const existingUser = await usersCollection.findOne({ email });
    
    if (existingUser) {
      // User exists, verify password
      const validPassword = await bcrypt.compare(password, existingUser.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      // Update last login
      await usersCollection.updateOne(
        { email },
        { $set: { lastLogin: new Date() } }
      );
      
      // Create session token
      const token = jwt.sign({ 
        userId: existingUser._id, 
        email: existingUser.email 
      }, JWT_SECRET, { expiresIn: '30d' });
      
      res.json({
        success: true,
        user: {
          id: existingUser._id,
          email: existingUser.email,
          plan: existingUser.plan,
          status: existingUser.status
        },
        token
      });
    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const newUser = {
        email,
        password: hashedPassword,
        status: 'inactive',
        plan: 'inactive',
        createdAt: new Date(),
        lastLogin: new Date()
      };
      
      const result = await usersCollection.insertOne(newUser);
      
      const token = jwt.sign({ 
        userId: result.insertedId, 
        email 
      }, JWT_SECRET, { expiresIn: '30d' });
      
      res.json({
        success: true,
        user: {
          id: result.insertedId,
          email,
          plan: 'inactive',
          status: 'inactive'
        },
        token
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle duplicate email error
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Simple email-based login (for website)
app.post('/api/login', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update last login
    await usersCollection.updateOne(
      { email },
      { $set: { lastLogin: new Date() } }
    );
    
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        plan: user.plan,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// DMG App Authentication - Password Free
app.post('/api/dmg-auth', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.json({ 
        authenticated: false,
        error: 'No account found with this email. Please subscribe first.' 
      });
    }

    const isSubscribed = ['trialing', 'active', 'past_due'].includes(user.status);
    
    if (!isSubscribed) {
      return res.json({ 
        authenticated: false,
        error: 'No active subscription found for this email' 
      });
    }

    // Update last login
    await usersCollection.updateOne(
      { email },
      { $set: { lastLogin: new Date() } }
    );
    
    // Create token for DMG app
    const token = jwt.sign({ 
      userId: user._id, 
      email: user.email,
      plan: user.plan 
    }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      authenticated: true,
      user: {
        id: user._id,
        email: user.email,
        plan: user.plan,
        status: user.status,
        subscribedAt: user.subscribedAt
      },
      token
    });
  } catch (error) {
    console.error('DMG auth error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Verify subscription for DMG app
app.post('/api/verify-subscription', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
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
      currentPeriodEnd: user.currentPeriodEnd
    });
  } catch (error) {
    console.error('Verify subscription error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Create Subscription
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { email, plan, paymentMethodId } = req.body;
    
    if (!email || !plan || !paymentMethodId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const selectedPlan = PLANS[plan];
    if (!selectedPlan) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    if (!selectedPlan.stripePriceId) {
      return res.status(500).json({ error: 'Plan not properly configured' });
    }

    // Create or retrieve customer
    let customer;
    const existingCustomers = await stripe.customers.list({
      email: email,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      
      // Attach payment method to existing customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customer.id,
      });

      // Set as default payment method
      await stripe.customers.update(customer.id, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    } else {
      customer = await stripe.customers.create({
        email: email,
        payment_method: paymentMethodId,
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    }

    // Create subscription with trial
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: selectedPlan.stripePriceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      trial_period_days: 14,
    });

    // Create or update user in database
    const existingUser = await usersCollection.findOne({ email });
    
    if (!existingUser) {
      // Auto-create user with default password for DMG app
      const defaultPassword = await bcrypt.hash('welcome123', 10);
      await usersCollection.insertOne({
        email,
        password: defaultPassword,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id,
        plan: plan,
        status: 'trialing',
        subscribedAt: new Date(),
        createdAt: new Date(),
        lastLogin: new Date()
      });
      
      console.log(`✅ Auto-created user account for: ${email}`);
    } else {
      // Update existing user
      await usersCollection.updateOne(
        { email },
        {
          $set: {
            stripeCustomerId: customer.id,
            stripeSubscriptionId: subscription.id,
            plan: plan,
            status: 'trialing',
            subscribedAt: new Date(),
            lastLogin: new Date()
          }
        }
      );
    }

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      status: subscription.status
    });

  } catch (err) {
    console.error('create-subscription error:', err);
    res.status(500).json({ error: err.message || 'Failed to create subscription' });
  }
});

// Check user subscription status (for website)
app.post('/api/check-subscription', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.json({ subscribed: false });
    }

    res.json({
      subscribed: ['trialing', 'active', 'past_due'].includes(user.status),
      plan: user.plan,
      status: user.status,
      subscribedAt: user.subscribedAt,
      email: user.email,
      currentPeriodEnd: user.currentPeriodEnd,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd
    });
  } catch (error) {
    console.error('Check subscription error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Cancel subscription
app.post('/api/cancel-subscription', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    const user = await usersCollection.findOne({ email: userEmail });
    if (!user || !user.stripeSubscriptionId) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const subscription = await stripe.subscriptions.update(
      user.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    // Update database
    await usersCollection.updateOne(
      { email: userEmail },
      { 
        $set: { 
          status: 'canceled',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: subscription.current_period_end
        }
      }
    );

    res.json({
      success: true,
      message: 'Subscription will cancel at period end',
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: subscription.current_period_end
    });

  } catch (err) {
    console.error('cancel-subscription error:', err);
    res.status(500).json({ error: err.message || 'Failed to cancel subscription' });
  }
});

// Get user profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  const userEmail = req.user.email;

  try {
    const user = await usersCollection.findOne({ email: userEmail });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      user: {
        id: user._id,
        email: user.email,
        plan: user.plan,
        status: user.status,
        subscribedAt: user.subscribedAt,
        createdAt: user.createdAt,
        currentPeriodEnd: user.currentPeriodEnd
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Track app download
app.post('/api/track-download', authenticateToken, async (req, res) => {
  const { os, version } = req.body;
  const userEmail = req.user.email;

  try {
    await downloadsCollection.insertOne({
      userEmail,
      os,
      version,
      downloadedAt: new Date()
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Download tracking error:', error);
    res.status(500).json({ error: 'Failed to track download' });
  }
});

// Webhook handler for Stripe events
app.post('/webhook', bodyParser.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`Received event: ${event.type}`);

  // Handle subscription events
  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      const subscription = event.data.object;
      await handleSubscriptionChange(subscription);
      break;
    
    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      await handleSuccessfulPayment(invoice);
      break;
      
    case 'invoice.payment_failed':
      const failedInvoice = event.data.object;
      await handleFailedPayment(failedInvoice);
      break;
  }

  res.json({received: true});
});

async function handleSubscriptionChange(subscription) {
  let status = subscription.status;
  if (subscription.cancel_at_period_end) {
    status = 'canceled';
  }

  try {
    await usersCollection.updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          status: status,
          plan: subscription.items.data[0]?.price.nickname || 'pro',
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end
        }
      }
    );
    
    console.log(`Updated subscription ${subscription.id} to status: ${status}`);
  } catch (error) {
    console.error('Error updating subscription status:', error);
  }
}

async function handleSuccessfulPayment(invoice) {
  console.log(`Payment succeeded for invoice ${invoice.id}`);
  
  // Update user status if it was past_due
  try {
    await usersCollection.updateOne(
      { stripeCustomerId: invoice.customer },
      { $set: { status: 'active' } }
    );
  } catch (error) {
    console.error('Error updating user status after payment:', error);
  }
}

async function handleFailedPayment(invoice) {
  console.log(`Payment failed for invoice ${invoice.id}`);
  
  // Update user status to past_due
  try {
    await usersCollection.updateOne(
      { stripeCustomerId: invoice.customer },
      { $set: { status: 'past_due' } }
    );
  } catch (error) {
    console.error('Error updating user status after failed payment:', error);
  }
}

// Developer bypass endpoint
app.post('/api/developer-bypass', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ success: false, error: 'Missing email or code' });

  const expected = process.env.DEV_BYPASS_CODE || 'dev123';
  if (code === expected) {
    // Create or update user with active subscription
    try {
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
      res.status(500).json({ success: false, error: 'Database error' });
    }
  } else {
    res.status(401).json({ success: false, error: 'Invalid developer code' });
  }
});

// === Start server ===
async function startServer() {
  await connectToDatabase();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server listening: http://localhost:${PORT}`);
    console.log(`💳 Stripe secret loaded: ${process.env.STRIPE_SECRET_KEY ? '✅' : '❌'}`);
    console.log(`🗄️ MongoDB connected: ✅`);
    console.log(`🔑 JWT secret: ${JWT_SECRET !== 'your-jwt-secret-key-change-in-production' ? '✅' : '❌'}`);
    console.log(`📊 Database: MongoDB (${process.env.MONGODB_URI})`);
  });
}

startServer().catch(console.error);