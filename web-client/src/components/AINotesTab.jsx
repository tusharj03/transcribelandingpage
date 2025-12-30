import React, { useState, useEffect, useRef } from 'react';
import { saveToHistory } from './HistoryTab';
import { marked } from 'marked';
import mermaid from 'mermaid';

export default function AINotesTab({ currentTranscription: initialTranscription, liveNotes, user, onLoginRequest, isViewMode = false }) {
    // State
    const [currentTranscription, setCurrentTranscription] = useState(initialTranscription);
    const [history, setHistory] = useState([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState('current');
    const [generatedNotes, setGeneratedNotes] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Refs
    const notesRef = useRef(null);

    // Initialize Mermaid
    useEffect(() => {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral', // Better for light mode
            securityLevel: 'loose',
            fontFamily: 'Inter',
        });
    }, []);

    // Re-run mermaid when notes change
    useEffect(() => {
        if (generatedNotes && notesRef.current) {
            // Small delay to ensure DOM is updated
            setTimeout(() => {
                try {
                    mermaid.run({
                        nodes: notesRef.current.querySelectorAll('.mermaid'),
                    });
                } catch (err) {
                    console.error('Mermaid error:', err);
                }
            }, 100);
        }
    }, [generatedNotes]);

    // ... (keep useEffect for props/history)

    const formatNotes = (markdown) => {
        if (!markdown) return '';
        try {
            // Intelligent Pre-process: Only wrap "naked" graphs if they are NOT already in code blocks
            const segments = markdown.split(/```/);
            for (let i = 0; i < segments.length; i += 2) {
                // Even indices are "text" (outside of code blocks)
                segments[i] = segments[i].replace(
                    // Match start of line (with optional whitespace), then graph/flowchart
                    // Capture until: double newline, OR next header (#), OR next numbered list (1. ), OR end of string
                    /(^|\n)\s*((?:graph|flowchart)\s+(?:TD|TB|LR|RL)[\s\S]*?)(?=\n\s*\n|\n\s*(?:#|\d+\.\s)|$)/g,
                    (match, prefix, content) => {
                        return `${prefix}\`\`\`mermaid\n${content.trim()}\n\`\`\``;
                    }
                );
            }
            const processedMarkdown = segments.join('```');

            const renderer = new marked.Renderer();

            // Handle marked v5+ signature: code(token)
            renderer.code = function (codeOrToken, langStr) {
                let code = codeOrToken;
                let language = langStr;

                // If first arg is object, it's a token (marked v5+)
                if (typeof codeOrToken === 'object' && codeOrToken !== null) {
                    code = codeOrToken.text || '';
                    language = codeOrToken.lang || '';
                }

                // Check for mermaid language or content that looks like mermaid
                const isMermaid = language === 'mermaid' ||
                    language === 'graph' ||
                    language === 'flowchart' ||
                    (!language && /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|pie)\s/.test(code));

                if (isMermaid) {
                    // 1. Strip 'mermaid' keyword if present
                    let cleanCode = (code || '').replace(/^mermaid\s+/, '').trim();

                    // 2. Sanitize common LLM syntax errors in Mermaid
                    // Replace "A + B" (syntax error) with "A and B"
                    cleanCode = cleanCode.replace(/([A-Za-z0-9])\s*\+\s*([A-Za-z0-9])/g, '$1 and $2');
                    // Ensure arrows are correct (sometimes LLM outputs '->' in graph TD which is valid, but '-->' is safer)

                    // 3. Force newline after graph definition (vital for single-line output fixes)
                    // If "graph TD" is followed by something that is NOT a newline, allow insert of newline
                    cleanCode = cleanCode.replace(/((?:graph|flowchart)\s+(?:TD|TB|LR|RL))\s+(?![\n\r])/, '$1\n');

                    return '<div class="mermaid">' + cleanCode + '</div>';
                }

                return '<pre><code class="language-' + (language || 'text') + '">' + (code || '') + '</code></pre>';
            };

            return marked.parse(processedMarkdown, { renderer: renderer });
        } catch (e) {
            console.error(e);
            return markdown;
        }
    };

    // Update internal state when prop changes
    useEffect(() => {
        if (liveNotes) {
            setGeneratedNotes(liveNotes);
        } else if (initialTranscription) {
            // If we are viewing saved notes from history, populate the output immediately
            if (isViewMode) {
                setGeneratedNotes(initialTranscription);
            } else {
                setCurrentTranscription(initialTranscription);
                // Only clear if we aren't streaming live notes
                if (!liveNotes) setGeneratedNotes(null);
            }
        }
    }, [initialTranscription, isViewMode, liveNotes]);

    // Load history
    useEffect(() => {
        try {
            const stored = localStorage.getItem('transcription-history');
            if (stored) {
                setHistory(JSON.parse(stored));
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    // UPDATED PROMPT: Blue/Teal Branding, Tables for Comparisons, No Checkboxes
    const SYSTEM_PROMPTS = {
        turbo: `You are an elite academic and professional analyst. Transform the provided transcription into a beautiful, structured document.

        CRITICAL VISUAL RULES:
        1. **Comparisons**: If comparing two or more items (e.g. Prokaryotic vs Eukaryotic, Old vs New), YOU MUST USE A MARKDOWN TABLE. Do not use lists for comparisons.
        2. **Visuals**: Create a Mermaid.js diagram for key processes. Use \`\`\`mermaid\ngraph TD\n...\n\`\`\` blocks.
           **RULES FOR DIAGRAMS:**
           - Do NOT use "+" to join nodes (e.g. "A + B --> C" is INVALID).
           - Only use "-->" for arrows.
           - Keep labels SIMPLE: "A[Water] --> B[Reaction]". Avoid substrings/complex formulas if possible.
           - Ensure the first node is on a NEW LINE after "graph TD".
           - Do NOT include title lines inside the mermaid block.
        3. **Action Items**: Use simple bullet points (*). DO NOT use checkboxes [ ] as they render poorly.

        Structure:
        # Title of the Session
        
        ## Executive Summary
        (High-level summary)

        ## Visual Overview
        (Insert Mermaid Diagram here if applicable - show relationships, flows, or hierarchies)

        ## Key Insights & Notes
        (Detailed notes. Use bolding for emphasis. Use TABLES for any comparisons.)
        
        ## Action Items (if applicable)
        *   Task 1
        *   Task 2
        (Do not use [ ])
        
        Style the output with clear Markdown. Use "##" for major sections.`
    };

    const handleGenerate = async () => {
        if (!user || (!user.authenticated && !user.offlineMode)) {
            onLoginRequest();
            return;
        }

        if (!currentTranscription) {
            setError('Please select a valid source.');
            return;
        }

        setLoading(true);
        setError(null);
        setGeneratedNotes(null);

        try {
            // Updated Prompt Logic
            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPTS.turbo },
                        { role: 'user', content: `Analyze the following transcription and allow Mermaid diagrams to be rendered by wrapping them in triple backticks with 'mermaid' language.\n\nTranscription:\n${currentTranscription.substring(0, 15000)}` }
                    ]
                })
            });

            if (!response.ok) throw new Error(`Generation failed: ${response.status}`);

            const data = await response.json();
            if (!data.completion) throw new Error('No completion received');

            let analysis = data.completion.trim();
            // Only strip if the ENTIRE response is wrapped in backticks (common LLM behavior)
            if (analysis.startsWith('```') && analysis.endsWith('```')) {
                // remove first line (```markdown) and last line (```)
                const lines = analysis.split('\n');
                if (lines.length >= 2) {
                    analysis = lines.slice(1, -1).join('\n').trim();
                }
            }

            setGeneratedNotes(analysis);
            saveToHistory(`Smart Notes`, analysis, 'notes', 'turbo');

        } catch (err) {
            console.error(err);
            setError(err.message || 'Failed to generate notes');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (generatedNotes) {
            navigator.clipboard.writeText(generatedNotes);
        }
    };



    return (
        <div id="notes" className="tab-content active" style={{ display: 'block' }}>
            <div className="card-header" style={{ marginBottom: '20px' }}>
                <div className="card-title">
                    <i className="fas fa-sparkles" style={{ color: 'var(--primary)' }}></i>
                    AI Smart Notes
                </div>
            </div>

            <div className="turbo-notes-wrapper">
                {/* Header Controls */}
                <div className="turbo-header">
                    <div className="turbo-controls">
                        <div className="turbo-select-wrapper">
                            <i className="fas fa-file-audio turbo-select-icon"></i>
                            <select
                                className="turbo-select"
                                value={selectedHistoryId}
                                onChange={(e) => {
                                    const id = e.target.value;
                                    setSelectedHistoryId(id);
                                    if (id === 'current') {
                                        setCurrentTranscription(initialTranscription);
                                    } else {
                                        const item = history.find(h => h.id === id);
                                        if (item) setCurrentTranscription(item.transcript);
                                    }
                                }}
                            >
                                <option value="current">Current Session {initialTranscription ? '(Ready)' : '(Empty)'}</option>
                                {history.filter(h => h.type === 'transcription').map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name || 'Untitled'} - {new Date(item.timestamp).toLocaleDateString()}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button
                            className="turbo-generate-btn"
                            onClick={handleGenerate}
                            disabled={loading}
                        >
                            {loading ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-magic"></i>}
                            {loading ? 'Analyzing...' : 'Generate Notes'}
                        </button>
                    </div>
                    {error && <div style={{ color: 'var(--danger)', fontWeight: '500' }}>{error}</div>}
                </div>

                {/* Main Content Container with Glow */}
                <div className="turbo-container">
                    <div className="turbo-glow"></div>
                    <div className="turbo-glow-2"></div>

                    {generatedNotes && (
                        <button className="turbo-copy-btn" onClick={copyToClipboard}>
                            <i className="fas fa-copy"></i> Copy Markdown
                        </button>
                    )}

                    <div className="turbo-content" ref={notesRef}>
                        {generatedNotes ? (
                            <div
                                dangerouslySetInnerHTML={{ __html: formatNotes(generatedNotes) }}
                            />
                        ) : (
                            <div className="turbo-empty">
                                <div className="turbo-empty-icon">
                                    <i className="fas fa-brain"></i>
                                </div>
                                <h2>AI Knowledge Engine</h2>
                                <p>Select a source transcription and let our advanced AI transform it into beautiful, structured notes with diagrams.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
