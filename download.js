// Download page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Check if user has paid
    const paymentSuccess = sessionStorage.getItem('paymentSuccess');
    if (!paymentSuccess) {
        window.location.href = 'index.html';
        return;
    }

    const downloadOptions = document.querySelectorAll('.download-option');
    const downloadInstructions = document.getElementById('downloadInstructions');
    const downloadButton = document.getElementById('downloadButton');
    const downloadLink = document.getElementById('downloadLink');
    const osName = document.getElementById('osName');

    // Hide all instruction sections
    const instructionSections = {
        'windows': document.getElementById('windowsInstructions'),
        'mac': document.getElementById('macInstructions'),
        'linux': document.getElementById('linuxInstructions')
    };

    // Detect user's OS automatically
    function detectOS() {
        const userAgent = window.navigator.userAgent;
        const platform = window.navigator.platform;
        
        if (/Mac/.test(platform)) return 'mac';
        if (/Win/.test(platform)) return 'windows';
        if (/Linux/.test(platform)) return 'linux';
        
        // Fallback based on user agent
        if (userAgent.indexOf('Mac') !== -1) return 'mac';
        if (userAgent.indexOf('Win') !== -1) return 'windows';
        if (userAgent.indexOf('Linux') !== -1) return 'linux';
        
        return 'windows'; // Default fallback
    }

    // OS selection
    downloadOptions.forEach(option => {
        option.addEventListener('click', function() {
            const os = this.getAttribute('data-os');
            selectOS(os);
        });
    });

    function selectOS(os) {
        // Remove active class from all options
        downloadOptions.forEach(opt => opt.style.background = 'var(--gray-light)');
        
        // Add active class to selected option
        document.querySelector(`.download-option[data-os="${os}"]`).style.background = 'var(--primary-light)';
        
        // Show instructions and download button
        downloadInstructions.style.display = 'block';
        downloadButton.style.display = 'block';
        
        // Hide all instruction sections
        Object.values(instructionSections).forEach(section => {
            section.style.display = 'none';
        });
        
        // Show selected instruction section
        instructionSections[os].style.display = 'block';
        
        // Update download button
        const osDisplayName = document.querySelector(`.download-option[data-os="${os}"] h3`).textContent;
        osName.textContent = osDisplayName;
        
        // Set download link based on OS
        let downloadUrl = '';
        let fileName = '';
        
        switch(os) {
            case 'windows':
                downloadUrl = 'assets/AudioTranscriberPro-Windows.zip';
                fileName = 'AudioTranscriberPro-Windows.zip';
                break;
            case 'mac':
                downloadUrl = 'assets/AudioTranscriberPro-macOS.dmg';
                fileName = 'AudioTranscriberPro-macOS.dmg';
                break;
            case 'linux':
                downloadUrl = 'assets/AudioTranscriberPro-Linux.deb';
                fileName = 'AudioTranscriberPro-Linux.deb';
                break;
        }
        
        downloadLink.href = downloadUrl;
        downloadLink.setAttribute('download', fileName);
    }

    // Download tracking
    downloadLink.addEventListener('click', function(e) {
        const os = osName.textContent.toLowerCase();
        const userEmail = sessionStorage.getItem('userEmail') || 'unknown';
        
        // Track download (in real app, send to your analytics)
        console.log(`Download started: ${os} by ${userEmail}`);
        
        const downloads = JSON.parse(localStorage.getItem('appDownloads') || '[]');
        downloads.push({
            os: os,
            timestamp: new Date().toISOString(),
            plan: sessionStorage.getItem('selectedPlan'),
            email: userEmail
        });
        localStorage.setItem('appDownloads', JSON.stringify(downloads));
        
        // Show success message after a short delay to ensure download starts
        setTimeout(() => {
            alert('🎉 Download started! Check your downloads folder.\n\nIf the download doesn\'t start automatically, right-click the download button and select "Save link as..."');
        }, 1000);
    });

    // Auto-select user's OS or default to macOS (since you have the .dmg)
    const userOS = detectOS();
    selectOS(userOS);
    
    // Show OS detection message
    if (userOS === 'mac') {
        console.log('🖥️ Auto-detected macOS user');
    } else {
        console.log(`🖥️ Auto-detected ${userOS} user (showing macOS as default since that's what you have)`);
        // Since you only have macOS build, show macOS by default but let them choose others
        selectOS('mac');
    }
});