// Simple Node.js server to handle payments and downloads
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/payment', (req, res) => {
    res.sendFile(path.join(__dirname, 'payment.html'));
});

app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'success.html'));
});

app.get('/download', (req, res) => {
    res.sendFile(path.join(__dirname, 'download.html'));
});

// Serve actual download files
app.get('/assets/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'assets', filename);
    
    // Check if file exists
    if (fs.existsSync(filePath)) {
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('Download error:', err);
                res.status(500).send('Error downloading file');
            }
        });
    } else {
        res.status(404).send('File not found');
    }
});

// Mock payment processing endpoint
app.post('/api/process-payment', (req, res) => {
    const { plan, email, paymentMethod } = req.body;
    
    // Store user email for tracking
    if (email) {
        // In a real app, you'd save to database
        console.log(`Payment processed for: ${email}, Plan: ${plan}`);
    }
    
    // Simulate payment processing
    setTimeout(() => {
        // In a real application, you would integrate with Stripe, PayPal, etc.
        const success = Math.random() > 0.1; // 90% success rate for demo
        
        if (success) {
            res.json({
                success: true,
                message: 'Payment processed successfully',
                transactionId: 'txn_' + Math.random().toString(36).substr(2, 9),
                plan: plan
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Payment failed. Please try again.'
            });
        }
    }, 2000);
});

// Download tracking endpoint
app.post('/api/track-download', (req, res) => {
    const { os, plan, email } = req.body;
    
    console.log(`Download tracked: ${os} - ${plan} - ${email}`);
    
    // In real app, save to database
    const downloadData = {
        os,
        plan,
        email,
        timestamp: new Date().toISOString(),
        ip: req.ip
    };
    
    console.log('📥 Download tracked:', downloadData);
    
    res.json({
        success: true,
        message: 'Download tracked'
    });
});

// Check file availability
app.get('/api/files/available', (req, res) => {
    const files = {
        windows: fs.existsSync(path.join(__dirname, 'assets', 'AudioTranscriberPro-Windows.zip')),
        mac: fs.existsSync(path.join(__dirname, 'assets', 'AudioTranscriberPro-macOS.dmg')),
        linux: fs.existsSync(path.join(__dirname, 'assets', 'AudioTranscriberPro-Linux.deb'))
    };
    
    res.json(files);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('📁 Serving files from:', __dirname);
    console.log('💾 Checking available download files...');
    
    // Check which files are available
    const files = ['AudioTranscriberPro-Windows.zip', 'AudioTranscriberPro-macOS.dmg', 'AudioTranscriberPro-Linux.deb'];
    files.forEach(file => {
        const exists = fs.existsSync(path.join(__dirname, 'assets', file));
        console.log(`${exists ? '✅' : '❌'} ${file}`);
    });
});