// Payment page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Get selected plan from sessionStorage
    const selectedPlan = sessionStorage.getItem('selectedPlan') || 'pro';
    const selectedPrice = sessionStorage.getItem('selectedPrice') || '19';
    
    // Update page with selected plan
    document.getElementById('planName').textContent = `${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} Plan`;
    document.getElementById('planPrice').textContent = selectedPrice;
    document.getElementById('displayPrice').textContent = selectedPrice;
    document.getElementById('submitPrice').textContent = selectedPrice;

    // Add free testing option to the page
    addFreeTestingOption();

    // Card number formatting
    document.getElementById('cardNumber').addEventListener('input', function(e) {
        let value = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
        let formattedValue = value.match(/.{1,4}/g)?.join(' ');
        if (formattedValue) {
            e.target.value = formattedValue;
        }
    });

    // Expiry date formatting
    document.getElementById('expiryDate').addEventListener('input', function(e) {
        let value = e.target.value.replace(/\//g, '').replace(/[^0-9]/gi, '');
        if (value.length >= 2) {
            value = value.substring(0, 2) + '/' + value.substring(2, 4);
        }
        e.target.value = value;
    });

    // CVC input restriction
    document.getElementById('cvc').addEventListener('input', function(e) {
        e.target.value = e.target.value.replace(/[^0-9]/gi, '');
    });

    // ZIP code input restriction
    document.getElementById('zipCode').addEventListener('input', function(e) {
        e.target.value = e.target.value.replace(/[^0-9a-zA-Z]/gi, '');
    });

    // Form submission
    document.getElementById('paymentForm').addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Basic validation
        const email = document.getElementById('email').value;
        const cardNumber = document.getElementById('cardNumber').value;
        const expiryDate = document.getElementById('expiryDate').value;
        const cvc = document.getElementById('cvc').value;
        const name = document.getElementById('name').value;
        const country = document.getElementById('country').value;
        const zipCode = document.getElementById('zipCode').value;
        const terms = document.getElementById('terms').checked;

        if (!email || !cardNumber || !expiryDate || !cvc || !name || !country || !zipCode || !terms) {
            alert('Please fill in all required fields and agree to the terms.');
            return;
        }

        // Validate card number (basic check)
        const cleanCardNumber = cardNumber.replace(/\s/g, '');
        if (cleanCardNumber.length < 13 || cleanCardNumber.length > 19) {
            alert('Please enter a valid card number.');
            return;
        }

        // Validate expiry date
        if (!/^\d{2}\/\d{2}$/.test(expiryDate)) {
            alert('Please enter a valid expiry date (MM/YY).');
            return;
        }

        // Validate CVC
        if (cvc.length < 3 || cvc.length > 4) {
            alert('Please enter a valid CVC code.');
            return;
        }

        // Simulate payment processing
        processPayment(email, selectedPlan, selectedPrice);
    });

    // If no plan selected, redirect to home
    if (!sessionStorage.getItem('selectedPlan')) {
        window.location.href = 'index.html';
    }
});

// Add free testing option to the payment page
function addFreeTestingOption() {
    const paymentCard = document.querySelector('.payment-card');
    
    const freeOption = document.createElement('div');
    freeOption.className = 'free-testing-option';
    freeOption.innerHTML = `
        <div style="text-align: center; padding: 20px; margin: 20px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: var(--border-radius); color: white;">
            <h3 style="margin-bottom: 8px; color: white;">🎁 Free Testing Access</h3>
            <p style="margin-bottom: 16px; opacity: 0.9;">Want to try before you buy? Get free temporary access for testing.</p>
            <button class="btn btn-light" id="freeAccessBtn" style="color: #667eea; background: white; border: none;">
                <i class="fas fa-rocket"></i> Get Free Test Access
            </button>
        </div>
    `;
    
    // Insert after the payment plan section
    const planSection = document.querySelector('.payment-plan');
    planSection.parentNode.insertBefore(freeOption, planSection.nextSibling);

    // Add free access functionality
    document.getElementById('freeAccessBtn').addEventListener('click', function() {
        if (confirm('🎉 Get free testing access?\n\nYou\'ll get temporary access to download and test Audio Transcriber Pro. This is perfect for trying out the features before purchasing.\n\nClick OK to continue.')) {
            grantFreeAccess();
        }
    });
}

// Process payment (simulated)
function processPayment(email, plan, price) {
    const submitButton = document.querySelector('#paymentForm button[type="submit"]');
    const originalText = submitButton.innerHTML;
    
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing Payment...';
    submitButton.disabled = true;

    // Store user email for tracking
    sessionStorage.setItem('userEmail', email);

    // Simulate API call to payment processor
    setTimeout(() => {
        // For demo purposes, we'll simulate both success and failure cases
        const isSuccess = Math.random() > 0.2; // 80% success rate
        
        if (isSuccess) {
            // Payment successful
            sessionStorage.setItem('paymentSuccess', 'true');
            sessionStorage.setItem('paymentMethod', 'paid');
            sessionStorage.setItem('paidPlan', plan);
            
            // Track successful payment
            trackPayment('success', email, plan, price);
            
            // Redirect to success page
            window.location.href = 'success.html';
        } else {
            // Payment failed
            submitButton.innerHTML = originalText;
            submitButton.disabled = false;
            
            // Show error message
            alert('❌ Payment failed. Please check your card details and try again.\n\nIf the problem persists, try the free testing option or use a different payment method.');
            
            // Track failed payment
            trackPayment('failed', email, plan, price);
        }
    }, 3000);
}

// Grant free access without payment
function grantFreeAccess() {
    const email = prompt('📧 Please enter your email address for free test access:', 'test@example.com');
    
    if (!email) {
        return; // User cancelled
    }
    
    if (!validateEmail(email)) {
        alert('Please enter a valid email address.');
        return;
    }
    
    // Show processing
    const freeBtn = document.getElementById('freeAccessBtn');
    const originalText = freeBtn.innerHTML;
    freeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Setting up free access...';
    freeBtn.disabled = true;
    
    // Simulate processing delay
    setTimeout(() => {
        // Store free access data
        sessionStorage.setItem('userEmail', email);
        sessionStorage.setItem('paymentSuccess', 'true');
        sessionStorage.setItem('paymentMethod', 'free_trial');
        sessionStorage.setItem('freeAccessGranted', 'true');
        sessionStorage.setItem('freeAccessExpiry', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()); // 7 days from now
        
        // Track free access
        trackFreeAccess(email);
        
        // Show success message and redirect
        alert(`🎉 Free access granted!\n\nYou now have 7 days of free access to Audio Transcriber Pro.\n\nA confirmation has been sent to ${email} (simulated).`);
        
        // Redirect to download page
        window.location.href = 'success.html';
    }, 2000);
}

// Email validation
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Track payment events (in real app, send to analytics)
function trackPayment(status, email, plan, price) {
    const paymentData = {
        status: status,
        email: email,
        plan: plan,
        price: price,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
    };
    
    console.log('💳 Payment tracked:', paymentData);
    
    // Save to localStorage for demo purposes
    const payments = JSON.parse(localStorage.getItem('paymentEvents') || '[]');
    payments.push(paymentData);
    localStorage.setItem('paymentEvents', JSON.stringify(payments));
}

// Track free access events
function trackFreeAccess(email) {
    const freeAccessData = {
        email: email,
        timestamp: new Date().toISOString(),
        expiry: sessionStorage.getItem('freeAccessExpiry'),
        userAgent: navigator.userAgent
    };
    
    console.log('🎁 Free access tracked:', freeAccessData);
    
    // Save to localStorage for demo purposes
    const freeAccesses = JSON.parse(localStorage.getItem('freeAccessEvents') || '[]');
    freeAccesses.push(freeAccessData);
    localStorage.setItem('freeAccessEvents', JSON.stringify(freeAccesses));
}

// Add some CSS for the free testing option
const style = document.createElement('style');
style.textContent = `
    .free-testing-option {
        animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.02); }
        100% { transform: scale(1); }
    }
    
    .btn-light {
        background: white !important;
        color: #667eea !important;
        border: 2px solid white !important;
        font-weight: 600;
    }
    
    .btn-light:hover {
        background: #f8f9fa !important;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
    }
`;
document.head.appendChild(style);