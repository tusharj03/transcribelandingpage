import React, { useState, useEffect } from 'react';
import { saveToHistory } from './HistoryTab';
import { marked } from 'marked';

// System prompts from original file
const SYSTEM_PROMPTS = {
    summary: `You are an expert content summarizer. Create a comprehensive yet concise summary of the provided transcription. Focus on the main ideas, key findings, and overall message. Structure it with clear headings and bullet points.`,
    "meeting-notes": `You are a professional meeting coordinator. Transform this transcription into well-organized meeting notes. Include: participants (if mentioned), key discussion points, decisions made, action items with owners and deadlines, and next steps. Use a clear, professional structure with appropriate sections.`,
    "study-notes": `You are an academic expert. Convert this transcription into effective study notes. Organize by key concepts, include definitions, important facts, and relationships between ideas. Use headings, bullet points, and emphasize critical information for better retention. Structure it for optimal learning.`,
    "action-plan": `You are a project management specialist. Extract all action items, tasks, and next steps from this transcription. Format as a clear action plan with: specific tasks, responsible parties (if mentioned), deadlines/timelines, and priorities. Use a structured table or organized list format.`,
    "key-points": `You are a content analyst. Extract the most important key points and main ideas from this transcription. Present them in a clear, concise manner using bullet points. Focus on the essential information that captures the core message and critical insights.`,
    "detailed": `You are a sophisticated content analyst. Provide a comprehensive analysis of the transcription. Include: main themes, detailed breakdown of key points, important quotes or statements, context analysis, and implications. Structure it with clear sections and subheadings for thorough understanding.`,
    actions: `You are a productivity expert. Extract all action items, tasks, and next steps from the transcription. Be specific about what needs to be done, by whom (if mentioned), and any deadlines. Format as a clear, actionable list.`
};

function enhanceStructuredNotes(text) {
    if (!text) return '';
    return text
        .replace(/<h1>/g, '<h1 style="color: var(--dark); border-bottom: 2px solid var(--primary); padding-bottom: 10px; margin-bottom: 20px;">')
        .replace(/<h2>/g, '<h2 style="color: var(--primary); border-bottom: 1px solid var(--gray-light); padding-bottom: 8px; margin: 25px 0 15px 0;">')
        .replace(/<h3>/g, '<h3 style="color: var(--dark); margin: 20px 0 12px 0;">')
        .replace(/<h4>/g, '<h4 style="color: var(--secondary-dark); margin: 16px 0 10px 0;">') // Added h4 styling
        .replace(/<p>/g, '<p style="margin-bottom: 16px; line-height: 1.6;">')
        .replace(/<ul>/g, '<ul style="margin: 16px 0; padding-left: 24px;">')
        .replace(/<ol>/g, '<ol style="margin: 16px 0; padding-left: 24px;">')
        .replace(/<li>/g, '<li style="margin-bottom: 8px; line-height: 1.5;">')
        .replace(/<strong>/g, '<strong style="color: var(--primary-dark);">')
        .replace(/<em>/g, '<em style="color: var(--gray);">')
        .replace(/<table>/g, '<table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">')
        .replace(/<th>/g, '<th style="background: var(--primary-light); color: var(--primary-dark); padding: 12px; text-align: left; border: 1px solid #e2e8f0;">')
        .replace(/<td>/g, '<td style="padding: 12px; border: 1px solid #e2e8f0;">');
}

function formatEnhancedNotes(notes) {
    if (!notes) return '';
    try {
        const rawHtml = marked.parse(notes);
        return enhanceStructuredNotes(rawHtml);
    } catch (e) {
        console.error("Markdown parsing error", e);
        return notes;
    }
}

export default function AINotesTab({ currentTranscription: initialTranscription, user, onLoginRequest, isViewMode = false }) {
    // State
    const [currentTranscription, setCurrentTranscription] = useState(initialTranscription);
    const [selectedTemplate, setSelectedTemplate] = useState('summary');
    const [history, setHistory] = useState([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState('current');
    const [customInstructions, setCustomInstructions] = useState('');
    const [generatedNotes, setGeneratedNotes] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Update internal state when prop changes
    useEffect(() => {
        if (initialTranscription) {
            // If we are viewing saved notes from history, populate the output immediately
            if (isViewMode) {
                setGeneratedNotes(initialTranscription);
                // We don't overwrite currentTranscription because in view mode, 
                // initialTranscription IS the notes, but currentTranscription usually holds source text.
                // However, the UI uses currentTranscription to show source. 
                // In view mode, we might not have the source text available if history only saved the notes.
                // But typically history saves the RESULT. 
                // So let's just show the notes.
            } else {
                setCurrentTranscription(initialTranscription);
                setGeneratedNotes(null); // Clear previous notes when new transcription arrives? 
                // Maybe not if we want to keep them. But for now this is safer to avoid stale state.
            }

            if (selectedHistoryId === 'current') {
                // Keep current selected
            }
        }
    }, [initialTranscription, isViewMode]);

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

    const handleGenerate = async () => {
        if (!user || (!user.authenticated && !user.offlineMode)) {
            onLoginRequest();
            return;
        }

        if (!currentTranscription) {
            setError('Please transcribe a file first or select from history.');
            return;
        }

        setLoading(true);
        setError(null);
        setGeneratedNotes(null);

        try {
            const systemPrompt = SYSTEM_PROMPTS[selectedTemplate] || SYSTEM_PROMPTS.summary;
            const promptContent = customInstructions
                ? `${systemPrompt}\n\nAdditional Instructions: ${customInstructions}`
                : systemPrompt;

            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: promptContent },
                        { role: 'user', content: `Please analyze this transcription:\n\n${currentTranscription.substring(0, 15000)}` }
                    ]
                })
            });

            if (!response.ok) throw new Error(`Generation failed: ${response.status}`);

            const data = await response.json();
            if (!data.completion) throw new Error('No completion received');

            let analysis = data.completion.trim();
            // Clean markdown blocks if present
            const codeBlockMatch = analysis.match(/```(?:markdown)?\s*([\s\S]*?)\s*```/);
            if (codeBlockMatch) {
                analysis = codeBlockMatch[1].trim();
            }

            setGeneratedNotes(analysis);

            // Auto-save
            saveToHistory(`AI Notes - ${selectedTemplate}`, analysis, 'notes', selectedTemplate);

        } catch (err) {
            console.error(err);
            setError(err.message || 'Failed to generate notes');
        } finally {
            setLoading(false);
        }
    };

    const templates = [
        { id: 'summary', name: 'Summary & Key Points' },
        { id: 'meeting-notes', name: 'Meeting Minutes' },
        { id: 'detailed', name: 'Detailed Analysis' },
        { id: 'action-plan', name: 'Action Plan' },
        { id: 'study-notes', name: 'Study Notes' },
        { id: 'key-points', name: 'Key Points Only' }
    ];

    return (
        <div id="notes" className="tab-content active" style={{ display: 'block' }}>
            <div className="card">
                <div className="card-header">
                    <div className="card-title">
                        <i className="fas fa-robot"></i>
                        AI Notes Generator
                    </div>
                    <div className="notes-info">
                        <i className="fas fa-info-circle"></i>
                        <span>Transform your transcriptions into organized, actionable notes</span>
                    </div>
                </div>

                <div className="notes-container-enhanced">
                    <div className="notes-grid">
                        <div className="notes-column">
                            {/* Source Selection */}
                            <div className="notes-section">
                                <h3 className="section-title">
                                    <i className="fas fa-file-alt"></i> Source Material
                                </h3>
                                <div className="source-selection">
                                    <div className="form-group">
                                        <select
                                            className="form-control"
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
                                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                                        >
                                            <option value="current">Current Transcription {initialTranscription ? '(Available)' : '(Empty)'}</option>
                                            {history.filter(h => h.type === 'transcription').map(item => (
                                                <option key={item.id} value={item.id}>
                                                    {item.name} - {new Date(item.timestamp).toLocaleDateString()}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Generation Controls */}
                            <div className="generation-controls compact">
                                <button
                                    id="generateNotesBtn"
                                    className="btn btn-primary btn-large"
                                    onClick={handleGenerate}
                                    disabled={loading}
                                    style={{ width: '100%', marginBottom: '15px' }}
                                >
                                    {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-magic"></i>}
                                    {loading ? ' Generating Smart Notes...' : ' Generate Smart Notes'}
                                </button>
                                {error && <div style={{ color: 'red', marginTop: '10px' }}>{error}</div>}
                            </div>
                        </div>

                        <div className="notes-column">
                            {/* Template Selection */}
                            <div className="notes-section">
                                <h3 className="section-title">
                                    <i className="fas fa-palette"></i> Note Template
                                </h3>
                                <div className="form-group">
                                    <select
                                        className="form-control"
                                        value={selectedTemplate}
                                        onChange={(e) => setSelectedTemplate(e.target.value)}
                                        style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                                    >
                                        {templates.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Customization Options */}
                            <div className="notes-section">
                                <h3 className="section-title">
                                    <i className="fas fa-cogs"></i> Customization
                                </h3>
                                <div className="form-group">
                                    <label className="customization-label" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Custom Instructions (Optional)</label>
                                    <textarea
                                        className="manual-input"
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', minHeight: '80px' }}
                                        placeholder="E.g., Focus on dates and financial figures..."
                                        value={customInstructions}
                                        onChange={e => setCustomInstructions(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Results Display */}
                    <div className="notes-section">
                        <h3 className="section-title">
                            <i className="fas fa-file-alt"></i> Generated Notes
                        </h3>
                        <div id="notesOutput" className="notes-output-enhanced">
                            {generatedNotes ? (
                                <div>
                                    <div className="result-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '10px' }}>
                                        <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(generatedNotes)}>
                                            <i className="fas fa-copy"></i> Copy
                                        </button>
                                    </div>
                                    <div dangerouslySetInnerHTML={{ __html: formatEnhancedNotes(generatedNotes) }} />
                                </div>
                            ) : (
                                <div className="output-placeholder">
                                    <div className="placeholder-icon">
                                        <i className="fas fa-lightbulb"></i>
                                    </div>
                                    <h3>Your AI-generated notes will appear here</h3>
                                    <p>Select a source, choose a template, and click Generate.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
