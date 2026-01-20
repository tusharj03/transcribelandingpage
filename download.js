document.addEventListener('DOMContentLoaded', async function () {
    // Check payment and subscription
    // Check payment and subscription
    // const paymentSuccess = sessionStorage.getItem('paymentSuccess');
    const userEmail = sessionStorage.getItem('userEmail');

    if (!userEmail) {
        alert('Please log in first');
        window.location.href = 'index.html';
        return;
    }

    const subscriptionInfo = document.getElementById('subscriptionInfo');
    const subscriptionText = document.getElementById('subscriptionText');

    // Verify subscription status
    await verifySubscription();

    // Check subscription button
    document.getElementById('checkSubscription').addEventListener('click', async function () {
        await verifySubscription();
    });

    async function verifySubscription() {
        const userEmail = sessionStorage.getItem('userEmail');
        const paymentMethod = sessionStorage.getItem('paymentMethod');

        if (paymentMethod === 'developer') {
            // Developer bypass - always show as active
            subscriptionInfo.style.display = 'block';
            subscriptionText.innerHTML = `
                Welcome, <strong>${userEmail}</strong>!<br>
                <span style="color: var(--secondary);">Developer Account - Full Access</span>
            `;
            return;
        }

        try {
            const response = await fetch('/api/check-subscription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: userEmail })
            });

            const result = await response.json();

            if (result.subscribed) {
                subscriptionInfo.style.display = 'block';
                const planName = result.plan.charAt(0).toUpperCase() + result.plan.slice(1);
                const status = result.status.charAt(0).toUpperCase() + result.status.slice(1);

                subscriptionText.innerHTML = `
                    Welcome, <strong>${userEmail}</strong>!<br>
                    Your <strong>${planName}</strong> plan is <span style="color: var(--secondary);">${status}</span>.
                    ${result.currentPeriodEnd ? `<br>Next billing: ${new Date(result.currentPeriodEnd * 1000).toLocaleDateString()}` : ''}
                `;

                // Store subscription info
                sessionStorage.setItem('subscriptionStatus', result.status);
                sessionStorage.setItem('subscriptionPlan', result.plan);
            } else {
                alert('❌ No active subscription found. Please subscribe first.');
                window.location.href = 'index.html';
            }

        } catch (error) {
            console.error('Subscription check failed:', error);
            if (paymentMethod !== 'developer') {
                alert('❌ Could not verify subscription. Please try again.');
                window.location.href = 'index.html';
            }
        }
    }
});