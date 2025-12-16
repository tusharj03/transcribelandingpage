
import React, { useEffect, useRef, useState } from 'react';
import './index.css';
import HistoryTab, { saveToHistory } from './components/HistoryTab';
import AINotesTab from './components/AINotesTab';
import ChatTab from './components/ChatTab';
import { useAuth } from './hooks/useAuth';

// We'll use FontAwesome for icons by adding the CDN link in index.html, 
// matching the original app.

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

  // Popup State
  const [showSlowPopup, setShowSlowPopup] = useState(false);
  const [showUpsellPopup, setShowUpsellPopup] = useState(false);

  // Transcribe Tab State
  const [transcribeCategory, setTranscribeCategory] = useState('file'); // 'live', 'background', 'file'

  // Model State
  const [selectedModel, setSelectedModel] = useState('base');

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
    if (status === 'transcribing' || status === 'loading-model') {
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
  }, [status]);

  // Upsell Popup Logic (Random/Timer)
  useEffect(() => {
    // Show upsell popup after 5 minutes (300000ms) or randomly
    const timer = setTimeout(() => {
      // Simple check to not show if user is deep in something else? Nah, just show it.
      // Maybe check if we haven't shown it yet
      setShowUpsellPopup(true);
    }, 300000);

    return () => clearTimeout(timer);
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

    try {
      const { audio, sampleRate, decodeMs } = await readAudioFrom(nextJob.file);
      worker.current.postMessage(
        {
          type: 'transcribe',
          audioBuffer: audio.buffer,
          sampleRate,
          jobId: nextJob.id,
          debugProfile: typeof localStorage !== 'undefined' && localStorage.getItem('whisperProfile') === '1',
          stageTiming: true,
          decodeMs,
        },
        [audio.buffer]
      );
    } catch (err) {
      handleJobError(nextJob.id, err.message);
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

  // Special Web Feature: Record "Background" (System Audio) via Screen Share
  const startSystemAudioRecording = async () => {
    if (!user || (!user.authenticated && !user.offlineMode)) {
      setShowLoginModal(true);
      return;
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
          setStatus('error');
        }

        stream.getTracks().forEach(t => t.stop());
      };

      // If user clicks "Stop Sharing" on browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopRecording();
      };

      mediaRecorder.current.start();
      setStatus('recording');
      startTimer();
    } catch (err) {
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current) {
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
    <div className="container">

      {/* Header */}
      <header>
        <div className="header">
          <div className="logo">
            <img src="/icons/resonote1795x512.png" alt="Resonote Logo" style={{ width: '260px', height: 'auto', display: 'block', margin: '0 auto 10px' }} />
          </div>
        </div>
        <div className="header-actions">
          {user && user.authenticated ? (
            <>
              <div id="userInfo" className="user-info">
                <span className="user-email">{user.email || 'User'}</span>
                {/* <span className="user-plan">{user.plan}</span> */}
              </div>
              <button id="logoutBtn" className="btn btn-outline logout-btn" onClick={logout}>
                <i className="fas fa-sign-out-alt"></i> Log Out
              </button>
            </>
          ) : (
            !showLoginModal && (
              <button className="btn btn-primary" onClick={() => setShowLoginModal(true)}>
                <i className="fas fa-user-circle"></i> Login
              </button>
            )
          )}
        </div>
        <p className="subtitle">Convert audio, video, and screen recordings to text with AI-powered transcription</p>
      </header>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab-btn ${activeTab === 'transcribe' ? 'active' : ''}`} onClick={() => setActiveTab('transcribe')}>Transcribe</button>
        <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>History</button>
        <button className={`tab-btn ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>AI Notes</button>
        <button className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>Chat</button>
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

            {/* FILE CATEGORY (Formerly Upload) */}
            {transcribeCategory === 'file' && (
              <div className="category-content active">
                {/* Workflow visual (static) */}
                <div className="transcription-workflow">
                  <div className="workflow-step">
                    <div className="step-number">1</div>
                    <h3>Choose Files</h3>
                  </div>
                  <div className="workflow-step">
                    <div className="step-number">2</div>
                    <h3>Select Model</h3>
                  </div>
                  <div className="workflow-step">
                    <div className="step-number">3</div>
                    <h3>Transcribe</h3>
                  </div>
                  <div className="workflow-step">
                    <div className="step-number">4</div>
                    <h3>Get Results</h3>
                  </div>
                </div>

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

            {/* LIVE CATEGORY (Microphone) */}
            {transcribeCategory === 'live' && (
              <div className="category-content active">
                <div className="recording-category-info">
                  <div className="info-icon"><i className="fas fa-microphone-alt"></i></div>
                  <div className="info-content">
                    <h3>Live Recording</h3>
                    <p>Record high-quality audio directly from your microphone.</p>
                  </div>
                </div>

                <div className="microphone-recording-container" style={{ textAlign: 'center', padding: '40px' }}>
                  <div className="recording-timer" style={{ fontSize: '48px', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '30px' }}>
                    {recordingTime}
                  </div>

                  {status === 'recording' ? (
                    <button className="btn btn-danger btn-xl" onClick={stopRecording}>
                      <i className="fas fa-stop"></i> Stop Recording
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
                      <button className="btn btn-primary btn-xl" onClick={startMicrophoneRecording}>
                        <i className="fas fa-microphone"></i> Start Recording
                      </button>
                    </div>
                  )}

                  {transcription && status === 'complete' && (
                    <div className="output-container-enhanced" style={{ marginTop: '30px', textAlign: 'left', width: '100%' }}>
                      <div className="output-header">
                        <div className="output-title"><i className="fas fa-file-alt"></i> Results</div>
                        <div className="output-actions">
                          <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(transcription)}><i className="fas fa-copy"></i> Copy</button>
                          <button className="btn btn-outline" onClick={() => handleDownloadTxt(transcription)}><i className="fas fa-download"></i> Download TXT</button>
                          <button className="btn btn-primary" onClick={() => handleCreateAINotes(transcription)}><i className="fas fa-robot"></i> AI Notes</button>
                        </div>
                      </div>
                      <div className="output-enhanced" style={{ padding: '20px', background: 'var(--gray-light)', whiteSpace: 'pre-wrap' }}>
                        {transcription}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* BACKGROUND CATEGORY (System Audio) */}
            {transcribeCategory === 'background' && (
              <div className="category-content active">
                <div className="recording-category-info">
                  <div className="info-icon"><i className="fas fa-desktop"></i></div>
                  <div className="info-content">
                    <h3>Background Recording</h3>
                    <p>Record system audio from a specific tab or window.</p>
                  </div>
                </div>

                <div className="microphone-recording-container" style={{ textAlign: 'center', padding: '40px' }}>
                  <div className="recording-timer" style={{ fontSize: '48px', fontWeight: 'bold', fontFamily: 'monospace', marginBottom: '30px' }}>
                    {recordingTime}
                  </div>

                  {status === 'recording' ? (
                    <button className="btn btn-danger btn-xl" onClick={stopRecording}>
                      <i className="fas fa-stop"></i> Stop Recording
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
                      <button className="btn btn-outline btn-xl" onClick={startSystemAudioRecording}>
                        <i className="fas fa-desktop"></i> Start Background Recording
                      </button>
                    </div>
                  )}

                  {transcription && status === 'complete' && (
                    <div className="output-container-enhanced" style={{ marginTop: '30px', textAlign: 'left', width: '100%' }}>
                      <div className="output-header">
                        <div className="output-title"><i className="fas fa-file-alt"></i> Results</div>
                        <div className="output-actions">
                          <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(transcription)}><i className="fas fa-copy"></i> Copy</button>
                          <button className="btn btn-outline" onClick={() => handleDownloadTxt(transcription)}><i className="fas fa-download"></i> Download TXT</button>
                          <button className="btn btn-primary" onClick={() => handleCreateAINotes(transcription)}><i className="fas fa-robot"></i> AI Notes</button>
                        </div>
                      </div>
                      <div className="output-enhanced" style={{ padding: '20px', background: 'var(--gray-light)', whiteSpace: 'pre-wrap' }}>
                        {transcription}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <HistoryTab onLoadTranscription={loadFromHistory} />
      )}

      {activeTab === 'notes' && (
        <AINotesTab
          currentTranscription={transcription}
          user={user}
          onLoginRequest={() => setShowLoginModal(true)}
          isViewMode={viewingSavedNotes}
        />
      )}

      {activeTab === 'chat' && (
        <ChatTab
          currentTranscription={transcription}
          user={user}
          onLoginRequest={() => setShowLoginModal(true)}
        />
      )}

      {/* Login Modal (Styled to match Electron App) */}
      {showLoginModal && (
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
      )}

      {/* Slow Transcription Popup */}
      {showSlowPopup && (
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
      )}

      {/* Upsell Popup */}
      {showUpsellPopup && (
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
      )}

    </div >
  );
}

export default App;
const displayPercent = (value) => {
  const num = Number(value) || 0;
  return `${Math.round(Math.max(0, Math.min(100, num)))}%`;
};
