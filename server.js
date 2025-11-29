require('dotenv').config();

console.log('Stripe secret:', process.env.STRIPE_SECRET_KEY ? '✅ loaded' : '❌ missing');
console.log('MongoDB URI:', process.env.MONGODB_URI ? '✅ loaded' : '❌ missing');
console.log('JWT secret:', process.env.JWT_SECRET ? '✅ loaded' : '❌ missing');

const express = require('express');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

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

// === Email Configuration ===
const emailTransporter = nodemailer.createTransport({
  service: 'gmail', // Use service name instead of host/port
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  connectionTimeout: 10000, // 10 seconds
  socketTimeout: 10000
});

// Add this test endpoint to debug email issues
// Add this endpoint to debug email setup
app.get('/api/debug-email-config', (req, res) => {
  const config = {
    SMTP_USER: process.env.SMTP_USER ? '✅ Set' : '❌ Missing',
    SMTP_PASS: process.env.SMTP_PASS ? '✅ Set' : '❌ Missing',
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: process.env.SMTP_PORT || 587,
    BASE_URL: process.env.BASE_URL || 'Not set',
    NODE_ENV: process.env.NODE_ENV || 'Not set'
  };

  console.log('🔧 Email Configuration:', config);
  res.json(config);
});

// === Middleware ===
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

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
app.get('/verify-email.html', (req, res) => res.sendFile(path.join(__dirname, 'verify-email.html')));
app.get('/reset-password.html', (req, res) => res.sendFile(path.join(__dirname, 'reset-password.html')));

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

// User Registration with Email Verification
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Check if user exists
    const existingUser = await usersCollection.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create verification token
    const verificationToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });

    // Create new user
    const newUser = {
      email,
      password: hashedPassword,
      status: 'unverified',
      plan: 'inactive',
      verificationToken,
      emailVerified: false,
      createdAt: new Date(),
      lastLogin: null
    };

    const result = await usersCollection.insertOne(newUser);

    // Send verification email
    await sendVerificationEmail(email, verificationToken);

    res.json({
      success: true,
      message: 'Registration successful! Please check your email for verification.',
      user: {
        id: result.insertedId,
        email,
        status: 'unverified',
        plan: 'inactive',
        emailVerified: false
      }
    });

  } catch (error) {
    console.error('Registration error:', error);

    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    console.error('Email send failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Email verification endpoint
app.post('/api/verify-email', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Verification token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await usersCollection.findOne({
      email: decoded.email,
      verificationToken: token
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    // Update user as verified
    await usersCollection.updateOne(
      { email: decoded.email },
      {
        $set: {
          emailVerified: true,
          verificationToken: null,
          status: 'inactive' // Change from unverified to inactive
        }
      }
    );

    res.json({
      success: true,
      message: 'Email verified successfully! You can now log in.'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(400).json({ error: 'Invalid or expired verification token' });
  }
});

// Send verification email
app.post('/api/send-verification-email', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    // Generate new verification token
    const verificationToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });

    // Update user with new token
    await usersCollection.updateOne(
      { email },
      { $set: { verificationToken } }
    );

    // Send verification email
    await sendVerificationEmail(email, verificationToken);

    res.json({
      success: true,
      message: 'Verification email sent successfully!'
    });

  } catch (error) {
    console.error('Send verification email error:', error);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// Password reset request
// Fixed password reset endpoint
app.post('/api/request-password-reset', async (req, res) => {
  console.log('🔑 Password reset requested for:', req.body?.email);

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const user = await usersCollection.findOne({ email });

    if (!user) {
      // Don't reveal whether email exists
      console.log('📧 User not found, but returning success for security');
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = jwt.sign({
      userId: user._id,
      email: user.email
    }, JWT_SECRET, { expiresIn: '1h' });

    // Store reset token
    await usersCollection.updateOne(
      { email },
      {
        $set: {
          resetToken,
          resetTokenExpires: new Date(Date.now() + 3600000) // 1 hour
        }
      }
    );

    console.log('📧 Attempting to send reset email to:', email);

    // Send reset email
    await sendPasswordResetEmail(email, resetToken);

    console.log('✅ Password reset email sent successfully');

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });

  } catch (error) {
    console.error('❌ Password reset request error:', error);
    console.error('❌ Error stack:', error.stack);

    // More detailed error response
    res.status(500).json({
      error: 'Failed to process password reset request',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Please try again later'
    });
  }
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await usersCollection.findOne({
      email: decoded.email,
      resetToken: token,
      resetTokenExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Validate new password
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password and clear reset token
    await usersCollection.updateOne(
      { email: decoded.email },
      {
        $set: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpires: null
        }
      }
    );

    res.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.'
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(400).json({ error: 'Invalid or expired reset token' });
  }
});

// Website Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if email is verified
    if (!user.emailVerified) {
      return res.status(401).json({ error: 'Please verify your email address before logging in' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await usersCollection.updateOne(
      { email },
      { $set: { lastLogin: new Date() } }
    );

    // Create session token
    const token = jwt.sign({
      userId: user._id,
      email: user.email
    }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        plan: user.plan,
        status: user.status,
        emailVerified: user.emailVerified
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Enhanced DMG App Login with better error handling
app.post('/api/dmg-login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password required'
    });
  }

  try {
    console.log('🔐 DMG Login attempt for:', email);

    const user = await usersCollection.findOne({ email });

    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if user has any password (for existing users without passwords)
    if (!user.password) {
      console.log('🔑 No password set for user, creating one...');
      // Auto-create password for existing users
      const hashedPassword = await bcrypt.hash('welcome123', 12);
      await usersCollection.updateOne(
        { email },
        { $set: { password: hashedPassword } }
      );
      user.password = hashedPassword;
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('❌ Invalid password for:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check subscription status - allow login even without active subscription
    const isSubscribed = ['trialing', 'active', 'past_due'].includes(user.status);

    if (!isSubscribed) {
      console.log('⚠️ No active subscription for:', email);
      // Don't block login, just inform user
      // They can still use the app but with limited features
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
      plan: user.plan,
      status: user.status
    }, JWT_SECRET, { expiresIn: '30d' });

    console.log('✅ DMG Login successful for:', email);

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        plan: user.plan,
        status: user.status,
        subscribedAt: user.subscribedAt,
        currentPeriodEnd: user.currentPeriodEnd,
        hasActiveSubscription: isSubscribed
      },
      token
    });

  } catch (error) {
    console.error('❌ DMG login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login service temporarily unavailable. Please try again.'
    });
  }
});

// Simple email-based login (legacy - for backward compatibility)
app.post('/api/simple-login', async (req, res) => {
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

// DMG App Authentication - Password Free (legacy)
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

    // Check if user exists and is verified
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser && !existingUser.emailVerified) {
      return res.status(400).json({ error: 'Please verify your email address before subscribing' });
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
        emailVerified: true, // Auto-verify for subscription flow
        subscribedAt: new Date(),
        createdAt: new Date(),
        lastLogin: new Date()
      });

      console.log(`✅ Auto-created user account for: ${email}`);
    }

    res.json({
      success: true,
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret
    });

  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ error: error.message });
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
        emailVerified: user.emailVerified,
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
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
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

  res.json({ received: true });
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

// Email sending functions
async function sendVerificationEmail(email, token) {
  const verificationUrl = `${process.env.BASE_URL || 'https://audiotranscriberlanding.vercel.app'}/verify-email.html?token=${token}`;

  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@audiotranscriberpro.com',
      to: email,
      subject: 'Verify Your Audio Transcriber Pro Account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Verify Your Email Address</h2>
          <p>Thank you for creating an account with Audio Transcriber Pro!</p>
          <p>Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Verify Email Address
            </a>
          </div>
          <p>Or copy and paste this link in your browser:</p>
          <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create an account, please ignore this email.</p>
        </div>
      `
    });
    console.log(`✅ Verification email sent to: ${email}`);
  } catch (error) {
    console.error('❌ Failed to send verification email:', error.response || error);
  }
}

async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${process.env.BASE_URL || 'https://audiotranscriberlanding.vercel.app'}/reset-password.html?token=${token}`;

  console.log('📧 Preparing to send email to:', email);
  console.log('🔗 Reset URL:', resetUrl);

  try {
    // Test SMTP connection first
    await emailTransporter.verify();
    console.log('✅ SMTP connection verified');

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Reset Your Audio Transcriber Pro Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Reset Your Password</h2>
          <p>We received a request to reset your password for your Audio Transcriber Pro account.</p>
          <p>Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>Or copy and paste this link in your browser:</p>
          <p style="word-break: break-all; color: #666;">${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request a password reset, please ignore this email.</p>
        </div>
      `
    };

    console.log('📤 Sending email...');
    const result = await emailTransporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', result.messageId);
    return true;

  } catch (error) {
    console.error('❌ Email sending failed:', error);
    console.error('❌ SMTP error details:', {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode
    });
    throw error; // Re-throw to be handled by the endpoint
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
            emailVerified: true,
            subscribedAt: new Date(),
            lastLogin: new Date()
          },
          $setOnInsert: {
            password: await bcrypt.hash('dev123', 12),
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
    console.log(`📧 Email configured: ${process.env.SMTP_USER ? '✅' : '❌'}`);
    console.log(`📊 Database: MongoDB (${process.env.MONGODB_URI})`);
  });
}

startServer().catch(console.error);