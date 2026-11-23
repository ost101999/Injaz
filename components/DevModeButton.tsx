import React, { useCallback, useEffect, useState } from 'react';
import { Code2, LoaderCircle, RefreshCw } from 'lucide-react';

type DevStatus = {
    available: boolean;
    active: boolean;
    fullSource?: boolean;
    mainOutdated?: boolean;
};

export function DevModeButton() {
    const [status, setStatus] = useState<DevStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ipc = (window as any).require?.('electron')?.ipcRenderer;

    const refreshStatus = useCallback(() => {
        if (ipc) void ipc.invoke('dev-mode:status').then(setStatus).catch(() => {});
    }, [ipc]);

    useEffect(() => {
        refreshStatus();
        const onFocus = () => refreshStatus();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [refreshStatus]);

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
            if (!result.ok) {
                if (!result.canceled) setError(result.error || 'تعذر تشغيل وضع التطوير.');
                setBusy(false);
            }
        } catch {
            setError('تعذر تشغيل وضع التطوير.');
            setBusy(false);
        }
    };

    const titleText = status.active
        ? status.mainOutdated
            ? 'يوجد تحديث في محرك التشغيل — اضغط لإعادة التشغيل بالكود الجديد بدون بناء'
            : status.fullSource
            ? 'وضع المطور الكامل نشط — اضغط للعودة للنسخة المثبتة'
            : 'وضع المطور نشط — اضغط للعودة للنسخة المثبتة'
        : 'تشغيل وضع التطوير (بدون إعادة بناء)';

    return <div className="relative flex items-center mr-2 ml-2">
        <button
            type="button"
            onClick={() => void toggle()}
            disabled={busy}
            title={titleText}
            aria-label={titleText}
            className={`relative flex items-center justify-center p-1 rounded-md transition disabled:opacity-50 ${
                status.active ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-50 hover:text-indigo-600'
            }`}
        >
            {busy
                ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />
                : status.active && status.mainOutdated
                ? <RefreshCw size={14} />
                : <Code2 size={14} />}
            {status.active && status.mainOutdated && !busy && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-white animate-pulse" />
            )}
        </button>
        {error && <div role="alert" dir="rtl" className="absolute z-50 top-full right-0 mt-2 w-64 rounded-xl bg-white p-3 text-sm text-red-600 shadow-lg">{error}<button type="button" className="mr-2 underline" onClick={() => setError('')}>إغلاق</button></div>}
    </div>;
}
