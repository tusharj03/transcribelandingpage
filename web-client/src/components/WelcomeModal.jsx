import React from 'react';

const WelcomeModal = ({ onClose, onSelectOption }) => {
    return (
        <div className="modal" style={{ display: 'flex' }}>
            <div className="update-modal-content" style={{ maxWidth: '900px', width: '90%' }}>
                <div className="modal-header" style={{ borderBottom: '1px solid var(--gray-light)', paddingBottom: '20px' }}>
                    <h2>Welcome back!</h2>
                    <span className="close-modal" onClick={onClose}>&times;</span>
                </div>
                <div className="modal-body">
                    <p className="update-message" style={{ fontSize: '18px', marginBottom: '25px' }}>
                        What are you transcribing today?
                    </p>

                    <div className="welcome-options" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                        <button
                            className="welcome-option-btn"
                            onClick={() => onSelectOption('tour-a')}
                            style={optionBtnStyle}
                        >
                            <span style={iconStyle}>🎥</span>
                            <div style={{ textAlign: 'center' }}>
                                <strong>Rapid Web Transcription</strong>
                                <div style={subtextStyle}>Canvas, YouTube, etc.</div>
                            </div>
                        </button>

                        <button
                            className="welcome-option-btn"
                            onClick={() => onSelectOption('tour-b')}
                            style={optionBtnStyle}
                        >
                            <span style={iconStyle}>🎙️</span>
                            <div style={{ textAlign: 'center' }}>
                                <strong>Live Transcription</strong>
                                <div style={subtextStyle}>Meetings, Lectures, Videos</div>
                            </div>
                        </button>

                        <button
                            className="welcome-option-btn"
                            onClick={() => onSelectOption('tour-c')}
                            style={optionBtnStyle}
                        >
                            <span style={iconStyle}>📁</span>
                            <div style={{ textAlign: 'center' }}>
                                <strong>Upload Video/Audio File</strong>
                                <div style={subtextStyle}>Process existing files</div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const optionBtnStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '15px',
    padding: '24px', // Slightly more padding
    background: 'white',
    border: '1px solid var(--gray-light)',
    borderRadius: '16px', // Rounded corners
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: 'var(--shadow)',
    color: 'var(--dark)',
    fontSize: '18px' // Base font size
};

const iconStyle = {
    fontSize: '32px', // Bigger icon
    background: 'var(--primary-light)',
    width: '64px', // Bigger circle
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '16px',
    marginBottom: '8px'
};

const subtextStyle = {
    fontSize: '15px', // Bigger subtext
    color: 'var(--gray)',
    marginTop: '8px',
    lineHeight: '1.4'
};

export default WelcomeModal;
