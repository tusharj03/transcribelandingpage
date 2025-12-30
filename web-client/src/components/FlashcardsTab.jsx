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

export default function FlashcardsTab({ currentTranscription }) {
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

    const handleRate = (rating) => {
        // Flashcard Loop
        setIsFlipped(false);
        if (currentIndex < cards.length - 1) {
            setTimeout(() => setCurrentIndex(currentIndex + 1), 150);
        } else {
            alert("Session Complete!");
            setCurrentIndex(0);
        }
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
        }
    };

    const handlePrevCard = () => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
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
                        <button onClick={handleGenerate} style={{ height: '36px', padding: '0 16px', fontSize: '13px', borderRadius: '50px', background: '#2D7FD3', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                        <div className={`review-controls ${isFlipped ? 'visible' : ''}`}>
                            <button className="btn-rating again" onClick={() => handleRate('again')}>
                                <span className="rating-label">Again</span>
                            </button>
                            <button className="btn-rating hard" onClick={() => handleRate('hard')}>
                                <span className="rating-label">Hard</span>
                            </button>
                            <button className="btn-rating good" onClick={() => handleRate('good')}>
                                <span className="rating-label">Good</span>
                            </button>
                            <button className="btn-rating easy" onClick={() => handleRate('easy')}>
                                <span className="rating-label">Easy</span>
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        // Quiz Mode
        if (mode === 'quiz') {
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
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            {renderProgressBar()}
                            <button onClick={handleGenerate} style={{ marginLeft: '10px', height: '36px', padding: '0 16px', fontSize: '13px', borderRadius: '50px', background: '#2D7FD3', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                New
                            </button>
                        </div>
                    </div>

                    <div className="quiz-container" style={{ margin: '0 auto' }}>
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

                            {isAnswered && currentIndex < cards.length - 1 && (
                                <button className="btn btn-primary" onClick={handleNextCard} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px' }}>
                                    Next <i className="fas fa-chevron-right"></i>
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

            <div className="flashcards-empty" style={{ padding: '40px', background: '#f8fafc', borderRadius: '16px' }}>
                <i className={`fas ${mode === 'quiz' ? 'fa-list-ul' : 'fa-layer-group'}`} style={{ color: '#2D7FD3' }}></i>
                <h3>Ready to {mode === 'quiz' ? 'Take a Quiz' : 'Study Cards'}?</h3>
                <p style={{ marginBottom: '24px' }}>
                    Click below to generate a {mode === 'quiz' ? 'multiple-choice quiz' : 'flashcard deck'} from the selected transcript.
                </p>

                <button onClick={handleGenerate} style={{ margin: '0 auto', height: '36px', padding: '0 20px', fontSize: '13px', borderRadius: '50px', background: '#2D7FD3', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 'auto', width: 'auto' }}>
                    Generate {mode === 'quiz' ? 'Quiz' : 'Deck'}
                </button>

                {error && <p style={{ color: 'red', marginTop: '16px' }}>{error}</p>}
            </div>
        </div>
    );
}
