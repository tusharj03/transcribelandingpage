document.addEventListener('DOMContentLoaded', async function () {
    // Check local storage first
    let userEmail = sessionStorage.getItem('userEmail');
    let authToken = sessionStorage.getItem('authToken');

    const storedUser = localStorage.getItem('resonote_user');
    if (storedUser) {
        try {
            const user = JSON.parse(storedUser);
            if (user && user.email) {
                // Sync specific values if missing from session
                if (!userEmail) userEmail = user.email;
                if (!authToken) authToken = user.token;

                // Also update session storage to keep things in sync
                sessionStorage.setItem('userEmail', user.email);
                if (user.token) sessionStorage.setItem('authToken', user.token);
                if (user.plan) sessionStorage.setItem('userPlan', user.plan);
                if (user.status) sessionStorage.setItem('userStatus', user.status);
            }
        } catch (e) {
            console.error('Error parsing stored user', e);
        }
    }

    if (!userEmail) {
        alert('Please log in first');
        window.location.href = 'index.html';
        return;
    }

    await loadAccountInfo();

    // Update payment method handler
    document.getElementById('updatePayment').addEventListener('click', async function () {
        await redirectToCustomerPortal();
    });

    // View invoices handler
    document.getElementById('viewInvoices').addEventListener('click', async function () {
        await redirectToCustomerPortal();
    });

    // Refresh subscription status
    document.getElementById('refreshStatus')?.addEventListener('click', async function () {
        await loadAccountInfo();
        showToast('Subscription status refreshed!', 'success');
    });

    // Cancel subscription handler
    document.getElementById('cancelSubscription').addEventListener('click', async function () {
        if (!confirm('Are you sure you want to cancel your subscription? You will lose access to Resonote at the end of your billing period.')) {
            return;
        }

        try {
            const headers = {
                'Content-Type': 'application/json'
            };

            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            const response = await fetch('/api/cancel-subscription', {
                method: 'POST',
                headers: headers
            });

            const result = await response.json();

            if (result.success) {
                showToast('Your subscription has been canceled. You will retain access until the end of your billing period.', 'success');
                await loadAccountInfo();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            showToast('Failed to cancel subscription: ' + error.message, 'error');
        }
    });

    async function loadAccountInfo() {
        const accountInfo = document.getElementById('accountInfo');
        const accountActions = document.getElementById('accountActions');

        try {
            const headers = {
                'Content-Type': 'application/json'
            };

            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            // Use the user profile endpoint instead of check-subscription
            const response = await fetch('/api/user-profile', {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error('Failed to fetch account information');
            }

            const result = await response.json();

            if (result.user) {
                const user = result.user;
                const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
                const status = user.status;
                const statusDisplay = status.charAt(0).toUpperCase() + status.slice(1);

                accountInfo.innerHTML = `
                    <div class="account-details">
                        <div class="detail-card">
                            <h3 style="margin-bottom: 8px; color: var(--dark); display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-check-circle" style="color: var(--secondary);"></i> 
                                Active Subscription
                                <span class="status-badge status-${status}">${statusDisplay}</span>
                            </h3>
                            <div class="detail-grid">
                                <div class="detail-item">
                                    <span class="detail-label">Plan</span>
                                    <span class="detail-value">${planName}</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Status</span>
                                    <span class="detail-value">${statusDisplay}</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Email</span>
                                    <span class="detail-value">${user.email}</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Member Since</span>
                                    <span class="detail-value">${new Date(user.createdAt).toLocaleDateString()}</span>
                                </div>
                                ${user.subscribedAt ? `
                                <div class="detail-item">
                                    <span class="detail-label">Subscribed On</span>
                                    <span class="detail-value">${new Date(user.subscribedAt).toLocaleDateString()}</span>
                                </div>
                                ` : ''}
                                ${user.currentPeriodEnd ? `
                                <div class="detail-item">
                                    <span class="detail-label">Next Billing Date</span>
                                    <span class="detail-value">${new Date(user.currentPeriodEnd * 1000).toLocaleDateString()}</span>
                                </div>
                                ` : ''}
                                ${user.cancelAtPeriodEnd ? `
                                <div class="detail-item">
                                    <span class="detail-label">Subscription Ends</span>
                                    <span class="detail-value" style="color: var(--danger);">${new Date(user.currentPeriodEnd * 1000).toLocaleDateString()}</span>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        
                        <div style="background: var(--primary-light); padding: 20px; border-radius: var(--border-radius); border-left: 4px solid var(--primary);">
                            <h4 style="margin-bottom: 12px; color: var(--dark);">
                                <i class="fas fa-info-circle"></i> Subscription Benefits
                            </h4>
                            <ul style="color: var(--gray); line-height: 1.6; padding-left: 20px;">
                                <li>Full access to Resonote desktop application</li>
                                <li>Regular updates and new features</li>
                                <li>Priority customer support</li>
                                <li>Cloud sync and backup</li>
                                <li>AI-powered transcription and analysis</li>
                            </ul>
                        </div>
                    </div>
                `;

                accountActions.style.display = 'block';

            } else {
                accountInfo.innerHTML = `
                    <div class="no-subscription">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3 style="margin-bottom: 12px; color: var(--dark);">No Active Subscription</h3>
                        <p style="color: var(--gray); margin-bottom: 24px; max-width: 400px; margin-left: auto; margin-right: auto;">
                            You don't have an active subscription. Subscribe to get full access to Resonote features.
                        </p>
                        <a href="index.html" class="btn btn-primary">
                            <i class="fas fa-crown"></i> Subscribe Now
                        </a>
                    </div>
                `;
                accountActions.style.display = 'none';
            }

        } catch (error) {
            console.error('Error loading account info:', error);
            accountInfo.innerHTML = `
                <div class="no-subscription">
                    <i class="fas fa-exclamation-circle" style="color: var(--danger);"></i>
                    <h3 style="margin-bottom: 12px; color: var(--dark);">Error Loading Account</h3>
                    <p style="color: var(--gray); margin-bottom: 24px;">
                        Could not load account information. Please try again later.
                    </p>
                    <div style="display: flex; gap: 12px; justify-content: center;">
                        <button onclick="location.reload()" class="btn btn-outline">
                            <i class="fas fa-redo"></i> Try Again
                        </button>
                        <button onclick="window.location.href='index.html'" class="btn btn-primary">
                            <i class="fas fa-home"></i> Back to Home
                        </button>
                    </div>
                </div>
            `;
            accountActions.style.display = 'none';
        }
    }

    function showToast(message, type = 'info') {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
            border-left: 4px solid ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};
            z-index: 1000;
            transform: translateX(400px);
            transition: transform 0.3s ease;
            max-width: 400px;
        `;

        toast.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation' : 'info'}-circle" 
                   style="color: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'}; margin-top: 2px;"></i>
                <span style="flex: 1;">${message}</span>
            </div>
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
        }, 100);

        setTimeout(() => {
            toast.style.transform = 'translateX(400px)';
            setTimeout(() => {
                if (document.body.contains(toast)) {
                    document.body.removeChild(toast);
                }
            }, 300);
        }, 5000);
    }

    async function redirectToCustomerPortal() {
        try {
            const headers = {
                'Content-Type': 'application/json'
            };

            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            const response = await fetch('/api/create-portal-session', {
                method: 'POST',
                headers: headers
            });

            const result = await response.json();

            if (response.ok && result.url) {
                window.location.href = result.url;
            } else {
                throw new Error(result.error || 'Failed to create portal session');
            }
        } catch (error) {
            console.error('Portal redirect error:', error);
            showToast('Failed to redirect to billing portal: ' + error.message, 'error');
        }
    }
});