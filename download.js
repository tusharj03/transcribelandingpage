document.addEventListener('DOMContentLoaded', async function() {
    // Check payment and subscription
    const paymentSuccess = sessionStorage.getItem('paymentSuccess');
    const userEmail = sessionStorage.getItem('userEmail');
    
    if (!paymentSuccess || !userEmail) {
        alert('❌ Please complete payment first');
        window.location.href = 'index.html';
        return;
    }

    // Verify subscription status
    await verifySubscription();

    const downloadOptions = document.querySelectorAll('.download-option');
    const downloadInstructions = document.getElementById('downloadInstructions');
    const downloadButton = document.getElementById('downloadButton');
    const downloadLink = document.getElementById('downloadLink');
    const osName = document.getElementById('osName');
    const subscriptionInfo = document.getElementById('subscriptionInfo');
    const subscriptionText = document.getElementById('subscriptionText');

    const instructionSections = {
        windows: document.getElementById('windowsInstructions'),
        mac: document.getElementById('macInstructions'),
        linux: document.getElementById('linuxInstructions')
    };

    // Github download URLs
    const downloadUrls = {
        windows: 'https://github.com/tusharj03/transcribelandingpage/releases/download/AudioTranscribe/AudioTranscriberPro-Windows.zip',
        mac: 'https://github.com/tusharj03/transcribelandingpage/releases/download/AudioTranscribe/AudioTranscriberPro-macOS.dmg',
        linux: 'https://github.com/tusharj03/transcribelandingpage/releases/download/AudioTranscribe/AudioTranscriberPro-Linux.deb'
    };

    const availableFiles = {
        windows: false,
        mac: true,
        linux: false
    };

    function selectOS(os) {
        // Remove active styles
        downloadOptions.forEach(opt => {
            opt.style.background = 'var(--gray-light)';
            opt.style.opacity = '1';
        });

        const selectedOption = document.querySelector(`.download-option[data-os="${os}"]`);
        selectedOption.style.background = 'var(--primary-light)';

        downloadInstructions.style.display = 'block';
        downloadButton.style.display = 'block';

        Object.values(instructionSections).forEach(section => section.style.display = 'none');
        instructionSections[os].style.display = 'block';

        const osDisplayName = selectedOption.querySelector('h3').textContent;
        osName.textContent = osDisplayName;

        const downloadUrl = downloadUrls[os];
        const fileName = `AudioTranscriberPro-${osDisplayName}.${os === 'windows' ? 'zip' : os === 'mac' ? 'dmg' : 'deb'}`;

        downloadLink.href = downloadUrl;
        downloadLink.setAttribute('download', fileName);
        downloadLink.innerHTML = `<i class="fas fa-download"></i> Download for ${osDisplayName}`;

        if (availableFiles[os]) {
            downloadLink.className = 'btn btn-primary';
            downloadLink.style.cursor = 'pointer';
            downloadLink.onclick = null;
        } else {
            downloadLink.className = 'btn btn-outline';
            downloadLink.style.cursor = 'not-allowed';
            downloadLink.onclick = function(e) {
                e.preventDefault();
                alert(`🚧 ${osDisplayName} version is coming soon!`);
            };
        }
    }

    downloadOptions.forEach(option => {
        option.addEventListener('click', () => {
            selectOS(option.getAttribute('data-os'));
        });
    });

    // Auto-select first available OS
    if (availableFiles.mac) selectOS('mac');
    else if (availableFiles.windows) selectOS('windows');
    else if (availableFiles.linux) selectOS('linux');

    // Update OS labels
    downloadOptions.forEach(option => {
        const os = option.getAttribute('data-os');
        const label = option.querySelector('p');
        if (availableFiles[os]) {
            label.innerHTML = `${label.textContent} <span style="color: var(--secondary); font-size: 12px;">✓ Available</span>`;
        } else {
            label.innerHTML = `${label.textContent} <span style="color: var(--gray); font-size: 12px;">⌛ Coming Soon</span>`;
        }
    });

    // Download tracking
    downloadLink.addEventListener('click', function(e) {
        let os = osName.textContent.toLowerCase();

        // Normalize names
        if (os === 'windows') os = 'windows';
        else if (os === 'macos') os = 'mac';
        else if (os === 'linux') os = 'linux';

        const isAvailable = availableFiles[os];

        if (!isAvailable) {
            e.preventDefault();
            alert(`🚧 ${osName.textContent} version is coming soon!`);
            return;
        }

        console.log(`📥 Download started: ${os} by ${sessionStorage.getItem('userEmail') || 'unknown'}`);

        // Track downloads
        const downloads = JSON.parse(localStorage.getItem('appDownloads') || '[]');
        downloads.push({
            os: os,
            timestamp: new Date().toISOString(),
            plan: sessionStorage.getItem('paidPlan') || 'unknown',
            email: sessionStorage.getItem('userEmail') || 'unknown',
            paymentMethod: sessionStorage.getItem('paymentMethod') || 'unknown',
            subscriptionId: sessionStorage.getItem('subscriptionId') || 'unknown'
        });
        localStorage.setItem('appDownloads', JSON.stringify(downloads));

        // Track subscription usage
        const userEmail = sessionStorage.getItem('userEmail');
        if (userEmail) {
            const userDownloads = JSON.parse(localStorage.getItem(`userDownloads_${userEmail}`) || '[]');
            userDownloads.push({
                os: os,
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            });
            localStorage.setItem(`userDownloads_${userEmail}`, JSON.stringify(userDownloads));
        }
    });

    // Check subscription button
    document.getElementById('checkSubscription').addEventListener('click', async function() {
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