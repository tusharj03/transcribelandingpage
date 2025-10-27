// Main landing page JavaScript
document.addEventListener('DOMContentLoaded', function() {
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
            paywallModal.classList.add('active');
            document.body.style.overflow = 'hidden';
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
        alert('Login functionality would be implemented here. This could redirect to a login page or open a login modal.');
    });

    // Get Started button functionality
    document.getElementById('getStartedBtn').addEventListener('click', () => {
        paywallModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });
});