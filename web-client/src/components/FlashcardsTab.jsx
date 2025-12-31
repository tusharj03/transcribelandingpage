import React, { useState, useEffect } from 'react';
import '../flashcards.css';

const FLASHCARD_PROMPT = `
You are an expert tutor. Your goal is to create high-quality flashcards from the provided transcript.
Output ONLY valid JSON in the following format:
[
  { "front": "Question", "back": "Answer" },
  ...
]
Rules:
1. Create 5-10 cards focusing on the MOST important concepts.
2. Keep "front" short and provocative.
3. Keep "back" concise.
4. Do not include markdown formatting in the JSON strings.
`;

const QUIZ_PROMPT = `
You are an expert tutor. Create a multiple-choice quiz from the provided transcript.
Output ONLY valid JSON in the following format:
[
  { 
    "question": "Question text", 
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": "Correct Option Text" 
  },
  ...
]
Rules:
1. Create 5 challenging questions.
2. The "answer" MUST EXACTLY match one of the strings in "options".
3. Distractors should be plausible.
`;

export default function FlashcardsTab({ currentTranscription, user, onLoginRequest }) {
    const [cards, setCards] = useState([]);
    const [status, setStatus] = useState('idle'); // 'idle', 'generating', 'review', 'empty'

    // V2 State
    const [mode, setMode] = useState('flashcards'); // 'flashcards' | 'quiz'
    const [source, setSource] = useState('current'); // 'current' | history_id
    const [historyItems, setHistoryItems] = useState([]);
    const [quizAnswers, setQuizAnswers] = useState({}); // { cardIndex: selectedOption }
    const [quizResults, setQuizResults] = useState({}); // { cardIndex: isCorrect }

    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [error, setError] = useState(null);

    const [quizComplete, setQuizComplete] = useState(false);

    // Load History on Mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem('transcription-history');
            if (stored) {
                setHistoryItems(JSON.parse(stored));
            }
        } catch (e) {
            console.error("Failed to load history for flashcards", e);
        }
    }, []);

    // Effect to reset state when source changes (optional, or just handle at generation)

    const getActiveTranscript = () => {
        if (source === 'current') return currentTranscription;
        const item = historyItems.find(i => i.id === source);
        return item ? item.transcript : null;
    };

    const handleGenerate = async () => {
        if (!user || (!user.authenticated && !user.offlineMode)) {
            onLoginRequest();
            return;
        }

        const transcript = getActiveTranscript();
        if (!transcript) {
            setError("No transcript selected.");
            return;
        }

        setStatus('generating');
        setError(null);
        setCards([]);
        setQuizAnswers({});
        setQuizResults({});
        setQuizComplete(false);
        setCurrentIndex(0);

        try {
            const systemPrompt = mode === 'quiz' ? QUIZ_PROMPT : FLASHCARD_PROMPT;

            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Here is the transcript:\n\n${transcript.substring(0, 15000)}` }
                    ]
                })
            });

            if (!response.ok) throw new Error(`Generation failed: ${response.status}`);

            const data = await response.json();
            if (!data.completion) throw new Error('No completion received from AI');

            // Parse JSON (handle potential markdown wrapping)
            let jsonStr = data.completion.trim();
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
            }

            const parsedCards = JSON.parse(jsonStr);

            if (Array.isArray(parsedCards) && parsedCards.length > 0) {
                setCards(parsedCards);
                // Reset session state
                setCurrentIndex(0);
                setIsFlipped(false);
                setStatus('review');
            } else {
                throw new Error("Failed to parse valid content from AI response");
            }

        } catch (err) {
            console.error("Content generation error:", err);
            setError("Could not generate content. Please try again.");
            setStatus('idle');
        }
    };

    const handleFlip = () => {
        if (mode === 'flashcards') setIsFlipped(!isFlipped);
    };

    const handleQuizOption = (option) => {
        const currentCard = cards[currentIndex];
        const isCorrect = option === currentCard.answer;

        // Save Answer
        setQuizAnswers(prev => ({ ...prev, [currentIndex]: option }));
        setQuizResults(prev => ({ ...prev, [currentIndex]: isCorrect }));

        // Auto Advance if Correct? No, let user confirm or just show state.
        // For this UI, we might just show correct/incorrect state immediately.
    };

    const handleNextCard = () => {
        if (currentIndex < cards.length - 1) {
            setCurrentIndex(currentIndex + 1);
            setIsFlipped(false);
        } else if (mode === 'quiz') {
            setQuizComplete(true);
        }
    };

    const handlePrevCard = () => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
            setIsFlipped(false);
        }
    };

    const restartQuiz = () => {
        setQuizAnswers({});
        setQuizResults({});
        setQuizComplete(false);
        setCurrentIndex(0);
    };

    // --- Render Helpers ---

    const renderControls = () => (
        <div className="flashcards-controls-row">
            <div className="control-group">
                <span className="control-label">Source</span>
                <select
                    className="source-select"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                >
                    <option value="current">Current Tab Transcript</option>
                    {historyItems.filter(item => item.type === 'transcription').map(item => (
                        <option key={item.id} value={item.id}>
                            {item.name.substring(0, 30)}{item.name.length > 30 ? '...' : ''} ({new Date(item.timestamp).toLocaleDateString()})
                        </option>
                    ))}
                </select>
            </div>

            <div className="control-group">
                <div className="mode-toggle">
                    <button
                        className={`mode-btn ${mode === 'flashcards' ? 'active' : ''}`}
                        onClick={() => setMode('flashcards')}
                    >
                        <i className="fas fa-layer-group"></i> Cards
                    </button>
                    <button
                        className={`mode-btn ${mode === 'quiz' ? 'active' : ''}`}
                        onClick={() => setMode('quiz')}
                    >
                        <i className="fas fa-list-ul"></i> Quiz
                    </button>
                </div>
            </div>
        </div>
    );

    const renderProgressBar = () => (
        <div className="segmented-progress">
            {cards.map((_, idx) => {
                let statusClass = '';
                if (idx < currentIndex) statusClass = 'completed';
                if (idx === currentIndex) statusClass = 'current';
                // Extra quiz logic: color by result?
                if (mode === 'quiz' && quizResults[idx] !== undefined) {
                    // Could override color for correct/incorrect here
                }
                return (
                    <div key={idx} className={`progress-segment ${statusClass}`}></div>
                );
            })}
        </div>
    );

    // --- MAIN RENDER ---

    if (status === 'generating') {
        return (
            <div className="flashcards-container">
                {renderControls()}
                <div className="flashcards-loading">
                    <div className="spinner"></div>
                    <h3>Generating {mode === 'quiz' ? 'Quiz' : 'Deck'}...</h3>
                    <p>Our AI is analyzing the text to create custom study materials.</p>
                </div>
            </div>
        );
    }

    if (status === 'review' && cards.length > 0) {
        // Flashcard Mode
        if (mode === 'flashcards') {
            const currentCard = cards[currentIndex];
            return (
                <div className="flashcards-container">
                    <div className="flashcards-header">
                        <div className="flashcards-title">
                            <h2>Study Session</h2>
                            <p>Card {currentIndex + 1} of {cards.length}</p>
                        </div>
                        <button className="btn-force-small btn-new-deck" onClick={handleGenerate}>
                            New Deck
                        </button>
                    </div>

                    <div className="card-stage">
                        <div className={`flashcard ${isFlipped ? 'flipped' : ''}`} onClick={handleFlip}>
                            <div className="card-face front">
                                <div className="card-label">QUESTION</div>
                                <div className="card-content">{currentCard.front}</div>
                                <div className="card-flip-hint">Click to flip</div>
                            </div>
                            <div className="card-face back">
                                <div className="card-label">ANSWER</div>
                                <div className="card-content">{currentCard.back}</div>
                            </div>
                        </div>

                        {/* Simplified Navigation Controls */}
                        <div className="flashcard-nav-controls">
                            <button
                                className="btn btn-outline"
                                disabled={currentIndex === 0}
                                onClick={handlePrevCard}
                            >
                                <i className="fas fa-arrow-left"></i> Previous
                            </button>
                            <span className="card-counter">{currentIndex + 1} / {cards.length}</span>
                            <button
                                className="btn btn-primary"
                                disabled={currentIndex === cards.length - 1}
                                onClick={handleNextCard}
                            >
                                Next <i className="fas fa-arrow-right"></i>
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        // Quiz Mode
        if (mode === 'quiz') {
            if (quizComplete) {
                const correctCount = Object.values(quizResults).filter(Boolean).length;
                const score = Math.round((correctCount / cards.length) * 100);

                return (
                    <div className="flashcards-container">
                        <div className="flashcards-header">
                            <div className="flashcards-title">
                                <h2>Quiz Results</h2>
                                <p>Score: {score}%</p>
                            </div>
                            <button className="btn-force-small btn-new-quiz" onClick={handleGenerate}>
                                New Quiz
                            </button>
                        </div>

                        <div className="quiz-results-container">
                            <div className="quiz-score-circle">
                                <div className="score-number">{correctCount}/{cards.length}</div>
                                <div className="score-label">Correct</div>
                            </div>

                            <div className="quiz-actions" style={{ marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                <button className="btn btn-outline" onClick={restartQuiz}>
                                    <i className="fas fa-redo"></i> Retake Quiz
                                </button>
                                <button className="btn btn-primary" onClick={handleGenerate}>
                                    <i className="fas fa-sparkles"></i> Generate New
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            const currentQ = cards[currentIndex];
            const answer = quizAnswers[currentIndex];
            const isAnswered = answer !== undefined;
            const isCorrect = quizResults[currentIndex];

            return (
                <div className="flashcards-container">
                    <div className="flashcards-header">
                        <div className="flashcards-title">
                            <h2>Knowledge Check</h2>
                            <p>Question {currentIndex + 1} of {cards.length}</p>
                        </div>
                        <div className="flashcards-quiz-header-actions">
                            {renderProgressBar()}
                            <button className="btn-force-small btn-new-quiz" onClick={handleGenerate}>
                                New
                            </button>
                        </div>
                    </div>

                    <div className="quiz-container">
                        <div className="quiz-question-card">
                            <div className="quiz-question">{currentQ.question}</div>
                        </div>

                        <div className="quiz-options">
                            {currentQ.options.map((opt, idx) => {
                                let className = 'quiz-option';
                                if (isAnswered) {
                                    if (opt === currentQ.answer) className += ' correct';
                                    else if (opt === answer) className += ' incorrect';
                                }

                                return (
                                    <div
                                        key={idx}
                                        className={className}
                                        onClick={() => !isAnswered && handleQuizOption(opt)}
                                    >
                                        <div className="option-circle"></div>
                                        <span>{opt}</span>
                                        {isAnswered && opt === currentQ.answer && <i className="fas fa-check" style={{ marginLeft: 'auto' }}></i>}
                                        {isAnswered && opt === answer && opt !== currentQ.answer && <i className="fas fa-times" style={{ marginLeft: 'auto' }}></i>}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Navigation Footer */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '30px' }}>
                            <button
                                className="btn btn-outline"
                                disabled={currentIndex === 0}
                                onClick={handlePrevCard}
                            >
                                <i className="fas fa-chevron-left"></i> Previous
                            </button>

                            {isAnswered && (
                                <button className="btn btn-primary" onClick={handleNextCard} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px' }}>
                                    {currentIndex < cards.length - 1 ? (
                                        <>Next <i className="fas fa-chevron-right"></i></>
                                    ) : (
                                        <>Finish Quiz <i className="fas fa-flag-checkered"></i></>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
    }

    // Idle State (Initial)
    return (
        <div className="flashcards-container">
            <div className="flashcards-header">
                <div className="flashcards-title">
                    <h2>Active Learning</h2>
                    <p>Create study materials from any session.</p>
                </div>
            </div>

            {renderControls()}

            <div className="flashcards-empty">
                <i className={`fas ${mode === 'quiz' ? 'fa-list-ul' : 'fa-layer-group'}`}></i>
                <h3>Ready to {mode === 'quiz' ? 'Take a Quiz' : 'Study Cards'}?</h3>
                <p className="flashcards-empty-text">
                    Click below to generate a {mode === 'quiz' ? 'multiple-choice quiz' : 'flashcard deck'} from the selected transcript.
                </p>

                <button className="btn-force-small btn-main-generate" onClick={handleGenerate}>
                    Generate {mode === 'quiz' ? 'Quiz' : 'Deck'}
                </button>

                {error && <p style={{ color: 'red', marginTop: '16px' }}>{error}</p>}
            </div>
        </div>
    );
}
