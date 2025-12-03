const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = null;
        this.isConfigured = false;
        this.initializeTransporter();
    }

    initializeTransporter() {
        // Try multiple email service configurations
        const configs = [
            // Gmail with App Password
            {
                service: 'gmail',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            },
            // SMTP with environment variables
            {
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT || 587,
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            },
            // SendGrid
            {
                host: 'smtp.sendgrid.net',
                port: 587,
                auth: {
                    user: 'apikey',
                    pass: process.env.SENDGRID_API_KEY
                }
            }
        ];

        for (const config of configs) {
            try {
                this.transporter = nodemailer.createTransport(config);
                this.isConfigured = true;
                console.log('✅ Email service configured successfully');
                break;
            } catch (error) {
                console.log('❌ Email config failed:', config.service || config.host);
            }
        }

        if (!this.isConfigured) {
            console.log('⚠️ No email service configured - emails will be logged to console');
        }
    }

    async sendVerificationEmail(email, token) {
        const verificationUrl = `${process.env.BASE_URL || 'https://resonote-ai.vercel.app'}/verify-email.html?token=${token}`;

        const mailOptions = {
            from: process.env.SMTP_FROM || 'tusharj2004@gmail.com',
            to: email,
            subject: 'Verify Your Resonote Account',
            html: this.getVerificationTemplate(verificationUrl)
        };

        return await this.sendEmail(mailOptions);
    }

    async sendPasswordResetEmail(email, token) {
        const resetUrl = `${process.env.BASE_URL || 'https://resonote-ai.vercel.app'}/reset-password.html?token=${token}`;

        const mailOptions = {
            from: process.env.SMTP_FROM || 'tusharj2004@gmail.com',
            to: email,
            subject: 'Reset Your Password - Resonote',
            html: this.getPasswordResetTemplate(resetUrl)
        };

        return await this.sendEmail(mailOptions);
    }

    async sendEmail(mailOptions) {
        if (!this.isConfigured) {
            // Log email to console in development
            console.log('📧 Email would be sent:', {
                to: mailOptions.to,
                subject: mailOptions.subject,
                url: mailOptions.html.match(/https?:\/\/[^\s"]+/)?.[0] || 'No URL found'
            });
            return { success: true, devMode: true };
        }

        try {
            await this.transporter.verify();
            const result = await this.transporter.sendMail(mailOptions);
            console.log('✅ Email sent successfully to:', mailOptions.to);
            return { success: true, messageId: result.messageId };
        } catch (error) {
            console.error('❌ Email sending failed:', error);
            return { success: false, error: error.message };
        }
    }

    getVerificationTemplate(verificationUrl) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Inter', Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2D7FD3; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0; }
                .button { background: #2D7FD3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; }
                .footer { text-align: center; margin-top: 20px; color: #64748b; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Resonote</h1>
                </div>
                <div class="content">
                    <h2>Verify Your Email Address</h2>
                    <p>Thank you for creating an account with Resonote!</p>
                    <p>Please click the button below to verify your email address:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${verificationUrl}" class="button" style="color: #ffffff !important;">Verify Email Address</a>
                    </div>
                    <p>Or copy and paste this link in your browser:</p>
                    <p style="word-break: break-all; color: #666; background: #f1f5f9; padding: 10px; border-radius: 5px;">
                        ${verificationUrl}
                    </p>
                    <p>This link will expire in 24 hours.</p>
                    <p>If you didn't create an account, please ignore this email.</p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 Resonote. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    getPasswordResetTemplate(resetUrl) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Inter', Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #2D7FD3; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0; }
                .button { background: #2D7FD3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; }
                .footer { text-align: center; margin-top: 20px; color: #64748b; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Resonote</h1>
                </div>
                <div class="content">
                    <h2>Reset Your Password</h2>
                    <p>We received a request to reset your password for your Resonote account.</p>
                    <p>Click the button below to reset your password:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetUrl}" class="button">Reset Password</a>
                    </div>
                    <p>Or copy and paste this link in your browser:</p>
                    <p style="word-break: break-all; color: #666; background: #f1f5f9; padding: 10px; border-radius: 5px;">
                        ${resetUrl}
                    </p>
                    <p>This link will expire in 1 hour.</p>
                    <p>If you didn't request a password reset, please ignore this email.</p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 Resonote. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }
}

module.exports = new EmailService();