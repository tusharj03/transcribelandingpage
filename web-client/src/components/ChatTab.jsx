import React, { useState, useEffect, useRef } from 'react';

const ChatTab = ({ currentTranscription, user, onLoginRequest }) => {
    // State
    const [messages, setMessages] = useState([
        { role: 'ai', content: "Hello! I can help answer questions about your transcriptions. Just transcribe some content and ask me anything!" }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [historyItems, setHistoryItems] = useState([]);

    // Logic for "Chat about" selection
    const [chatSource, setChatSource] = useState('current'); // 'current' or 'history'
    const [selectedHistoryId, setSelectedHistoryId] = useState('');
    const [contextText, setContextText] = useState('');

    const messagesEndRef = useRef(null);

    // Load history
    useEffect(() => {
        try {
            const stored = localStorage.getItem('transcription-history');
            if (stored) {
                setHistoryItems(JSON.parse(stored));
            }
        } catch (e) {
            console.error("Failed to load history", e);
        }
    }, []);

    // Update Context when selection changes
    useEffect(() => {
        if (chatSource === 'current') {
            setContextText(currentTranscription || '');
        } else if (chatSource === 'history') {
            if (selectedHistoryId) {
                const item = historyItems.find(i => i.id === selectedHistoryId);
                setContextText(item ? item.transcript : '');
            } else {
                setContextText('');
            }
        }
    }, [chatSource, selectedHistoryId, currentTranscription, historyItems]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, loading]);

    const handleSend = async () => {
        if (!input.trim()) return;

        if (!user || !user.authenticated) {
            onLoginRequest();
            return;
        }

        if (!contextText) {
            alert("No transcription content available. Please transcribe a file or select a transcription from history.");
            return;
        }

        const userMsg = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: `You are a helpful assistant analyzing the following text:\n\n${contextText.substring(0, 15000)}...` },
                        ...messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
                        { role: 'user', content: userMsg.content }
                    ]
                })
            });
            const data = await response.json();
            console.log('API Response:', data);

            if (data.error) {
                setMessages(prev => [...prev, { role: 'ai', content: `Error: ${data.error}` }]);
            } else {
                setMessages(prev => [...prev, { role: 'ai', content: data.completion || data.content || data.message || "I couldn't generate a response." }]);
            }
        } catch (error) {
            setMessages(prev => [...prev, { role: 'ai', content: "Sorry, I encountered a network error. Please try again." }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div id="chat" className="tab-content active" style={{ display: 'block' }}>
            <div className="card">
                <div className="card-header">
                    <div className="card-title">
                        <i className="fas fa-comments"></i>
                        Transcription Chat
                    </div>
                    <div className="chat-info">
                        <i className="fas fa-info-circle"></i>
                        <span>Ask questions about your transcriptions</span>
                    </div>
                </div>
                <div className="chat-container">
                    <div className="chat-source-selection">
                        <label>Chat about:</label>
                        <select
                            id="chatHistorySelect"
                            value={chatSource}
                            onChange={(e) => setChatSource(e.target.value)}
                        >
                            <option value="current">Current Transcription</option>
                            <option value="history">From History</option>
                        </select>

                        {chatSource === 'history' && (
                            <select
                                id="chatSpecificHistory"
                                style={{ display: 'block' }}
                                value={selectedHistoryId}
                                onChange={(e) => setSelectedHistoryId(e.target.value)}
                            >
                                <option value="">Select from history...</option>
                                {historyItems.filter(h => h.type === 'transcription').map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} - {new Date(item.timestamp).toLocaleDateString()}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className="transcription-context">
                        <h4>Current Context</h4>
                        <div id="chatTranscriptionPreview" className="transcription-preview-content">
                            {contextText
                                ? (contextText.length > 150 ? contextText.substring(0, 150) + "..." : contextText)
                                : "No transcription available. Please transcribe some content first."}
                        </div>
                    </div>

                    <div id="chatHistory" className="chat-history">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`chat-message ${msg.role === 'user' ? 'user' : 'bot'}`}>
                                <div className="message-content">
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="chat-message bot">
                                <div className="message-content">
                                    <span className="typing-indicator">
                                        <span></span><span></span><span></span>
                                    </span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="chat-input-container">
                        <textarea
                            id="chatInput"
                            placeholder="Ask a question about your transcription..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyPress}
                        ></textarea>
                        <button
                            id="sendChatBtn"
                            className="btn btn-primary"
                            onClick={handleSend}
                            disabled={loading}
                        >
                            <i className="fas fa-paper-plane"></i> Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChatTab;
