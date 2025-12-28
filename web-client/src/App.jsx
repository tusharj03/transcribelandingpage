
import React, { useEffect, useRef, useState } from 'react';
import './index.css';
import HistoryTab, { saveToHistory } from './components/HistoryTab';
import AINotesTab from './components/AINotesTab';
import ChatTab from './components/ChatTab';
import Sidebar from './components/Sidebar';
import { useAuth } from './hooks/useAuth';
import { useLiveNotes } from './hooks/useLiveNotes';
import { useLiveAssist } from './hooks/useLiveAssist';
import { marked } from 'marked';

// We'll use FontAwesome for icons by adding the CDN link in index.html, 
// matching the original app.

// ===============================
// 🔌 Universal Native Host Client
// ===============================
class NativeHostClient {
  constructor() {
    this.mode = 'extension'; // 'extension' | 'websocket'
    this.ws = null;
    this.wsPort = 3000;
    this.extensionId = 'lamboikcmffdoaolbcdadahfbejjcioe';
    this.isConnected = false;
  }

  async connect() {
    // 1. Try Chrome Extension first
    if (window.chrome && window.chrome.runtime && window.chrome.runtime.sendMessage) {
      try {
        const response = await new Promise((resolve) => {
          // Timeout for extension check
          const pid = setTimeout(() => resolve(null), 1000);
          try {
            window.chrome.runtime.sendMessage(this.extensionId, { action: 'ping' }, (res) => {
              clearTimeout(pid);
              if (window.chrome.runtime.lastError) resolve(null);
              else resolve(res);
            });
          } catch (e) { clearTimeout(pid); resolve(null); }
        });

        if (response && response.type === 'PONG') {
          console.log("✅ Native Host connected via Chrome Extension");
          this.mode = 'extension';
          this.isConnected = true;
          return true;
        }
      } catch (e) {
        console.log("Extension check failed, trying WebSocket...");
      }
    }

    // 2. Fallback to WebSocket (Safari, Firefox, Standalone)
    return this.connectWebSocket();
  }

  connectWebSocket() {
    return new Promise((resolve) => {
      try {
        console.log("🔄 Attempting WebSocket connection to Native Host...");
        const socket = new WebSocket(`ws://localhost:${this.wsPort}`);
        this.ws = socket;

        socket.onopen = () => {
          console.log("✅ Native Host connected via WebSocket (Universal Mode)");
          this.mode = 'websocket';
          this.isConnected = true;
          // Send initial ping to verify plumbing, using EXPLICIT socket to avoid race
          this.sendMessage({ action: 'ping' }, (res) => {
            console.log("WS Ping valid:", res);
            resolve(true);
          }, socket);
        };

        this.ws.onerror = (err) => {
          console.warn("❌ WebSocket connection failed:", err);
          this.isConnected = false;
          resolve(false);
        };

        this.ws.onmessage = (event) => {
          // Handled by request callbacks usually, but here we might need a global listener if we support push
          // For now, simpler request-response pattern validation
        };

      } catch (e) {
        console.error("WS Setup error:", e);
        resolve(false);
      }
    });
  }

  sendMessage(message, callback, explicitSocket = null) {
    if (this.mode === 'extension') {
      if (window.chrome && window.chrome.runtime) {
        window.chrome.runtime.sendMessage(this.extensionId, message, callback);
      } else {
        callback({ type: 'ERROR', message: 'Extension API unavailable' });
      }
    } else if (this.mode === 'websocket') {
      const targetWs = explicitSocket || this.ws;
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        // Simple One-Off Implementation:
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        message.requestId = requestId;

        const listener = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.requestId === requestId || (data.type === 'PONG' && message.action === 'ping')) {
              targetWs.removeEventListener('message', listener);
              callback(data);
            }
          } catch (e) { /* ignore */ }
        };
        targetWs.addEventListener('message', listener);
        targetWs.send(JSON.stringify(message));
      } else {
        const state = targetWs ? targetWs.readyState : 'null';
        console.warn(`WS Not Open. State: ${state}, Explicit: ${!!explicitSocket}`);
        callback({ type: 'ERROR', message: 'WebSocket not connected' });
      }
    } else {
      callback({ type: 'ERROR', message: 'No connection mode active' });
    }
  }
}

const nativeClient = new NativeHostClient();

function App() {
  // Tabs State
  // Tab State
  const [activeTab, setActiveTab] = useState('transcribe'); // 'transcribe', 'history', 'notes', 'chat'

  // Auth Hook
  const { user, login, logout, checkAccess } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [nativeHostConnected, setNativeHostConnected] = useState(false);
  const EXTENSION_ID = 'iddimggbohccfikpkeelhaceooojfiga';

  // Popup State
  const [showSlowPopup, setShowSlowPopup] = useState(false);
  const [showUpsellPopup, setShowUpsellPopup] = useState(false);

  // Transcribe Tab State
  const [transcribeCategory, setTranscribeCategory] = useState('file'); // 'live', 'background', 'file'

  // LIVE TAB State
  const [liveSubTab, setLiveSubTab] = useState('transcript'); // 'transcript', 'notes', 'assist'
  const [outputSubTab, setOutputSubTab] = useState('transcript'); // 'transcript', 'notes', 'assist'
  const [viewingFile, setViewingFile] = useState(null); // For 'file' mode, which file we are viewing
  const [transcriptionSource, setTranscriptionSource] = useState('tab'); // 'tab', 'mic', 'system' (default 'tab')

  // BACKGROUND TAB State
  const [backgroundMuted, setBackgroundMuted] = useState(false);

  // RAPID TRANSCRIBE State
  const [showTabSelector, setShowTabSelector] = useState(false);
  const [availableTabs, setAvailableTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(false);

  // Model State
  const [selectedModel, setSelectedModel] = useState('base');

  // Mobile Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Worker & Transcription State
  const [status, setStatus] = useState('idle'); // idle, loading-model, recording, transcribing, complete, error
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [transcription, setTranscription] = useState('');
  const [transcribeFiles, setTranscribeFiles] = useState([]);
  const [transcribeQueue, setTranscribeQueue] = useState([]);
  const [completedTranscriptions, setCompletedTranscriptions] = useState([]);
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const [lastMetrics, setLastMetrics] = useState(null);
  const [lastProfile, setLastProfile] = useState(null);
  const [viewingSavedNotes, setViewingSavedNotes] = useState(false);

  // Live AI Hooks
  const { liveNotes } = useLiveNotes({
    isRecording: status === 'recording',
    transcription
  });

  const { messages: assistMessages, loading: assistLoading, sendMessage: sendAssistMessage } = useLiveAssist({
    liveNotes,
    transcription,
    isRecording: status === 'recording'
  });

  // Audio Recording State
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const [recordingTime, setRecordingTime] = useState('00:00:00');
  const recordingInterval = useRef(null);
  const audioContextRef = useRef(null);

  // Worker Reference
  const worker = useRef(null);
  const activeJobRef = useRef(null);
  const queueRef = useRef([]);

  const modelDisplayName = (key) => {
    const map = {
      base: 'Base',
      small: 'Small',
    };
    return map[key] || key;
  };

  const resolveModelId = (name) => {
    if (name === 'base') return 'Xenova/whisper-base.en';
    if (name === 'small') return 'distil-whisper/distil-small.en';
    return 'Xenova/whisper-base.en';
  };

  // Initialize Worker
  useEffect(() => {
    const formatProgressPercent = (value) => {
      if (typeof value !== 'number' || Number.isNaN(value)) return 0;
      const normalized = value <= 1 ? value * 100 : value;
      return Math.max(0, Math.min(100, normalized));
    };
    const clampPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

    if (!worker.current) {
      worker.current = new Worker(new URL('./worker.js', import.meta.url), {
        type: 'module',
      });

      worker.current.onmessage = (e) => {
        const { type, data } = e.data;
        if (type === 'worker-alive') {
          console.log('🧵 worker-alive', e.data);
          return;
        }
        if (type === 'download') {
          if (data.status === 'progress') {
            setDownloadProgress(formatProgressPercent(data.progress));
            setStatus('loading-model');
          }
        } else if (type === 'ready') {
          setStatus('idle');
        } else if (type === 'result') {
          handleJobCompletion(data?.jobId, data?.text || '');
          if (data?.metrics) setLastMetrics(data.metrics);
        } else if (type === 'progress') {
          if (data?.jobId) {
            setTranscribeQueue(prev => prev.map(job => job.id === data.jobId
              ? { ...job, status: 'processing', progress: clampPercent(data.percent) }
              : job));
          }
        } else if (type === 'error') {
          console.error(data);
          setStatus('error');
          if (data?.jobId) {
            handleJobError(data.jobId, data.message || 'Unknown error');
          }
          // alert('Error: ' + (data?.message || data)); // Suppress alert for cleaner UI if needed, but keeping for now.
          alert('Error: ' + (data?.message || data));
        }
      };

      // Trigger load
      worker.current.postMessage({ type: 'load', model: resolveModelId(selectedModel) });
    }

  }, []);

  // Monitor Transcription Time for "Slow" Popup
  useEffect(() => {
    let timer;
    if ((status === 'transcribing' || status === 'loading-model') && !nativeHostConnected) {
      const startTime = Date.now();
      timer = setInterval(() => {
        if (Date.now() - startTime > 30000) { // 30 seconds
          // Only show if we haven't shown it recently or just once per session?
          // For now, just show it.
          setShowSlowPopup(true);
          clearInterval(timer); // Show once per long job
        }
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [status, nativeHostConnected]);

  // Upsell Popup Logic (Random/Timer)
  useEffect(() => {
    if (nativeHostConnected) return; // Don't upsell if they have the app connected

    // Show upsell popup after 5 minutes (300000ms) or randomly
    const timer = setTimeout(() => {
      // Simple check to not show if user is deep in something else? Nah, just show it.
      // Maybe check if we haven't shown it yet
      setShowUpsellPopup(true);
    }, 300000);

    return () => clearTimeout(timer);
  }, [nativeHostConnected]);

  // Debug State
  useEffect(() => {
    console.log("👉 Native Host State Changed:", nativeHostConnected);
  }, [nativeHostConnected]);

  // Check Native Host Connection
  useEffect(() => {
    const checkConnection = async () => {
      console.log("🕵️‍♂️ Checking connection...");
      const connected = await nativeClient.connect();
      console.log("🕵️‍♂️ Connection Result:", connected);
      setNativeHostConnected(!!connected);
    };

    // Check immediately
    checkConnection();
    // Retry once after 2 seconds
    setTimeout(checkConnection, 2000);
  }, []);

  // Keep queue in sync for helpers
  useEffect(() => {
    queueRef.current = transcribeQueue;
  }, [transcribeQueue]);

  // --- Audio Processing Helper ---

  const readAudioFrom = (fileOrBlob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function () {
        const arrayBuffer = reader.result;
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        const audioContext = audioContextRef.current;

        const tDecodeStart = performance.now();
        audioContext.decodeAudioData(arrayBuffer, (decodedAudio) => {
          const decodeMs = performance.now() - tDecodeStart;
          const audioData = decodedAudio.getChannelData(0); // Get first channel
          resolve({
            audio: audioData,
            sampleRate: decodedAudio.sampleRate,
            decodeMs,
          });
        }, (err) => reject(err));
      };
      reader.readAsArrayBuffer(fileOrBlob);
    });
  }

  // --- Handlers ---

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setTranscribeFiles(prev => [...prev, ...files]);
      e.target.value = null; // Allow re-uploading same file
    }
  };

  const removeFile = (index) => {
    setTranscribeFiles(prev => prev.filter((_, i) => i !== index));
  };

  // --- Transcription Queue Helpers ---

  const processWithWorker = async (job) => {
    try {
      const { audio, sampleRate, decodeMs } = await readAudioFrom(job.file);
      worker.current.postMessage(
        {
          type: 'transcribe',
          audioBuffer: audio.buffer,
          sampleRate,
          jobId: job.id,
          debugProfile: typeof localStorage !== 'undefined' && localStorage.getItem('whisperProfile') === '1',
          stageTiming: true,
          decodeMs,
        },
        [audio.buffer]
      );
    } catch (err) {
      handleJobError(job.id, err.message);
    }
  };

  const startNextJob = async () => {
    if (activeJobRef.current) return;
    const nextJob = queueRef.current.find(j => j.status === 'pending');
    if (!nextJob) {
      setStatus(completedTranscriptions.length ? 'complete' : 'idle');
      return;
    }

    activeJobRef.current = nextJob;
    setStatus('transcribing');
    const updatedQueue = queueRef.current.map(job => job.id === nextJob.id ? { ...job, status: 'processing', progress: Math.max(job.progress || 0, 1) } : job);
    queueRef.current = updatedQueue;
    setTranscribeQueue(updatedQueue);

    if (nativeHostConnected) {
      // Native Host Path
      console.log("Transcribing file via Native Host...");
      const reader = new FileReader();
      reader.onloadend = () => {
        // Safely extract base64 data. 
        const parts = reader.result.split(',');
        const base64data = parts[parts.length - 1];

        // Map model name for Native Host (whisper.cpp)
        const nativeModel = selectedModel === 'small' ? 'ggml-small.bin' : 'ggml-base.bin';

        nativeClient.sendMessage({
          action: 'transcribe_audio',
          audioData: base64data,
          model: nativeModel,
          language: 'en'
        }, (response) => {
          if (!response || response.type === 'ERROR') {
            console.warn("Native Host Transcription Failed, falling back to worker:", response);
            // Fallback to worker
            processWithWorker(nextJob);
          } else if (response.type === 'TRANSCRIPT') {
            handleJobCompletion(nextJob.id, response.text);
          }
        });
      };
      reader.readAsDataURL(nextJob.file);
    } else {
      // Worker Path
      processWithWorker(nextJob);
    }
  };

  const handleJobCompletion = (jobId, text) => {
    const job = queueRef.current.find(j => j.id === jobId) || activeJobRef.current;

    // For non-queued jobs (e.g., mic/system audio), fall back to the legacy flow
    if (!job && !queueRef.current.length) {
      activeJobRef.current = null;
      setTranscription(text);
      setStatus('complete');
      saveToHistory(`Transcription ${new Date().toLocaleTimeString()}`, text, 'transcription', selectedModel);
      return;
    }

    const remaining = queueRef.current.filter(j => j.id !== jobId);
    queueRef.current = remaining;
    setTranscribeQueue(remaining);

    if (job) {
      const completed = { ...job, status: 'completed', progress: 100, transcript: text };
      setCompletedTranscriptions(prev => [...prev, completed]);
      setTranscription(text); // Keep latest transcript accessible to other tabs
      saveToHistory(`Transcription - ${job.name}`, text, 'transcription', selectedModel);
    }

    activeJobRef.current = null;
    if (remaining.some(j => j.status === 'pending')) {
      startNextJob();
    } else {
      setStatus('complete');
    }
  };

  const handleJobError = (jobId, message) => {
    const job = queueRef.current.find(j => j.id === jobId);

    if (!job && !queueRef.current.length) {
      activeJobRef.current = null;
      setStatus('error');
      return;
    }

    const remaining = queueRef.current.filter(j => j.id !== jobId);
    queueRef.current = remaining;
    setTranscribeQueue(prev => prev.filter(j => j.id !== jobId));

    if (job) {
      setCompletedTranscriptions(prev => [...prev, { ...job, status: 'error', progress: 0, transcript: message }]);
    }
    activeJobRef.current = null;
    if (remaining.some(j => j.status === 'pending')) {
      setStatus('transcribing');
      startNextJob();
    } else {
      setStatus('error');
    }
  };

  const formatFileSize = (size) => `${(size / 1024 / 1024).toFixed(2)} MB`;

  const handleDownloadTxt = (text) => {
    const element = document.createElement("a");
    const file = new Blob([text], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `transcription-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleCreateAINotes = (text) => {
    // Save to history first if needed, but we typically auto-save.
    // We need to switch to AI Notes tab and somehow pass this text.
    // The AINotesTab takes 'currentTranscription' prop which is linked to 'transcription' state.
    // So just switching tab is enough.
    setActiveTab('notes');
  };

  const startTranscription = () => {
    if (!user || (!user.authenticated && !user.offlineMode)) {
      setShowLoginModal(true);
      return;
    }
    if (transcribeFiles.length === 0) {
      alert("Please select a file first.");
      return;
    }

    const timestamp = Date.now();
    const queue = transcribeFiles.map((file, idx) => ({
      id: `${timestamp}-${idx}-${file.name}`,
      file,
      name: file.name,
      size: file.size,
      status: 'pending',
      progress: 0,
      transcript: ''
    }));

    setTranscribeQueue(queue);
    queueRef.current = queue;
    activeJobRef.current = null;
    setCompletedTranscriptions([]);
    setTranscribeFiles([]); // move files into queue
    setTranscription('');
    startNextJob();
  };

  const startMicrophoneRecording = () => {
    if (!user || (!user.authenticated && !user.offlineMode)) {
      setShowLoginModal(true);
      return;
    }

    if (!('webkitSpeechRecognition' in window)) {
      alert("Web Speech API is not supported in this browser. Please use Chrome/Edge or download the Desktop App.");
      return;
    }

    const recognition = new window.webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US'; // Could make this configurable

    recognition.onstart = () => {
      setStatus('recording');
      startTimer();
      setTranscription('');
      mediaRecorder.current = recognition; // Reuse ref for storage
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      // For continuous update, we might need to accumulate. 
      // Actually webkitSpeechRecognition accumulates history in the session usually.
      // But let's just use what it gives us.
      // Wait, if we set transcription here, it updates the UI live.
      // 'finalTranscript' won't contain previous segments if we only loop from resultIndex.
      // Actually, we should loop from 0 if we want full text, OR maintain a running buffer.
      // Let's rely on event.results accumulator.

      let allText = '';
      for (let i = 0; i < event.results.length; ++i) {
        allText += event.results[i][0].transcript;
      }
      setTranscription(allText);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setStatus('error');
    };

    recognition.onend = () => {
      // If manually stopped, status might already be changing. 
      // If it stopped due to silence/error, we need to handle it.
      if (status === 'recording') {
        // Auto-save logic
        // Wait, we need to access the latest transcription state. 
        // State 'transcription' is updated in onresult.
        // However, inside this callback, state might be stale if closure issue.
        // But we are in a function created each render? No, this is defined in component.
        // 'transcription' state might be stale here. Use ref or just let the stop handler handle it?
        // Actually, let's use a ref for current text just to be safe for saving.
      }
      stopTimer();
      setStatus('complete'); // Go straight to complete, no "transcribing" phase needed for Web API

      // We need to save to history here.
      // Caveat: accessing up-to-date 'transcription' state here.
      // Let's rely on the fact that onresult updated the state, 
      // but to be safe, we should probably check if we can pass it or use a ref.
      // For simplicity in this plan: we will trigger save in stopRecording or let the user see it.
      // But the request said: "if they click the mic again, make sure to save to history".
      // Clicking mic again calls stopRecording.
    };

    recognition.start();
  };

  const startRapidTranscription = (tab) => {
    try {
      if (!window.chrome || !window.chrome.runtime) {
        console.error("Rapid Transcribe: Chrome extension API not available.");
        return;
      }

      console.log(`[RapidTranscribe] Starting for: ${tab.title} (${tab.url})`);
      setStatus('transcribing');
      setShowTabSelector(false); // Close modal

      // Safety timeout - if extension doesn't reply in 30s, assume it failed/crashed
      const safetyTimeout = setTimeout(() => {
        console.error("[RapidTranscribe] TIMEOUT: No response from extension after 30 seconds.");
        alert("Timeout: The extension did not respond.\n\nPossible causes:\n1. Native Host is not running or crashed.\n2. Extension is stuck.\n\nPlease check the logs.");
        setStatus('idle');
      }, 30000);

      window.chrome.runtime.sendMessage(EXTENSION_ID, {
        action: "transcribe_url",
        url: tab.url,
        // We can pass tabId if extension needs it to focus/highlight
        source: "web_client_rapid"
      }, (res) => {
        clearTimeout(safetyTimeout);
        console.log("[RapidTranscribe] Raw callback received from extension:", res);
        if (window.chrome.runtime.lastError) {
          console.error("[RapidTranscribe] Runtime Error:", window.chrome.runtime.lastError);
          alert(`Transcription Error: ${window.chrome.runtime.lastError.message}`);
          setStatus('idle');
          return;
        }

        console.log("[RapidTranscribe] Response:", res);

        // Handle Final Result (Async via requestId)
        if (res && res.type === 'TRANSCRIPT') {
          // Success
          console.log("[RapidTranscribe] Transcription success:", res.text.substring(0, 50) + "...");
          setTranscription(res.text);
          setStatus('idle');
          alert(`Transcription Complete for: ${tab.title}`);
        } else if (res && (res.error || res.type === 'ERROR')) {
          const errMsg = res.error || res.message || "Unknown error";
          console.error("[RapidTranscribe] Failed with error:", errMsg);
          alert(`Failed: ${errMsg}`);
          setStatus('idle');
        } else {
          // If we get here it might mean the extension sent something else, or nothing.
          console.warn("[RapidTranscribe] Unexpected response format:", res);
          if (res && res.status === 'processing') {
            // Fallback if extension wasn't reloaded properly
            alert("Updating extension... please reload the extension.");
          } else {
            // It's possible the extension sent nothing?
            console.log("[RapidTranscribe] Response was empty or invalid.");
            setStatus('idle');
          }
        }
      });
    } catch (e) {
      console.error("[RapidTranscribe] Exception:", e);
      alert("Error starting transcription: " + e.message);
      setStatus('idle');
    }
  };

  const handleRapidTranscribeClick = () => {
    try {
      if (!window.chrome || !window.chrome.runtime) {
        console.error("Rapid Transcribe Check Failed details:", {
          hasChrome: !!window.chrome,
          hasRuntime: !!(window.chrome && window.chrome.runtime),
          userAgent: navigator.userAgent
        });
        alert(`Extension not detected!\n\nTroubleshooting:\n1. Ensure 'Resonote' extension is installed.\n2. Go to chrome://extensions and click 'Reload' on the extension.\n3. Refresh this page.\n4. Ensure you are on http://localhost:5173 (or allowed domain).`);
        return;
      }

      console.log("Rapid Transcribe Clicked. Fetching available tabs...");
      setTabsLoading(true);

      // Timeout for GET_TABS
      const timeoutId = setTimeout(() => {
        if (tabsLoading) {
          setTabsLoading(false);
          alert("Extension setup issue: The extension is not responding.\n\nPlease:\n1. Open chrome://extensions\n2. Reload the 'Resonote' extension\n3. Refresh this page.");
        }
      }, 3000);

      // Get list of open tabs (doesn't need native host)
      const msg = { action: "GET_TABS" };
      window.chrome.runtime.sendMessage(EXTENSION_ID, msg, (response) => {
        clearTimeout(timeoutId);
        setTabsLoading(false);

        if (window.chrome.runtime.lastError) {
          console.error("[RapidTranscribe] GET_TABS Error:", window.chrome.runtime.lastError);
          // If the error is regarding messaging, it might be due to missing permissions or extension not installed.
          alert(`Extension Error: ${window.chrome.runtime.lastError.message}\n\nMake sure the extension is installed and allowed to communicate with this site.`);
          return;
        }

        console.log("[RapidTranscribe] GET_TABS Response:", response);

        if (response && response.success && Array.isArray(response.tabs)) {
          console.log(`Found ${response.tabs.length} tabs.`);
          setAvailableTabs(response.tabs);
          setShowTabSelector(true);
        } else {
          alert("Could not fetch open tabs. Please try reloading the extension.");
        }
      });
    } catch (e) {
      console.error("Critical Error in Rapid Transcribe:", e);
      alert(`Critical Error: ${e.message}`);
    }
  };

  // Special Web Feature: Record "Background" (System Audio) via Screen Share
  const startSystemAudioRecording = async () => {
    if (!user || (!user.authenticated && !user.offlineMode)) {
      setShowLoginModal(true);
      return;
    }

    // Handle Mute Logic if toggle is on
    if (backgroundMuted && window.chrome && window.chrome.runtime) {
      window.chrome.runtime.sendMessage(EXTENSION_ID, { action: "GET_ACTIVE_TAB_INFO" }, (response) => {
        if (response && response.success) {
          window.chrome.runtime.sendMessage(EXTENSION_ID, {
            action: "MUTE_TAB",
            tabId: response.tabId,
            muted: true
          });
        }
      });
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

      // Check if user shared audio
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        alert("Please make sure to check 'Share System Audio' when selecting a screen/tab!");
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      setStatus('recording');
      startTimer();
      setTranscription('');

      // If connected to Native Host, use Live Streaming
      if (nativeHostConnected && window.chrome && window.chrome.runtime) {
        try {
          console.log("Starting Live System Transcription via Native Host...");
          const port = window.chrome.runtime.connect(EXTENSION_ID, { name: "resonote-stream" });

          // Store port in a ref to clean up later
          if (!window.extensionPortRef) window.extensionPortRef = {}; // specific ref?
          // Actually, we can attach it to mediaRecorder.current or a new ref.
          // Let's use a new ref or attach to the recorder object for cleanup visibility.
          const streamId = `stream_${Date.now()}`;

          port.onMessage.addListener((msg) => {
            if (msg.type === 'STREAMING_TRANSCRIPT') {
              // Update transcription live!
              // msg.currentTranscript is the text of the *current chunk*.
              // We need to accumulate it intelligently or just append.
              // Simple append for V1, maybe with dedupe if needed.
              // Actually, native_host returns the *text of the chunk*.
              if (msg.currentTranscript) {
                setTranscription(prev => {
                  const newText = msg.currentTranscript.trim();
                  if (!newText) return prev;
                  // avoid double spacing
                  return prev ? `${prev} ${newText}` : newText;
                });
              }
            } else if (msg.type === 'ERROR') {
              console.error("Native Host Stream Error:", msg.message);
              setTranscription(prev => `${prev}\n[Error: ${msg.message}]`);
            }
          });

          // Handle accidental disconnects (e.g. extension reload or stale SW)
          port.onDisconnect.addListener(() => {
            if (window.chrome.runtime.lastError) {
              console.warn("Port disconnected due to error:", window.chrome.runtime.lastError.message);
            } else {
              console.log("Port disconnected");
            }

            // If we are still recording, this is unexpected!
            if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
              setTranscription(prev => `${prev}\n\n[System]: Connection to extension lost. Please reload the extension to enable live streaming.`);
              // Optionally stop or fallback? Stopping is safer to avoid silent failure.
              stopRecording();
            }
          });

          mediaRecorder.current = new MediaRecorder(stream);
          audioChunks.current = [];

          mediaRecorder.current.ondataavailable = async (event) => {
            if (event.data.size > 0 && port) { // Check port existence
              // Convert to base64 and send
              const blob = event.data;
              const reader = new FileReader();
              reader.onloadend = () => {
                // Safely extract base64 data. 
                // Note: The MIME type can contain commas (e.g. codecs), so simple split(',')[1] is unsafe.
                // Base64 does not contain commas, so grabbing the last part is safe.
                const parts = reader.result.split(',');
                const base64data = parts[parts.length - 1];

                try {
                  port.postMessage({
                    action: "transcribe_audio_stream",
                    audioData: base64data,
                    streamId: streamId,
                  });
                } catch (err) {
                  console.error("Failed to post message to port:", err);
                }
              };
              reader.readAsDataURL(blob);
            }
          };

          mediaRecorder.current.onstop = () => {
            try {
              port.disconnect();
              // Unmute if we muted on start
              if (backgroundMuted && window.chrome && window.chrome.runtime) {
                window.chrome.runtime.sendMessage(EXTENSION_ID, { action: "GET_ACTIVE_TAB_INFO" }, (response) => {
                  if (response && response.success) {
                    window.chrome.runtime.sendMessage(EXTENSION_ID, {
                      action: "MUTE_TAB",
                      tabId: response.tabId,
                      muted: false
                    });
                  }
                });
              }
            } catch (e) { /* ignore */ }

            stream.getTracks().forEach(t => t.stop());
            setStatus('complete');
            stopTimer();
          };

          // Stop if user clicks "Stop Sharing"
          stream.getVideoTracks()[0].onended = () => {
            stopRecording();
          };

          // Start recording with 1s timeslices for low latency
          mediaRecorder.current.start(1000);
          // Save reference to port for manual stop
          mediaRecorder.current.extensionPort = port;

          return; // Exit, avoiding the fallback logic below
        } catch (e) {
          console.error("Failed to connect to extension for streaming:", e);
          // Fallback to standard logic is below...
        }
      }

      // Fallback: Standard Offline/Worker-based (Original Logic)
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        setStatus('transcribing');

        try {
          const { audio, sampleRate, decodeMs } = await readAudioFrom(audioBlob);
          worker.current.postMessage(
            {
              type: 'transcribe',
              audioBuffer: audio.buffer,
              sampleRate,
              debugProfile: typeof localStorage !== 'undefined' && localStorage.getItem('whisperProfile') === '1',
              stageTiming: true,
              decodeMs,
            },
            [audio.buffer]
          );
        } catch (err) {
          console.error("System audio decoding failed", err);
          setTranscription(`Error processing audio: ${err.message}`);
          setStatus('error');
        }

        stream.getTracks().forEach(t => t.stop());
      };

      stream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };

      mediaRecorder.current.start();

    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current) {
      // Clean up extension port if present (for Live System Streaming)
      if (mediaRecorder.current.extensionPort) {
        try {
          mediaRecorder.current.extensionPort.disconnect();
        } catch (e) { /* ignore */ }
      }

      // Check if it's the Web Speech API object (has .stop() and .abort()) or MediaRecorder
      if (mediaRecorder.current.getVideoTracks) {
        // System audio (MediaRecorder)
        mediaRecorder.current.stop();
      } else if (typeof mediaRecorder.current.stop === 'function') {
        // Web Speech API or MediaRecorder
        mediaRecorder.current.stop();
      }

      // Manual save for Web Speech API since its async nature might be tricky 
      // and we want to ensure it's saved when user clicks stop.
      if (transcribeCategory === 'live' && transcription) {
        saveToHistory(`Live Recording ${new Date().toLocaleTimeString()}`, transcription, 'transcription', 'google-speech');
      }
    }
    stopTimer();
  };

  // Timer Logic
  const startTimer = () => {
    let seconds = 0;
    setRecordingTime("00:00:00");
    clearInterval(recordingInterval.current);
    recordingInterval.current = setInterval(() => {
      seconds++;
      const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      setRecordingTime(`${h}:${m}:${s}`);

      // Upsell: If transcription takes > 30s in web, suggest app
      // Note: This timer is for RECORDING, but user asked for "transcribing > 30s"
      // Wait, the timer logic is used for recording. For file transcription, there is no visual timer in the UI state `recordingTime`.
      // But we can check `status` or use a separate ref for transcription duration.
      // However, `recordingInterval` is used for recording.
      // For file transcription, we might need a separate effect.
    }, 1000);
  };

  const stopTimer = () => {
    clearInterval(recordingInterval.current);
  };

  const switchModel = (modelName) => {
    if (selectedModel === modelName) return;

    setSelectedModel(modelName);
    setStatus('loading-model');
    setDownloadProgress(0);

    const fullModelName = resolveModelId(modelName);
    worker.current.postMessage({ type: 'load', model: fullModelName });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginEmail) return setLoginError('Please enter your email address');
    if (!loginPassword) return setLoginError('Please enter your password');

    setLoginError('');
    setLoginLoading(true);

    try {
      const result = await login(loginEmail, loginPassword);
      if (result.success) {
        setShowLoginModal(false);
        setLoginEmail('');
        setLoginPassword('');
      } else {
        setLoginError(result.error);
      }
    } catch (err) {
      setLoginError('An unexpected error occurred.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Callback to load item from history
  const loadFromHistory = (item) => {
    setTranscription(item.transcript);
    // Explicitly set status to complete so results show up
    setStatus('complete');

    // Switch to the relevant tab based on type
    if (item.type === 'notes') {
      setActiveTab('notes');
      setViewingSavedNotes(true);
    } else {
      setActiveTab('transcribe');
      setViewingSavedNotes(false);
      // For File category, the UI requires the 'completedTranscriptions' array to be populated
      // to show anything. We must mock a completed job so the user sees the text.
      if (transcribeCategory === 'file') {
        setCompletedTranscriptions([{
          id: item.id,
          name: item.name,
          status: 'completed',
          progress: 100,
          transcript: item.transcript
        }]);
        setTranscribeQueue([]); // Clear queue to avoid confusion
      } else {
        // For Live/Background, setCategory to file so it uses the standard view?
        // Or keep it. The user likely wants to see it in the "File" view style if they are loading old history.
        setTranscribeCategory('file');
        setCompletedTranscriptions([{
          id: item.id,
          name: item.name,
          status: 'completed',
          progress: 100,
          transcript: item.transcript
        }]);
        setTranscribeQueue([]);
      }
    }
  };

  // --- Render ---

  // NOTE: This JSX structure mirrors the index.html structure almost exactly, 
  // but using React state for showing/hiding tabs and categories.
  const safeDownloadProgress = Math.max(0, Math.min(100, downloadProgress || 0));

  return (
    <div className="app-layout">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRapidTranscribe={handleRapidTranscribeClick}
        user={user}
        onLogin={() => setShowLoginModal(true)}
        onLogout={logout}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      <main className="main-content">
        {nativeHostConnected && (
          <div className="native-badge-inline">
            <i className="fas fa-check-circle"></i> Native App Connected
          </div>
        )}

        <div className="dashboard-header">
          <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(true)} style={{ marginBottom: '16px' }}>
            <i className="fas fa-bars"></i>
          </button>

        </div>

        {/* Transcribe Content */}
        {activeTab === 'transcribe' && (
          <div className="tab-content active">
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  <i className="fas fa-microphone-alt"></i> Transcription Mode
                </div>
                <div className="transcription-categories">
                  <button className={`category-btn ${transcribeCategory === 'live' ? 'active' : ''}`} onClick={() => setTranscribeCategory('live')}>
                    <i className="fas fa-microphone"></i> Live
                  </button>
                  <button className={`category-btn ${transcribeCategory === 'background' ? 'active' : ''}`} onClick={() => setTranscribeCategory('background')}>
                    <i className="fas fa-desktop"></i> Background
                  </button>
                  <button className={`category-btn ${transcribeCategory === 'file' ? 'active' : ''}`} onClick={() => setTranscribeCategory('file')}>
                    <i className="fas fa-upload"></i> File
                  </button>
                </div>
              </div>

              {/* LIVE CATEGORY */}
              {transcribeCategory === 'live' && (
                <div className="category-content active">

                  {/* 1. Audio Source Selector (Big & Prominent) */}
                  <div className="audio-source-section" style={{ marginBottom: '30px' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', fontWeight: '600', color: 'var(--gray)' }}>Select Audio Source</label>
                    <div className="source-buttons-large" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                      <button
                        className={`source-btn-lg ${transcriptionSource === 'tab' ? 'active' : ''}`}
                        onClick={() => setTranscriptionSource('tab')}
                        style={{
                          padding: '20px',
                          border: '2px solid var(--gray-light)',
                          borderRadius: '16px',
                          background: transcriptionSource === 'tab' ? 'var(--primary-light)' : 'white',
                          borderColor: transcriptionSource === 'tab' ? 'var(--primary)' : 'var(--gray-light)',
                          color: transcriptionSource === 'tab' ? 'var(--primary-dark)' : 'var(--gray)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'
                        }}
                      >
                        <i className="fas fa-desktop" style={{ fontSize: '24px' }}></i>
                        <span style={{ fontWeight: '600' }}>Tab Audio</span>
                      </button>

                      <button
                        className={`source-btn-lg ${transcriptionSource === 'mic' ? 'active' : ''}`}
                        onClick={() => setTranscriptionSource('mic')}
                        style={{
                          padding: '20px',
                          border: '2px solid var(--gray-light)',
                          borderRadius: '16px',
                          background: transcriptionSource === 'mic' ? 'var(--primary-light)' : 'white',
                          borderColor: transcriptionSource === 'mic' ? 'var(--primary)' : 'var(--gray-light)',
                          color: transcriptionSource === 'mic' ? 'var(--primary-dark)' : 'var(--gray)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'
                        }}
                      >
                        <i className="fas fa-microphone" style={{ fontSize: '24px' }}></i>
                        <span style={{ fontWeight: '600' }}>Microphone</span>
                      </button>

                      <button
                        className={`source-btn-lg ${transcriptionSource === 'system' ? 'active' : ''}`}
                        onClick={() => setTranscriptionSource('system')}
                        style={{
                          padding: '20px',
                          border: '2px solid var(--gray-light)',
                          borderRadius: '16px',
                          background: transcriptionSource === 'system' ? 'var(--primary-light)' : 'white',
                          borderColor: transcriptionSource === 'system' ? 'var(--primary)' : 'var(--gray-light)',
                          color: transcriptionSource === 'system' ? 'var(--primary-dark)' : 'var(--gray)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'
                        }}
                      >
                        <i className="fas fa-volume-up" style={{ fontSize: '24px' }}></i>
                        <span style={{ fontWeight: '600' }}>System</span>
                      </button>
                    </div>
                  </div>

                  {/* 2. Controls & Timer */}
                  <div className="live-controls" style={{ textAlign: 'center', marginBottom: '30px' }}>
                    {status === 'recording' && (
                      <div className="live-timer" style={{ fontSize: '2.5rem', fontWeight: '700', fontFamily: 'monospace', color: 'var(--dark)', marginBottom: '20px', letterSpacing: '-1px' }}>
                        {recordingTime}
                      </div>
                    )}

                    <div className="action-buttons-enhanced" style={{ display: 'flex', justifyContent: 'center' }}>
                      {status === 'recording' ? (
                        <button className="btn btn-danger btn-xl" onClick={stopRecording} style={{ padding: '16px 40px', fontSize: '18px', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <i className="fas fa-stop"></i> Stop & Transcribe
                        </button>
                      ) : status === 'transcribing' ? (
                        <button className="btn btn-outline btn-xl" disabled style={{ padding: '16px 40px', fontSize: '18px', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'wait' }}>
                          <i className="fas fa-spinner fa-spin"></i> Processing...
                        </button>
                      ) : (
                        <button className="btn btn-primary btn-xl" onClick={() => {
                          if (transcriptionSource === 'mic') startMicrophoneRecording();
                          else startSystemAudioRecording();
                        }} style={{ padding: '16px 40px', fontSize: '18px', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)' }}>
                          <i className="fas fa-record-vinyl"></i>
                          {transcriptionSource === 'mic' ? 'Start Recording' : 'Start Capture'}
                        </button>
                      )}
                    </div>

                    {status === 'idle' && (
                      <div className="status-hint" style={{ marginTop: '16px', color: 'var(--gray)', fontSize: '14px' }}>
                        <i className="fas fa-info-circle"></i> Ready to capture high-quality audio
                      </div>
                    )}
                  </div>

                  {/* 3. Output Container */}
                  <div className="output-container" style={{ marginBottom: '16px', minHeight: '300px' }}>
                    <div className="output-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                      <div className="output-header-top" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <div className="output-header-left">
                          <div className="output-title"><i className="fas fa-file-alt"></i> Live Output</div>
                        </div>
                        <div className="output-actions">
                          <button className="btn btn-outline" onClick={() => handleDownloadTxt(transcription)}><i className="fas fa-download"></i></button>
                        </div>
                      </div>

                      {/* Subtabs moved here */}
                      <div className="output-subtabs" style={{ display: 'flex', gap: '4px', background: 'var(--gray-light)', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
                        <button
                          className={`sub-tab-btn ${liveSubTab === 'transcript' ? 'active' : ''}`}
                          onClick={() => setLiveSubTab('transcript')}
                          style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                        >
                          Transcript
                        </button>
                        <button
                          className={`sub-tab-btn ${liveSubTab === 'notes' ? 'active' : ''}`}
                          onClick={() => setLiveSubTab('notes')}
                          style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                        >
                          Notes
                        </button>
                        <button
                          className={`sub-tab-btn ${liveSubTab === 'assist' ? 'active' : ''}`}
                          onClick={() => setLiveSubTab('assist')}
                          style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                        >
                          Assist
                        </button>
                      </div>
                    </div>

                    {liveSubTab === 'transcript' && (
                      <div className="output" id="transcript">
                        {transcription || <span style={{ color: 'var(--gray)', fontStyle: 'italic' }}>Waiting for speech...</span>}
                      </div>
                    )}
                    {liveSubTab === 'notes' && (
                      <div
                        id="liveNotes"
                        className="flex-1 overflow-y-auto p-4 text-sm text-[var(--text-secondary)]"
                      >
                        {liveNotes ? (
                          <div dangerouslySetInnerHTML={{ __html: marked.parse(liveNotes) }} />
                        ) : (
                          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--gray)' }}>
                            <i className="fas fa-sticky-note" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.5 }}></i>
                            <p>Live notes will appear here automatically.</p>
                          </div>
                        )}
                      </div>
                    )}
                    {liveSubTab === 'assist' && (
                      <div className="chat-container live-chat-container">
                        <div className="chat-messages" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                          {assistMessages.map((msg, idx) => (
                            <div key={idx} className={`message ${msg.role}`}>
                              {msg.content}
                            </div>
                          ))}
                          {assistLoading && <div className="message assistant"><i className="fas fa-spinner fa-spin"></i></div>}
                        </div>
                        <div className="chat-input-container">
                          <textarea
                            className="chat-input"
                            placeholder="Ask about the live context..."
                            rows="1"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendAssistMessage(e.target.value);
                                e.target.value = '';
                              }
                            }}
                          ></textarea>
                          <button className="send-button" onClick={(e) => {
                            const input = e.target.previousSibling;
                            sendAssistMessage(input.value);
                            input.value = '';
                          }}><i className="fas fa-paper-plane"></i></button>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* BACKGROUND CATEGORY */}
              {transcribeCategory === 'background' && (
                <div className="category-content active">
                  <div className="background-controls-card">
                    <div className="info-header">
                      <i className="fas fa-desktop info-icon-bg"></i>
                      <div className="info-text-group">
                        <h4>Background Capture</h4>
                        <p>Record systems audio or microphone while this tab is in the background.</p>
                      </div>
                    </div>

                    <div className="bg-settings-row">
                      <label className="toggle-label-clean">
                        <span>Mute tab while recording</span>
                        <div className="toggle-switch-wrapper">
                          <input type="checkbox" checked={backgroundMuted} onChange={(e) => setBackgroundMuted(e.target.checked)} />
                          <span className="toggle-slider"></span>
                        </div>
                      </label>
                    </div>

                    <div className="bg-actions-row">
                      {status === 'recording' ? (
                        <button className="btn btn-danger btn-large-block" onClick={stopRecording}>
                          <div className="btn-content-stack">
                            <i className="fas fa-stop-circle"></i>
                            <span>Stop & Transcribe</span>
                          </div>
                        </button>
                      ) : status === 'transcribing' ? (
                        <button className="btn btn-outline btn-large-block disabled" disabled>
                          <div className="btn-content-stack">
                            <i className="fas fa-spinner fa-spin"></i>
                            <span>Processing...</span>
                          </div>
                        </button>
                      ) : (
                        <div className="dual-action-grid">
                          <button className="btn-action-card primary" onClick={() => {
                            if (transcriptionSource === 'mic') startMicrophoneRecording();
                            else startSystemAudioRecording();
                          }}>
                            <i className="fas fa-record-vinyl"></i>
                            <span>Start Capture</span>
                          </button>

                          <button className="btn-action-card rapid" onClick={handleRapidTranscribeClick}>
                            <i className="fas fa-bolt"></i>
                            <span>Rapid Transcribe</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="output-container" style={{ marginBottom: '16px', minHeight: '300px' }}>
                    <div className="output-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                      <div className="output-header-top" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <div className="output-header-left">
                          <div className="output-title"><i className="fas fa-file-alt"></i> Background Output</div>
                        </div>
                        <div className="output-actions">
                          <button className="btn btn-outline" onClick={() => handleDownloadTxt(transcription)}><i className="fas fa-download"></i></button>
                        </div>
                      </div>

                      {/* Subtabs */}
                      <div className="output-subtabs" style={{ display: 'flex', gap: '4px', background: 'var(--gray-light)', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
                        <button
                          className={`sub-tab-btn ${outputSubTab === 'transcript' ? 'active' : ''}`}
                          onClick={() => setOutputSubTab('transcript')}
                          style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                        >
                          Transcript
                        </button>
                        <button
                          className={`sub-tab-btn ${outputSubTab === 'notes' ? 'active' : ''}`}
                          onClick={() => setOutputSubTab('notes')}
                          style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                        >
                          Notes
                        </button>
                        <button
                          className={`sub-tab-btn ${outputSubTab === 'assist' ? 'active' : ''}`}
                          onClick={() => setOutputSubTab('assist')}
                          style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                        >
                          Assist
                        </button>
                      </div>
                    </div>

                    {outputSubTab === 'transcript' && (
                      <div className="output" id="transcript">
                        {transcription || "Your background transcription will appear here..."}
                      </div>
                    )}
                    {outputSubTab === 'notes' && (
                      <div
                        id="liveNotes"
                        className="flex-1 overflow-y-auto p-4 text-sm text-[var(--text-secondary)]"
                      >
                        {liveNotes ? (
                          <div dangerouslySetInnerHTML={{ __html: marked.parse(liveNotes) }} />
                        ) : (
                          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--gray)' }}>
                            <i className="fas fa-sticky-note" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.5 }}></i>
                            <p>Notes will appear here automatically.</p>
                          </div>
                        )}
                      </div>
                    )}
                    {outputSubTab === 'assist' && (
                      <div className="chat-container live-chat-container">
                        <div className="chat-messages" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                          {assistMessages.map((msg, idx) => (
                            <div key={idx} className={`message ${msg.role}`}>
                              {msg.content}
                            </div>
                          ))}
                          {assistLoading && <div className="message assistant"><i className="fas fa-spinner fa-spin"></i></div>}
                        </div>
                        <div className="chat-input-container">
                          <textarea
                            className="chat-input"
                            placeholder="Ask about the background context..."
                            rows="1"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendAssistMessage(e.target.value);
                                e.target.value = '';
                              }
                            }}
                          ></textarea>
                          <button className="send-button" onClick={(e) => {
                            const input = e.target.previousSibling;
                            sendAssistMessage(input.value);
                            input.value = '';
                          }}><i className="fas fa-paper-plane"></i></button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* FILE CATEGORY (Formerly Upload) */}
              {transcribeCategory === 'file' && (
                <div className="category-content active">
                  {/* Workflow visual (static) */}


                  {/* Drop Zone */}
                  <div className="drop-zone-enhanced"
                    onClick={() => document.getElementById('fileInput').click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFileSelect({ target: { files: e.dataTransfer.files } });
                    }}
                  >
                    <i className="fas fa-cloud-upload-alt drop-icon"></i>
                    <p className="drop-text">Click or Drop Files Here</p>
                    <p className="drop-subtext">Supports MP3, WAV, M4A, etc.</p>
                    <input type="file" id="fileInput" className="file-input" accept="audio/*,video/*" multiple onChange={handleFileSelect} />
                  </div>

                  {/* File List */}
                  <div className="file-list-enhanced">
                    {transcribeFiles.map((f, i) => (
                      <div key={i} className="file-item-enhanced">
                        <div className="file-icon-enhanced"><i className="fas fa-file-audio"></i></div>
                        <div className="file-info-enhanced">
                          <div className="file-name-enhanced">{f.name}</div>
                          <div className="file-size-enhanced">{(f.size / 1024 / 1024).toFixed(2)} MB</div>
                        </div>
                        <button className="remove-file" onClick={() => removeFile(i)}><i className="fas fa-times"></i></button>
                      </div>
                    ))}
                  </div>

                  {/* Model Selector */}
                  <div className="model-selector-enhanced">
                    <h3 className="section-title"><i className="fas fa-brain"></i> AI Model</h3>
                    <div className="model-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>



                      <div className={`model-card ${selectedModel === 'base' ? 'selected' : ''}`} onClick={() => switchModel('base')}>
                        <div className="model-header">
                          <div className="model-icon-wrapper">
                            <i className="fas fa-balance-scale model-icon"></i>
                          </div>
                          <div className="model-title-group">
                            <h4 className="model-name">Base</h4>
                            <span className="model-badge">Balanced</span>
                          </div>
                          {selectedModel === 'base' && <i className="fas fa-check-circle" style={{ color: 'var(--primary)' }}></i>}
                        </div>
                        <div className="model-info">
                          <p className="model-desc">Good balance. Recommended for most general use cases.</p>
                          <div className="model-tags">
                            <span className="tag speed">Med Speed</span>
                            <span className="tag accuracy">Good Accuracy</span>
                          </div>
                        </div>
                      </div>

                      <div className={`model-card ${selectedModel === 'small' ? 'selected' : ''}`} onClick={() => switchModel('small')}>
                        <div className="model-header">
                          <div className="model-icon-wrapper">
                            <i className="fas fa-crown model-icon"></i>
                          </div>
                          <div className="model-title-group">
                            <h4 className="model-name">Small</h4>
                            <span className="model-badge">Premium</span>
                          </div>
                          {selectedModel === 'small' && <i className="fas fa-check-circle" style={{ color: 'var(--primary)' }}></i>}
                        </div>
                        <div className="model-info">
                          <p className="model-desc">High accuracy. Best for professional work and difficult audio.</p>
                          <div className="model-tags">
                            <span className="tag speed">Low Speed</span>
                            <span className="tag accuracy">High Accuracy</span>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Actions */}
                  <div className="action-buttons-enhanced">
                    <button className="btn btn-primary btn-large" onClick={startTranscription} disabled={status === 'transcribing' || status === 'loading-model'}>
                      {status === 'transcribing' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-play-circle"></i>}
                      {status === 'transcribing' ? ' Transcribing...' : ' Start Transcription'}
                    </button>
                  </div>

                  {/* Transcription Results & Queue */}
                  {(transcribeQueue.length > 0 || completedTranscriptions.length > 0) && (
                    <div className="output-container-enhanced transcription-results-card" style={{ marginTop: '30px' }}>
                      <div className="output-header">
                        <div className="output-title"><i className="fas fa-file-alt"></i> Transcription Results</div>
                        <div className="output-actions">
                          <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(transcription)}><i className="fas fa-copy"></i> Copy</button>
                          <button className="btn btn-outline" onClick={() => handleDownloadTxt(transcription)}><i className="fas fa-download"></i> Download TXT</button>
                          <button className="btn btn-primary" onClick={() => handleCreateAINotes(transcription)}><i className="fas fa-robot"></i> AI Notes</button>
                        </div>
                      </div>

                      <div className="queue-section">
                        <div className="section-label">In Progress</div>
                        {transcribeQueue.length === 0 ? (
                          <div className="queue-empty">No files are currently transcribing.</div>
                        ) : (
                          <div className="queue-list">
                            {transcribeQueue.map(job => (
                              <div key={job.id} className="queue-item">
                                <div className="queue-info">
                                  <div className="queue-name">{job.name}</div>
                                  <div className="queue-meta">
                                    {formatFileSize(job.size)} • {job.status === 'processing' ? 'Transcribing' : 'Queued'}
                                  </div>
                                </div>
                                <div className="queue-progress">
                                  <div className={`queue-status ${job.status}`}>
                                    {job.status === 'processing' ? displayPercent(job.progress) : 'Waiting'}
                                  </div>
                                  <div className="queue-progress-bar">
                                    <div
                                      className="queue-progress-fill"
                                      style={{
                                        width: `${job.status === 'processing'
                                          ? Math.max(0, Math.min(100, Math.round(job.progress || 0)))
                                          : 0}%`
                                      }}
                                    ></div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {completedTranscriptions.length > 0 && (
                        <div className="completed-section">
                          <div className="section-label">Completed</div>
                          <div className="completed-list">
                            {completedTranscriptions.map(job => (
                              <div key={job.id} className="completed-item">
                                <div className="completed-header">
                                  <div>
                                    <div className="queue-name">{job.name}</div>
                                    <div className="queue-meta">{job.status === 'error' ? 'Failed' : 'Finished • 100%'}</div>
                                  </div>
                                  {job.status !== 'error' && (
                                    <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(job.transcript || '')}>
                                      Copy
                                    </button>
                                  )}
                                </div>
                                <div className="completed-body" style={{ whiteSpace: 'pre-wrap' }}>
                                  {job.status === 'error' ? `Error: ${job.transcript}` : job.transcript}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}

        {
          activeTab === 'history' && (
            <HistoryTab onLoadTranscription={loadFromHistory} />
          )
        }

        {
          activeTab === 'notes' && (
            <AINotesTab
              currentTranscription={transcription}
              liveNotes={liveNotes}
              user={user}
              onLoginRequest={() => setShowLoginModal(true)}
              isViewMode={viewingSavedNotes}
            />
          )
        }

        {
          activeTab === 'chat' && (
            <ChatTab
              currentTranscription={transcription}
              user={user}
              onLoginRequest={() => setShowLoginModal(true)}
            />
          )
        }

      </main>

      {/* Login Modal (Styled to match Electron App) */}
      {
        showLoginModal && (
          <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
          }}>
            {/* Using inline styles to match login.html structure */}
            <div className="login-container" style={{
              background: 'white',
              borderRadius: '12px',
              padding: '40px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              width: '100%',
              maxWidth: '400px',
              textAlign: 'center',
              position: 'relative'
            }}>
              <button
                onClick={() => setShowLoginModal(false)}
                style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748B' }}>
                <i className="fas fa-times"></i>
              </button>

              <div className="logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '24px' }}>
                <img src="/icons/resonote1795x512.png" alt="Resonote" style={{ width: '200px', height: 'auto' }} />
              </div>

              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px', color: '#1E293B' }}>Sign In to Your Account</h2>
              <p className="subtitle" style={{ color: '#64748B', marginBottom: '32px', lineHeight: '1.5' }}>Enter your email and password to access the application</p>

              {loginError && (
                <div className="error-message" style={{ display: 'block', background: '#FEF2F2', color: '#EF4444', padding: '12px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #fecaca', textAlign: 'left' }}>
                  <i className="fas fa-exclamation-circle"></i> {loginError}
                </div>
              )}

              <form onSubmit={handleLogin} style={{ textAlign: 'left' }}>
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', color: '#1E293B' }}>Email Address</label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="your@email.com"
                    style={{ width: '100%', padding: '12px 16px', border: '1px solid #F1F5F9', borderRadius: '12px', fontSize: '16px' }}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', color: '#1E293B' }}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      style={{ width: '100%', padding: '12px 16px', border: '1px solid #F1F5F9', borderRadius: '12px', fontSize: '16px' }}
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}>
                      <i className={`fas fa-eye${showPassword ? '-slash' : ''}`}></i>
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" disabled={loginLoading} style={{ width: '100%', padding: '12px 24px', borderRadius: '12px', fontWeight: '600', fontSize: '16px', background: '#2D7FD3', color: 'white', border: 'none', cursor: 'pointer' }}>
                  {loginLoading ? <><i className="fas fa-spinner fa-spin"></i> Signing in...</> : <><i className="fas fa-sign-in-alt"></i> Sign In</>}
                </button>
              </form>

              <div className="divider" style={{ margin: '24px 0', position: 'relative', textAlign: 'center' }}>
                <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: '#F1F5F9' }}></div>
                <span style={{ position: 'relative', background: 'white', padding: '0 16px', color: '#64748B', fontSize: '14px' }}>or</span>
              </div>

              <button className="btn btn-outline" onClick={() => window.open('https://audiotranscriberlanding.vercel.app', '_blank')}
                style={{ width: '100%', padding: '12px 24px', borderRadius: '12px', fontWeight: '600', fontSize: '16px', background: 'transparent', border: '1px solid #F1F5F9', color: '#1E293B', cursor: 'pointer' }}>
                <i className="fas fa-crown"></i> Get Subscription
              </button>

              <div className="subscription-info" style={{ marginTop: '20px', padding: '16px', background: '#A9D4F8', borderRadius: '12px', border: '1px solid #2D7FD3', textAlign: 'left' }}>
                <h4 style={{ color: '#1C5FA7', marginBottom: '8px', fontSize: '16px', margin: '0 0 8px 0' }}><i className="fas fa-info-circle"></i> No Account Yet?</h4>
                <p style={{ color: '#1E293B', fontSize: '14px', lineHeight: '1.4', margin: 0 }}>Subscribe on our website first, then sign in here with your email and password.</p>
              </div>
            </div>
          </div>
        )
      }

      {/* Slow Transcription Popup */}
      {
        showSlowPopup && (
          <div className="modal-overlay">
            <div className="modal-content-enhanced">
              <button className="modal-close-btn" onClick={() => setShowSlowPopup(false)}><i className="fas fa-times"></i></button>
              <div className="modal-icon-large">
                <i className="fas fa-tachometer-alt"></i>
              </div>
              <h3 className="modal-title">Taking too long?</h3>
              <p className="modal-text">Web browsers throttle performance. Download the desktop app for <strong>10x faster</strong> transcription speeds!</p>
              <button className="btn btn-primary btn-block" onClick={() => window.open('https://audiotranscriberlanding.vercel.app', '_blank')}>
                <i className="fas fa-download"></i> Download App
              </button>
            </div>
          </div>
        )
      }

      {/* Upsell Popup */}
      {
        showUpsellPopup && (
          <div className="modal-overlay">
            <div className="modal-content-enhanced">
              <button className="modal-close-btn" onClick={() => setShowUpsellPopup(false)}><i className="fas fa-times"></i></button>
              <div className="modal-icon-large">
                <i className="fas fa-rocket"></i>
              </div>
              <h3 className="modal-title">Unleash Full Power</h3>
              <p className="modal-text">Get unlimited recording, faster models, and offline privacy with the Rewind Resonote Desktop App.</p>
              <button className="btn btn-primary btn-block" onClick={() => window.open('https://audiotranscriberlanding.vercel.app', '_blank')}>
                <i className="fas fa-download"></i> Get Desktop App
              </button>
            </div>
          </div>
        )
      }

      {/* Tab Selector Modal */}
      {showTabSelector && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, color: '#1E293B'
        }}>
          <div className="tab-selector-container" style={{
            background: 'white', padding: '24px', borderRadius: '12px', width: '450px', maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#1E293B' }}><i className="fas fa-list"></i> Select a Tab</h3>
              <button onClick={() => setShowTabSelector(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748B' }}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            {tabsLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#64748B' }}>
                <i className="fas fa-spinner fa-spin"></i> Loading tabs...
              </div>
            ) : (
              <div className="tab-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {availableTabs.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#64748B' }}>No open tabs found.</p>
                ) : availableTabs.map(tab => (
                  <div key={tab.id} onClick={() => startRapidTranscription(tab)} style={{
                    padding: '12px', background: '#F8FAFC', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
                    border: '1px solid transparent', transition: 'all 0.2s', textAlign: 'left'
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F1F5F9'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    {tab.favIconUrl ? <img src={tab.favIconUrl} alt="" style={{ width: '16px', height: '16px' }} /> : <i className="fas fa-globe" style={{ color: '#64748B' }}></i>}
                    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>
                      <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '2px', color: '#1E293B' }}>{tab.title}</div>
                      <div style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.url}</div>
                    </div>
                    {tab.audible && <i className="fas fa-volume-up" style={{ color: '#22C55E' }}></i>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div >
  );
}

export default App;
const displayPercent = (value) => {
  const num = Number(value) || 0;
  return `${Math.round(Math.max(0, Math.min(100, num)))}%`;
};
