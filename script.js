// Main landing page JavaScript
document.addEventListener('DOMContentLoaded', function () {
    // Mobile Menu Toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navMenu = document.querySelector('.nav-menu');
    const body = document.body;

    // Create overlay element
    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';
    body.appendChild(overlay);

    function toggleMenu() {
        navMenu.classList.toggle('active');
        overlay.classList.toggle('active');
        body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : '';

        // Change icon
        const icon = mobileMenuBtn.querySelector('i');
        if (navMenu.classList.contains('active')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', toggleMenu);
    }

    // Close menu when clicking overlay
    overlay.addEventListener('click', toggleMenu);

    // Close menu when clicking a link
    const navLinks = document.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (navMenu.classList.contains('active')) {
                toggleMenu();
            }
        });
    });
    // Check if user is already logged in
    checkExistingSession();

    // FAQ Toggle
    document.querySelectorAll('.faq-question').forEach(question => {
        question.addEventListener('click', () => {
            const item = question.parentElement;
            item.classList.toggle('active');
        });
    });

    // Paywall Modal
    const paywallModal = document.getElementById('paywallModal');
    const downloadButtons = document.querySelectorAll('#heroDownloadBtn, #ctaDownloadBtn');
    const closeModal = document.getElementById('closeModal');
    const selectPlanButtons = document.querySelectorAll('.select-plan');

    // Show modal when download buttons are clicked
    downloadButtons.forEach(button => {
        button.addEventListener('click', () => {
            const userEmail = sessionStorage.getItem('userEmail');

            if (!userEmail) {
                // Show login modal first
                document.getElementById('loginModal').classList.add('active');
                document.body.style.overflow = 'hidden';
            } else {
                // User is logged in, show paywall
                paywallModal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });
    });

    // Close modal
    closeModal.addEventListener('click', () => {
        paywallModal.classList.remove('active');
        document.body.style.overflow = 'auto';
    });

    // Close modal when clicking outside
    paywallModal.addEventListener('click', (e) => {
        if (e.target === paywallModal) {
            paywallModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    });

    // Plan selection - redirect to payment page
    selectPlanButtons.forEach(button => {
        button.addEventListener('click', () => {
            const plan = button.getAttribute('data-plan');
            const price = button.getAttribute('data-price');

            // Store plan selection in sessionStorage
            sessionStorage.setItem('selectedPlan', plan);
            sessionStorage.setItem('selectedPrice', price);

            // Redirect to payment page
            window.location.href = 'payment.html';
        });
    });

    // Modal plan buttons
    document.getElementById('modalProBtn').addEventListener('click', () => {
        sessionStorage.setItem('selectedPlan', 'pro');
        sessionStorage.setItem('selectedPrice', '19');
        window.location.href = 'payment.html';
    });

    document.getElementById('modalBasicBtn').addEventListener('click', () => {
        sessionStorage.setItem('selectedPlan', 'basic');
        sessionStorage.setItem('selectedPrice', '9');
        window.location.href = 'payment.html';
    });

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();

            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 100,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Navbar background on scroll
    window.addEventListener('scroll', () => {
        const header = document.querySelector('header');
        if (window.scrollY > 100) {
            header.style.boxShadow = 'var(--shadow-lg)';
        } else {
            header.style.boxShadow = 'var(--shadow)';
        }
    });

    // Demo button functionality
    document.getElementById('watchDemoBtn').addEventListener('click', () => {
        alert('Demo video would play here. In a real implementation, this would open a video modal or redirect to a demo page.');
    });

    // Login button functionality
    document.getElementById('loginBtn').addEventListener('click', () => {
        document.getElementById('loginModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    // Get Started button functionality
    document.getElementById('getStartedBtn').addEventListener('click', () => {
        const userEmail = sessionStorage.getItem('userEmail');

        if (!userEmail) {
            document.getElementById('registerModal').classList.add('active');
            document.body.style.overflow = 'hidden';
        } else {
            paywallModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    });

    // Login Modal Functionality
    setupLoginModal();

    // Registration Modal Functionality
    setupRegistrationModal();

    // User dropdown functionality
    setupUserDropdown();
});

// Check if user has an existing session
function checkExistingSession() {
    const userEmail = sessionStorage.getItem('userEmail');
    const userPlan = sessionStorage.getItem('userPlan');

    if (userEmail) {
        // User is logged in, update UI
        document.getElementById('userMenu').style.display = 'block';
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('getStartedBtn').style.display = 'none';
        document.getElementById('userEmail').textContent = userEmail;

        // Show user status if they have a plan
        if (userPlan && userPlan !== 'inactive') {
            document.getElementById('userStatus').style.display = 'block';
            document.getElementById('currentPlan').textContent = userPlan;

            // Show current subscription info
            document.getElementById('currentSubscription').style.display = 'block';
            document.getElementById('activePlanName').textContent = userPlan.charAt(0).toUpperCase() + userPlan.slice(1);
        }
    }
}

// Setup login modal functionality
function setupLoginModal() {
    const loginModal = document.getElementById('loginModal');
    const closeLoginModal = document.getElementById('closeLoginModal');
    const submitLogin = document.getElementById('submitLogin');
    const showRegister = document.getElementById('showRegister');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginMessage = document.getElementById('loginMessage');

    // Close login modal
    closeLoginModal.addEventListener('click', () => {
        loginModal.classList.remove('active');
        document.body.style.overflow = 'auto';
    });

    // Show register modal from login
    showRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginModal.classList.remove('active');
        document.getElementById('registerModal').classList.add('active');
    });

    // Login form submission
    submitLogin.addEventListener('click', async function () {
        const email = loginEmail.value.trim();
        const password = loginPassword.value;

        if (!email || !password) {
            loginMessage.textContent = 'Please enter both email and password';
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (result.success) {
                // Store user session
                sessionStorage.setItem('userEmail', result.user.email);
                sessionStorage.setItem('authToken', result.token);
                sessionStorage.setItem('userPlan', result.user.plan);
                sessionStorage.setItem('userStatus', result.user.status);

                // Update UI
                document.getElementById('userMenu').style.display = 'block';
                document.getElementById('loginBtn').style.display = 'none';
                document.getElementById('getStartedBtn').style.display = 'none';
                document.getElementById('userEmail').textContent = result.user.email;

                // Update user status section
                if (result.user.plan && result.user.plan !== 'inactive') {
                    document.getElementById('userStatus').style.display = 'block';
                    document.getElementById('currentPlan').textContent = result.user.plan;

                    document.getElementById('currentSubscription').style.display = 'block';
                    document.getElementById('activePlanName').textContent = result.user.plan.charAt(0).toUpperCase() + result.user.plan.slice(1);
                }

                // Close modal
                loginModal.classList.remove('active');
                document.body.style.overflow = 'auto';

                showToast('Successfully signed in!', 'success');
            } else {
                loginMessage.textContent = result.error || 'Login failed';
            }
        } catch (error) {
            loginMessage.textContent = 'Network error. Please try again.';
        }
    });

    // Close modal when clicking outside
    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) {
            loginModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    });
}

// Setup registration modal functionality
function setupRegistrationModal() {
    const registerModal = document.getElementById('registerModal');
    const closeRegisterModal = document.getElementById('closeRegisterModal');
    const submitRegister = document.getElementById('submitRegister');
    const showLogin = document.getElementById('showLogin');
    const registerEmail = document.getElementById('registerEmail');
    const registerPassword = document.getElementById('registerPassword');
    const confirmPassword = document.getElementById('confirmPassword');
    const registerMessage = document.getElementById('registerMessage');

    // New elements
    const registerFormContent = document.getElementById('registerFormContent');
    const registerSuccessContent = document.getElementById('registerSuccessContent');
    const registerSuccessDoneBtn = document.getElementById('registerSuccessDoneBtn');

    // Reset function
    const resetRegisterModal = () => {
        if (registerFormContent) registerFormContent.style.display = 'block';
        if (registerSuccessContent) registerSuccessContent.style.display = 'none';
        registerEmail.value = '';
        registerPassword.value = '';
        confirmPassword.value = '';
        registerMessage.textContent = '';
    };

    // Close register modal
    closeRegisterModal.addEventListener('click', () => {
        registerModal.classList.remove('active');
        document.body.style.overflow = 'auto';
        setTimeout(resetRegisterModal, 300);
    });

    // Show login modal from register
    showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerModal.classList.remove('active');
        document.getElementById('loginModal').classList.add('active');
        setTimeout(resetRegisterModal, 300);
    });

    // Registration form submission
    submitRegister.addEventListener('click', async function () {
        const email = registerEmail.value.trim();
        const password = registerPassword.value;
        const confirm = confirmPassword.value;

        if (!email || !password) {
            registerMessage.textContent = 'Please enter both email and password';
            return;
        }

        if (password !== confirm) {
            registerMessage.textContent = 'Passwords do not match';
            return;
        }

        if (password.length < 8) {
            registerMessage.textContent = 'Password must be at least 8 characters long';
            return;
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (result.success) {
                // Show success view
                if (registerFormContent) registerFormContent.style.display = 'none';
                if (registerSuccessContent) registerSuccessContent.style.display = 'block';

                // Auto-login in background
                try {
                    const loginResponse = await fetch('/api/login', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ email, password })
                    });

                    const loginResult = await loginResponse.json();

                    if (loginResult.success) {
                        sessionStorage.setItem('userEmail', loginResult.user.email);
                        sessionStorage.setItem('authToken', loginResult.token);
                        sessionStorage.setItem('userPlan', loginResult.user.plan);
                        sessionStorage.setItem('userStatus', loginResult.user.status);

                        // Update UI immediately (behind the modal)
                        document.getElementById('userMenu').style.display = 'block';
                        document.getElementById('loginBtn').style.display = 'none';
                        document.getElementById('getStartedBtn').style.display = 'none';
                        document.getElementById('userEmail').textContent = loginResult.user.email;
                    }
                } catch (loginError) {
                    console.error('Auto-login failed', loginError);
                }

            } else {
                registerMessage.textContent = result.error || 'Registration failed';
            }
        } catch (error) {
            registerMessage.textContent = 'Network error. Please try again.';
        }
    });

    // Done button handler
    if (registerSuccessDoneBtn) {
        registerSuccessDoneBtn.addEventListener('click', () => {
            registerModal.classList.remove('active');
            document.body.style.overflow = 'auto';

            // Show toast and paywall if logged in
            if (sessionStorage.getItem('userEmail')) {
                showToast('Account created and signed in!', 'success');
                setTimeout(() => {
                    document.getElementById('paywallModal').classList.add('active');
                    document.body.style.overflow = 'hidden';
                }, 1000);
            }

            setTimeout(resetRegisterModal, 300);
        });
    }

    // Close modal when clicking outside
    registerModal.addEventListener('click', (e) => {
        if (e.target === registerModal) {
            registerModal.classList.remove('active');
            document.body.style.overflow = 'auto';
            setTimeout(resetRegisterModal, 300);
        }
    });
}

// Setup user dropdown functionality
function setupUserDropdown() {
    const userDropdown = document.getElementById('userDropdown');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const logoutLink = document.getElementById('logoutLink');

    // Toggle dropdown
    if (userDropdown) {
        userDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdownMenu.style.display = 'none';
        });

        // Logout functionality
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();

            // Clear session storage
            sessionStorage.removeItem('userEmail');
            sessionStorage.removeItem('authToken');
            sessionStorage.removeItem('userPlan');
            sessionStorage.removeItem('userStatus');

            // Update UI
            document.getElementById('userMenu').style.display = 'none';
            document.getElementById('loginBtn').style.display = 'inline-block';
            document.getElementById('getStartedBtn').style.display = 'inline-block';
            document.getElementById('userStatus').style.display = 'none';
            document.getElementById('currentSubscription').style.display = 'none';

            showToast('Successfully logged out', 'success');
        });
    }
}

// Toast notification function
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
        border-left: 4px solid ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};
        z-index: 10000;
        transform: translateX(400px);
        transition: transform 0.3s ease;
        max-width: 400px;
        display: flex;
        align-items: center;
        gap: 12px;
    `;

    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
    const iconColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1';

    toast.innerHTML = `
        <i class="fas fa-${icon}" style="color: ${iconColor};"></i>
        <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);

    // Animate out after 5 seconds
    setTimeout(() => {
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 300);
    }, 5000);
}

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal-overlay.active');
        modals.forEach(modal => {
            modal.classList.remove('active');
            document.body.style.overflow = 'auto';
        });
    }
});