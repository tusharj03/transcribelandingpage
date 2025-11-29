const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    if (!token) return null;

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
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const action = req.query.action;

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        switch (action) {
            case 'create':
                return await handleCreateSubscription(req, res, usersCollection);
            case 'cancel':
                return await handleCancelSubscription(req, res, usersCollection);
            case 'check':
                return await handleCheckSubscription(req, res, usersCollection);
            case 'verify':
                return await handleVerifySubscription(req, res, usersCollection);
            case 'portal':
                return await handleCreatePortalSession(req, res, usersCollection);
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error(`Subscription error (${action}):`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

async function handleCreateSubscription(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, plan, paymentMethodId } = req.body;

    if (!email || !plan || !paymentMethodId) return res.status(400).json({ error: 'Missing required fields' });

    const PLANS = {
        basic: { price: 900, stripePriceId: process.env.STRIPE_BASIC_PRICE_ID },
        pro: { price: 1900, stripePriceId: process.env.STRIPE_PRO_PRICE_ID },
        enterprise: { price: 4900, stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID }
    };

    const selectedPlan = PLANS[plan];
    if (!selectedPlan || !selectedPlan.stripePriceId) return res.status(400).json({ error: 'Invalid plan selected' });

    let customer;
    const existingCustomers = await stripe.customers.list({ email: email, limit: 1 });

    if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
        await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethodId } });
    } else {
        customer = await stripe.customers.create({
            email: email,
            payment_method: paymentMethodId,
            invoice_settings: { default_payment_method: paymentMethodId },
        });
    }

    const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: selectedPlan.stripePriceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        trial_period_days: 14,
    });

    await usersCollection.updateOne(
        { email },
        {
            $set: {
                stripeCustomerId: customer.id,
                stripeSubscriptionId: subscription.id,
                plan: plan,
                status: 'trialing',
                subscribedAt: new Date(),
                currentPeriodEnd: subscription.current_period_end,
                cancelAtPeriodEnd: subscription.cancel_at_period_end
            }
        },
        { upsert: true }
    );

    res.json({
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        status: subscription.status
    });
}

async function handleCancelSubscription(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userAuth = authenticateToken(req);
    if (!userAuth) return res.status(401).json({ error: 'Invalid or missing authentication token' });

    const userData = await usersCollection.findOne({ _id: new ObjectId(userAuth.userId) });
    if (!userData || !userData.stripeSubscriptionId) return res.status(404).json({ error: 'No active subscription found' });

    const subscription = await stripe.subscriptions.update(userData.stripeSubscriptionId, { cancel_at_period_end: true });

    await usersCollection.updateOne(
        { _id: userData._id },
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
        message: 'Subscription scheduled for cancellation at period end',
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end
    });
}

async function handleCheckSubscription(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await usersCollection.findOne({ email });
    if (!user) return res.json({ subscribed: false, error: 'No account found with this email' });

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
}

async function handleVerifySubscription(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await usersCollection.findOne({ email });
    if (!user) return res.json({ subscribed: false, error: 'No account found with this email. Please subscribe first.' });

    const isSubscribed = ['trialing', 'active', 'past_due'].includes(user.status);
    if (!isSubscribed) return res.json({ subscribed: false, error: 'No active subscription found for this email' });

    res.json({
        subscribed: true,
        plan: user.plan,
        status: user.status,
        email: user.email,
        subscribedAt: user.subscribedAt,
        currentPeriodEnd: user.currentPeriodEnd
    });
}

async function handleCreatePortalSession(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userAuth = authenticateToken(req);
    if (!userAuth) return res.status(401).json({ error: 'Authentication required' });

    const user = await usersCollection.findOne({ email: userAuth.email });
    if (!user || !user.stripeCustomerId) return res.status(400).json({ error: 'No billing account found' });

    const returnUrl = `${process.env.BASE_URL || 'https://resonote.vercel.app'}/account.html`;

    const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: returnUrl,
    });

    res.json({ url: portalSession.url });
}
