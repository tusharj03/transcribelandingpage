import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import mermaid from 'mermaid';

export const saveToHistory = (name, transcript, type = 'transcription', model = 'unknown', notes = null, assistMessages = []) => {
    try {
        let history = [];
        const stored = localStorage.getItem('transcription-history');
        if (stored) {
            history = JSON.parse(stored);
        }

        const newItem = {
            id: `trans-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name,
            transcript,
            timestamp: new Date().toISOString(),
            model,
            type,
            notes,
            assistMessages
        };

        history.unshift(newItem);
        if (history.length > 100) history = history.slice(0, 100);

        localStorage.setItem('transcription-history', JSON.stringify(history));
        return newItem;
    } catch (e) {
        console.error('Failed to save history', e);
        return null;
    }
};

export const updateHistoryItem = (id, updates) => {
    try {
        let history = [];
        const stored = localStorage.getItem('transcription-history');
        if (stored) {
            history = JSON.parse(stored);
        }

        const index = history.findIndex(item => item.id === id);
        if (index !== -1) {
            history[index] = { ...history[index], ...updates };
            localStorage.setItem('transcription-history', JSON.stringify(history));
            return true;
        }
        return false;
    } catch (e) {
        console.error('Failed to update history', e);
        return false;
    }
}

export default function HistoryTab({ onLoadTranscription }) {
    const [history, setHistory] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState('all'); // 'all', 'transcription', 'notes'
    const [viewingItem, setViewingItem] = useState(null);
    const [detailSubTab, setDetailSubTab] = useState('transcript'); // 'transcript', 'notes', 'assist'
    const notesRef = useRef(null);

    // Initialize Mermaid
    useEffect(() => {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            securityLevel: 'loose',
            fontFamily: 'Inter',
        });
    }, []);

    // Re-run mermaid when viewing item changes
    useEffect(() => {
        if (viewingItem?.notes && detailSubTab === 'notes' && notesRef.current) {
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
    }, [viewingItem, detailSubTab]);

    const formatNotes = (markdown) => {
        if (!markdown) return '';
        try {
            // Intelligent Pre-process: Only wrap "naked" graphs if they are NOT already in code blocks
            const segments = markdown.split(/```/);
            for (let i = 0; i < segments.length; i += 2) {
                // Even indices are "text" (outside of code blocks)
                segments[i] = segments[i].replace(
                    /(^|\n)\s*((?:graph|flowchart)\s+(?:TD|TB|LR|RL)[\s\S]*?)(?=\n\s*\n|\n\s*(?:#|\d+\.\s)|$)/g,
                    (match, prefix, content) => {
                        return `${prefix}\`\`\`mermaid\n${content.trim()}\n\`\`\``;
                    }
                );
            }
            const processedMarkdown = segments.join('```');

            const renderer = new marked.Renderer();

            renderer.code = function (codeOrToken, langStr) {
                let code = codeOrToken;
                let language = langStr;

                if (typeof codeOrToken === 'object' && codeOrToken !== null) {
                    code = codeOrToken.text || '';
                    language = codeOrToken.lang || '';
                }

                const isMermaid = language === 'mermaid' ||
                    language === 'graph' ||
                    language === 'flowchart' ||
                    (!language && /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|pie)\s/.test(code));

                if (isMermaid) {
                    let cleanCode = (code || '').replace(/^mermaid\s+/, '').trim();
                    cleanCode = cleanCode.replace(/([A-Za-z0-9])\s*\+\s*([A-Za-z0-9])/g, '$1 and $2');
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

    useEffect(() => {
        loadHistory();

        // Listen for history updates globally
        const handleStorage = () => loadHistory();
        window.addEventListener('storage', handleStorage); // Cross-tab
        // We might need a custom event for same-tab updates if we don't lift state
        const interval = setInterval(loadHistory, 2000); // Poll for simple updates

        return () => {
            window.removeEventListener('storage', handleStorage);
            clearInterval(interval);
        }
    }, []);

    const loadHistory = () => {
        try {
            const storedHistory = localStorage.getItem('transcription-history');
            if (storedHistory) {
                const parsed = JSON.parse(storedHistory);
                setHistory(parsed);
                // Also update viewing item if it exists
                if (viewingItem) {
                    const current = parsed.find(i => i.id === viewingItem.id);
                    if (current) setViewingItem(current);
                }
            } else {
                setHistory([]);
            }
        } catch (e) {
            console.error('Failed to load history', e);
        }
    };

    const deleteItem = (id, e) => {
        e.stopPropagation();
        const newHistory = history.filter(item => item.id !== id);
        setHistory(newHistory);
        localStorage.setItem('transcription-history', JSON.stringify(newHistory));
        if (viewingItem && viewingItem.id === id) setViewingItem(null);
    };

    const clearAll = () => {
        if (confirm("Are you sure you want to clear all history?")) {
            setHistory([]);
            localStorage.removeItem('transcription-history');
        }
    };

    const handleDownload = (item, e) => {
        e.stopPropagation();
        let content = item.transcript;
        let ext = 'txt';

        if (detailSubTab === 'notes' && item.notes) {
            content = item.notes;
            ext = 'md';
        }

        const element = document.createElement("a");
        const file = new Blob([content], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);

        element.download = `${item.name.replace(/\s+/g, '-').toLowerCase()}-${detailSubTab}.${ext}`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    const filteredHistory = history.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (item.transcript && item.transcript.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesFilter = filter === 'all' || item.type === filter;
        return matchesSearch && matchesFilter;
    });

    const stats = {
        total: history.length,
        transcriptions: history.filter(i => i.type === 'transcription').length,
        notes: history.filter(i => i.type === 'notes').length, // count only standalone Smart Notes
        // Approximate size
        size: (new Blob([JSON.stringify(history)]).size / 1024 / 1024).toFixed(2) + ' MB'
    };

    // Helpers
    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleString();
    };

    const renderDetailContent = () => {
        if (detailSubTab === 'transcript') {
            return (
                <div className="output" style={{ flex: 1, padding: '24px', overflowY: 'auto', background: '#f8fafc', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '14px', lineHeight: '1.6' }}>
                    {viewingItem.transcript}
                </div>
            )
        } else if (detailSubTab === 'notes') {
            return (
                <div style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>
                    {viewingItem.notes ? (
                        <div className="turbo-notes-wrapper" style={{ padding: 0 }}>
                            <div className="turbo-container" style={{ minHeight: 'auto', border: 'none', boxShadow: 'none' }}>
                                <div className="turbo-content" ref={notesRef}>
                                    <div dangerouslySetInnerHTML={{ __html: formatNotes(viewingItem.notes) }} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ color: 'var(--gray)', textAlign: 'center', marginTop: '40px' }}>
                            <i className="fas fa-sticky-note" style={{ fontSize: '32px', marginBottom: '10px', opacity: 0.5 }}></i>
                            <p>No AI Notes available for this item.</p>
                        </div>
                    )}
                </div>
            )
        } else if (detailSubTab === 'assist') {
            return (
                <div className="output" style={{ flex: 1, padding: '24px', overflowY: 'auto', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {viewingItem.assistMessages && viewingItem.assistMessages.length > 0 ? (
                        viewingItem.assistMessages.map((msg, idx) => (
                            <div key={idx} className={`message ${msg.role}`} style={{
                                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                background: msg.role === 'user' ? 'var(--primary)' : 'white',
                                color: msg.role === 'user' ? 'white' : 'var(--dark)',
                                padding: '12px 16px',
                                borderRadius: '12px',
                                maxWidth: '80%',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                            }}>
                                {msg.content}
                            </div>
                        ))
                    ) : (
                        <div style={{ color: 'var(--gray)', textAlign: 'center', marginTop: '40px' }}>
                            <i className="fas fa-comments" style={{ fontSize: '32px', marginBottom: '10px', opacity: 0.5 }}></i>
                            <p>No Assist chat history.</p>
                        </div>
                    )}
                </div>
            )
        }
    }

    if (viewingItem) {
        return (
            <div id="history" className="tab-content active" style={{ display: 'block' }}>
                <div className="card" style={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
                    <div className="card-header" style={{ marginBottom: 0, paddingBottom: '16px', borderBottom: '1px solid var(--gray-light)', flexDirection: 'column', alignItems: 'flex-start', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
                            <button className="btn btn-outline" onClick={() => setViewingItem(null)} style={{ padding: '8px 12px' }}>
                                <i className="fas fa-arrow-left"></i> Back
                            </button>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                <h3 style={{ margin: 0, fontSize: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{viewingItem.name}</h3>
                                <div style={{ fontSize: '13px', color: 'var(--gray)' }}>
                                    {formatTime(viewingItem.timestamp)} • {viewingItem.model || 'AI'}
                                </div>
                            </div>
                            <div className="output-actions">
                                <button className="btn btn-outline"
                                    onClick={(e) => handleDownload(viewingItem, e)}
                                    title="Download Current View"
                                >
                                    <i className="fas fa-download"></i>
                                </button>
                                <button className="btn btn-primary"
                                    onClick={() => onLoadTranscription(viewingItem)}
                                    title="Load into regular workspace to edit"
                                >
                                    <i className="fas fa-external-link-alt"></i> Open
                                </button>
                            </div>
                        </div>

                        {/* Subtabs */}
                        <div className="output-subtabs" style={{ display: 'flex', gap: '4px', background: 'var(--gray-light)', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
                            <button
                                className={`sub-tab-btn ${detailSubTab === 'transcript' ? 'active' : ''}`}
                                onClick={() => setDetailSubTab('transcript')}
                                style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                            >
                                Transcript
                            </button>
                            <button
                                className={`sub-tab-btn ${detailSubTab === 'notes' ? 'active' : ''}`}
                                onClick={() => setDetailSubTab('notes')}
                                style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                            >
                                Notes
                            </button>
                            <button
                                className={`sub-tab-btn ${detailSubTab === 'assist' ? 'active' : ''}`}
                                onClick={() => setDetailSubTab('assist')}
                                style={{ padding: '6px 16px', fontSize: '13px', borderRadius: '6px', border: 'none' }}
                            >
                                Assist
                            </button>
                        </div>
                    </div>

                    {renderDetailContent()}

                </div>
            </div>
        );
    }

    return (
        <div id="history" className="tab-content active" style={{ display: 'block' }}>
            <div className="card">
                <div className="card-header">
                    <div className="card-title">
                        <i className="fas fa-history"></i> History & Archives
                    </div>
                    <div className="history-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <div className="search-bar">
                            <i className="fas fa-search"></i>
                            <input
                                type="text"
                                placeholder="Search history..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="history-filter">
                            <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
                            <button className={`filter-btn ${filter === 'transcription' ? 'active' : ''}`} onClick={() => setFilter('transcription')}>Transcriptions</button>
                            <button className={`filter-btn ${filter === 'notes' ? 'active' : ''}`} onClick={() => setFilter('notes')}>AI Notes</button>
                        </div>
                        <button className="btn btn-danger" onClick={clearAll}>
                            <i className="fas fa-trash-alt"></i> Clear All
                        </button>
                    </div>
                </div>

                <div className="history-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                    <div className="stat-card" style={{ padding: '20px', background: '#f8fafc', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div className="stat-icon" style={{ fontSize: '24px', color: 'var(--primary)' }}><i className="fas fa-file-alt"></i></div>
                        <div className="stat-info">
                            <div className="stat-number" style={{ fontSize: '20px', fontWeight: 'bold' }}>{stats.total}</div>
                            <div className="stat-label" style={{ fontSize: '12px', color: '#64748b' }}>Total Items</div>
                        </div>
                    </div>
                    <div className="stat-card" style={{ padding: '20px', background: '#f8fafc', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div className="stat-icon" style={{ fontSize: '24px', color: 'var(--primary)' }}><i className="fas fa-microphone"></i></div>
                        <div className="stat-info">
                            <div className="stat-number" style={{ fontSize: '20px', fontWeight: 'bold' }}>{stats.transcriptions}</div>
                            <div className="stat-label" style={{ fontSize: '12px', color: '#64748b' }}>Transcriptions</div>
                        </div>
                    </div>
                    <div className="stat-card" style={{ padding: '20px', background: '#f8fafc', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div className="stat-icon" style={{ fontSize: '24px', color: 'var(--primary)' }}><i className="fas fa-robot"></i></div>
                        <div className="stat-info">
                            <div className="stat-number" style={{ fontSize: '20px', fontWeight: 'bold' }}>{stats.notes}</div>
                            <div className="stat-label" style={{ fontSize: '12px', color: '#64748b' }}>Items with Notes</div>
                        </div>
                    </div>
                </div>

                <div id="historyList" className="history-list-enhanced">
                    {filteredHistory.length === 0 ? (
                        <div className="history-empty-state" style={{ textAlign: 'center', padding: '60px' }}>
                            <div className="empty-icon" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '20px' }}>
                                <i className="fas fa-history"></i>
                            </div>
                            <h3>No History Found</h3>
                            <p style={{ color: '#64748b' }}>Try adjusting your search or transcription filters.</p>
                        </div>
                    ) : (
                        filteredHistory.map((item) => (
                            <div key={item.id} className="file-item-enhanced"
                                onClick={() => setViewingItem(item)}
                                style={{ cursor: 'pointer' }}>
                                <div className="file-icon-enhanced">
                                    <i className={`fas ${item.type === 'notes' ? 'fa-robot' : 'fa-microphone'}`}></i>
                                </div>
                                <div className="file-info-enhanced">
                                    <div className="file-name-enhanced">{item.name}</div>
                                    <div className="file-size-enhanced">
                                        {formatTime(item.timestamp)} • {(item.model === 'turbo' ? 'Smart Model' : item.model) || 'AI'}
                                    </div>
                                </div>
                                <div className="file-actions-enhanced" style={{ display: 'flex', gap: '5px' }}>

                                    <button className="remove-file" onClick={(e) => deleteItem(item.id, e)}>
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
