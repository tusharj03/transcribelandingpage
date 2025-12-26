import { useState, useRef, useEffect } from 'react';

export function useLiveAssist({ liveNotes, transcription, isRecording }) {
    const [messages, setMessages] = useState([
        { role: 'assistant', content: "I'm listening to the live notes. Ask me anything about the ongoing session!" }
    ]);
    const [loading, setLoading] = useState(false);
    const wasRecording = useRef(isRecording);

    useEffect(() => {
        if (!wasRecording.current && isRecording) {
            setMessages([
                { role: 'assistant', content: "I'm listening to the live notes. Ask me anything about the ongoing session!" }
            ]);
        }
        wasRecording.current = isRecording;
    }, [isRecording]);

    // Helpers
    const getContext = () => {
        const currentNotes = liveNotes || "";
        const currentTranscript = transcription || "";

        if (currentNotes.length > 50) {
            return "Here are the live notes so far:\n" + currentNotes;
        } else if (currentTranscript.length > 50) {
            return "NOTES ARE EMPTY. Here is the raw transcript:\n" + currentTranscript.substring(Math.max(0, currentTranscript.length - 2000));
        } else {
            return "The session has just started. No significant notes or transcript yet.";
        }
    };

    const sendMessage = async (userMessage) => {
        if (!userMessage.trim()) return;

        // Add user message immediately
        const newMsg = { role: 'user', content: userMessage };
        setMessages(prev => [...prev, newMsg]);
        setLoading(true);

        try {
            const contextContent = getContext();

            const systemPrompt = `You are a Live Meeting Assistant. Your goal is to answer questions based strictly on the current meeting context provided below.
        
Context:
${contextContent}

User Question: ${userMessage}

Instructions:
- Be concise and direct.
- If the answer isn't in the notes/transcript, say "I don't have that info yet."
- Do not hallucinate facts not present in the context.`;

            const payloadMessages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ];

            const response = await fetch('/api/llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: payloadMessages })
            });

            if (!response.ok) throw new Error(`Chat failed: ${response.status}`);

            const data = await response.json();
            const aiResponse = data.completion?.trim() || "I couldn't process that.";

            setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);

        } catch (error) {
            console.error('Live Chat error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: "Error: " + error.message }]);
        } finally {
            setLoading(false);
        }
    };

    return {
        messages,
        loading,
        sendMessage
    };
}
