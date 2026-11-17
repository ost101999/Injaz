import React, { useEffect, useState } from 'react';
import { Code2, LoaderCircle } from 'lucide-react';

export function DevModeButton() {
    const [status, setStatus] = useState<{ available: boolean; active: boolean } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ipc = (window as any).require?.('electron')?.ipcRenderer;
    useEffect(() => { if (ipc) void ipc.invoke('dev-mode:status').then(setStatus); }, []);
    if (!status?.available) return null;
    const toggle = async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            const data: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key !== null) data[key] = localStorage.getItem(key) ?? '';
            }
            const result = await ipc.invoke('dev-mode:toggle', data);
            if (!result.ok) { if (!result.canceled) setError(result.error || 'تعذر تشغيل وضع التطوير.'); setBusy(false); }
        } catch { setError('تعذر تشغيل وضع التطوير.'); setBusy(false); }
    };
    return <div className="relative">
        <button type="button" onClick={() => void toggle()} disabled={busy} title={status.active ? 'العودة للنسخة المثبتة' : 'تشغيل وضع التطوير'} aria-label={status.active ? 'العودة للنسخة المثبتة' : 'تشغيل وضع التطوير'} className={`p-2 rounded-lg transition disabled:opacity-50 ${status.active ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-50 hover:text-indigo-600'}`}>
            {busy ? <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" /> : <Code2 size={20} />}
        </button>
        {error && <div role="alert" dir="rtl" className="absolute z-50 top-full right-0 mt-2 w-64 rounded-xl bg-white p-3 text-sm text-red-600 shadow-lg">{error}<button type="button" className="mr-2 underline" onClick={() => setError('')}>إغلاق</button></div>}
    </div>;
}
