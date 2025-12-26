import { useState, useEffect } from 'react';

const API_BASE_URL = 'https://resonote-ai.vercel.app';

export function useAuth() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Load user from local storage on mount
    useEffect(() => {
        const storedUser = localStorage.getItem('resonote_user');
        if (storedUser) {
            try {
                setUser(JSON.parse(storedUser));
            } catch (e) {
                console.error('Failed to parse stored user', e);
                localStorage.removeItem('resonote_user');
            }
        }
        setLoading(false);
    }, []);

    const login = async (email, password) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/api/dmg-login`, {
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
                    subscribedAt: result.user.subscribedAt,
                    currentPeriodEnd: result.user.currentPeriodEnd,
                    token: result.token
                };
                setUser(userData);
                localStorage.setItem('resonote_user', JSON.stringify(userData));
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
        localStorage.removeItem('resonote_user');
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
