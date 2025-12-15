import { useState, useEffect } from 'react';

const API_BASE_URL = ''; // Relative path since we are served from the same domain

export function useAuth() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Load user from session storage on mount (shared with main site)
    useEffect(() => {
        const email = sessionStorage.getItem('userEmail');
        const token = sessionStorage.getItem('authToken');
        const plan = sessionStorage.getItem('userPlan');
        const status = sessionStorage.getItem('userStatus');

        if (email && token) {
            setUser({
                authenticated: true,
                email,
                plan: plan || 'free',
                status: status || 'active',
                token
            });
        }
        setLoading(false);
    }, []);

    const login = async (email, password) => {
        setLoading(true);
        setError(null);
        try {
            // Use the main site's login endpoint for consistency
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `Login failed: ${response.status}`;
                try {
                    const errorResult = JSON.parse(errorText);
                    errorMessage = errorResult.error || errorMessage;
                } catch (e) {
                    // ignore
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();

            if (result.success && result.user) {
                const userData = {
                    authenticated: true,
                    email: result.user.email,
                    plan: result.user.plan,
                    status: result.user.status,
                    token: result.token
                };

                setUser(userData);

                // Save to sessionStorage to share with main site
                sessionStorage.setItem('userEmail', userData.email);
                sessionStorage.setItem('authToken', userData.token);
                sessionStorage.setItem('userPlan', userData.plan);
                sessionStorage.setItem('userStatus', userData.status);

                return { success: true, user: userData };
            } else {
                throw new Error(result.error || 'Authentication failed');
            }

        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    const logout = () => {
        setUser(null);
        sessionStorage.removeItem('userEmail');
        sessionStorage.removeItem('authToken');
        sessionStorage.removeItem('userPlan');
        sessionStorage.removeItem('userStatus');
        // Optional: Redirect to main home?
        // window.location.href = '/'; 
    };

    // Helper to check plan access
    // plan hierarchy: basic < pro < enterprise
    const checkAccess = (requiredPlan) => {
        if (!user) return false;
        // Mobile/Offline mode override if we had it, but web is online basically
        // if (user.offlineMode) return false; // or limited features

        const plans = { 'basic': 1, 'pro': 2, 'enterprise': 3 };
        const userLevel = plans[user.plan] || 0;
        const requiredLevel = plans[requiredPlan] || 0;

        return userLevel >= requiredLevel;
    };

    return {
        user,
        loading,
        error,
        login,
        logout,
        checkAccess
    };
}
