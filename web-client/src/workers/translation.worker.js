
import { pipeline, env } from '@xenova/transformers';

// Skip local model checks, use remote models by default for web
env.allowLocalModels = false;
env.useBrowserCache = true;

class TranslationPipeline {
    static task = 'translation';
    static model = 'Xenova/nllb-200-distilled-600M';
    static instance = null;

    static async getInstance(progressCallback = null) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, { progress_callback: progressCallback });
        }
        return this.instance;
    }
}

self.addEventListener('message', async (event) => {
    const { type, text, src_lang, tgt_lang, id } = event.data;

    if (type === 'init') {
        try {
            await TranslationPipeline.getInstance((data) => {
                self.postMessage({ type: 'progress', data });
            });
            self.postMessage({ type: 'ready' });
        } catch (e) {
            self.postMessage({ type: 'error', error: e.message });
        }
    } else if (type === 'translate') {
        try {
            const translator = await TranslationPipeline.getInstance();

            // NLLB uses specific codes (e.g. spa_Latn). The mapping should be handled by the caller,
            // but if we receive simple codes, we might want to map here or assume caller did it.
            // For now, assume caller passes correct NLLB codes.
            const output = await translator(text, {
                src_lang: src_lang,
                tgt_lang: tgt_lang,
            });

            self.postMessage({
                type: 'result',
                id,
                text: output[0].translation_text,
            });
        } catch (e) {
            self.postMessage({ type: 'error', id, error: e.message });
        }
    }
});
