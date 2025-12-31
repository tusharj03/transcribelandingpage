import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';

const ChatTab = ({ currentTranscription, user, onLoginRequest }) => {
    // --- State ---

    // History & Navigation
    const [savedChats, setSavedChats] = useState([]);
    const [currentChatId, setCurrentChatId] = useState(null); // If null, we are in "New Chat" mode (staging) or viewing nothing

    // Active Chat State
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    // Transcription Context
    const [historyItems, setHistoryItems] = useState([]);
    const [chatSource, setChatSource] = useState('current'); // 'current' | 'history'
    const [selectedHistoryId, setSelectedHistoryId] = useState('');
    const [contextText, setContextText] = useState('');

    // Mobile History Toggle
    const [showHistory, setShowHistory] = useState(false);

    const messagesEndRef = useRef(null);

    // --- Effects ---

    // 1. Load Everything on Mount
    useEffect(() => {
        try {
            // Load Transcriptions History
            const storedTranscripts = localStorage.getItem('transcription-history');
            if (storedTranscripts) setHistoryItems(JSON.parse(storedTranscripts));

            // Load Chat History
            const storedChats = localStorage.getItem('chat-history');
            if (storedChats) {
                const parsed = JSON.parse(storedChats);
                setSavedChats(parsed);
                // Optionally load the most recent chat? Or start new. 
                // Let's start new for now or load if there's one?
                // Default: Start fresh
                loadNewChatState();
            } else {
                loadNewChatState();
            }
        } catch (e) {
            console.error("Failed to load history", e);
        }
    }, []);

    // 2. Context Text Logic
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

    // 3. Auto-Scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    // --- Logic ---

    const loadNewChatState = () => {
        setCurrentChatId(null);
        setMessages([
            { role: 'ai', content: "Hello! I can help answer questions about your transcriptions. Ask me anything!" }
        ]);
        setInput('');
    };

    const loadChat = (chatId) => {
        const chat = savedChats.find(c => c.id === chatId);
        if (chat) {
            setCurrentChatId(chatId);
            setMessages(chat.messages);
            // Optionally restore context? 
            // For now, context is dynamic based on dropdowns. 
            // Saving context ID in chat object would be better but let's stick to simple first.
        }
    };

    const saveCurrentChat = (updatedMessages) => {
        let newChats = [...savedChats];

        if (currentChatId) {
            // Update existing
            const idx = newChats.findIndex(c => c.id === currentChatId);
            if (idx !== -1) {
                newChats[idx] = { ...newChats[idx], messages: updatedMessages, lastUpdated: Date.now() };
            }
        } else {
            // Create new
            const newId = Date.now().toString();
            // Generate title from first user message
            const firstUserMsg = updatedMessages.find(m => m.role === 'user');
            const title = firstUserMsg
                ? (firstUserMsg.content.length > 30 ? firstUserMsg.content.substring(0, 30) + '...' : firstUserMsg.content)
                : 'New Conversation';

            const newChat = {
                id: newId,
                title: title,
                messages: updatedMessages,
                createdAt: Date.now(),
                lastUpdated: Date.now()
            };
            newChats = [newChat, ...newChats]; // Prepend
            setCurrentChatId(newId);
        }

        setSavedChats(newChats);
        localStorage.setItem('chat-history', JSON.stringify(newChats));
        return newChats; // return for immediate update if needed
    };

    const deleteChat = (e, chatId) => {
        e.stopPropagation();
        if (window.confirm("Are you sure you want to delete this chat?")) {
            const newChats = savedChats.filter(c => c.id !== chatId);
            setSavedChats(newChats);
            localStorage.setItem('chat-history', JSON.stringify(newChats));
            if (currentChatId === chatId) {
                loadNewChatState();
            }
        }
    };

    const handleSend = async () => {
        if (!input.trim()) return;

        if (!user || !user.authenticated) {
            onLoginRequest();
            return;
        }

        if (!contextText) {
            alert("No transcription content available. Please select a source.");
            return;
        }

        const userMsg = { role: 'user', content: input };
        const newMessages = [...messages, userMsg];
        setMessages(newMessages);
        setInput('');
        setLoading(true);

        // Save immediately (optimistic? or wait for reply? User message is enough to start)
        saveCurrentChat(newMessages);

        try {
            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: `You are a helpful assistant analyzing the following text:\n\n${contextText.substring(0, 15000)}...` },
                        ...newMessages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))
                    ]
                })
            });
            const data = await response.json();

            let aiContent = "I couldn't generate a response.";
            if (data.error) aiContent = `Error: ${data.error}`;
            else if (data.completion || data.content) aiContent = data.completion || data.content;

            const finalMessages = [...newMessages, { role: 'ai', content: aiContent }];
            setMessages(finalMessages);
            saveCurrentChat(finalMessages);

        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev, { role: 'ai', content: "Sorry, I encountered a network error." }]);
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

    // --- Render ---

    return (
        <div id="chat" className="tab-content active chat-tab-container">

            {/* Mobile History Toggle Overlay */}
            {showHistory && (
                <div className="chat-history-overlay" onClick={() => setShowHistory(false)}></div>
            )}

            {/* Sidebar (History) */}
            <div className={`chat-sidebar ${showHistory ? 'open' : ''}`}>
                <div className="chat-sidebar-header">
                    <button
                        className="btn btn-primary btn-new-chat"
                        onClick={() => {
                            loadNewChatState();
                            if (window.innerWidth < 768) setShowHistory(false);
                        }}
                    >
                        <i className="fas fa-plus"></i> New Chat
                    </button>
                    <button className="btn-close-history" onClick={() => setShowHistory(false)}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="recent-chats-list">
                    <div className="recent-header">Recent</div>
                    {savedChats.length === 0 && <p className="no-history-text">No history yet</p>}

                    {savedChats.map(chat => (
                        <div
                            key={chat.id}
                            className={`recent-chat-item ${currentChatId === chat.id ? 'active' : ''}`}
                            onClick={() => {
                                loadChat(chat.id);
                                if (window.innerWidth < 768) setShowHistory(false);
                            }}
                        >
                            <span className="chat-item-title">
                                {chat.title}
                            </span>
                            <i
                                className="fas fa-trash-alt delete-chat-icon"
                                onClick={(e) => deleteChat(e, chat.id)}
                            ></i>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="card chat-main-area">
                <div className="card-header chat-header">
                    <div className="card-title">
                        <button className="btn-mobile-history" onClick={() => setShowHistory(true)}>
                            <i className="fas fa-bars"></i>
                        </button>
                        <i className="fas fa-comments"></i>
                        Transcription Chat
                    </div>
                    <div className="chat-info">
                        <i className="fas fa-info-circle"></i>
                        <span className="chat-info-text">Ask questions about your transcriptions</span>
                    </div>
                </div>

                <div className="chat-source-selection">
                    <label>Context:</label>
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
                            className="chat-specific-history"
                            value={selectedHistoryId}
                            onChange={(e) => setSelectedHistoryId(e.target.value)}
                        >
                            <option value="">Select transcript...</option>
                            {historyItems.filter(h => h.type === 'transcription').map(item => (
                                <option key={item.id} value={item.id}>
                                    {item.name} - {new Date(item.timestamp).toLocaleDateString()}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <div className="transcription-context">
                    <p className="context-indicator">
                        {contextText ? `Using context (${contextText.length} chars)` : 'No context selected'}
                    </p>
                </div>

                <div className="chat-container">
                    <div id="chatHistory" className="chat-history">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`chat-message ${msg.role === 'user' ? 'user' : 'bot'}`}>
                                <div className="message-content">
                                    <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }} />
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
                </div>

                <div className="chat-input-container">
                    <textarea
                        id="chatInput"
                        placeholder="Ask away..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyPress}
                    ></textarea>
                    <button
                        id="sendChatBtn"
                        className="btn-send-chat"
                        onClick={handleSend}
                        disabled={loading}
                    >
                        <i className="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatTab;
