document.addEventListener('DOMContentLoaded', function() {
    // Check payment
    const paymentSuccess = sessionStorage.getItem('paymentSuccess');
    if (!paymentSuccess) {
        alert('❌ Please complete payment first');
        window.location.href = 'index.html';
        return;
    }

    const downloadOptions = document.querySelectorAll('.download-option');
    const downloadInstructions = document.getElementById('downloadInstructions');
    const downloadButton = document.getElementById('downloadButton');
    const downloadLink = document.getElementById('downloadLink');
    const osName = document.getElementById('osName');

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
        plan: sessionStorage.getItem('selectedPlan') || 'unknown',
        email: sessionStorage.getItem('userEmail') || 'unknown',
        paymentMethod: sessionStorage.getItem('paymentMethod') || 'unknown'
    });
    localStorage.setItem('appDownloads', JSON.stringify(downloads));

    // Actually download
    downloadLink.setAttribute('href', downloadUrls[os]);
    downloadLink.setAttribute('download', `AudioTranscriberPro-${osName.textContent}.dmg`);
});


    // Developer bypass
    const devBtn = document.getElementById('developerBypass');
    devBtn.addEventListener('click', () => {
        const code = prompt('Enter developer code:');
        if (!code) return;

        fetch('/api/developer-bypass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: sessionStorage.getItem('userEmail') || 'dev@test.com', code })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                sessionStorage.setItem('paymentSuccess', 'true');
                sessionStorage.setItem('paymentMethod', 'developer');
                alert('Developer access granted!');
                window.location.reload();
            } else {
                alert('Invalid code.');
            }
        })
        .catch(() => alert('Error during developer access.'));
    });
});
