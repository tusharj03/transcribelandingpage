import React from 'react';

const Sidebar = ({
    activeTab, setActiveTab, onRapidTranscribe,
    user, onLogin, onLogout, isOpen, onClose,
    translationEnabled, setTranslationEnabled,
    targetLang, setTargetLang,
    translationStatus, translationProgress, translatorReady
}) => {
    return (
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
            <button className="sidebar-close-btn" onClick={onClose}>
                <i className="fas fa-times"></i>
            </button>
            <div className="sidebar-header">
                <div className="logo-container">
                    <img src="/icons/resonote1795x512.png" alt="Resonote" className="logo-img" />
                </div>
            </div>

            <div className="sidebar-cta">
                <button
                    className="btn-rapid-cta"
                    onClick={onRapidTranscribe}
                    title="Rapid Transcribe"
                >
                    <div className="rapid-icon-circle">
                        <i className="fa-solid fa-bolt"></i>
                    </div>
                    <div className="rapid-text">
                        <span className="rapid-title">Rapid Transcribe</span>
                        <span className="rapid-subtitle">Instant Web Capture</span>
                    </div>
                </button>
            </div>

            <nav className="sidebar-nav">
                <div className="nav-section">
                    <div className="nav-label">Main</div>

                    <button
                        className={`nav-item ${activeTab === 'transcribe' ? 'active' : ''}`}
                        onClick={() => { setActiveTab('transcribe'); if (window.innerWidth < 768) onClose(); }}
                    >
                        <i className="fa-solid fa-microphone-lines nav-icon"></i>
                        <span>Transcribe</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                        onClick={() => { setActiveTab('history'); if (window.innerWidth < 768) onClose(); }}
                    >
                        <i className="fa-solid fa-clock-rotate-left nav-icon"></i>
                        <span>History</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'notes' ? 'active' : ''}`}
                        onClick={() => { setActiveTab('notes'); if (window.innerWidth < 768) onClose(); }}
                    >
                        <i className="fa-solid fa-wand-magic-sparkles nav-icon"></i>
                        <span>AI Notes</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
                        onClick={() => { setActiveTab('chat'); if (window.innerWidth < 768) onClose(); }}
                    >
                        <i className="fa-solid fa-comments nav-icon"></i>
                        <span>Chat</span>
                    </button>
                </div>
            </nav>

            <div className="sidebar-footer">
                {/* Language Selector */}
                <div className="language-selector-container" style={{ marginBottom: '16px', padding: '0 16px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--gray)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Language</span>
                        {translationEnabled && !translatorReady && (
                            <span style={{ fontSize: '10px' }}>{translationStatus} ({Math.round(translationProgress)}%)</span>
                        )}
                    </div>
                    <select
                        className="language-dropdown"
                        value={translationEnabled ? targetLang : 'default'}
                        onChange={(e) => {
                            if (e.target.value === 'default') {
                                setTranslationEnabled(false);
                            } else {
                                setTranslationEnabled(true);
                                setTargetLang(e.target.value);
                            }
                        }}
                        style={{
                            width: '100%',
                            padding: '8px',
                            borderRadius: '8px',
                            border: '1px solid var(--gray-light)',
                            fontSize: '14px',
                            background: 'white',
                            color: 'var(--text-primary)'
                        }}
                    >
                        <option value="default">Default</option>
                        <option value="en">English</option>
                        <option value="es">Spanish (Español)</option>
                        <option value="fr">French (Français)</option>
                        <option value="de">German (Deutsch)</option>
                        <option value="it">Italian (Italiano)</option>
                        <option value="pt">Portuguese (Português)</option>
                        <option value="zh">Chinese (中文)</option>
                        <option value="ja">Japanese (日本語)</option>
                        <option value="ru">Russian (Русский)</option>
                    </select>
                </div>

                {user && user.authenticated ? (
                    <div className="user-profile-card">
                        <div className="user-avatar">
                            {user.email ? user.email[0].toUpperCase() : 'U'}
                        </div>
                        <div className="user-info-min">
                            <span className="user-email-text">{user.email?.split('@')[0]}</span>
                            <span className="user-plan-badge">Pro</span>
                        </div>
                        <button className="logout-icon-btn" onClick={onLogout} title="Logout">
                            <i className="fa-solid fa-right-from-bracket"></i>
                        </button>
                    </div>
                ) : (
                    <button className="login-sidebar-btn" onClick={onLogin}>
                        <i className="fa-regular fa-user"></i>
                        <span>Sign In</span>
                    </button>
                )}
            </div>
        </aside>
    );
};

export default Sidebar;
