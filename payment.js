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
    document.getElementById('termsPrice').textContent = selectedPrice;
    document.getElementById('button-price').textContent = selectedPrice;

    // Initialize Stripe
    let stripe;
    let elements;
    
    try {
        // Get Stripe publishable key from server
        const response = await fetch('/api/config');
        const { publishableKey } = await response.json();
        
        if (!publishableKey) {
            throw new Error('Stripe publishable key not configured');
        }
        
        stripe = Stripe(publishableKey);
        
        // Initialize Stripe Elements
        const appearance = {
            theme: 'stripe',
            variables: {
                colorPrimary: '#6366f1',
                colorBackground: '#ffffff',
                colorText: '#1e293b',
                colorDanger: '#ef4444',
                fontFamily: 'Inter, system-ui, sans-serif',
                spacingUnit: '4px',
                borderRadius: '12px'
            }
        };
        
        elements = stripe.elements({ appearance });
        
        // Create card element
        const cardElement = elements.create('card', {
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
        
        cardElement.mount('#card-element');
        
        // Handle form submission
        const form = document.getElementById('payment-form');
        const submitButton = document.getElementById('submit-button');
        const buttonText = document.getElementById('button-text');
        const spinner = document.getElementById('spinner');
        const paymentMessage = document.getElementById('payment-message');
        
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            
            if (!stripe || !elements) {
                showMessage('Payment system not initialized. Please refresh the page.', 'error');
                return;
            }
            
            // Disable form submission
            submitButton.disabled = true;
            buttonText.textContent = 'Processing...';
            spinner.classList.remove('hidden');
            paymentMessage.classList.add('hidden');
            
            // Get form data
            const email = document.getElementById('email').value;
            const name = document.getElementById('name').value;
            
            try {
                // Create payment intent on server
                const { clientSecret, paymentIntentId } = await createPaymentIntent(
                    selectedPrice, 
                    selectedPlan, 
                    email
                );
                
                // Confirm payment with Stripe
                const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
                    payment_method: {
                        card: cardElement,
                        billing_details: {
                            name: name,
                            email: email,
                        },
                    },
                    return_url: `${window.location.origin}/download.html`,
                });
                
                if (error) {
                    showMessage(error.message, 'error');
                    submitButton.disabled = false;
                    buttonText.textContent = `Start 14-Day Free Trial - $${selectedPrice}/month after`;
                    spinner.classList.add('hidden');
                } else if (paymentIntent.status === 'succeeded') {
                    // Payment successful
                    await handleSuccessfulPayment(paymentIntent.id, email, selectedPlan);
                }
            } catch (error) {
                console.error('Payment error:', error);
                showMessage('An error occurred while processing your payment. Please try again.', 'error');
                submitButton.disabled = false;
                buttonText.textContent = `Start 14-Day Free Trial - $${selectedPrice}/month after`;
                spinner.classList.add('hidden');
            }
        });
        
        // Handle real-time validation errors from the card Element
        cardElement.on('change', (event) => {
            const displayError = document.getElementById('card-errors');
            if (event.error) {
                displayError.textContent = event.error.message;
                displayError.style.color = '#ef4444';
                displayError.style.fontSize = '14px';
                displayError.style.marginTop = '8px';
            } else {
                displayError.textContent = '';
            }
        });
        
    } catch (error) {
        console.error('Stripe initialization error:', error);
        showMessage('Payment system temporarily unavailable. Please try again later.', 'error');
    }
    
    // Create payment intent on server
    async function createPaymentIntent(amount, plan, email) {
        const response = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: amount,
                plan: plan,
                email: email
            }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create payment intent');
        }
        
        return await response.json();
    }
    
    // Handle successful payment
    async function handleSuccessfulPayment(paymentIntentId, email, plan) {
        try {
            // Notify server of successful payment
            const response = await fetch('/api/payment-success', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    paymentIntentId: paymentIntentId,
                    email: email,
                    plan: plan
                }),
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Store payment success in session storage
                sessionStorage.setItem('paymentSuccess', 'true');
                sessionStorage.setItem('userEmail', email);
                sessionStorage.setItem('paymentMethod', 'stripe');
                sessionStorage.setItem('paymentId', paymentIntentId);
                
                // Redirect to download page
                window.location.href = 'download.html';
            } else {
                throw new Error(result.error || 'Payment verification failed');
            }
        } catch (error) {
            console.error('Payment success handling error:', error);
            showMessage('Payment processed but verification failed. Please contact support.', 'warning');
        }
    }
    
    // Show message to user
    function showMessage(message, type = 'error') {
        const paymentMessage = document.getElementById('payment-message');
        paymentMessage.textContent = message;
        paymentMessage.className = '';
        
        if (type === 'error') {
            paymentMessage.style.background = '#fef2f2';
            paymentMessage.style.color = '#dc2626';
            paymentMessage.style.border = '1px solid #fecaca';
        } else if (type === 'success') {
            paymentMessage.style.background = '#f0fdf4';
            paymentMessage.style.color = '#16a34a';
            paymentMessage.style.border = '1px solid #bbf7d0';
        } else if (type === 'warning') {
            paymentMessage.style.background = '#fffbeb';
            paymentMessage.style.color = '#d97706';
            paymentMessage.style.border = '1px solid #fed7aa';
        }
        
        paymentMessage.classList.remove('hidden');
    }
});

// Utility function to show/hide elements
function toggleElement(id, show) {
    const element = document.getElementById(id);
    if (element) {
        element.classList.toggle('hidden', !show);
    }
}