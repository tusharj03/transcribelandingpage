const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-change-in-production';

let cachedDb = null;

const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

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

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const action = req.query.action;

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        switch (action) {
            case 'request-reset':
                return await handleRequestReset(req, res, usersCollection);
            case 'reset':
                return await handleResetPassword(req, res, usersCollection);
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error(`Password error (${action}):`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

async function handleRequestReset(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await usersCollection.findOne({ email });

    if (!user) {
        return res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    const resetToken = jwt.sign(
        { userId: user._id, email: user.email, type: 'password_reset' },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    await usersCollection.updateOne(
        { email },
        { $set: { resetToken, resetTokenExpires: new Date(Date.now() + 3600000) } }
    );

    const resetUrl = `${process.env.BASE_URL || 'https://resonote-ai.vercel.app'}/reset-password.html?token=${resetToken}`;

    try {
        await emailTransporter.sendMail({
            from: process.env.SMTP_FROM || 'noreply@audiotranscriberpro.com',
            to: email,
            subject: 'Reset Your Password - Resonote',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Reset Your Password</h2>
          <p>We received a request to reset your password for your Resonote account.</p>
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
        });
    } catch (emailError) {
        console.error('Failed to send reset email:', emailError);
    }

    res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
}

async function handleResetPassword(req, res, usersCollection) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { token, newPassword } = req.body;

    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long' });

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (decoded.type !== 'password_reset') return res.status(400).json({ error: 'Invalid token type' });

    const user = await usersCollection.findOne({
        _id: new ObjectId(decoded.userId),
        resetToken: token,
        resetTokenExpires: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await usersCollection.updateOne(
        { _id: user._id },
        {
            $set: { password: hashedPassword, lastLogin: new Date() },
            $unset: { resetToken: "", resetTokenExpires: "" }
        }
    );

    res.json({ success: true, message: 'Password reset successfully! You can now log in with your new password.' });
}
