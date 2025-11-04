let stripe, elements, cardElement;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async function() {
    // Check if plan is selected
    const selectedPlan = sessionStorage.getItem('selectedPlan');
    const selectedPrice = sessionStorage.getItem('selectedPrice');
    
    if (!selectedPlan || !selectedPrice) {
        alert('Please select a plan first');
        window.location.href = 'index.html';
        return;
    }

    // Update UI with selected plan
    document.getElementById('selectedPlanName').textContent = 
        selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1) + ' Plan';
    document.getElementById('selectedPlanPrice').textContent = selectedPrice;

    // Initialize Stripe
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        
        stripe = Stripe(config.publishableKey);
        elements = stripe.elements();
        
        cardElement = elements.create('card', {
            style: {
                base: {
                    fontSize: '16px',
                    color: '#1e293b',
                    '::placeholder': {
                        color: '#94a3b8'
                    }
                }
            }
        });
    } catch (error) {
        showMessage('Payment system unavailable. Please try again later.', 'error');
    }

    // Auth form handler
    document.getElementById('auth-button').addEventListener('click', handleAuth);
    
    // Payment form handler
    document.getElementById('payment-form').addEventListener('submit', handlePaymentSubmit);
});

async function handleAuth() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const authButton = document.getElementById('auth-button');
    const authMessage = document.getElementById('auth-message');

    if (!email || !password) {
        authMessage.textContent = 'Please enter both email and password';
        authMessage.style.color = '#ef4444';
        return;
    }

    authButton.disabled = true;
    authButton.textContent = 'Checking...';

    try {
        // Try to register first, will login if user exists
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            
            // Show payment form
            document.getElementById('auth-section').style.display = 'none';
            document.getElementById('payment-form').style.display = 'block';
            
            // Mount card element
            if (cardElement) {
                cardElement.mount('#card-element');
            }
        } else {
            authMessage.textContent = data.error || 'Authentication failed';
            authMessage.style.color = '#ef4444';
        }
    } catch (error) {
        authMessage.textContent = 'Network error. Please try again.';
        authMessage.style.color = '#ef4444';
    } finally {
        authButton.disabled = false;
        authButton.textContent = 'Continue to Payment';
    }
}

async function handlePaymentSubmit(event) {
    event.preventDefault();
    
    if (!stripe || !cardElement) {
        showMessage('Payment system not ready', 'error');
        return;
    }

    const submitButton = document.getElementById('submit-button');
    const submitLabel = document.getElementById('submit-label');
    const spinner = document.getElementById('spinner');
    const terms = document.getElementById('terms');

    if (!terms.checked) {
        showMessage('Please accept the terms and conditions', 'error');
        return;
    }

    submitButton.disabled = true;
    submitLabel.textContent = 'Processing...';
    spinner.style.display = 'inline-block';

    try {
        const selectedPlan = sessionStorage.getItem('selectedPlan');
        
        // Create payment method
        const { paymentMethod, error } = await stripe.createPaymentMethod({
            type: 'card',
            card: cardElement,
        });

        if (error) {
            throw new Error(error.message);
        }

        // Create subscription
        const response = await fetch('/api/create-subscription', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
                plan: selectedPlan,
                payment_method: paymentMethod.id
            })
        });

        const subscription = await response.json();

        if (subscription.error) {
            throw new Error(subscription.error);
        }

        // Confirm payment if needed
        if (subscription.status === 'incomplete' && subscription.clientSecret) {
            const { error: confirmError } = await stripe.confirmCardPayment(
                subscription.clientSecret
            );

            if (confirmError) {
                throw new Error(confirmError.message);
            }
        }

        // Success
        sessionStorage.setItem('subscriptionActive', 'true');
        sessionStorage.setItem('userPlan', selectedPlan);
        showMessage('Subscription activated! Redirecting...', 'success');
        
        setTimeout(() => {
            window.location.href = 'download.html';
        }, 2000);

    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitLabel.textContent = 'Start 14-Day Free Trial';
        spinner.style.display = 'none';
    }
}

function showMessage(message, type = 'error') {
    const messageEl = document.getElementById('payment-message');
    messageEl.textContent = message;
    messageEl.style.color = type === 'error' ? '#ef4444' : '#16a34a';
}