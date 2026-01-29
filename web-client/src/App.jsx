
import React, { useEffect, useRef, useState } from 'react';
import './index.css';
import HistoryTab, { saveToHistory, updateHistoryItem } from './components/HistoryTab';
import AINotesTab from './components/AINotesTab';
import ChatTab from './components/ChatTab';
import FlashcardsTab from './components/FlashcardsTab';
import Sidebar from './components/Sidebar';
import WelcomeModal from './components/WelcomeModal';
import AlertModal from './components/AlertModal';
import ProductTour from './components/ProductTour';
import { useAuth } from './hooks/useAuth';
import { useLiveNotes } from './hooks/useLiveNotes';
import { useLiveAssist } from './hooks/useLiveAssist';
import { useAutoScroll } from './hooks/useAutoScroll';
import { marked } from 'marked';
import { translator } from './lib/TranslatorEngine';

// We'll use FontAwesome for icons by adding the CDN link in index.html, 
// matching the original app.

// ===============================
// 🔌 Universal Native Host Client
// ===============================
const POSSIBLE_EXTENSION_IDS = [
  'lamboikcmffdoaolbcdadahfbejjcioe', // Testing ID
  'iddimggbohccfikpkeelhaceooojfiga'  // Production ID
];

const CANVAS_DOMAINS = ["canvas", "instructure", "kaltura", "panopto", "learning"];

class NativeHostClient {
  constructor() {
    this.ws = null;
    this.wsPort = 3000;
    this.extensionId = null;

    // Dual Capability Flags
    this.isWsConnected = false;
    this.isExtensionConnected = false;

    this.port = null;
    this.listeners = new Set();
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async connect() {
    console.log("🕵️‍♂️ Initializing Native Client Connections...");

    // Parallel connection attempts
    const [wsResult, extResult] = await Promise.all([
      this.connectWebSocket(),
      this.connectExtension()
    ]);

    this.isWsConnected = wsResult;
    this.isExtensionConnected = !!extResult;
    if (extResult) this.extensionId = extResult;

    console.log(`🔌 Connection Status: WS=${this.isWsConnected}, EXT=${this.isExtensionConnected}`);

    // Return true if AT LEAST one method works
    return this.isWsConnected || this.isExtensionConnected;
  }

  async connectExtension() {
    if (!window.chrome || !window.chrome.runtime || !window.chrome.runtime.sendMessage) return null;

    for (const id of POSSIBLE_EXTENSION_IDS) {
      try {
        const res = await new Promise(resolve => {
          const pid = setTimeout(() => resolve(null), 500); // Fast timeout
          try {
            window.chrome.runtime.sendMessage(id, { action: 'ping' }, (response) => {
              clearTimeout(pid);
              if (window.chrome.runtime.lastError) resolve(null);
              else resolve(response);
            });
          } catch (e) { clearTimeout(pid); resolve(null); }
        });

        if (res && res.type === 'PONG') {
          console.log(`✅ Extension Connected: ${id}`);

          // Establish long-lived connection for control messages
          try {
            this.port = window.chrome.runtime.connect(id, { name: "resonote-control" });
            this.port.onMessage.addListener((msg) => {
              this.listeners.forEach(cb => cb(msg));
            });
          } catch (e) { console.error("Control Port Connect Error:", e); }

          return id;
        }
      } catch (e) { }
    }
    return null;
  }

  async connectWebSocket() {
    return new Promise((resolve) => {
      try {
        const socket = new WebSocket(`ws://localhost:${this.wsPort}`);

        socket.onopen = () => {
          console.log("✅ WebSocket Connected");
          this.ws = socket;
          this.isWsConnected = true;
          resolve(true);
        };

        socket.onerror = (err) => {
          // console.warn("❌ WebSocket Failed");
          resolve(false);
        };

        // Safety timeout
        setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) resolve(false);
        }, 1500);

      } catch (e) { resolve(false); }
    });
  }

  sendMessage(message, callback, target = 'auto') {
    // Strategy: 'auto' (prefer WS), 'websocket', 'extension'

    // 1. WebSocket (Preferred for 'auto' or explicit)
    if ((target === 'auto' || target === 'websocket') && this.isWsConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      message.requestId = requestId;

      const listener = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.requestId === requestId || (data.type === 'PONG' && message.action === 'ping')) {
            // If it's a progress update, don't close the listener yet
            if (data.type === 'PROGRESS') {
              callback(data);
            } else {
              // Final response (TRANSCRIPT or ERROR)
              this.ws.removeEventListener('message', listener);
              callback(data);
            }
          }
        } catch (e) { }
      };
      this.ws.addEventListener('message', listener);
      this.ws.send(JSON.stringify(message));
      return;
    }

    // 2. Extension (Fallback for 'auto', or explicit)
    if ((target === 'auto' || target === 'extension') && this.isExtensionConnected && this.extensionId) {
      if (window.chrome && window.chrome.runtime) {
        try {
          window.chrome.runtime.sendMessage(this.extensionId, message, (res) => {
            if (window.chrome.runtime.lastError) {
              console.warn("Extension Message Error:", window.chrome.runtime.lastError);
              callback({ type: 'ERROR', message: window.chrome.runtime.lastError.message });
            } else {
              callback(res);
            }
          });
        } catch (e) {
          callback({ type: 'ERROR', message: e.message });
        }
        return;
      }
    }

    // 3. Failure
    callback({ type: 'ERROR', message: `No active connection for target: ${target}` });
  }

  getActiveExtensionId() {
    return this.extensionId || POSSIBLE_EXTENSION_IDS[0];
  }
}

const nativeClient = new NativeHostClient();

// Helper to identify unique videos (ignoring different stream formats)
const getVideoFingerprint = (url) => {
  try {
    if (url.includes('entryId/')) {
      const match = url.match(/entryId\/([^\/]+)/);
      if (match) return `kaltura:${match[1]}`;
    }
    if (url.includes('youtu')) {
      if (url.includes('v=')) return `youtube:${url.split('v=')[1].split('&')[0]}`;
      if (url.includes('/embed/')) return `youtube:${url.split('/embed/')[1].split('?')[0]}`;
    }
  } catch (e) { }
  return url;
};

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
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isExtConnected, setIsExtConnected] = useState(false);
  const [extensionId, setExtensionId] = useState(POSSIBLE_EXTENSION_IDS[0]); // Default to first for initial state

  // Popup State
  const [showSlowPopup, setShowSlowPopup] = useState(false);
  const [showUpsellPopup, setShowUpsellPopup] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);

  const showAlert = (msg) => {
    setAlertMessage(msg);
  };

  // Transcribe Tab State
  const [transcribeCategory, setTranscribeCategory] = useState('file'); // 'live', 'background', 'file'

  // LIVE TAB State
  const [liveSubTab, setLiveSubTab] = useState('transcript'); // 'transcript', 'notes', 'assist'
  const [outputSubTab, setOutputSubTab] = useState('transcript'); // 'transcript', 'notes', 'assist'
  const [viewingFile, setViewingFile] = useState(null); // For 'file' mode, which file we are viewing
  const [transcriptionSource, setTranscriptionSource] = useState('mic'); // 'tab', 'mic', 'system' (default 'mic')
  const [hoveredSource, setHoveredSource] = useState(null);

  // BACKGROUND TAB State
  const [backgroundMuted, setBackgroundMuted] = useState(false);

  // RAPID TRANSCRIBE State
  const [showTabSelector, setShowTabSelector] = useState(false);
  const [availableTabs, setAvailableTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [urlInput, setUrlInput] = useState('');

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
  const [webQueue, setWebQueue] = useState([]); // { id, name, status: 'processing' | 'complete' | 'error' }
  const [completedTranscriptions, setCompletedTranscriptions] = useState([]);
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const [lastMetrics, setLastMetrics] = useState(null);
  const [lastProfile, setLastProfile] = useState(null);
  const [viewingSavedNotes, setViewingSavedNotes] = useState(false);

  // Track processed URLs to prevent duplicates
  const processedUrlsRef = useRef(new Set());

  // Subscribe to Extension Control Messages
  useEffect(() => {
    const unsubscribe = nativeClient.addListener((msg) => {
      if (msg.action === 'FOUND_VIDEOS_UPDATE') {
        console.log("[App] Received delayed video find update:", msg.videos);

        // Deduplicate and Add
        const uniqueBatch = [];
        const seenInBatch = new Set();

        // 1. Unique-ify the incoming batch first
        msg.videos.forEach(v => {
          const fp = getVideoFingerprint(v.url);
          if (!seenInBatch.has(fp)) {
            seenInBatch.add(fp);
            uniqueBatch.push(v);
          }
        });

        // 2. Process the unique batch
        uniqueBatch.forEach((video, index) => {
          const fingerprint = getVideoFingerprint(video.url);

          // Global dedupe check (have we seen this anytime this session?)
          if (processedUrlsRef.current.has(fingerprint)) return;
          processedUrlsRef.current.add(fingerprint);

          setTimeout(() => {
            const videoTab = {
              title: `${video.title || 'Video'} ${index + 1} (Found)`,
              url: video.url,
              initialStatus: 'transcribing'
            };
            startRapidTranscription(videoTab);
          }, index * 200);
        });
      }
    });
    return unsubscribe;
  }, []);

  // Translation State
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [targetLang, setTargetLang] = useState('es');
  const [translatedText, setTranslatedText] = useState('');
  const [translatorReady, setTranslatorReady] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationStatus, setTranslationStatus] = useState('');

  // Tour State
  // Tour State
  const [showWelcomeModal, setShowWelcomeModal] = useState(() => {
    return !localStorage.getItem('hasSeenWelcome');
  });
  const [activeTour, setActiveTour] = useState(null);
  const [seenTours, setSeenTours] = useState(() => {
    try {
      const savedStats = localStorage.getItem('seenTours');
      return savedStats ? JSON.parse(savedStats) : [];
    } catch (e) {
      return [];
    }
  });

  const handleTourSelection = (tourId) => {
    setShowWelcomeModal(false);
    localStorage.setItem('hasSeenWelcome', 'true');
    setActiveTour(tourId);
    setSeenTours(prev => {
      const newState = [...prev, tourId];
      localStorage.setItem('seenTours', JSON.stringify(newState));
      return newState;
    });

    // Switch tabs based on tour
    if (tourId === 'tour-a') {
      setActiveTab('transcribe');
      setTranscribeCategory('background');
    } else if (tourId === 'tour-b') {
      setActiveTab('transcribe');
      setTranscribeCategory('live');
    } else if (tourId === 'tour-c') {
      setActiveTab('transcribe');
      setTranscribeCategory('file');
    }
  };

  const handleTourEnd = () => {
    setActiveTour(null);
  };

  // Automate Tour Triggering on Tab Switch
  useEffect(() => {
    if (activeTour || showWelcomeModal) return; // Don't interrupt existing tour or modal

    if (activeTab === 'transcribe') {
      if (transcribeCategory === 'background' && !seenTours.includes('tour-a')) {
        setActiveTour('tour-a');
        setSeenTours(prev => {
          const newState = [...prev, 'tour-a'];
          localStorage.setItem('seenTours', JSON.stringify(newState));
          return newState;
        });
      } else if (transcribeCategory === 'live' && !seenTours.includes('tour-b')) {
        setActiveTour('tour-b');
        setSeenTours(prev => {
          const newState = [...prev, 'tour-b'];
          localStorage.setItem('seenTours', JSON.stringify(newState));
          return newState;
        });
      } else if (transcribeCategory === 'file' && !seenTours.includes('tour-c')) {
        setActiveTour('tour-c');
        setSeenTours(prev => {
          const newState = [...prev, 'tour-c'];
          localStorage.setItem('seenTours', JSON.stringify(newState));
          return newState;
        });
      }
    }
  }, [activeTab, transcribeCategory, activeTour, showWelcomeModal, seenTours]);

  useEffect(() => {
    // 1. Eager Initialization / Download
    const initTranslator = async () => {
      if (translationEnabled && !translatorReady) {
        setTranslationStatus(`Initializing ${targetLang}...`);
        // Reset progress to 0 if re-initializing
        setTranslationProgress(0);

        try {
          translator.setOnProgress((progress, statusText) => {
            setTranslationProgress(progress);
            setTranslationStatus(statusText);
          });
          // Initialize engine (this triggers download)
          await translator.init('en', targetLang);
          setTranslatorReady(true);
          setTranslationStatus('Ready');
        } catch (e) {
          console.error("Translator Init Error:", e);
          setTranslationStatus('Error');
        }
      }
    };
    initTranslator();
  }, [translationEnabled, targetLang, translatorReady]);

  useEffect(() => {
    // 2. Perform Translation
    const runTranslation = async () => {
      if (translationEnabled && translatorReady && transcription && transcription.trim().length > 0) {
        try {
          const result = await translator.translate(transcription);
          setTranslatedText(result);
          // setTranslationStatus('Translated'); // Optional, conflicts with download status maybe?
        } catch (e) {
          console.error("Translation error:", e);
        }
      }
    };

    // Debounce translation
    const timer = setTimeout(runTranslation, 1000);
    return () => clearTimeout(timer);
  }, [transcription, translationEnabled, targetLang, translatorReady]);

  // Live AI Hooks
  const { liveNotes, status: notesStatus, generateFullNotes } = useLiveNotes({
    isRecording: status === 'recording',
    transcription
  });

  const { messages: assistMessages, loading: assistLoading, sendMessage: sendAssistMessage } = useLiveAssist({
    liveNotes,
    transcription,
    isRecording: status === 'recording'
  });

  const assistScrollRef = useAutoScroll([assistMessages]);

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
          showAlert('Error: ' + (data?.message || data));
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
  const [connectionCheckLoading, setConnectionCheckLoading] = useState(false);

  const checkConnection = async () => {
    setConnectionCheckLoading(true);
    // console.log("🕵️‍♂️ Checking connection...");
    await nativeClient.connect();

    const wsOk = nativeClient.isWsConnected;
    const extOk = nativeClient.isExtensionConnected;

    setIsWsConnected(wsOk);
    setIsExtConnected(extOk);

    const fullyConnected = wsOk && extOk;
    console.log(`🕵️‍♂️ Connection Result: WS=${wsOk}, EXT=${extOk} => FULL=${fullyConnected}`);

    setNativeHostConnected(fullyConnected);

    if (extOk) {
      setExtensionId(nativeClient.getActiveExtensionId());
    }
    setConnectionCheckLoading(false);
  };

  // Check Native Host Connection
  useEffect(() => {
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
          // Handle PROGRESS
          if (response && response.type === 'PROGRESS') {
            const percent = response.percent || 0;
            // Update queue state live
            setTranscribeQueue(prev => prev.map(j => j.id === nextJob.id ? { ...j, status: 'processing', progress: percent } : j));
            // Update ref so logic that checks ref sees it (though ref updates are not reactive, safe to ignore for UI, but good for coherence)
            queueRef.current = queueRef.current.map(j => j.id === nextJob.id ? { ...j, status: 'processing', progress: percent } : j);
            return;
          }

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

  const handleJobCompletion = async (jobId, text) => {
    try {
      // Check translation
      let finalText = text;
      if (translationEnabled && translatorReady) {
        try {
          finalText = await translator.translate(text);
        } catch (e) {
          console.error("Auto-translation failed for job", e);
        }
      }

      const job = queueRef.current.find(j => j.id === jobId) || activeJobRef.current;

      // For non-queued jobs (e.g., mic/system audio), fall back to the legacy flow
      if (!job && !queueRef.current.length) {
        activeJobRef.current = null;
        setTranscription(finalText);
        // Also update translatedText state so the view knows it matches
        if (translationEnabled) setTranslatedText(finalText);

        setStatus('complete');
        saveToHistory(`Transcription ${new Date().toLocaleTimeString()}`, finalText, 'transcription', selectedModel);
        return;
      }

      // Remove job from queue
      const remaining = queueRef.current.filter(j => j.id !== jobId);
      queueRef.current = remaining;
      setTranscribeQueue(remaining);

      if (job) {
        const completed = { ...job, status: 'completed', progress: 100, transcript: finalText };
        setCompletedTranscriptions(prev => [...prev, completed]);
        setTranscription(text);

        try {
          const historyItem = saveToHistory(historyName, finalText, 'transcription', selectedModel);

          // Auto-generate generic notes and update history
          generateFullNotes(finalText).then(notes => {
            if (historyItem && historyItem.id) {
              updateHistoryItem(historyItem.id, { notes });
            }
          });
        } catch (hErr) {
          console.error("History save failed:", hErr);
        }
      }

      activeJobRef.current = null;

      // Decide next step
      if (remaining.some(j => j.status === 'pending')) {
        startNextJob();
      } else {
        console.log("[JobComplete] All jobs finished. Setting status to complete.");
        setStatus('complete');
        // Ensure we are not stuck in transcribing if something weird happened
      }
    } catch (criticalError) {
      console.error("CRITICAL Job Completion Error:", criticalError);
      activeJobRef.current = null;
      setStatus('error');
      showAlert(`Transcription finished but post-processing failed: ${criticalError.message}`);
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
      showAlert("Please select a file first.");
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
      showAlert("Web Speech API is not supported in this browser. Please use Chrome/Edge or download the Desktop App.");
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

      const initialStatus = tab.initialStatus || 'finding video...';
      const queueId = Date.now();
      setWebQueue(prev => [...prev, { id: queueId, title: tab.title, url: tab.url, status: initialStatus }]);

      // Safety timeout - if extension doesn't reply in 30s, assume it failed/crashed
      // Safety timeout - Increased to 120s for long downloads
      let safetyTimeout = setTimeout(() => {
        console.error("[RapidTranscribe] TIMEOUT: No response from extension after 120 seconds.");
        // Only show alert if we are still processing (queueId still in queue)
        setWebQueue(prev => {
          const stillPending = prev.some(item => item.id === queueId);
          if (stillPending) {
            showAlert("Timeout: The extension did not respond in 120s.\n\nThe transcription might still be running in the background. Please check the extension popup.");
            setStatus('idle');
            return prev.filter(item => item.id !== queueId);
          }
          return prev;
        });
      }, 120000);

      // Determine Routing Strategy
      const isCanvas = tab.url && CANVAS_DOMAINS.some(d => tab.url.includes(d));
      const routeTarget = isCanvas ? 'extension' : 'auto';

      if (isCanvas) {
        console.log("⚠️ Canvas/Kaltura URL detected. Forcing routing via Extension for automation.");
        if (!nativeClient.isExtensionConnected) {
          clearTimeout(safetyTimeout);
          showAlert("Canvas Transcription requires the Chrome Extension.\n\nPlease enable the extension to automate the capture of this video.");
          setStatus('idle');
          setWebQueue(prev => prev.filter(item => item.id !== queueId));
          return;
        }
      }

      // Use nativeClient for consistent message passing
      nativeClient.sendMessage({
        action: "transcribe_url",
        url: tab.url,
        source: "web_client_rapid"
      }, (res) => {
        // Handle Progress Updates
        if (res && res.type === 'PROGRESS') {
          console.log(`[RapidTranscribe] Progress: ${res.percent}%`);
          // Reset Timeout
          clearTimeout(safetyTimeout);
          // Re-arm timeout (another 120s from now)
          safetyTimeout = setTimeout(() => {
            console.error("[RapidTranscribe] TIMEOUT (after progress update)");
            setWebQueue(prev => {
              if (prev.some(item => item.id === queueId)) {
                showAlert("Timeout: Transcription stopped responding.");
                setStatus('idle');
                return prev.filter(item => item.id !== queueId);
              }
              return prev;
            });
          }, 120000);

          // Update UI Status
          setWebQueue(prev => prev.map(item => {
            if (item.id === queueId) {
              return { ...item, status: `transcribing (${res.percent}%)` };
            }
            return item;
          }));
          return; // Don't process final logic yet
        }

        if (res && res.type === 'WAITING_FOR_MANUAL_PLAY') {
          console.log("[RapidTranscribe] Waiting for user to play video...");

          // Re-arm timeout to give user time (5 minutes)
          clearTimeout(safetyTimeout);
          safetyTimeout = setTimeout(() => {
            console.error("[RapidTranscribe] TIMEOUT (waiting for manual play)");
            setWebQueue(prev => {
              if (prev.some(item => item.id === queueId)) {
                showAlert("Timeout: No video playback detected within 5 minutes.");
                setStatus('idle');
                return prev.filter(item => item.id !== queueId);
              }
              return prev;
            });
          }, 300000);

          // Update UI Status
          setWebQueue(prev => prev.map(item => {
            if (item.id === queueId) {
              return { ...item, status: 'Waiting for video play...' };
            }
            return item;
          }));

          if (!window.hasShownPlayAlert) {
            window.hasShownPlayAlert = true;
            showAlert("Extension Ready: Please press PLAY on the video in your other tab to begin.");
          }
          return;
        }

        if (res && res.type === 'FOUND_VIDEOS') {
          console.log(`[RapidTranscribe] Found ${res.videos.length} videos`);
          clearTimeout(safetyTimeout);

          // Remove the "Scanning" placeholder
          setWebQueue(prev => prev.filter(item => item.id !== queueId));

          // Queue the found videos
          res.videos.forEach((video, index) => {
            // Recursively call with the DIRECT URL
            // set timeout to stagger them slightly so IDs don't collide
            setTimeout(() => {
              // Mock a tab object
              const videoTab = {
                title: `${video.title || 'Video'} ${index + 1} (${tab.title})`,
                url: video.url,
                initialStatus: 'transcribing' // Explicitly set status for found videos
              };
              startRapidTranscription(videoTab);
            }, index * 200);
          });
          return;
        }

        clearTimeout(safetyTimeout);
        console.log("[RapidTranscribe] Raw callback received from extension:", res);

        if (window.chrome.runtime.lastError) {
          console.error("[RapidTranscribe] Runtime Error:", window.chrome.runtime.lastError);
          showAlert(`Transcription Error: ${window.chrome.runtime.lastError.message}`);
          setStatus('idle');
          setWebQueue(prev => prev.filter(item => item.id !== queueId)); // Remove failed item
          return;
        }

        console.log("[RapidTranscribe] Response:", res);

        // Handle Final Result (Async via requestId)
        if (res && res.type === 'TRANSCRIPT') {
          // Success
          console.log("[RapidTranscribe] Transcription success:", res.text.substring(0, 50) + "...");

          setTranscription(res.text);

          // Explicitly translate if enabled
          if (translationEnabled && translatorReady) {
            setTranslationStatus(`Translating...`); // Optional UI feedback
            translator.translate(res.text).then(translated => {
              setTranslatedText(translated);
              setTranslationStatus('Translated');
            }).catch(err => {
              console.error("Rapid translation failed", err);
              setTranslationStatus('Error');
            });
          }

          setStatus('idle');
          // showAlert(`Transcription Complete for: ${tab.title}`);



          setWebQueue(prev => prev.filter(item => item.id !== queueId));

          // Auto-generate generic notes
          // generateFullNotes(res.text); // Moved inside async block below

          // Save to history with AI naming
          (async () => {
            let name = tab.title || "Web Transcription";
            try {
              const aiName = await generateTranscriptionName(res.text);
              if (aiName) name = aiName;
            } catch (e) { }

            const historyItem = saveToHistory(name, res.text, 'transcription', 'rapid-web');

            // Generate notes and update history
            generateFullNotes(res.text).then(notes => {
              if (historyItem && historyItem.id) {
                updateHistoryItem(historyItem.id, { notes });
              }
            });
          })();
        } else if (res && (res.error || res.type === 'ERROR')) {
          const errMsg = res.error || res.message || "Unknown error";
          console.error("[RapidTranscribe] Failed with error:", errMsg);
          showAlert(`Failed: ${errMsg}`);
          setStatus('idle');
          setWebQueue(prev => prev.filter(item => item.id !== queueId));
        } else {
          // If we get here it might mean the extension sent something else, or nothing.
          console.warn("[RapidTranscribe] Unexpected response format:", res);
          if (res && res.status === 'processing') {
            // Fallback if extension wasn't reloaded properly
            console.log("Updating extension... please reload the extension.");
          } else {
            // It's possible the extension sent nothing?
            console.log("[RapidTranscribe] Response was empty or invalid.");
            setStatus('idle');
            setWebQueue(prev => prev.filter(item => item.id !== queueId));
          }
        }
      }, routeTarget);
    } catch (e) {
      console.error("[RapidTranscribe] Exception:", e);
      showAlert("Error starting transcription: " + e.message);
      setStatus('idle');
      // No queueId here as it might fail before creation? 
      // check if we created one... well, if queueId is not defined in this scope catch block...
      // Actually queueId is const inside try block. 
      // We need to move queueId definition up or use a different way?
      // Actually catch block is outside. So we can't access queueId.
      // But typically this catch catches synchronous errors before sendMessage...
      // Just clear all processing queues? No that's bad.
      // Let's assume queue add happened inside try.
      setWebQueue([]);
    }
  };

  const handleRapidTranscribeClick = () => {
    try {
      // 1. Check if EXTENSION is connected (Required for Tabs)
      // 1. Check if BOTH are connected (Required for Full Feature)
      if (!nativeHostConnected) {
        setShowSlowPopup(true);
        return;
      }

      console.log("Rapid Transcribe Clicked. Fetching available tabs...");
      setTabsLoading(true);

      const timeoutId = setTimeout(() => {
        if (tabsLoading) {
          setTabsLoading(false);
          showAlert("Extension setup issue: The extension is not responding.\n\nPlease:\n1. Open chrome://extensions\n2. Reload the 'Resonote' extension\n3. Refresh this page.");
        }
      }, 3000);

      // Get list of open tabs (doesn't need native host)
      const msg = { action: "GET_TABS" };
      window.chrome.runtime.sendMessage(extensionId, msg, (response) => {
        clearTimeout(timeoutId);
        setTabsLoading(false);

        if (window.chrome.runtime.lastError) {
          console.error("[RapidTranscribe] GET_TABS Error:", window.chrome.runtime.lastError);
          // If the error is regarding messaging, it might be due to missing permissions or extension not installed.
          showAlert(`Extension Error: ${window.chrome.runtime.lastError.message}\n\nMake sure the extension is installed and allowed to communicate with this site.`);
          return;
        }

        console.log("[RapidTranscribe] GET_TABS Response:", response);

        if (response && response.success && Array.isArray(response.tabs)) {
          console.log(`Found ${response.tabs.length} tabs.`);
          setAvailableTabs(response.tabs);
          setShowTabSelector(true);
        } else {
          showAlert("Could not fetch open tabs. Please try reloading the extension.");
        }
      });
    } catch (e) {
      console.error("Critical Error in Rapid Transcribe:", e);
      showAlert(`Critical Error: ${e.message}`);
    }
  };

  const handleUrlTranscribe = () => {
    if (!urlInput || !urlInput.startsWith('http')) {
      showAlert("Please enter a valid URL (starting with http:// or https://)");
      return;
    }

    // 1. Check Connection (Native Host Required)
    // 1. Check Connection (Native Host Required)
    if (!nativeHostConnected) {
      setShowSlowPopup(true);
      return;
    }

    try {
      console.log("Starting URL Transcription for:", urlInput);
      setStatus('transcribing');

      const queueId = Date.now();
      setWebQueue(prev => [...prev, { id: queueId, title: urlInput, url: urlInput, status: 'finding video...' }]);

      let safetyTimeout = setTimeout(() => {
        console.error("[UrlTranscribe] TIMEOUT");
        showAlert("Timeout: The Native App did not respond in 60 seconds.");
        setStatus('idle');
        setWebQueue(prev => prev.filter(item => item.id !== queueId));
      }, 60000); // Increased to 60s

      // Use Universal Client (Auto Strategy: Prefer WS, unless Canvas)
      const isCanvas = urlInput && CANVAS_DOMAINS.some(d => urlInput.includes(d));
      const routeTarget = isCanvas ? 'extension' : 'auto';

      if (isCanvas) {
        console.log("⚠️ Canvas/Kaltura URL detected. Forcing routing via Extension for automation.");
        if (!nativeClient.isExtensionConnected) {
          clearTimeout(safetyTimeout);
          showAlert("Canvas Transcription requires the Chrome Extension.\n\nPlease enable the extension to automate the capture of this video.");
          setStatus('idle');
          setWebQueue(prev => prev.filter(item => item.id !== queueId));
          return;
        }
      }

      nativeClient.sendMessage({
        action: "transcribe_url",
        url: urlInput,
        source: "web_client_url"
      }, (res) => {
        // Handle Progress Updates
        if (res && res.type === 'PROGRESS') {
          // Reset Timeout
          clearTimeout(safetyTimeout);
          // Re-arm timeout
          safetyTimeout = setTimeout(() => {
            showAlert("Timeout: Native Host stopped responding.");
            setStatus('idle');
            setWebQueue(prev => prev.filter(item => item.id !== queueId));
          }, 120000);

          setWebQueue(prev => prev.map(item => {
            if (item.id === queueId) {
              return { ...item, status: `transcribing (${res.percent}%)` };
            }
            return item;
          }));
          return;
        }

        clearTimeout(safetyTimeout);

        // Handle WS or Extension 'Last Error' if emulated or passed
        if (res && res.type === 'ERROR') {
          console.error("[UrlTranscribe] Error:", res.message);
          showAlert(`Failed: ${res.message}`);
          setStatus('idle');
          setWebQueue(prev => prev.filter(item => item.id !== queueId));
          return;
        }

        if (res && res.type === 'TRANSCRIPT') {
          setTranscription(res.text);
          setStatus('idle');
          if (window.innerWidth >= 768) setUrlInput(''); // Clear input if on desktop
          setWebQueue(prev => prev.filter(item => item.id !== queueId));

          // Save to history with AI naming
          (async () => {
            let name = "URL Transcription";
            try {
              const aiName = await generateTranscriptionName(res.text);
              if (aiName) name = aiName;
            } catch (e) { }

            const historyItem = saveToHistory(name, res.text, 'transcription', 'rapid-url');

            // Generate notes and update history
            generateFullNotes(res.text).then(notes => {
              if (historyItem && historyItem.id) {
                updateHistoryItem(historyItem.id, { notes });
              }
            });
          })();
        } else {
          // Unknown response or non-error but not transcript?
          console.warn("[UrlTranscribe] Unexpected response:", res);
          setStatus('idle');
          setWebQueue(prev => prev.filter(item => item.id !== queueId));
        }
      }, routeTarget);

    } catch (error) {
      console.error("URL Transcribe Error:", error);
      showAlert("Error: " + error.message);
      setStatus('idle');
    }
  };



  // Special Web Feature: Record "Background" (System Audio) via Screen Share
  const startSystemAudioRecording = async () => {
    if (!user || (!user.authenticated && !user.offlineMode)) {
      setShowLoginModal(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          suppressLocalAudioPlayback: backgroundMuted // This magically mutes the tab/window/screen locally!
        },
        suppressLocalAudioPlayback: backgroundMuted // Duplicate at root for safety/compatibility
      });

      // Check if user shared audio
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        showAlert("Please make sure to check 'Share System Audio' when selecting a screen/tab!");
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
          const port = window.chrome.runtime.connect(extensionId, { name: "resonote-stream" });

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

  const generateTranscriptionName = async (text) => {
    if (!text || text.trim().length < 10) return null;
    try {
      const messages = [
        {
          role: 'system',
          content: 'You are a helpful assistant. Generate a short, descriptive title (maximum 6 words) for the following transcript text. Do not include quotes or prefixes like "Title:". Just the title.'
        },
        {
          role: 'user',
          content: text.slice(0, 800) // First ~100-150 words
        }
      ];

      const response = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });

      if (!response.ok) return null;
      const data = await response.json();
      return data.completion ? data.completion.trim().replace(/^["']|["']$/g, '') : null;
    } catch (e) {
      console.error("Failed to generate name:", e);
      return null;
    }
  };

  const stopRecording = async () => {
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
        let name = `Live Recording ${new Date().toLocaleTimeString()}`;

        // Attempt AI naming
        // Use a small clearer status if desired, but for now we'll just await (optimistic UI)
        try {
          const aiName = await generateTranscriptionName(transcription);
          if (aiName) name = aiName;
        } catch (e) { console.error(e); }

        saveToHistory(name, transcription, 'transcription', 'google-speech', liveNotes, assistMessages);
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

  const handleRemoveWebQueueItem = (id) => {
    setWebQueue(prev => {
      const remaining = prev.filter(item => item.id !== id);
      if (remaining.length === 0) {
        setStatus('idle');
      }
      return remaining;
    });
  };

  const handleRemoveTranscribeQueueItem = (id) => {
    setTranscribeQueue(prev => {
      const newQueue = prev.filter(item => item.id !== id);
      queueRef.current = newQueue;

      if (newQueue.length === 0) {
        setStatus('idle');
      }
      return newQueue;
    });
    // If it was the active job, we ideally cancel it, but for V1 just removing from UI is okay.
    // The worker will finish and try to update a non-existent item (or we should add a check).
  };

  // --- Render ---

  // NOTE: This JSX structure mirrors the index.html structure almost exactly, 
  // but using React state for showing/hiding tabs and categories.
  const safeDownloadProgress = Math.max(0, Math.min(100, downloadProgress || 0));

  return (
    <div className="app-layout">
      <ProductTour activeTour={activeTour} onTourEnd={handleTourEnd} />
      {showWelcomeModal && (
        <WelcomeModal
          onClose={() => {
            setShowWelcomeModal(false);
            localStorage.setItem('hasSeenWelcome', 'true');
          }}
          onSelectOption={handleTourSelection}
        />
      )}

      <Sidebar
        id="tour-sidebar"
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRapidTranscribe={handleRapidTranscribeClick}
        user={user}
        onLogin={() => setShowLoginModal(true)}
        onLogout={logout}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        translationEnabled={translationEnabled}
        setTranslationEnabled={setTranslationEnabled}
        targetLang={targetLang}
        setTargetLang={setTargetLang}
        translationStatus={translationStatus}
        translationProgress={translationProgress}
        translatorReady={translatorReady}
        nativeHostConnected={nativeHostConnected}
      />

      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      <main className="main-content">
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
                    <i className="fas fa-globe"></i> Web
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
                    <div id="tour-source-toggle" className="source-buttons-large" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                      <button
                        className={`source-btn-lg ${transcriptionSource === 'tab' ? 'active' : ''}`}
                        onClick={() => setTranscriptionSource('tab')}
                        onMouseEnter={() => setHoveredSource('tab')}
                        onMouseLeave={() => setHoveredSource(null)}
                        style={{
                          padding: '20px',
                          border: '2px solid var(--gray-light)',
                          borderRadius: '16px',
                          background: transcriptionSource === 'tab' ? 'var(--primary-light)' : 'white',
                          borderColor: transcriptionSource === 'tab' ? 'var(--primary)' : 'var(--gray-light)',
                          color: transcriptionSource === 'tab' ? 'var(--primary-dark)' : 'var(--gray)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                          position: 'relative'
                        }}
                      >
                        <i className="fas fa-desktop" style={{ fontSize: '24px' }}></i>
                        <span style={{ fontWeight: '600' }}>Tab Audio</span>
                        {hoveredSource === 'tab' && (
                          <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginBottom: '10px',
                            background: '#1E293B',
                            color: 'white',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            width: '200px',
                            textAlign: 'center',
                            zIndex: 10,
                            pointerEvents: 'none',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                          }}>
                            Captures audio playing within this specific browser tab.
                            <div style={{
                              position: 'absolute',
                              top: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              borderLeft: '6px solid transparent',
                              borderRight: '6px solid transparent',
                              borderTop: '6px solid #1E293B'
                            }}></div>
                          </div>
                        )}
                      </button>

                      <button
                        className={`source-btn-lg ${transcriptionSource === 'mic' ? 'active' : ''}`}
                        onClick={() => setTranscriptionSource('mic')}
                        onMouseEnter={() => setHoveredSource('mic')}
                        onMouseLeave={() => setHoveredSource(null)}
                        style={{
                          padding: '20px',
                          border: '2px solid var(--gray-light)',
                          borderRadius: '16px',
                          background: transcriptionSource === 'mic' ? 'var(--primary-light)' : 'white',
                          borderColor: transcriptionSource === 'mic' ? 'var(--primary)' : 'var(--gray-light)',
                          color: transcriptionSource === 'mic' ? 'var(--primary-dark)' : 'var(--gray)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                          position: 'relative'
                        }}
                      >
                        <i className="fas fa-microphone" style={{ fontSize: '24px' }}></i>
                        <span style={{ fontWeight: '600' }}>Microphone</span>
                        {hoveredSource === 'mic' && (
                          <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginBottom: '10px',
                            background: '#1E293B',
                            color: 'white',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            width: '200px',
                            textAlign: 'center',
                            zIndex: 10,
                            pointerEvents: 'none',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                          }}>
                            Records your voice or surroundings via your microphone.
                            <div style={{
                              position: 'absolute',
                              top: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              borderLeft: '6px solid transparent',
                              borderRight: '6px solid transparent',
                              borderTop: '6px solid #1E293B'
                            }}></div>
                          </div>
                        )}
                      </button>

                      <button
                        className={`source-btn-lg ${transcriptionSource === 'system' ? 'active' : ''}`}
                        onClick={() => setTranscriptionSource('system')}
                        onMouseEnter={() => setHoveredSource('system')}
                        onMouseLeave={() => setHoveredSource(null)}
                        style={{
                          padding: '20px',
                          border: '2px solid var(--gray-light)',
                          borderRadius: '16px',
                          background: transcriptionSource === 'system' ? 'var(--primary-light)' : 'white',
                          borderColor: transcriptionSource === 'system' ? 'var(--primary)' : 'var(--gray-light)',
                          color: transcriptionSource === 'system' ? 'var(--primary-dark)' : 'var(--gray)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                          position: 'relative'
                        }}
                      >
                        <i className="fas fa-volume-up" style={{ fontSize: '24px' }}></i>
                        <span style={{ fontWeight: '600' }}>System</span>
                        {hoveredSource === 'system' && (
                          <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginBottom: '10px',
                            background: '#1E293B',
                            color: 'white',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            width: '200px',
                            textAlign: 'center',
                            zIndex: 10,
                            pointerEvents: 'none',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                          }}>
                            Captures all audio playing on your computer (speakers).
                            <div style={{
                              position: 'absolute',
                              top: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              borderLeft: '6px solid transparent',
                              borderRight: '6px solid transparent',
                              borderTop: '6px solid #1E293B'
                            }}></div>
                          </div>
                        )}
                      </button>
                    </div>

                    {(transcriptionSource === 'system' || transcriptionSource === 'tab') && (
                      <div style={{ marginTop: '20px', maxWidth: '400px', margin: '20px auto 0' }}>
                        <div className="bg-settings-row" style={{ marginBottom: 0, padding: '12px 20px' }}>
                          <label className="toggle-label-clean" style={{ justifyContent: 'space-between', width: '100%' }}>
                            <span style={{ fontSize: '15px', fontWeight: '500', color: 'var(--dark)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <i className="fas fa-volume-mute" style={{ color: 'var(--gray)', fontSize: '14px' }}></i>
                              Mute source while recording
                            </span>
                            <div className="toggle-switch-wrapper">
                              <input type="checkbox" checked={backgroundMuted} onChange={(e) => setBackgroundMuted(e.target.checked)} />
                              <span className="toggle-slider"></span>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}
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
                        <button id="tour-start-capture" className="btn btn-primary btn-xl" onClick={() => {
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
                          id="tour-assist-tab"
                          style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                        >
                          Assist
                        </button>
                      </div>
                    </div>

                    {liveSubTab === 'transcript' && (
                      <div className="output-split-container" style={{ display: 'flex', gap: '16px', height: '100%' }}>
                        <div className="output" id="transcript" style={{ flex: 1 }}>
                          {transcription || <span style={{ color: 'var(--gray)', fontStyle: 'italic' }}>Waiting for speech...</span>}
                        </div>
                        {translationEnabled && (
                          <div className="output translated-output" style={{ flex: 1, borderLeft: '1px solid #eee', paddingLeft: '16px', background: '#f9f9f9' }}>
                            {translatedText || <span style={{ color: 'var(--gray)', fontStyle: 'italic' }}>Translation...</span>}
                          </div>
                        )}
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
                        <div className="chat-messages" ref={assistScrollRef}>
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
                      <i className="fas fa-globe info-icon-bg"></i>
                      <div className="info-text-group">
                        <h4>Rapid Web Transcription</h4>
                        <p>Transcribe videos from the web (YouTube, Canvas, etc.) in a matter of seconds.</p>
                      </div>
                    </div>

                    {/* Section 1: Tab Selector */}
                    <div style={{ marginTop: '24px' }}>
                      <button
                        id="tour-rapid-btn"
                        className="btn btn-primary"
                        onClick={handleRapidTranscribeClick}
                        style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '18px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <i className="fas fa-bolt" style={{ marginRight: '10px' }}></i>
                        Transcribe Audio from Another Browser Tab
                      </button>
                    </div>

                    {/* Divider */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      margin: '28px 0',
                      color: 'var(--gray)',
                      fontWeight: '800',
                      fontSize: '16px'
                    }}>
                      <div style={{ flex: 1, height: '2px', background: 'var(--gray-light)', opacity: 0.8 }}></div>
                      <span style={{ padding: '0 16px', color: 'var(--text-primary)', opacity: 0.7 }}>OR</span>
                      <div style={{ flex: 1, height: '2px', background: 'var(--gray-light)', opacity: 0.8 }}></div>
                    </div>

                    {/* Section 2: URL Input */}
                    <div className="url-input-container">
                      <div className="search-bar" id="tour-url-input" style={{ width: '100%', marginBottom: '12px', padding: '12px' }}>
                        <i className="fas fa-link" style={{ fontSize: '16px' }}></i>
                        <input
                          type="text"
                          placeholder="Paste your video link here..."
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          style={{ fontSize: '16px' }}
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={handleUrlTranscribe}
                        style={{ width: '100%', padding: '12px', borderRadius: '12px', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        disabled={!urlInput}
                      >
                        <i className="fas fa-bolt" style={{ marginRight: '8px' }}></i>
                        Transcribe URL
                      </button>
                    </div>

                    {/* Web Transcription Queue */}
                    {webQueue.length > 0 && (
                      <div className="web-queue" style={{ marginTop: '24px', borderTop: '1px solid var(--gray-light)', paddingTop: '16px' }}>
                        <h5 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--gray)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Processing Queue</h5>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {webQueue.map(item => (
                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid var(--gray-light)', position: 'relative' }}>
                              <i className="fas fa-spinner fa-spin" style={{ color: 'var(--primary)', fontSize: '18px' }}></i>
                              <div style={{ flex: 1, overflow: 'hidden' }}>
                                <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--dark)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title || item.url}</div>
                                <div style={{ fontSize: '12px', color: 'var(--gray)' }}>{item.status}</div>
                              </div>
                              <button
                                className="remove-file"
                                onClick={() => handleRemoveWebQueueItem(item.id)}
                                style={{
                                  background: 'none', border: 'none', color: '#EF4444',
                                  cursor: 'pointer', padding: '4px', fontSize: '16px'
                                }}
                              >
                                <i className="fas fa-times"></i>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="output-container" style={{ marginBottom: '16px', minHeight: '300px' }}>
                    <div className="output-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                      <div className="output-header-top" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <div className="output-header-left">
                          <div className="output-title"><i className="fas fa-file-alt"></i> Transcription Results</div>
                        </div>
                        <div className="output-actions">
                          <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(transcription)}><i className="fas fa-copy"></i> Copy</button>
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
                      <>
                        {/* Original Text - Hide if translation enabled (per request) */}
                        {!translationEnabled && (
                          <div className="output" id="transcript">
                            {transcription || "Your transcription will appear here..."}
                          </div>
                        )}
                        {/* Translated Text - Show if enabled */}
                        {translationEnabled && (
                          <div className="output translated-output" style={{ background: '#f9f9f9', padding: '16px', borderRadius: '8px', border: '1px solid #eee' }}>
                            {translatedText || <span style={{ color: 'var(--gray)', fontStyle: 'italic' }}>Translation...</span>}
                          </div>
                        )}
                      </>
                    )}
                    {outputSubTab === 'notes' && (
                      <div
                        id="liveNotes"
                        className="flex-1 overflow-y-auto p-4 text-sm text-[var(--text-secondary)]"
                      >
                        {notesStatus === 'generating' ? (
                          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--primary)' }}>
                            <i className="fas fa-magic fa-spin" style={{ fontSize: '32px', marginBottom: '12px' }}></i>
                            <p>Generating AI Notes...</p>
                          </div>
                        ) : liveNotes ? (
                          <div className="notes-content" dangerouslySetInnerHTML={{ __html: marked.parse(liveNotes) }} />
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
                        <div className="chat-messages" ref={assistScrollRef}>
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
                    id="tour-upload-area"
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
                  <div className="model-selector-enhanced" id="tour-model-selector">
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

                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Actions */}
                  <div className="action-buttons-enhanced">
                    <button id="tour-transcribe-btn" className="btn btn-primary btn-large" onClick={startTranscription} disabled={status === 'transcribing' || status === 'loading-model'}>
                      {status === 'transcribing' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-play-circle"></i>}
                      {status === 'transcribing' ? ' Transcribing...' : ' Start Transcription'}
                    </button>
                  </div>

                  {/* Transcription Results & Queue */}
                  {/* Transcription Results & Queue */}
                  {(transcribeQueue.length > 0 || completedTranscriptions.length > 0) && (
                    <div className="output-container" style={{ marginTop: '30px', minHeight: '300px' }}>
                      <div className="output-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                        <div className="output-header-top" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                          <div className="output-header-left">
                            <div className="output-title"><i className="fas fa-file-alt"></i> Transcription Results</div>
                          </div>
                          <div className="output-actions">
                            <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(transcription)}><i className="fas fa-copy"></i> Copy</button>
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
                        <div>
                          {/* Queue Section */}
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
                                    <div className="queue-actions" style={{ marginLeft: '12px' }}>
                                      <button
                                        className="remove-file"
                                        onClick={() => handleRemoveTranscribeQueueItem(job.id)}
                                      >
                                        <i className="fas fa-times"></i>
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Completed Section */}
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
                          <div className="chat-messages" ref={assistScrollRef}>
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
                              placeholder="Ask about your file context..."
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
                  )}
                </div>
              )}

            </div>
          </div>
        )}

        {/* New Tab Content Structure */}
        <div className={`tab-content ${activeTab === 'history' ? 'active' : ''}`}>
          {activeTab === 'history' && (
            <HistoryTab onLoadTranscription={loadFromHistory} />
          )}
        </div>

        <div className={`tab-content ${activeTab === 'notes' ? 'active' : ''}`}>
          {activeTab === 'notes' && (
            <AINotesTab
              currentTranscription={transcription}
              liveNotes={liveNotes}
              user={user}
              onLoginRequest={() => setShowLoginModal(true)}
              isViewMode={viewingSavedNotes}
            />
          )}
        </div>

        <div className={`tab-content ${activeTab === 'flashcards' ? 'active' : ''}`}>
          {activeTab === 'flashcards' && (
            <FlashcardsTab
              currentTranscription={transcription}
              user={user}
              onLoginRequest={() => setShowLoginModal(true)}
            />
          )}
        </div>

        <div className={`tab-content ${activeTab === 'chat' ? 'active' : ''}`}>
          {activeTab === 'chat' && (
            <ChatTab
              currentTranscription={transcription}
              user={user}
              onLoginRequest={() => setShowLoginModal(true)}
            />
          )}
        </div>

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

      {/* Slow Transcription / Missing Component Popup */}
      {
        showSlowPopup && (
          <div className="modal-overlay">
            <div className="modal-content-enhanced">
              <button className="modal-close-btn" onClick={() => setShowSlowPopup(false)}><i className="fas fa-times"></i></button>
              <div className="modal-icon-large">
                <i className="fas fa-tachometer-alt"></i>
              </div>

              {!isWsConnected && !isExtConnected ? (
                <>
                  <h3 className="modal-title">Complete Your Setup</h3>
                  <p className="modal-text">You are missing <strong>both components</strong> required for the best experience.</p>
                </>
              ) : !isWsConnected ? (
                <>
                  <h3 className="modal-title">Desktop App Required</h3>
                  <p className="modal-text" style={{ marginBottom: '16px' }}>
                    To use Rapid Transcribe, you must have the Desktop App <strong>installed AND running</strong>.
                  </p>
                  <ol style={{ textAlign: 'left', margin: '0 0 20px 20px', color: '#666', fontSize: '14px', lineHeight: '1.6' }}>
                    <li>Download the app below (if you haven't already).</li>
                    <li><strong>Launch the app</strong> and keep it open.</li>
                    <li>Click the button below to retry.</li>
                  </ol>
                  <button
                    className="btn btn-primary btn-block"
                    onClick={checkConnection}
                    disabled={connectionCheckLoading}
                    style={{ marginBottom: '16px' }}
                  >
                    {connectionCheckLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-sync-alt"></i>}
                    {connectionCheckLoading ? ' Checking...' : ' I have opened the app'}
                  </button>
                </>
              ) : (
                <>
                  <h3 className="modal-title">Extension Required</h3>
                  <p className="modal-text">Install the helper extension to enable seamless browser communication.</p>
                </>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(!isWsConnected) && (
                  <>
                    <a href="https://github.com/tusharj03/transcribelandingpage/releases/download/v1.0.5/Resonote_Background_Service_Setup.exe" className="btn btn-outline btn-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none' }}>
                      <i className="fab fa-windows"></i> Download for Windows
                    </a>
                    <a href="https://github.com/tusharj03/transcribelandingpage/releases/download/v1.0.5/Resonote_Background_Service.pkg" className="btn btn-outline btn-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'transparent', borderColor: '#ddd', color: '#333', textDecoration: 'none' }}>
                      <i className="fab fa-apple"></i> Download for Mac
                    </a>
                  </>
                )}

                {(!isExtConnected) && (
                  <a href="https://chromewebstore.google.com/detail/resonote-extension/iddimggbohccfikpkeelhaceooojfiga" target="_blank" rel="noreferrer" className="btn btn-outline btn-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none' }}>
                    <i className="fab fa-chrome"></i> Get Chrome Extension
                  </a>
                )}
              </div>
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

      {/* Alert Modal */}
      {alertMessage && (
        <AlertModal
          message={alertMessage}
          onClose={() => setAlertMessage(null)}
        />
      )}

      {/* Tab Selector Modal */}
      {showTabSelector && (
        <div className="modal-overlay" onClick={() => setShowTabSelector(false)} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, color: '#1E293B'
        }}>
          <div className="tab-selector-container" onClick={(e) => e.stopPropagation()} style={{
            background: 'white', borderRadius: '12px', width: '450px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 24px 16px 24px', flexShrink: 0, background: 'white' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#1E293B' }}><i className="fas fa-list"></i> Select a Tab</h3>
              <button onClick={() => setShowTabSelector(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748B' }}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px 24px' }}>
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
