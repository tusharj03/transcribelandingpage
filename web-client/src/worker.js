
import { pipeline, env } from '@xenova/transformers';

// Skip local checks for the model since we are running in browser
env.allowLocalModels = false;
env.useBrowserCache = true;

self.postMessage({ type: 'worker-alive', ts: Date.now() });

// Simple VAD-style detector: find the first window whose energy is well above
// the noise floor so we can skip long leading silence.
const detectSpeechStart = (audio, sampleRate, opts = {}) => {
    if (!audio || audio.length === 0 || !sampleRate) return null;
    const windowMs = opts.windowMs ?? 30;
    const hopMs = opts.hopMs ?? 15;
    const padSeconds = opts.padSeconds ?? 1;
    const minThreshold = opts.minThreshold ?? 0.00001;

    const window = Math.max(1, Math.floor(sampleRate * (windowMs / 1000)));
    const hop = Math.max(1, Math.floor(sampleRate * (hopMs / 1000)));
    if (window <= 0 || hop <= 0) return null;

    const rmsValues = [];
    for (let start = 0; start < audio.length; start += hop) {
        const end = Math.min(audio.length, start + window);
        let sumSq = 0;
        for (let i = start; i < end; i++) {
            const v = audio[i];
            sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, end - start));
        rmsValues.push(rms);
    }
    if (rmsValues.length === 0) return null;

    const quantile = (arr, q) => {
        if (!arr.length) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
        return sorted[idx];
    };

    const noiseFloor = quantile(rmsValues, 0.2);
    const median = quantile(rmsValues, 0.5);
    const threshold = Math.max(minThreshold, noiseFloor * 3, median * 0.6);

    let speechWindow = -1;
    for (let i = 0; i < rmsValues.length; i++) {
        // Require two windows over threshold to avoid single-pop triggers.
        const level = (rmsValues[i] + (rmsValues[i + 1] ?? rmsValues[i])) / 2;
        if (level > threshold) {
            speechWindow = i;
            break;
        }
    }
    if (speechWindow < 0) return null;

    const startSample = Math.max(0, (speechWindow * hop) - Math.floor(sampleRate * padSeconds));
    return {
        startSample,
        startSeconds: startSample / sampleRate,
        threshold,
        noiseFloor,
        median,
    };
};

class PipelineSingleton {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-base.en'; // Default aligns with UI "base" option
    static instance = null;
    static configured = false;
    static adapterInfo = null;
    static backend = null;
    static dtype = 'float32';

    static configureBackendPerformance() {
        if (this.configured) return;
        const wasm = env.backends?.onnx?.wasm;
        if (wasm) {
            const cores = navigator?.hardwareConcurrency || 4;
            const isolation = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
            // Threads only work when crossOriginIsolated; otherwise force single-threaded to avoid false confidence.
            if (isolation) {
                const threads = Math.max(1, (cores || 2) - 1);
                wasm.numThreads = threads;
                wasm.proxy = true;
                wasm.simd = true;
            } else {
                wasm.numThreads = 1;
                wasm.proxy = false;
                wasm.simd = true;
            }
        }
        this.configured = true;
    }

    static async detectAdapter() {
        if (!('gpu' in navigator) || typeof navigator.gpu?.requestAdapter !== 'function') return null;
        try {
            const tryAdapter = async (opts) => {
                try {
                    return await navigator.gpu.requestAdapter(opts);
                } catch (e) {
                    return null;
                }
            };

            // Prefer the high-performance adapter, fall back to default if unavailable.
            const adapter = await tryAdapter({ powerPreference: 'high-performance' }) || await tryAdapter();
            if (!adapter) return null;
            const features = adapter.features ? Array.from(adapter.features.values()) : [];
            const limits = adapter.limits ? Object.fromEntries(Object.entries(adapter.limits)) : {};
            return {
                name: adapter.name || null,
                vendor: adapter.vendor || null,
                features,
                limits,
                isSwiftShader: (adapter.name || '').toLowerCase().includes('swiftshader'),
            };
        } catch (err) {
            console.warn('WebGPU adapter detection failed', err);
            return null;
        }
    }

    static async getInstance(progressCallback = null, forceBackend = null) {
        if (this.instance === null) {
            // Configure performance settings
            this.configureBackendPerformance();

            // Detect adapter once
            if (!this.adapterInfo) {
                this.adapterInfo = await this.detectAdapter();
            }

            const adapter = this.adapterInfo;
            const supportsWebGPU = adapter && !adapter.isSwiftShader;
            const useF16 = !!adapter?.features?.includes?.('shader-f16');
            this.dtype = useF16 ? 'float16' : 'float32';
            this.runtimeDtype = this.dtype;
            const taskId = this.task || 'automatic-speech-recognition';

            try {
                if (forceBackend !== 'wasm' && supportsWebGPU) {
                    console.log("🚀 Attempting to load model with WebGPU...");
                    try {
                        this.instance = await pipeline(taskId, PipelineSingleton.model, {
                            progress_callback: progressCallback,
                            device: 'webgpu',
                            dtype: this.dtype,
                        });
                    } catch (e) {
                        if (String(e?.message || '').includes('Unsupported model type') && !PipelineSingleton.__triedFallbackModel) {
                            console.warn('⚠️ Unsupported model type for', PipelineSingleton.model, 'retrying with Xenova/whisper-base.en');
                            PipelineSingleton.__triedFallbackModel = true;
                            PipelineSingleton.model = 'Xenova/whisper-base.en';
                            this.instance = await pipeline(taskId, PipelineSingleton.model, {
                                progress_callback: progressCallback,
                                device: 'webgpu',
                                dtype: this.dtype,
                            });
                        } else {
                            throw e;
                        }
                    }
                    this.backend = 'webgpu';
                    console.log("✅ WebGPU Load Success!");
                } else {
                    throw new Error('Skipping WebGPU (unsupported or forced WASM)');
                }
            } catch (err) {
                console.warn("⚠️ WebGPU failed or skipped, falling back to WASM (CPU).", err);
                const wasmThreads = env.backends?.onnx?.wasm?.numThreads;

                try {
                    this.instance = await pipeline(taskId, PipelineSingleton.model, {
                        progress_callback: progressCallback,
                        device: 'wasm',
                    });
                } catch (e) {
                    if (String(e?.message || '').includes('Unsupported model type') && !PipelineSingleton.__triedFallbackModel) {
                        console.warn('⚠️ Unsupported model type for', PipelineSingleton.model, 'retrying with Xenova/whisper-base.en on WASM');
                        PipelineSingleton.__triedFallbackModel = true;
                        PipelineSingleton.model = 'Xenova/whisper-base.en';
                        this.instance = await pipeline(taskId, PipelineSingleton.model, {
                            progress_callback: progressCallback,
                            device: 'wasm',
                        });
                    } else {
                        throw e;
                    }
                }
                this.backend = `wasm:${wasmThreads || 1}`;
                this.dtype = 'float32';
            }

            // Emit telemetry once per load
            const handler = this.instance?.model?.session?.handler;
            const backendName = handler?.backend?.name || handler?.name || this.backend || 'unknown';
            const fallbackList = handler?.fallbacks || handler?.cpuFallback || null;
            const wasmCfg = env.backends?.onnx?.wasm || {};
            const backendDtype = handler?.backend?.dtype || handler?.backend?.device?.preferredPixelFormat || this.dtype;
            if (useF16 && !String(backendDtype || '').includes('16')) {
                console.warn('⚠️ FP16 requested but runtime is', backendDtype || 'unknown');
            }
            this.runtimeDtype = backendDtype || this.dtype;
            this.dtype = String(this.runtimeDtype || '').includes('16') ? 'float16' : 'float32';
            self.postMessage({
                type: 'telemetry',
                data: {
                    backend: backendName,
                    dtype: this.dtype,
                    runtime_dtype: this.runtimeDtype,
                    fp16_requested: useF16,
                    adapter: adapter || null,
                    wasm: {
                        numThreads: wasmCfg.numThreads,
                        proxy: wasmCfg.proxy,
                        simd: wasmCfg.simd,
                    },
                    fallbacks: fallbackList || [],
                },
            });
        }
        return this.instance;
    }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audio, audioBuffer, jobId, sampleRate: inputSampleRate, debugProfile, backend: forcedBackend, decodeMs, stageTiming } = event.data;

    if (type === 'load') {
        try {
            const modelName = event.data.model || 'Xenova/whisper-base.en';

            // Should we reload?
            if (PipelineSingleton.instance && PipelineSingleton.model !== modelName) {
                // Ideally we'd dispose, but transformers.js v2 doesn't have an explicit dispose on the pipeline easily exposed 
                // or we just overwrite the instance. V3 has dispose(). 
                // For now, overwriting:
                PipelineSingleton.instance = null;
            }

            if (PipelineSingleton.model !== modelName) {
                PipelineSingleton.model = modelName;
            }

            await PipelineSingleton.getInstance((data) => {
                // Relay progress back to main thread
                self.postMessage({ type: 'download', data });
            }, forcedBackend);
            self.postMessage({ type: 'ready' });
        } catch (error) {
            self.postMessage({ type: 'error', data: { message: error.message, jobId } });
        }
        return;
    }

    if (type === 'transcribe') {
        const userForcesChunking = event.data?.forceChunking === true;
        const userForcesFull = event.data?.forceChunking === false;
        const defaultChunking = false; // prefer full-clip first unless user opts in
        const chunkLengthSeconds = 30;
        const strideSeconds = 5;

        try {
            const transcriber = await PipelineSingleton.getInstance(null, forcedBackend);

            // Rehydrate audio from transferable buffer when provided
            const audioInput = audioBuffer ? new Float32Array(audioBuffer) : audio;
            if (!audioInput) throw new Error('No audio provided to worker');

            // Trim leading silence so the model sees speech quickly.
            const sourceSampleRate = inputSampleRate || transcriber?.processor?.feature_extractor?.config?.sampling_rate || 16000;
            const vadInfo = detectSpeechStart(audioInput, sourceSampleRate, { padSeconds: 1, windowMs: 30, hopMs: 15 });
            let workingAudio = audioInput;
            const audioWasTrimmed = !!(vadInfo && vadInfo.startSample > 0 && vadInfo.startSample < audioInput.length - sourceSampleRate * 0.5);
            if (audioWasTrimmed) {
                workingAudio = audioInput.subarray(vadInfo.startSample);
            }

            // Use the model's expected sample rate for length calculations
            const sr = transcriber?.processor?.feature_extractor?.config?.sampling_rate || 16000;
            const resampleFactor = inputSampleRate ? sr / inputSampleRate : 1;
            const calcSeconds = (arr) => {
                const effectiveLength = Math.max(1, Math.floor((arr.length || 0) * resampleFactor));
                return Math.max(1, effectiveLength / sr);
            };
            let currentTotalSeconds = calcSeconds(workingAudio);
            const totalSecondsFull = calcSeconds(audioInput);
            let usedTrimmedAudio = audioWasTrimmed;

            const wantStageTiming = !!stageTiming || !!debugProfile;
            let profilingStarted = false;
            if (wantStageTiming && transcriber?.model?.session?.startProfiling) {
                transcriber.model.session.startProfiling();
                profilingStarted = true;
            }

            let processedSeconds = 0;
            const postProgress = (percent) => {
                if (jobId) {
                    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
                    self.postMessage({ type: 'progress', data: { jobId, percent: safe } });
                }
            };

            const buildRequestOptions = (useChunking, overrides = {}) => {
                const chunkLen = overrides.chunk_length_s ?? chunkLengthSeconds;
                const strideLen = overrides.stride_length_s ?? strideSeconds;
                const opts = {
                    language: 'english',
                    task: 'transcribe',
                    return_timestamps: useChunking,
                    condition_on_previous_text: overrides.condition_on_previous_text ?? true,
                    // Deterministic decoding for stability across chunks; disable early stopping on "no speech" heuristics
                    temperature: overrides.temperature ?? 0,
                    no_speech_threshold: overrides.no_speech_threshold ?? -Infinity, // never drop a chunk for predicted silence
                    logprob_threshold: overrides.logprob_threshold ?? -Infinity, // don't abort on low avg logprob
                    compression_ratio_threshold: overrides.compression_ratio_threshold ?? Infinity, // don't abort on "looks like pure noise"
                };
                if (useChunking) {
                    opts.chunk_length_s = chunkLen;
                    opts.stride_length_s = strideLen;
                    opts.chunk_callback = (chunk) => {
                        const chunkDuration = Math.max(0, (chunk?.stride?.[0] || chunkLen) - (chunk?.stride?.[1] || strideLen) - (chunk?.stride?.[2] || strideLen));
                        processedSeconds += chunkDuration;
                        const percent = (processedSeconds / currentTotalSeconds) * 100;
                        postProgress(percent);
                    };
                }
                return opts;
            };

            const preferChunkingForLength = Math.max(currentTotalSeconds, totalSecondsFull) > 30; // long clips benefit from chunking for memory/runtime
            const runMode = {
                attemptedChunking: userForcesChunking || ((defaultChunking || preferChunkingForLength) && !userForcesFull),
                usedChunking: false,
            };
            let usedRecoveryFallback = false;

            // send an initial progress update for the queue UI
            if (jobId) {
                postProgress(0);
            }

            const extractText = (res) => {
                if (!res) return '';
                if (typeof res.text === 'string' && res.text.trim()) return res.text.trim();
                if (Array.isArray(res.chunks)) {
                    return res.chunks.map(c => (c?.text || '').trim()).filter(Boolean).join(' ').trim();
                }
                if (Array.isArray(res.segments)) {
                    return res.segments.map(c => (c?.text || '').trim()).filter(Boolean).join(' ').trim();
                }
                return '';
            };

            const attempt = async (audioData, useChunking, isTrimmed, overrides = {}) => {
                processedSeconds = 0;
                runMode.usedChunking = useChunking;
                usedTrimmedAudio = !!isTrimmed;
                const tStart = performance.now();
                const res = await transcriber(audioData, buildRequestOptions(useChunking, overrides));
                const elapsed = performance.now() - tStart;
                return { res, elapsed, usedChunking: useChunking };
            };

            let attemptResult;
            try {
                attemptResult = await attempt(workingAudio, runMode.attemptedChunking, audioWasTrimmed);
            } catch (err) {
                // If full-clip failed (likely OOM or wasm issue), retry with chunking to avoid hard failure.
                const triedFullClip = !runMode.attemptedChunking;
                if (triedFullClip) {
                    console.warn('Full-clip transcription failed, retrying with chunking', err);
                    attemptResult = await attempt(workingAudio, true, audioWasTrimmed);
                } else {
                    // If we trimmed audio and it still failed, fall back to the original clip before surfacing.
                    if (audioWasTrimmed) {
                        console.warn('Trimmed audio failed; retrying with full audio buffer');
                        currentTotalSeconds = totalSecondsFull;
                        attemptResult = await attempt(audioInput, true, false);
                    } else {
                        throw err;
                    }
                }
            }

            let finalText = extractText(attemptResult?.res);
            // If we got an empty transcript, retry once with chunking as a recovery.
            if ((!finalText || finalText.length === 0) && !attemptResult?.usedChunking) {
                console.warn('Empty transcript on full-clip run; retrying with chunking');
                attemptResult = await attempt(workingAudio, true, audioWasTrimmed);
                finalText = extractText(attemptResult?.res);
            }
            // If trimmed audio yielded nothing, try again with the untrimmed clip to avoid accidental over-trim.
            if ((!finalText || finalText.length === 0) && audioWasTrimmed) {
                console.warn('Empty transcript after trimmed audio; retrying full audio');
                currentTotalSeconds = totalSecondsFull;
                attemptResult = await attempt(audioInput, true, false);
                finalText = extractText(attemptResult?.res);
            }
            // Last-resort permissive chunked pass to defeat no-speech heuristics.
            if (!finalText || finalText.length === 0) {
                console.warn('Empty transcript after all retries; running permissive chunked fallback');
                currentTotalSeconds = totalSecondsFull;
                usedRecoveryFallback = true;
                const permissiveOverrides = {
                    chunk_length_s: 15,
                    stride_length_s: 3,
                    condition_on_previous_text: false,
                    temperature: 0,
                    no_speech_threshold: -Infinity,
                    logprob_threshold: -Infinity,
                    compression_ratio_threshold: Infinity,
                    return_timestamps: true,
                };
                attemptResult = await attempt(audioInput, true, false, permissiveOverrides);
                finalText = extractText(attemptResult?.res);
            }

            runMode.usedChunking = !!attemptResult?.usedChunking;
            const elapsedMs = attemptResult?.elapsed ?? 0;
            const result = attemptResult?.res || {};

            const tokenCount = finalText
                ? finalText.trim().split(/\s+/).filter(Boolean).length
                : 0;
            console.log('[timing] transcription ms:', elapsedMs);
            console.log('[timing] tokens:', tokenCount);
            if (tokenCount > 0 && elapsedMs > 0) {
                console.log('[timing] ms/token:', elapsedMs / tokenCount);
            }

            let stageTimingMs = null;
            if (profilingStarted) {
                const profile = transcriber.model.session.endProfiling();
                const events = profile?.events || [];
                const dispatches = events.filter(e => e?.cat === 'Dispatch' || e?.name?.includes('Dispatch'));
                const maxDispatchMs = dispatches.reduce((max, e) => Math.max(max, e?.dur || 0), 0) / 1000; // convert µs to ms if dur is µs
                const totalUs = events.reduce((sum, e) => sum + (e?.dur || 0), 0);
                const bucketUs = (pred) => events.reduce((sum, e) => pred(e) ? sum + (e?.dur || 0) : sum, 0);
                const encoderUs = bucketUs(e => /encoder/i.test(e?.name || '') || /encoder/i.test(e?.args?.op_name || ''));
                const decoderUs = bucketUs(e => /decoder/i.test(e?.name || '') || /decoder/i.test(e?.args?.op_name || '') || /lm_head/i.test(e?.name || ''));
                const encoderMs = encoderUs / 1000;
                const decoderMs = decoderUs / 1000;
                const totalMs = totalUs / 1000;
                const postMs = Math.max(0, totalMs - encoderMs - decoderMs);
                stageTimingMs = {
                    decode: typeof decodeMs === 'number' ? decodeMs : null,
                    encoder: encoderMs || null,
                    decoder: decoderMs || null,
                    post: postMs || null,
                    total: totalMs || null,
                };
                self.postMessage({ type: 'profile', data: { jobId, dispatches: dispatches.length, maxDispatchMs } });
            }

            // Emit per-job metrics for UI/debugging
            const metricsPayload = {
                jobId,
                backend: PipelineSingleton.backend || 'unknown',
                dtype: PipelineSingleton.dtype || 'unknown',
                runtime_dtype: PipelineSingleton.runtimeDtype || null,
                adapter: PipelineSingleton.adapterInfo || null,
                chunk_length_s: runMode.usedChunking ? chunkLengthSeconds : null,
                stride_length_s: runMode.usedChunking ? strideSeconds : null,
                vad_trimmed: usedTrimmedAudio || false,
                recovery_fallback: usedRecoveryFallback || false,
                speech_start_s: vadInfo ? vadInfo.startSeconds : null,
                tokens: tokenCount ?? null,
                elapsed_ms: elapsedMs,
                tokens_per_sec: tokenCount && elapsedMs ? (tokenCount / (elapsedMs / 1000)) : null,
                ms_per_token: tokenCount && elapsedMs ? (elapsedMs / tokenCount) : null,
                decode_ms: typeof decodeMs === 'number' ? decodeMs : null,
                stage_timing_ms: stageTimingMs || null,
                speech_start_s: vadInfo ? vadInfo.startSeconds : null,
            };
            self.postMessage({ type: 'metrics', data: metricsPayload });

            // Ensure we report completion if chunk_callback didn't hit 100
            if (jobId) {
                self.postMessage({ type: 'progress', data: { jobId, percent: 100 } });
            }

            const payload = { jobId, metrics: metricsPayload, text: finalText || '' };
            if (result && typeof result === 'object') {
                Object.assign(payload, result);
            }
            self.postMessage({ type: 'result', data: payload });
        } catch (error) {
            const safeMetrics = {
                jobId,
                backend: PipelineSingleton.backend || 'unknown',
                dtype: PipelineSingleton.dtype || 'unknown',
                runtime_dtype: PipelineSingleton.runtimeDtype || null,
                adapter: PipelineSingleton.adapterInfo || null,
                chunk_length_s: runMode.usedChunking ? chunkLengthSeconds : null,
                stride_length_s: runMode.usedChunking ? strideSeconds : null,
                vad_trimmed: usedTrimmedAudio || false,
                recovery_fallback: usedRecoveryFallback || false,
                speech_start_s: vadInfo ? vadInfo.startSeconds : null,
                tokens: null,
                elapsed_ms: null,
                tokens_per_sec: null,
                ms_per_token: null,
                decode_ms: typeof decodeMs === 'number' ? decodeMs : null,
                stage_timing_ms: null,
            };
            self.postMessage({ type: 'error', data: { message: error.message, jobId, metrics: safeMetrics } });
        }
    }
});
