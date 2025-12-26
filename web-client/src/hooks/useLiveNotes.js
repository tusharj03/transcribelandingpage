import { useState, useEffect, useRef, useCallback } from 'react';

// Helper: Estimate tokens
const estimateTokens = (text = '') => {
    const t = String(text || '');
    return Math.max(0, Math.ceil(t.length / 4));
};

// Helper: Get last N words
const getLastWords = (text = "", count = 30) => {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    return words.slice(-count).join(" ");
};

// Helper: Normalize notes structure
const normalizeNotesStructure = (text) => {
    const lines = String(text || "").split(/\r?\n/);
    let current = null;
    let buffer = [];
    const order = [];
    const sections = new Map();

    const flush = () => {
        if (current === null) return;
        if (!sections.has(current)) {
            order.push(current);
            sections.set(current, []);
        }
        if (buffer.length) {
            const existing = sections.get(current) || [];
            sections.set(current, existing.concat(buffer));
        }
        buffer = [];
    };

    for (const line of lines) {
        // Detect bullet (with or without bold)
        const bulletMatch = line.match(/^\s*[-•]\s*(.*)$/);
        // Detect ### or ** aligned headers
        const hashHeaderMatch = line.match(/^\s*###\s*(.+?)\s*$/);
        const boldHeaderMatch = line.match(/^\s*\*\*(.+?)\*\*\s*$/);

        const isHeader = (hashHeaderMatch || boldHeaderMatch) && !bulletMatch;

        if (isHeader) {
            flush();
            current = hashHeaderMatch ? hashHeaderMatch[1].trim() : boldHeaderMatch[1].trim();
            if (!current) current = "";
            continue;
        }

        if (bulletMatch) {
            // It's a bullet. Assuming it belongs to current header.
            // If we have no header yet, current might be null => flush will create it.
            // But wait, if we changed headers, we would have flushed.
            const content = bulletMatch[1].trim();
            if (content) {
                buffer.push(`- ${content}`);
            }
            continue;
        }

        const cleanLine = line.trim();
        if (cleanLine === "") continue;

        // Fallback: treat as bullet if it looks like meaningful text but isn't a header
        if (cleanLine.length > 2) {
            buffer.push(`- ${cleanLine}`);
        }
    }
    flush();

    if (order.length === 0 && buffer.length) {
        order.push("");
        sections.set("", buffer.slice());
    }

    const rebuilt = [];
    for (let i = 0; i < order.length; i++) {
        const title = order[i];
        const bullets = sections.get(title) || [];
        // dedup logic...
        const seen = new Set();
        const deduped = [];
        for (const b of bullets) {
            const key = b.trim();
            if (!key) continue;
            if (seen.has(key.toLowerCase())) continue;
            seen.add(key.toLowerCase());
            deduped.push(b);
        }

        if (deduped.length === 0 && !title) continue;

        const sectionBlock = [];
        if (title) sectionBlock.push(`### ${title}`);
        sectionBlock.push(...deduped.filter(Boolean));

        // Single newline join guarantees tight list in Markdown
        rebuilt.push(sectionBlock.join('\n'));
    }

    // Join sections with double newline to separate headers
    return rebuilt.join("\n\n").trim();
};

export function useLiveNotes({ isRecording, transcription }) {
    const [liveNotes, setLiveNotes] = useState("");
    const [status, setStatus] = useState("idle"); // idle, generating, finalizing
    const notesUpdateTimer = useRef(null);
    const notesSingleChatInFlight = useRef(false);

    // We need refs for current state in intervals
    const liveNotesRef = useRef("");
    const transcriptionRef = useRef("");

    useEffect(() => {
        liveNotesRef.current = liveNotes;
    }, [liveNotes]);

    useEffect(() => {
        transcriptionRef.current = transcription;
    }, [transcription]);

    // Helpers for Context
    const getNotesTailContext = (linesCount = 8) => {
        if (!liveNotesRef.current) return "";
        const lines = liveNotesRef.current.split(/\r?\n/).filter(l => l.trim().length);
        return lines.slice(-linesCount).join("\n");
    };

    const getLastBulletBlock = () => {
        const lines = liveNotesRef.current ? liveNotesRef.current.split(/\r?\n/) : [];
        const isHeading = (l) => /^\s*\*\*.+\*\*\s*$/.test(l);
        const isBullet = (l) => /^\s*[-•]/.test(l);

        let idx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (isBullet(lines[i])) {
                idx = i;
                break;
            }
        }
        if (idx === -1) return { block: '', start: -1, end: -1 };

        const bulletIndent = lines[idx].match(/^\s*/)[0].length;
        let end = idx;
        for (let j = idx + 1; j < lines.length; j++) {
            const ln = lines[j];
            const indent = ln.match(/^\s*/)[0].length;
            if (isHeading(ln)) break;
            if (isBullet(ln) && indent <= bulletIndent) break;
            end = j;
        }

        const blockLines = lines.slice(idx, end + 1);
        return { block: blockLines.join("\n").trim(), start: idx, end };
    };

    const applyNormalizedNotes = (raw) => {
        const normalized = normalizeNotesStructure(raw || "");
        setLiveNotes(normalized);
    };

    const replaceLastBulletBlock = (newLines) => {
        const lines = liveNotesRef.current ? liveNotesRef.current.split(/\r?\n/) : [];
        const isBullet = (l) => /^\s*[-•]/.test(l);

        // Similar logic to extension...
        let idx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (isBullet(lines[i])) {
                idx = i;
                break;
            }
        }

        if (idx === -1) {
            const merged = [...lines, ...newLines].join("\n").trim();
            applyNormalizedNotes(merged);
            return;
        }

        const bulletIndent = lines[idx].match(/^\s*/)[0].length;
        // Need to find end of block... simplified for now assuming block is contiguous bullets
        // Actually, let's just find the end of this bullet block
        let end = idx;
        const isHeading = (l) => /^\s*\*\*.+\*\*\s*$/.test(l);

        for (let j = idx + 1; j < lines.length; j++) {
            const ln = lines[j];
            const indent = ln.match(/^\s*/)[0].length;
            if (isHeading(ln)) break;
            if (isBullet(ln) && indent <= bulletIndent) break;
            end = j;
        }

        const before = lines.slice(0, idx);
        const after = lines.slice(end + 1);
        const merged = [...before, ...newLines, ...after].join("\n").trim();
        applyNormalizedNotes(merged);
    };

    // Main Update Logic
    const updateNotesSingleChat = async ({ force = false } = {}) => {
        if (notesSingleChatInFlight.current) return;
        if (!force && !isRecording) return;

        const transcriptText = transcriptionRef.current || '';
        const chunk = getLastWords(transcriptText, 30).trim();
        if (!chunk) return;

        const tailContext = getNotesTailContext(2);
        const { block: lastBullet } = getLastBulletBlock();

        const messages = [
            {
                role: 'system',
                content: [
                    'You are maintaining live meeting notes. ',
                    'Inputs: last ~30 transcript words, recent notes tail (1-2 lines), and the current last bullet block.',
                    'Decide ONE of:',
                    '1) Respond with "no change" (exactly) if nothing new or already captured.',
                    '2) Return 1-3 bullets to REPLACE the last bullet block (do not ignore previous content; keep bullets concise; NEVER merge two concepts; split ideas).',
                    '3) If the transcript clearly introduces a NEW concept/definition/term, return a bold header line (### Header Name) followed by 1-3 concise bullets (max 8 words each).',
                    'Rules:',
                    '- Style: Telegraphic, extremely concise. Max range: 5-10 words per bullet.',
                    '- ALWAYS create an initial header if none exists.',
                    '- NEVER combine multiple concepts into one bullet.',
                    '- Detect topic shifts → create a NEW header (### Header Name).',
                    '- Header format: ### Header Name (no bullets), blank line after.',
                    '- Valueconciseness: "Price up 5%" > "The price has gone up by 5 percent".',
                    '- Output ONLY: "no change" OR bullets OR header + bullets.'
                ].join('\n')
            },
            {
                role: 'user',
                content: [
                    'Recent notes tail (reference; do not repeat unchanged content):',
                    tailContext || '[none]',
                    '',
                    'Current last bullet block:',
                    lastBullet || '[none]',
                    '',
                    'Latest transcript slice (~30 words):',
                    chunk
                ].join('\n')
            }
        ];

        notesSingleChatInFlight.current = true;
        try {
            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages })
            });

            if (!response.ok) throw new Error('API Error');

            const data = await response.json();
            const raw = data.completion?.trim() || '';
            const lower = raw.toLowerCase().trim();
            let output = lower === 'no change' ? '' : raw;

            if (output) {
                // Pre-clean for spacing
                output = output.replace(/\n{2,}/g, '\n').replace(/([^\n])\n(### )/g, '$1\n\n$2');

                const sanitizedLines = output.split(/\r?\n/)
                    .map(l => l.trim())
                    .filter(Boolean)
                    .map(l => {
                        const bh = l.match(/^-+\s*\*\*(.+?)\*\*\s*$/) || l.match(/^-+\s*###\s*(.+?)\s*$/);
                        if (bh) return `### ${bh[1].trim()}`;
                        if (/^\s*#{1,6}\s+/.test(l)) return l; // Pass through existing headers
                        if (!l.startsWith('-') && !l.startsWith('•') && /^\*\*.*\*\*$/.test(l)) return `### ${l.replace(/\*\*/g, '')}`;
                        if (!l.startsWith('-')) return `- ${l.replace(/^[•]/, '').trim()}`;
                        return l;
                    });

                const hasHeader = sanitizedLines[0] && /^(###|\*\*)/.test(sanitizedLines[0]);
                if (hasHeader) {
                    const merged = [liveNotesRef.current, ...sanitizedLines].filter(Boolean).join('\n').trim();
                    applyNormalizedNotes(merged);
                } else {
                    replaceLastBulletBlock(sanitizedLines);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            notesSingleChatInFlight.current = false;
        }
    };

    // Generate notes from full transcript (for File mode)
    const generateFullNotes = async (fullTranscript) => {
        if (!fullTranscript?.trim()) return;
        setStatus('generating');

        // We might need to chunk if too large, but for now let's try direct
        // or maybe a "summary" prompt.
        const messages = [
            {
                role: 'system',
                content: 'You are an expert note-taker. Create concise, structured, telegraphic notes from the provided transcript. Use ### for headers. No conversational filler.'
            },
            {
                role: 'user',
                content: `Transcript:\n${fullTranscript.slice(0, 15000)}` // Safety cap
            }
        ];

        try {
            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages })
            });
            const data = await response.json();
            if (data.completion) {
                // Pass through the same cleaner to ensure formatting consistency
                let clean = data.completion.trim();
                clean = clean.replace(/^(Here|Sure|Okay|I have).*?:/im, '').trim();
                clean = clean.replace(/\n{2,}/g, '\n').replace(/([^\n])\n(### )/g, '$1\n\n$2');
                applyNormalizedNotes(clean);
            }
        } catch (e) {
            console.error(e);
        }
        setStatus('idle');
    };

    // Finalize
    const finalizeNotes = async () => {
        if (!liveNotesRef.current.trim()) return;
        setStatus('finalizing');

        const messages = [
            {
                role: 'system',
                content: 'You are a precise note cleaning machine. You will receive raw notes. Output ONLY the cleaned notes in Markdown. Rules: 1. NO conversational filler ("Here are your notes"). 2. Merge/rename duplicate headers. 3. Merge repetitive bullets. 4. Keep bullets extremely concise (max 8 words). 5. Use ### for headers. 6. Output MUST start directly with a header or bullet.'
            },
            {
                role: 'user',
                content: `Clean and organize these notes:\n${liveNotesRef.current}`
            }
        ];

        try {
            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages })
            });
            const data = await response.json();
            if (data.completion) {
                // Strip conversational prefixes if they sneak in
                let clean = data.completion.trim();
                clean = clean.replace(/^(Here|Sure|Okay|I have).*?:/im, '').trim();

                // Aggressive spacing cleanup
                // 1. Collapse ALL multiple newlines to single newlines first
                clean = clean.replace(/\n{2,}/g, '\n');

                // 2. Ensure exactly one empty line before headers (except at start)
                clean = clean.replace(/([^\n])\n(### )/g, '$1\n\n$2');

                applyNormalizedNotes(clean);
            }
        } catch (e) { e }
        setStatus('idle');
    };

    // Track previous recording state to detect start
    const wasRecording = useRef(isRecording);

    useEffect(() => {
        if (!wasRecording.current && isRecording) {
            // Started recording -> Reset notes
            setLiveNotes("");
            setStatus("idle");
        }
        wasRecording.current = isRecording;
    }, [isRecording]);

    // Start/Stop Timer
    useEffect(() => {
        if (isRecording) {
            notesUpdateTimer.current = setInterval(() => {
                updateNotesSingleChat();
            }, 10000); // 10s
        } else {
            if (notesUpdateTimer.current) {
                clearInterval(notesUpdateTimer.current);
                notesUpdateTimer.current = null;
            }
            if (liveNotesRef.current && wasRecording.current) { // Check if we *were* recording just now
                // Finalize when stopped
                finalizeNotes();
            }
        }
    }, [isRecording]);

    return {
        liveNotes,
        status,
        generateFullNotes,
        setLiveNotes
    };
}
