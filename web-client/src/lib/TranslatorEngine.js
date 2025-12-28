import languageMapping from './languageMapping.json';

class TranslatorEngine {
    constructor() {
        this.engine = null; // 'chrome' | 'transformers'
        this.worker = null;
        this.isReady = false;
        this.onProgressCallback = null;
        this.sourceLang = 'en';
        this.targetLang = 'es';
    }

    async init(sourceLang = 'en', targetLang = 'es') {
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;

        // 1. Check for Chrome Native AI
        if (window.ai && window.ai.translator) {
            try {
                const capabilities = await window.ai.translator.capabilities();
                if (capabilities.available !== 'no') {
                    // It's available (or 'after-download')
                    try {
                        this.chromeTranslator = await window.ai.translator.create({
                            sourceLanguage: sourceLang,
                            targetLanguage: targetLang,
                            monitor(m) {
                                m.addEventListener('downloadprogress', (e) => {
                                    if (this.onProgressCallback) {
                                        // Normalize to 0-100
                                        const percent = (e.loaded / e.total) * 100;
                                        this.onProgressCallback(percent, 'Downloading Chrome Model...');
                                    }
                                });
                            }
                        });
                        this.engine = 'chrome';
                        this.isReady = true;
                        console.log('✅ Using Chrome Native AI Translator');
                        return true;
                    } catch (createError) {
                        console.warn('Chrome AI creation failed, falling back...', createError);
                    }
                }
            } catch (e) {
                console.log('Chrome AI checks failed', e);
            }
        }

        // 2. Fallback to Transformers.js Worker
        console.log('⚠️ Using Transformers.js Fallback');
        this.engine = 'transformers';
        this.worker = new Worker(new URL('../workers/translation.worker.js', import.meta.url), { type: 'module' });

        return new Promise((resolve, reject) => {
            this.worker.onmessage = (e) => {
                const { type, data, error } = e.data;
                if (type === 'ready') {
                    this.isReady = true;
                    resolve(true);
                } else if (type === 'progress') {
                    if (this.onProgressCallback) {
                        // data has status, file, progress, loaded, total
                        // We typically restart progress for each shard, so it's jumpy, but okay for MVP
                        if (data.status === 'progress' && data.progress) {
                            this.onProgressCallback(data.progress, `Downloading ${data.file}...`);
                        } else if (data.status === 'initiate') {
                            this.onProgressCallback(0, `Initializing ${data.file}...`);
                        }
                    }
                } else if (type === 'error') {
                    console.error("Worker Error:", error);
                    reject(error);
                }
            };

            this.worker.postMessage({ type: 'init' });
        });
    }

    async translate(text) {
        if (!this.isReady) throw new Error("Translator not ready");

        if (this.engine === 'chrome') {
            return await this.chromeTranslator.translate(text);
        } else {
            return new Promise((resolve, reject) => {
                const id = Date.now().toString();

                const handler = (e) => {
                    if (e.data.id === id) {
                        this.worker.removeEventListener('message', handler);
                        if (e.data.type === 'result') resolve(e.data.text);
                        else reject(e.data.error);
                    }
                };
                this.worker.addEventListener('message', handler);

                // Map simple codes to NLLB codes
                const src = languageMapping[this.sourceLang] || this.sourceLang;
                const tgt = languageMapping[this.targetLang] || this.targetLang;

                this.worker.postMessage({
                    type: 'translate',
                    text,
                    src_lang: src,
                    tgt_lang: tgt,
                    id
                });
            });
        }
    }

    setOnProgress(callback) {
        this.onProgressCallback = callback;
    }
}

export const translator = new TranslatorEngine();
