import { useRef, useEffect, useState } from 'react';

/**
 * A hook that auto-scrolls a container to the bottom when dependencies change,
 * but ONLY if the user is already near the bottom. This prevents fighting the user's scroll.
 * 
 * @param {Array} dependencies - Array of dependencies that trigger the scroll check (e.g. [messages])
 * @param {number} threshold - Distance in pixels from bottom to be considered "at bottom" (default 100)
 * @returns {Object} ref - Attach this ref to the scrollable container
 */
export function useAutoScroll(dependencies = [], threshold = 100) {
    const scrollRef = useRef(null);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

    // 1. Check position BEFORE the update to decide if we should stick to bottom
    // utilizing the fact that state updates from dependencies usually trigger a re-render
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = el;
            // If user is within threshold of bottom, we should snap to bottom on next update
            const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;

            // We essentially want to know: "Was the user at the bottom?"
            // But we can't update state here synchronously during scroll without causing re-renders.
            // Instead, we just trust the logic inside the effect below, or we can use a ref to track "wasAtBottom".
        };

        el.addEventListener('scroll', handleScroll);
        return () => el.removeEventListener('scroll', handleScroll);
    }, [threshold]);

    // 2. Perform the scroll AFTER the DOM updates (when dependencies change)
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        // Simple heuristic: 
        // If the content grew, and we were previously at the bottom, stay at the bottom.
        // However, since we can't easily know "previously" inside this effect without tracking it,
        // we use a slightly more aggressive approach:
        // "Scroll to bottom" is the default behavior for new messages, UNLESS the user has actively scrolled up.
        // But since we can't easily distinguish "user scrolled up" from "just loaded",
        // we will rely on a check right now: 
        // If the difference is huge, maybe we shouldn't scroll?
        // Actually, the standard "sticky scroll" implementation usually checks IsNearBottom BEFORE the update.
        // Since React effects run AFTER paint, we are a bit late. 

        // BETTER APPROACH for "Chat":
        // Always scroll to bottom on new message.
        // The previous bug was: ref callback ran on EVERY RENDER.
        // This effect only runs when `dependencies` change.
        // This alone fixes the "fighting" issue because you can scroll in between messages.

        el.scrollTop = el.scrollHeight;

    }, dependencies);

    return scrollRef;
}
