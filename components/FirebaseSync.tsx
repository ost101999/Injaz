import React, { useEffect, useRef, useState } from 'react';
import { syncOnce } from '../firebase/sync-engine.mjs';

const API_KEY = 'AIzaSyCmZvYgFE6XVCyKFdZc6gEkusiSPP41pXc';
const DATABASE = 'https://enjaz-9957d-default-rtdb.europe-west1.firebasedatabase.app';
const USER_ID = 'idyOzbfKCBUQjnlVImyB9DVwlBI2';
const BASELINE = 'injaz_firebase_baseline_v1';
const ARCHIVE = 'injaz_firebase_conflict_archive_v1';
const labels: Record<string, string> = { lists: 'القوائم', tasks: 'المهام', habits: 'العادات', preferences: 'التفضيلات' };
type Snapshot = { lists: any[]; tasks: any[]; habits: any[]; preferences: any };
type Session = { refreshToken: string; email: string };

async function request(url: string, options: RequestInit) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${response.status}`), { status: response.status });
    return body;
}

export function useFirebaseSync(snapshot: Snapshot, apply: (expected: Snapshot, next: Snapshot) => boolean, disableFile: () => void) {
    const state = useRef(snapshot); state.current = snapshot;
    const applyRef = useRef(apply); applyRef.current = apply;
    const disableRef = useRef(disableFile); disableRef.current = disableFile;
    const auth = useRef<{ session: Session; token: string; expires: number } | null>(null);
    const running = useRef(false);
    const generation = useRef(0);
    const conflictRef = useRef<any>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState('غير متصل');
    const [conflict, setConflict] = useState<any>(null);
    const [choices, setChoices] = useState<Record<string, string>>({});
    const [lastSuccess, setLastSuccess] = useState<number | null>(null);
    const ipc = () => (window as any).require?.('electron')?.ipcRenderer;
    const saveSession = async (session: Session) => {
        const bridge = ipc();
        if (!bridge) throw new Error('تسجيل الدخول متاح في تطبيق سطح المكتب فقط');
        await bridge.invoke('firebase-session:write', JSON.stringify(session));
    };
    const refresh = async (session: Session) => {
        const attempt = generation.current;
        const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
        const data = await request(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, { method: 'POST', body });
        if (attempt !== generation.current) throw new Error('CANCELLED');
        if (data.user_id !== USER_ID) throw new Error('هذا الحساب غير مخوّل لمزامنة إنجاز');
        const next = { ...session, refreshToken: data.refresh_token };
        await saveSession(next);
        if (attempt !== generation.current) {
            if (!auth.current) await ipc()?.invoke('firebase-session:clear');
            throw new Error('CANCELLED');
        }
        auth.current = { session: next, token: data.id_token, expires: Date.now() + Number(data.expires_in) * 1000 };
        return data.id_token as string;
    };
    const readLocal = () => {
        const current = state.current;
        for (const field of ['lists', 'tasks', 'habits', 'preferences'] as const) {
            const raw = localStorage.getItem(`injaz_${field}`);
            if (raw === null || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(current[field])) throw new Error('LOCAL_BUSY');
        }
        return JSON.parse(JSON.stringify(current));
    };
    const run = async (review?: any) => {
        if (!auth.current || running.current || (conflictRef.current && !review)) return;
        running.current = true;
        const attempt = generation.current;
        try {
            setStatus('جارٍ المزامنة…');
            const active = auth.current;
            const token = active.expires > Date.now() + 60000 ? active.token : await refresh(active.session);
            if (generation.current !== attempt) return;
            const url = `${DATABASE}/appState.json?auth=${encodeURIComponent(token)}`;
            const result = await syncOnce({
                transport: {
                    read: async () => {
                        const response = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(30000) });
                        if (!response.ok) throw Object.assign(new Error(`خطأ في قراءة السحابة (${response.status})`), { status: response.status });
                        const etag = response.headers.get('ETag');
                        if (!etag) throw new Error('تعذّر التحقق من نسخة السحابة');
                        const envelope = await response.json();
                        if (envelope === null) return { value: null, etag };
                        if (envelope.version !== 1 || typeof envelope.payload !== 'string') throw new Error('صيغة بيانات السحابة غير معروفة');
                        return { value: JSON.parse(envelope.payload), etag };
                    },
                    write: async (value: Snapshot, etag: string) => {
                        const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify({ version: 1, payload: JSON.stringify(value) }), signal: AbortSignal.timeout(30000) });
                        if (!response.ok) throw Object.assign(new Error(`خطأ في حفظ السحابة (${response.status})`), { status: response.status });
                    }
                },
                getLocal: () => { if (generation.current !== attempt) throw new Error('CANCELLED'); return readLocal(); },
                getBaseline: () => { const raw = localStorage.getItem(BASELINE); return raw ? JSON.parse(raw) : null; },
                applyLocal: (expected: Snapshot, next: Snapshot) => applyRef.current(expected, next),
                saveBaseline: (value: Snapshot) => localStorage.setItem(BASELINE, JSON.stringify(value)),
                review
            });
            if (generation.current !== attempt) return;
            if (result.status === 'conflict') {
                conflictRef.current = result; setConflict(result); setChoices({}); setStatus('يوجد تعارض يحتاج مراجعة');
            } else if (result.status === 'ok') {
                conflictRef.current = null; setConflict(null); setLastSuccess(Date.now()); setStatus('تمت المزامنة');
            } else setStatus('تغيّرت البيانات أثناء المزامنة، ستتم المحاولة مجددًا');
        } catch (error: any) {
            if (generation.current !== attempt || error?.message === 'CANCELLED') return;
            setStatus(error?.message === 'LOCAL_BUSY' ? 'في انتظار حفظ التعديلات المحلية' : `تعذرت المزامنة: ${error?.message || 'تحقق من الاتصال'}`);
        } finally { running.current = false; }
    };
    const runRef = useRef(run); runRef.current = run;
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const stored = await ipc()?.invoke('firebase-session:read');
                if (!stored || !alive) return;
                const session = JSON.parse(stored) as Session;
                if (typeof session.refreshToken !== 'string' || typeof session.email !== 'string') throw new Error('جلسة الدخول غير صالحة');
                // Keep the session pending when offline; the normal retry loop
                // refreshes it after the connection returns.
                auth.current = { session, token: '', expires: 0 };
                disableRef.current(); setEmail(session.email); setConnected(true); setStatus('متصل، في انتظار المزامنة');
            } catch (error: any) { if (alive) setStatus(`تعذرت استعادة الدخول: ${error?.message || 'سجّل الدخول مجددًا'}`); }
        })();
        return () => { alive = false; generation.current++; };
    }, []);
    useEffect(() => {
        if (!connected) return;
        const interval = setInterval(() => void runRef.current(), 10000);
        const initial = setTimeout(() => void runRef.current(), 2000);
        const focus = () => void runRef.current();
        window.addEventListener('focus', focus);
        return () => { clearInterval(interval); clearTimeout(initial); window.removeEventListener('focus', focus); };
    }, [connected]);
    useEffect(() => {
        if (!connected) return;
        const timer = setTimeout(() => void runRef.current(), 2000);
        return () => clearTimeout(timer);
    }, [snapshot.lists, snapshot.tasks, snapshot.habits, snapshot.preferences, connected]);
    const login = async () => {
        try {
            setStatus('جارٍ تسجيل الدخول…');
            const data = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
            });
            if (data.localId !== USER_ID) throw new Error('هذا الحساب غير مخوّل لمزامنة إنجاز');
            const session = { email: data.email, refreshToken: data.refreshToken };
            await saveSession(session);
            auth.current = { session, token: data.idToken, expires: Date.now() + Number(data.expiresIn) * 1000 };
            disableRef.current(); setPassword(''); setConnected(true); setStatus('متصل، في انتظار المزامنة');
        } catch (error: any) { setStatus(`تعذّر تسجيل الدخول: ${error?.message || 'تحقق من البيانات'}`); }
    };
    const logout = async () => {
        generation.current++; auth.current = null; conflictRef.current = null; setConflict(null); setConnected(false); setPassword('');
        try { await ipc()?.invoke('firebase-session:clear'); setStatus('تم تسجيل الخروج'); }
        catch { setStatus('تعذّر حذف جلسة الدخول المحفوظة'); }
    };
    const resolve = async () => {
        if (!conflict || conflict.conflicts.some((field: string) => !choices[field])) return;
        try {
            const archive = JSON.parse(localStorage.getItem(ARCHIVE) || '[]');
            archive.push({ at: Date.now(), local: conflict.local, remote: conflict.remote, choices });
            localStorage.setItem(ARCHIVE, JSON.stringify(archive));
            await run({ ...conflict, choices });
        } catch { setStatus('تعذّر حفظ نسخة التعارض محليًا؛ لم يتم استبدال البيانات'); }
    };
    return { email, setEmail, password, setPassword, connected, status, conflict, choices, setChoices, lastSuccess, login, logout, resolve, retry: () => void runRef.current() };
}

export function FirebaseSyncPanel({ sync }: { sync: ReturnType<typeof useFirebaseSync> }) {
    return <div className="p-4 bg-white border border-gray-200 rounded-xl space-y-3 shadow-sm" dir="rtl">
        <h4 className="text-sm font-bold text-gray-700">مزامنة إنجاز السحابية</h4>
        {!sync.connected ? <>
            <input type="email" autoComplete="username" placeholder="البريد الإلكتروني" value={sync.email} onChange={e => sync.setEmail(e.target.value)} className="w-full p-2 border rounded text-sm" />
            <input type="password" autoComplete="current-password" placeholder="كلمة المرور" value={sync.password} onChange={e => sync.setPassword(e.target.value)} className="w-full p-2 border rounded text-sm" />
            <button type="button" onClick={() => void sync.login()} className="px-3 py-2 bg-indigo-600 text-white rounded text-sm">تسجيل الدخول وتفعيل المزامنة</button>
        </> : <div className="flex gap-2"><button type="button" onClick={sync.retry} className="px-3 py-2 bg-indigo-600 text-white rounded text-sm">مزامنة الآن</button><button type="button" onClick={() => void sync.logout()} className="px-3 py-2 border rounded text-sm">تسجيل الخروج</button></div>}
        <p className="text-xs text-gray-600">{sync.status}{sync.lastSuccess ? ` — آخر نجاح: ${new Date(sync.lastSuccess).toLocaleString('ar-EG')}` : ''}</p>
        {sync.conflict && <div className="p-3 bg-amber-50 rounded space-y-3">
            <p className="text-sm font-bold">توجد نسختان مختلفتان. راجع كل قسم واختر النسخة التي تريد الاحتفاظ بها.</p>
            {sync.conflict.conflicts.map((field: string) => <div key={field} className="space-y-1">
                <p className="font-bold text-sm">{labels[field] || field}</p>
                <details><summary className="text-xs cursor-pointer">عرض النسختين</summary><div className="text-xs overflow-auto max-h-40" dir="auto"><b>هذا الجهاز:</b><pre className="whitespace-pre-wrap">{JSON.stringify(sync.conflict.local[field], null, 2)}</pre><b>السحابة:</b><pre className="whitespace-pre-wrap">{JSON.stringify(sync.conflict.remote?.[field] ?? null, null, 2)}</pre></div></details>
                <label className="text-xs ml-3"><input type="radio" name={`firebase-${field}`} checked={sync.choices[field] === 'local'} onChange={() => sync.setChoices({ ...sync.choices, [field]: 'local' })} /> نسخة هذا الجهاز</label>
                {sync.conflict.remote && <label className="text-xs"><input type="radio" name={`firebase-${field}`} checked={sync.choices[field] === 'remote'} onChange={() => sync.setChoices({ ...sync.choices, [field]: 'remote' })} /> نسخة السحابة</label>}
            </div>)}
            <button type="button" onClick={() => void sync.resolve()} disabled={sync.conflict.conflicts.some((field: string) => !sync.choices[field])} className="px-3 py-2 bg-amber-700 disabled:opacity-40 text-white rounded text-sm">حفظ الاختيارات</button>
        </div>}
    </div>;
}
