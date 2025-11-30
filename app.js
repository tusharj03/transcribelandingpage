document.addEventListener('DOMContentLoaded', () => {
    // --- Tab Navigation ---
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons and contents
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked button and corresponding content
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // --- Sub-tab Navigation (Live/Background) ---
    const subTabBtns = document.querySelectorAll('.sub-tab-btn');
    const subTabContents = document.querySelectorAll('.sub-tab-content');

    subTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            subTabBtns.forEach(b => b.classList.remove('active'));
            subTabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const subTabId = btn.getAttribute('data-subtab');
            document.getElementById(subTabId).classList.add('active');
        });
    });

    // --- Source Selection ---
    const sourceBtns = document.querySelectorAll('.source-btn');
    sourceBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sourceBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // --- Modal Logic ---
    const modal = document.getElementById('modelSelectionModal');
    const startCaptureBtn = document.getElementById('startCaptureBtn');
    const modalCloseBtn = document.querySelector('.modal-close');
    const startTranscribeBtn = document.getElementById('startTranscribeBtn');
    const modelOptions = document.querySelectorAll('.model-option');

    // Open modal on start capture
    startCaptureBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
    });

    // Close modal
    modalCloseBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Model selection
    modelOptions.forEach(option => {
        option.addEventListener('click', () => {
            modelOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
        });
    });

    // Start Transcription (Mock)
    startTranscribeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        const statusDiv = document.getElementById('status');
        const statusText = statusDiv.querySelector('.status-text');
        const stopBtn = document.getElementById('stopTranscribeBtn');
        const transcriptDiv = document.getElementById('transcript');

        statusDiv.className = 'status recording';
        statusText.textContent = 'Recording in progress...';
        startCaptureBtn.disabled = true;
        stopBtn.disabled = false;
        transcriptDiv.textContent = 'Listening...';

        // Simulate transcription updates
        let dots = 0;
        const interval = setInterval(() => {
            dots = (dots + 1) % 4;
            transcriptDiv.textContent = 'Listening' + '.'.repeat(dots);
        }, 500);

        // Store interval ID on the stop button to clear it later
        stopBtn.dataset.intervalId = interval;
    });

    // Stop Transcription (Mock)
    const stopTranscribeBtn = document.getElementById('stopTranscribeBtn');
    stopTranscribeBtn.addEventListener('click', () => {
        const statusDiv = document.getElementById('status');
        const statusText = statusDiv.querySelector('.status-text');
        const transcriptDiv = document.getElementById('transcript');
        const intervalId = stopTranscribeBtn.dataset.intervalId;

        clearInterval(intervalId);
        statusDiv.className = 'status idle';
        statusText.textContent = 'Ready to capture. Click "Start Capture" to begin.';
        startCaptureBtn.disabled = false;
        stopTranscribeBtn.disabled = true;
        transcriptDiv.textContent = 'Transcription complete. (This is a demo)';

        // Add to history (Mock)
        addToHistory('Demo Transcription', new Date().toLocaleString());
    });

    // --- Chat Logic ---
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatMessages = document.getElementById('chatMessages');
    const typingIndicator = document.getElementById('typingIndicator');

    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Add user message
        addMessage(text, 'user');
        chatInput.value = '';

        // Show typing indicator
        typingIndicator.classList.add('visible');
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Simulate AI response
        setTimeout(() => {
            typingIndicator.classList.remove('visible');
            addMessage('This is a demo response. In the full app, I would analyze your transcription.', 'assistant');
        }, 1500);
    }

    sendChatBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        msgDiv.textContent = text;
        chatMessages.insertBefore(msgDiv, typingIndicator);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // --- History Logic ---
    function addToHistory(title, date) {
        const historyList = document.getElementById('historyList');
        const emptyState = historyList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        const item = document.createElement('div');
        item.className = 'history-item'; // Needs CSS
        item.style.padding = '15px';
        item.style.borderBottom = '1px solid #eee';
        item.innerHTML = `
            <div style="font-weight: 600;">${title}</div>
            <div style="font-size: 12px; color: #888;">${date}</div>
        `;
        historyList.prepend(item);
    }

    // --- Background Tab Logic (Mock) ---
    const startBackgroundBtn = document.getElementById('startBackgroundCaptureBtn');
    const stopBackgroundBtn = document.getElementById('stopBackgroundBtn');
    const backgroundStatus = document.getElementById('backgroundStatus');

    startBackgroundBtn.addEventListener('click', () => {
        backgroundStatus.className = 'status recording';
        backgroundStatus.querySelector('.status-text').textContent = 'Background recording active...';
        startBackgroundBtn.disabled = true;
        stopBackgroundBtn.disabled = false;
    });

    stopBackgroundBtn.addEventListener('click', () => {
        backgroundStatus.className = 'status idle';
        backgroundStatus.querySelector('.status-text').textContent = 'Ready for background transcription.';
        startBackgroundBtn.disabled = false;
        stopBackgroundBtn.disabled = true;
    });

    // --- User Info (Mock) ---
    document.getElementById('userId').textContent = 'Demo User';
    document.getElementById('subscriptionBadge').textContent = 'PRO';
});
