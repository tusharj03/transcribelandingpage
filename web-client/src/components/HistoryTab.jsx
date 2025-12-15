import React, { useState, useEffect } from 'react';
import { saveToHistory as saveHelper } from './HistoryTab'; // import self? No.

// We need to move the helper out or keep it here.
// Currently App.jsx imports { saveToHistory } from './components/HistoryTab'.
// I should export it.

export const saveToHistory = (name, transcript, type = 'transcription', model = 'unknown') => {
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
            type
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

export default function HistoryTab({ onLoadTranscription }) {
    const [history, setHistory] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState('all'); // 'all', 'transcription', 'notes'

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = () => {
        try {
            const storedHistory = localStorage.getItem('transcription-history');
            if (storedHistory) {
                setHistory(JSON.parse(storedHistory));
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
    };

    const clearAll = () => {
        if (confirm("Are you sure you want to clear all history?")) {
            setHistory([]);
            localStorage.removeItem('transcription-history');
        }
    };

    const handleDownload = (item, e) => {
        e.stopPropagation();
        const element = document.createElement("a");
        const file = new Blob([item.transcript], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        const ext = item.type === 'notes' ? 'md' : 'txt';
        element.download = `${item.name.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
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
        notes: history.filter(i => i.type === 'notes').length,
        // Approximate size
        size: (new Blob([JSON.stringify(history)]).size / 1024 / 1024).toFixed(2) + ' MB'
    };

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
                            <div className="stat-label" style={{ fontSize: '12px', color: '#64748b' }}>AI Notes</div>
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
                                onClick={() => onLoadTranscription(item)}
                                style={{ cursor: 'pointer' }}>
                                <div className="file-icon-enhanced">
                                    <i className={`fas ${item.type === 'notes' ? 'fa-robot' : 'fa-microphone'}`}></i>
                                </div>
                                <div className="file-info-enhanced">
                                    <div className="file-name-enhanced">{item.name}</div>
                                    <div className="file-size-enhanced">
                                        {new Date(item.timestamp).toLocaleString()} • {item.model || 'AI'}
                                    </div>
                                </div>
                                <div className="file-actions-enhanced" style={{ display: 'flex', gap: '5px' }}>
                                    <button className="btn btn-outline btn-sm" onClick={(e) => handleDownload(item, e)}>
                                        <i className="fas fa-download"></i>
                                    </button>
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
