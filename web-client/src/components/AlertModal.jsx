import React from 'react';

const AlertModal = ({ message, onClose }) => {
    if (!message) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content-enhanced">
                <button className="modal-close-btn" onClick={onClose}>
                    <i className="fas fa-times"></i>
                </button>
                <div className="modal-icon-large" style={{ color: 'var(--primary)', background: 'var(--primary-light)' }}>
                    <i className="fas fa-info-circle"></i>
                </div>
                <h3 className="modal-title">Notice</h3>
                <p className="modal-text" style={{ whiteSpace: 'pre-line' }}>{message}</p>
                <button className="btn btn-primary btn-block" onClick={onClose}>
                    OK
                </button>
            </div>
        </div>
    );
};

export default AlertModal;
