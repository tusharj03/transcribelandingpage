import React from 'react';

const Sidebar = ({ activeTab, setActiveTab, onRapidTranscribe, user, onLogin, onLogout }) => {
    return (
        <aside className="sidebar">
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
                        onClick={() => setActiveTab('transcribe')}
                    >
                        <i className="fa-solid fa-microphone-lines nav-icon"></i>
                        <span>Transcribe</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveTab('history')}
                    >
                        <i className="fa-solid fa-clock-rotate-left nav-icon"></i>
                        <span>History</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'notes' ? 'active' : ''}`}
                        onClick={() => setActiveTab('notes')}
                    >
                        <i className="fa-solid fa-wand-magic-sparkles nav-icon"></i>
                        <span>AI Notes</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
                        onClick={() => setActiveTab('chat')}
                    >
                        <i className="fa-solid fa-comments nav-icon"></i>
                        <span>Chat</span>
                    </button>
                </div>
            </nav>

            <div className="sidebar-footer">
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
