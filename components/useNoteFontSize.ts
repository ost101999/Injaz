import { useEffect, useState } from 'react';

const key = 'injaz_note_font_size';
const readSize = () => {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= 12 && value <= 40 ? value : 20;
};

export function useNoteFontSize() {
    const [size, setSize] = useState(readSize);
    useEffect(() => {
        const sync = (event: StorageEvent) => { if (event.key === key) setSize(readSize()); };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, []);
    const handleSizeShortcut = (event: React.KeyboardEvent) => {
        if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey ||
            !['Period', 'Comma'].includes(event.code)) return false;
        event.preventDefault();
        event.stopPropagation();
        const next = Math.max(12, Math.min(40, size + (event.code === 'Period' ? 2 : -2)));
        try { localStorage.setItem(key, String(next)); } catch { /* Keep the size for this session. */ }
        setSize(next);
        return true;
    };
    return { size, handleSizeShortcut };
}
