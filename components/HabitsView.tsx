import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Habit } from '../types';
import { Icons } from './Icons';

interface HabitsViewProps {
    habits: Habit[];
    setHabits: React.Dispatch<React.SetStateAction<Habit[]>>;
    separateSpaced?: boolean;
    showCompletedSpaced?: boolean;
    isActive?: boolean;
}

const HABIT_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f97316',
    '#10b981', '#3b82f6', '#f59e0b', '#ef4444',
    '#14b8a6', '#a855f7'
];

const HABIT_ICONS = [
    { key: 'Sparkles', label: 'شرارة' },
    { key: 'Droplets', label: 'ماء' },
    { key: 'BookOpen', label: 'قراءة' },
    { key: 'Dumbbell', label: 'رياضة' },
    { key: 'Brain', label: 'تعلم' },
    { key: 'Moon', label: 'نوم' },
    { key: 'Heart', label: 'صحة' },
    { key: 'Leaf', label: 'طبيعة' },
];

const HABIT_CATEGORIES = ['عبادات', 'صحة', 'تعليم', 'رياضة', 'عناية شخصية', 'أخرى'];

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const AR_ORDINALS = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس'];

const generateId = () => Math.random().toString(36).substr(2, 9);

const toDateStr = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Helper to get date adjusted by transition hour */
const getEffectiveDate = () => {
    const n = new Date();
    const saved = localStorage.getItem('injaz_day_transition_hour');
    const h = saved ? parseInt(saved) : 6;
    if (n.getHours() < h) n.setDate(n.getDate() - 1);
    return n;
};

/** Convert Western digits to Arabic-Indic numerals (\u0661\u0662\u0663...) */
const toAr = (n: number | string): string =>
    String(n).replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));

const isEnglishText = (text: string): boolean => !/[\u0600-\u06FF]/.test(text) && /[a-zA-Z]/.test(text);

const getTodayStr = () => {
    const n = getEffectiveDate();
    return toDateStr(n.getFullYear(), n.getMonth(), n.getDate());
};

/** Build the days of the currently‑viewed month */
const buildMonthColumns = (year: number, month: number, todayStr: string) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const d = new Date(year, month, day);
        const dateStr = toDateStr(year, month, day);
        return {
            day,
            dateStr,
            dayName: AR_DAYS[d.getDay()],
            isFuture: dateStr > todayStr,
        };
    });
};

function getStreak(completions: string[]): number {
    const d = getEffectiveDate();
    let streak = 0;
    while (true) {
        const s = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
        if (completions.includes(s)) { 
            streak++; 
            d.setDate(d.getDate() - 1); 
        } else {
            break;
        }
    }
    return streak;
}

function getGoalProgress(habit: Habit): { current: number; total: number; percent: number } | null {
    if (!habit.goal) return null;
    if (habit.goal.type !== 'custom_date' && habit.goal.value <= 0) return null;
    
    const start = habit.goal.startDate;
    const d = new Date(start);
    const startDateStr = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    const completionsCount = habit.completions.filter(c => c >= startDateStr).length;
    
    let current = completionsCount + (habit.goal.startValue || 0);
    let total = habit.goal.value;
    
    if (habit.goal.type === 'custom_date') {
        if (!habit.goal.targetDate) return null;
        const target = new Date(habit.goal.targetDate);
        target.setHours(23, 59, 59, 999);
        const timeDiff = target.getTime() - start;
        total = Math.ceil(timeDiff / (1000 * 3600 * 24));
        if (total <= 0) total = 1;
    }
    
    const percent = Math.min(100, Math.round((current / total) * 100));
    
    return { current, total, percent };
}

function isHabitDueOnDate(habit: Habit, dateStr: string) {
    if (!habit.frequency || habit.frequency === 'daily') return true;
    
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayOfWeek = date.getDay();
    
    if (habit.frequency === 'weekly') {
        return habit.customDays?.includes(dayOfWeek) || false;
    }
    if (habit.frequency === 'monthly') {
        if (habit.isLastDayOfMonth) {
            const nextDay = new Date(y, m - 1, d + 1);
            return nextDay.getMonth() !== m - 1;
        }
        if (habit.customDays && habit.customDays.length === 2) {
            const [targetWeekday, occurrence] = habit.customDays;
            const currentWeekday = date.getDay();
            const currentOccurrence = Math.ceil(date.getDate() / 7);
            return currentWeekday === targetWeekday && currentOccurrence === occurrence;
        }
        const dayOfMonth = habit.customDays?.[0] || new Date(habit.createdAt).getDate();
        return date.getDate() === dayOfMonth;
    }
    if (habit.frequency === 'custom') {
        const [interval, unit] = habit.customDays || [2, 0];
        
        if (interval === 0) {
            const [, y, m, d] = habit.customDays || [];
            return dateStr === toDateStr(y, m, d);
        }

        const createdAt = new Date(habit.createdAt);
        
        // Use effective dates to avoid time zone issues
        const startY = createdAt.getFullYear();
        const startM = createdAt.getMonth();
        const startD = createdAt.getDate();
        
        const currY = date.getFullYear();
        const currM = date.getMonth();
        const currD = date.getDate();

        if (unit === 0) { // Months
            const monthsDiff = (currY - startY) * 12 + (currM - startM);
            if (habit.customDays?.length === 4) {
                const [,, targetWeekday, occurrence] = habit.customDays;
                const currentWeekday = date.getDay();
                const currentOccurrence = Math.ceil(date.getDate() / 7);
                return monthsDiff % interval === 0 && currentWeekday === targetWeekday && currentOccurrence === occurrence;
            }
            const targetDay = habit.customDays?.[2] || startD;
            return monthsDiff % interval === 0 && currD === targetDay;
        } else { // Years
            const yearsDiff = currY - startY;
            const targetDay = habit.customDays?.[2] || startD;
            return yearsDiff % interval === 0 && currM === startM && currD === targetDay;
        }
    }
    return true;
}

function HabitEditModal({ initialHabit, onSave, onDelete, onClose, existingCategories, existingGroups }: { 
    initialHabit?: Habit; 
    onSave: (h: Partial<Habit>) => void; 
    onDelete?: (id: string) => void;
    onClose: () => void; 
    existingCategories: string[];
    existingGroups: string[];
}) {
    const [title, setTitle] = useState(initialHabit?.title || '');
    const [category, setCategory] = useState(initialHabit?.category || (existingCategories.find(c => c !== 'أخرى') || ''));
    const [groupId, setGroupId] = useState(initialHabit?.groupId || (existingGroups.includes('عام') ? 'عام' : (existingGroups[0] || 'عام')));
    const [duration, setDuration] = useState(initialHabit?.duration || 0);
    const [goalType, setGoalType] = useState<'days' | 'weeks' | 'months' | 'count' | 'custom_date'>(initialHabit?.goal?.type || 'days');
    const [goalValue, setGoalValue] = useState(initialHabit?.goal?.value || 0);
    const [goalTargetDate, setGoalTargetDate] = useState<string | undefined>(initialHabit?.goal?.targetDate);
    const [goalTargetDateMonthOffset, setGoalTargetDateMonthOffset] = useState(0);
    const [startValue, setStartValue] = useState(initialHabit?.goal?.startValue || 0);
    const [showCustomCalendar, setShowCustomCalendar] = useState(false);
    const [isFinished, setIsFinished] = useState(initialHabit?.isFinished || false);
    const [isCreatingNewCategory, setIsCreatingNewCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [showDuration, setShowDuration] = useState(!!initialHabit?.duration);
    const [showCategory, setShowCategory] = useState(!!initialHabit?.category);
    const [frequency, setFrequency] = useState<Habit['frequency']>(initialHabit?.frequency || 'daily');
    const [showMonthlyCalendar, setShowMonthlyCalendar] = useState(false);
    const [isLastDayOfMonth, setIsLastDayOfMonth] = useState(initialHabit?.isLastDayOfMonth || false);
    const [showLastDayConfirm, setShowLastDayConfirm] = useState(false);
    const [showCustomOptions, setShowCustomOptions] = useState(false);
    const [customOneTimeMonthOffset, setCustomOneTimeMonthOffset] = useState(0);
    
    const customIntervalRef = useRef<HTMLInputElement>(null);
    const goalValueRef = useRef<HTMLInputElement>(null);
    const durationRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const attachWheelListener = (ref: React.RefObject<HTMLInputElement>, handler: (e: WheelEvent) => void) => {
            const el = ref.current;
            if (el) {
                el.addEventListener('wheel', handler, { passive: false });
                return () => el.removeEventListener('wheel', handler);
            }
        };

        const handleWheelCustom = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const direction = e.deltaY > 0 ? -1 : 1;
            setCustomDays(prev => {
                const current = prev[0] === 0 ? 0 : (prev[0] || 2);
                const newVal = Math.max(0, current + direction);
                const today = getEffectiveDate();
                if (newVal === 0) return [0, today.getFullYear(), today.getMonth(), today.getDate()];
                return [newVal, prev[1] === undefined ? 0 : prev[1], prev[2] === undefined ? today.getDate() : prev[2]];
            });
        };

        const handleWheelGoal = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const direction = e.deltaY > 0 ? -1 : 1;
            setGoalValue(prev => Math.max(0, prev + direction));
        };

        const handleWheelDuration = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const direction = e.deltaY > 0 ? -1 : 1;
            setDuration(prev => Math.max(0, (prev || 0) + direction));
        };

        const cleanupCustom = attachWheelListener(customIntervalRef, handleWheelCustom);
        const cleanupGoal = attachWheelListener(goalValueRef, handleWheelGoal);
        const cleanupDuration = attachWheelListener(durationRef, handleWheelDuration);

        return () => {
            cleanupCustom?.();
            cleanupGoal?.();
            cleanupDuration?.();
        };
    }, [frequency, showCustomOptions, goalType, showDuration]);

    // Lock scroll when modal is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    const effectiveToday = getEffectiveDate();
    const effectiveTodayStr = toDateStr(effectiveToday.getFullYear(), effectiveToday.getMonth(), effectiveToday.getDate());

    const [customDays, setCustomDays] = useState<number[]>(initialHabit?.customDays || (initialHabit?.frequency === 'monthly' ? [new Date(initialHabit.createdAt).getDate()] : (initialHabit?.frequency === 'weekly' ? [new Date(initialHabit.createdAt).getDay()] : [])));
    
    const getCustomSummary = () => {
        if (!customDays || customDays.length < 1) return '';
        const [interval, unit, ...rest] = customDays;
        
        if (interval === 0) {
            if (customDays.length >= 4) {
                const [, y, m, d] = customDays;
                return `مرة واحدة في ${toAr(d)} ${AR_MONTHS[m]} ${toAr(y)}`;
            }
            return 'مرة واحدة';
        }

        const intervalAr = toAr(interval);
        let unitText = '';
        if (unit === 0) { // Months
            unitText = interval === 1 ? 'شهر' : (interval === 2 ? 'شهرين' : (interval >= 3 && interval <= 10 ? 'أشهر' : 'شهر'));
        } else { // Years
            unitText = interval === 1 ? 'سنة' : (interval === 2 ? 'سنتين' : (interval >= 3 && interval <= 10 ? 'سنوات' : 'سنة'));
        }
        
        let suffix = '';
        if (unit === 0) {
            if (rest.length === 2) {
                const dayName = AR_DAYS[rest[0]];
                const dayNameWithoutAl = dayName.startsWith('ال') ? dayName.substring(2) : dayName;
                suffix = ` - ${AR_ORDINALS[rest[1] - 1] || toAr(rest[1])} ${dayNameWithoutAl}`;
            } else if (rest.length === 1) {
                suffix = ` - يوم ${toAr(rest[0])}`;
            }
        }
        
        return `كل ${intervalAr} ${unitText}${suffix}`;
    };

    const handleSubmit = () => {
        if (!title.trim()) return;
        const startOfToday = getEffectiveDate();
        startOfToday.setHours(0, 0, 0, 0);
        const goal = (goalValue > 0 || goalType === 'custom_date') ? { 
            type: goalType, 
            value: goalValue, 
            startDate: initialHabit?.goal?.startDate || startOfToday.getTime(),
            targetDate: goalTargetDate,
            startValue: goalType === 'days' ? startValue : undefined
        } : undefined;
        onSave({ 
            title: title.trim(), 
            category: frequency === 'daily' ? (showCategory ? (isCreatingNewCategory ? newCategoryName.trim() : category) : undefined) : undefined,
            groupId: frequency !== 'daily' ? (showCategory ? (isCreatingNewCategory ? newCategoryName.trim() : groupId) : undefined) : undefined,
            duration: (showDuration && duration > 0) ? duration : undefined,
            goal,
            isFinished,
            frequency,
            customDays: (frequency === 'custom' || frequency === 'weekly' || frequency === 'monthly') ? customDays : undefined,
            isLastDayOfMonth: frequency === 'monthly' ? isLastDayOfMonth : false
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900/10 backdrop-blur-[2px] p-4 animate-fadeIn" onClick={onClose}>
            <div className="w-full max-w-lg p-10 bg-white shadow-[0_30px_60px_-12px_rgba(0,0,0,0.1)] rounded-2xl relative border border-gray-100" style={{ fontFamily: '"DecoType Naskh", Amiri, serif' }} onClick={e => e.stopPropagation()}>
                
                <style>{`
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 4px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: transparent;
                        margin-top: 10px;
                        margin-bottom: 10px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: #e2e8f0;
                        border-radius: 10px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: #cbd5e1;
                    }
                    /* Hide spin buttons for number inputs */
                    input::-webkit-outer-spin-button,
                    input::-webkit-inner-spin-button {
                        -webkit-appearance: none;
                        margin: 0;
                    }
                    input[type=number] {
                        -moz-appearance: textfield;
                    }
                `}</style>

                {/* Close Button */}
                <button 
                    onClick={onClose} 
                    className="absolute top-6 left-6 text-gray-300 hover:text-gray-600 transition-colors p-2 rounded-xl hover:bg-gray-50"
                >
                    <Icons.Close size={20} />
                </button>

                {/* Header Title */}
                <div className="mb-8 text-center animate-fadeIn">
                    <h2 className="text-2xl font-black text-gray-800 tracking-tight" style={{ fontFamily: 'Deco, Amiri, serif' }}>تخصيص العادة</h2>
                    <p className="text-[11px] text-indigo-400 font-bold uppercase tracking-[0.3em] mt-1 opacity-60">Customization</p>
                </div>

                <div className="overflow-y-scroll max-h-[55vh] custom-scrollbar pl-4 -ml-2">
                    <div className="flex flex-col divide-y divide-gray-100">
                        {/* Name Input */}
                    <div className="space-y-2 pb-6">
                        <div className="flex items-center gap-2.5 mb-2">
                            <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100/60 shadow-sm">
                                <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
                            </div>
                            <label className="text-[18px] font-black text-gray-800 tracking-tight" style={{ fontFamily: 'Deco, Amiri, serif' }}>اسم العادة</label>
                        </div>
                        <div className="bg-gray-50/50 rounded-lg px-4 border border-gray-200/50 focus-within:bg-white focus-within:border-indigo-200 transition-all">
                            <input 
                                type="text" 
                                value={title} 
                                onChange={e => setTitle(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        handleSubmit();
                                    }
                                }}
                                placeholder="ماذا تود أن تنجز؟"
                                className="w-full text-lg font-medium bg-transparent py-2 outline-none placeholder:text-gray-300 text-gray-800 leading-[1.8]"
                                style={{ fontFamily: 'Deco, Amiri, serif' }}
                                autoFocus
                            />
                        </div>
                    </div>


                    {/* Frequency Section */}
                    <div className="space-y-3 py-6">
                        <div className="flex items-center gap-2.5 mb-2">
                            <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100/60 shadow-sm">
                                <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
                            </div>
                            <label className="text-[18px] font-black text-gray-800 tracking-tight" style={{ fontFamily: 'Deco, Amiri, serif' }}>تكرار العادة</label>
                        </div>
                        <div className="flex bg-gray-100/40 p-0.5 rounded-lg gap-0.5">
                            {(['daily', 'weekly', 'monthly', 'custom'] as const).map((f) => (
                                <div key={f} className="flex-1 relative flex">
                                    <button 
                                        key={f}
                                        type="button"
                                        onClick={() => {
                                            if (f === 'monthly') {
                                                if (frequency === 'monthly') {
                                                    setShowMonthlyCalendar(!showMonthlyCalendar);
                                                } else {
                                                    setFrequency('monthly');
                                                    setShowMonthlyCalendar(true);
                                                    setShowCustomOptions(false);
                                                    const today = getEffectiveDate();
                                                    setCustomDays([today.getDate()]);
                                                    setIsLastDayOfMonth(false);
                                                }
                                            } else if (f === 'custom') {
                                                if (frequency === 'custom') {
                                                    setShowCustomOptions(!showCustomOptions);
                                                } else {
                                                    setFrequency('custom');
                                                    setShowCustomOptions(true);
                                                    setShowMonthlyCalendar(false);
                                                    const today = getEffectiveDate();
                                                    if (!customDays || customDays.length < 3) {
                                                        setCustomDays([2, 0, today.getDate()]); // Default: every 2 months on this day
                                                    }
                                                }
                                            } else {
                                                setFrequency(f);
                                                setShowMonthlyCalendar(false);
                                                setShowCustomOptions(false);
                                                const today = getEffectiveDate();
                                                if (f === 'weekly' || f === 'monthly') {
                                                    setCustomDays([f === 'monthly' ? today.getDate() : today.getDay()]);
                                                    if (f === 'monthly') setIsLastDayOfMonth(false);
                                                } else if (f === 'custom') {
                                                    if (!customDays || customDays.length < 3) {
                                                        setCustomDays([2, 0, today.getDate()]); // Default: every 2 months on this day
                                                    }
                                                }
                                            }
                                        }}
                                        className={`flex-1 py-2 text-[12px] font-bold rounded-md transition-all ${frequency === f ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                        style={{ fontFamily: 'Deco, Amiri, serif' }}
                                    >
                                        {f === 'daily' ? 'يومي' : f === 'weekly' ? 'أسبوعي' : f === 'monthly' ? 'شهري' : 'مخصص'}
                                    </button>
                                    {f === 'monthly' && frequency === 'monthly' && customDays.length > 0 && !showMonthlyCalendar && (
                                        <div className="absolute top-full pt-0 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
                                            <span className="text-[11px] text-gray-400" style={{ fontFamily: 'Amiri, serif' }}>
                                                {isLastDayOfMonth 
                                                    ? 'آخر يوم في الشهر'
                                                    : (customDays.length === 2 
                                                        ? `${AR_ORDINALS[customDays[1] - 1] || toAr(customDays[1])} ${AR_DAYS[customDays[0]].startsWith('ال') ? AR_DAYS[customDays[0]].substring(2) : AR_DAYS[customDays[0]]}`
                                                        : `يوم ${toAr(customDays[0])}`)}
                                            </span>
                                        </div>
                                    )}
                                    {f === 'custom' && frequency === 'custom' && customDays.length >= 2 && !showCustomOptions && (
                                        <div className="absolute top-full pt-0 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
                                            <span className="text-[11px] text-gray-400" style={{ fontFamily: 'Amiri, serif' }}>
                                                {getCustomSummary()}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {frequency === 'weekly' && (
                            <div className="mt-4 animate-fadeIn p-3 rounded-2xl border border-indigo-100/50 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                                <div className="flex flex-wrap gap-2 justify-center">
                                    {['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map((day, index) => {
                                        const dayOrder = [6, 0, 1, 2, 3, 4, 5];
                                        const dayIndex = dayOrder[index];
                                        const isSelected = customDays.includes(dayIndex);
                                        return (
                                            <button
                                                key={dayIndex}
                                                type="button"
                                                onClick={(e) => {
                                                    const isMulti = e.ctrlKey || e.metaKey || frequency === 'weekly';
                                                    if (isSelected) {
                                                        if (!isMulti && customDays.length === 1) return; 
                                                        setCustomDays(customDays.filter(d => d !== dayIndex));
                                                    } else {
                                                        if (isMulti) {
                                                            setCustomDays([...customDays, dayIndex].sort());
                                                        } else {
                                                            setCustomDays([dayIndex]);
                                                        }
                                                    }
                                                }}
                                                className={`px-2.5 py-2 rounded-xl text-[12px] font-bold transition-all duration-300 ${
                                                    isSelected 
                                                    ? 'bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] z-10' 
                                                    : 'bg-white text-gray-400 border border-gray-100 hover:border-indigo-200 hover:text-indigo-500'
                                                }`}
                                                style={{ fontFamily: 'Deco, Amiri, serif' }}
                                            >
                                                {day}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {frequency === 'custom' && showCustomOptions && (
                            <div className="mt-4 animate-fadeIn p-4 rounded-2xl border border-indigo-100/50 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                                <div className="flex items-center justify-center gap-4">
                                    <span className="text-[14px] text-gray-400" style={{ fontFamily: 'Deco, Amiri, serif' }}>تـكـرار كـل</span>
                                    <div className="relative group">
                                        <input 
                                            ref={customIntervalRef}
                                            type="text"
                                            inputMode="numeric"
                                            value={customDays[0] === 0 ? '0' : (customDays[0] || 2)}
                                            onFocus={e => e.target.select()}
                                            onChange={e => {
                                                const val = e.target.value.replace(/[^0-9]/g, '');
                                                const interval = parseInt(val) || 0;
                                                const today = getEffectiveDate();
                                                if (interval === 0) {
                                                    setCustomDays([0, today.getFullYear(), today.getMonth(), today.getDate()]);
                                                } else {
                                                    setCustomDays([interval, customDays[1] === undefined ? 0 : customDays[1], customDays[2] === undefined ? today.getDate() : customDays[2]]);
                                                }
                                            }}
                                            className="w-12 h-7 bg-gray-50/50 border border-gray-100 rounded-xl py-1 px-2 text-center text-indigo-600 text-sm font-bold focus:bg-white focus:border-indigo-200 transition-all outline-none"
                                            style={{ fontFamily: 'Acme, sans-serif', direction: 'ltr' }}
                                        />
                                    </div>
                                    {customDays[0] > 0 && (
                                        <div className="flex bg-gray-100/40 p-0.5 rounded-xl gap-0.5 border border-gray-200/20">
                                            <button 
                                                type="button"
                                                onClick={() => {
                                                    const targetDay = customDays[2] || getEffectiveDate().getDate();
                                                    setCustomDays([customDays[0] || 2, 0, targetDay]);
                                                }}
                                                className={`px-4 py-1.5 text-[12px] font-bold rounded-lg transition-all ${customDays[1] === 0 ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                                style={{ fontFamily: 'Deco, Amiri, serif' }}
                                            >
                                                أشهر
                                            </button>
                                            <button 
                                                type="button"
                                                onClick={() => {
                                                    const targetDay = customDays[2] || getEffectiveDate().getDate();
                                                    setCustomDays([customDays[0] || 2, 1, targetDay]);
                                                }}
                                                className={`px-4 py-1.5 text-[12px] font-bold rounded-lg transition-all ${customDays[1] === 1 ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                                style={{ fontFamily: 'Deco, Amiri, serif' }}
                                            >
                                                سنة
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {customDays[0] === 0 && (() => {
                                    const now = getEffectiveDate();
                                    const targetDateObj = new Date(now.getFullYear(), now.getMonth() + customOneTimeMonthOffset, 1);
                                    const currentMonth = targetDateObj.getMonth();
                                    const currentYear = targetDateObj.getFullYear();
                                    
                                    const firstDayJS = targetDateObj.getDay();
                                    const firstDay = (firstDayJS + 1) % 7; // Shift to Saturday-start
                                    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
                                    const dayNames = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
                                    
                                    const [, selY, selM, selD] = customDays;
                                    
                                    return (
                                        <div className="mt-4 pt-4 border-t border-indigo-50">
                                            <div className="bg-indigo-50/30 px-3 py-2 border-b border-indigo-50/50 flex items-center justify-between rounded-t-xl">
                                                <button onClick={() => setCustomOneTimeMonthOffset(p => p - 1)} className="p-1 text-indigo-400 hover:bg-indigo-100 rounded-lg transition-colors">
                                                    <Icons.ChevronRight size={14} />
                                                </button>
                                                <div className="flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                                                    <button 
                                                        onClick={() => {
                                                            setCustomOneTimeMonthOffset(0);
                                                            setCustomDays([0, now.getFullYear(), now.getMonth(), now.getDate()]);
                                                        }}
                                                        className="w-1.5 h-1.5 rounded-full bg-indigo-300 hover:bg-indigo-500 transition-colors mr-1"
                                                        title="العودة لليوم الحالي"
                                                    />
                                                    <span className="font-black text-indigo-400" style={{ fontFamily: 'Deco, Amiri, serif' }}>{AR_MONTHS[currentMonth]}</span>
                                                    <span className="font-normal text-indigo-400" style={{ fontFamily: 'Acme, sans-serif' }}>{currentYear}</span>
                                                </div>
                                                <button onClick={() => setCustomOneTimeMonthOffset(p => p + 1)} className="p-1 text-indigo-400 hover:bg-indigo-100 rounded-lg transition-colors">
                                                    <Icons.ChevronLeft size={14} />
                                                </button>
                                            </div>
                                            <div className="px-3 pb-3 pt-1 grid grid-cols-7 gap-x-1.5 gap-y-1.5 justify-items-center">
                                                {dayNames.map((dn) => (
                                                    <div key={dn} className="text-center w-9 h-9 flex items-center justify-center text-indigo-300/60 font-bold text-[10px]">
                                                        {dn}
                                                    </div>
                                                ))}
                                                {Array.from({ length: firstDay }).map((_, i) => (
                                                    <div key={`empty-${i}`} className="w-9 h-9" />
                                                ))}
                                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                                    const day = i + 1;
                                                    const isSelected = selY === currentYear && selM === currentMonth && selD === day;
                                                    const isTodayInGrid = currentYear === now.getFullYear() && currentMonth === now.getMonth() && day === now.getDate();
                                                    
                                                    return (
                                                        <button
                                                            key={day}
                                                            type="button"
                                                            onClick={() => {
                                                                setCustomDays([0, currentYear, currentMonth, day]);
                                                                setShowCustomOptions(false);
                                                            }}
                                                            className={`w-9 h-9 flex items-center justify-center rounded-xl text-[12px] transition-all duration-300 ${
                                                                isSelected
                                                                ? 'bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] z-10' 
                                                                : isTodayInGrid
                                                                    ? 'bg-indigo-50/30 text-indigo-600 border border-indigo-100/60'
                                                                    : 'bg-white text-gray-400 border border-gray-100 hover:border-indigo-200 hover:text-indigo-500'
                                                            }`}
                                                            style={{ fontFamily: 'Acme, sans-serif' }}
                                                        >
                                                            {day}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {customDays[0] > 0 && customDays[1] === 0 && (() => {
                                    const now = getEffectiveDate();
                                    const firstDayJS = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
                                    const firstDay = (firstDayJS + 1) % 7;
                                    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                                    const dayNames = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
                                    
                                    const isWeekdayMode = customDays.length === 4;
                                    const activeWeekday = isWeekdayMode ? customDays[2] : null;
                                    const activeOccurrence = isWeekdayMode ? customDays[3] : null;
                                    const selectedDay = !isWeekdayMode ? (customDays[2] || (initialHabit ? new Date(initialHabit.createdAt).getDate() : now.getDate())) : null;

                                    return (
                                        <div className="mt-4 pt-4 border-t border-indigo-50">
                                            <div className="flex items-center justify-center mb-3">
                                                <span className="text-[11px] font-black text-indigo-400 uppercase tracking-wider" style={{ fontFamily: 'Deco, Amiri, serif' }}>
                                                    {isWeekdayMode ? `تكرار في ${['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][activeWeekday!]} رقم ${toAr(activeOccurrence!)}` : 'يوم التكرار في الشهر'}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-7 gap-x-1.5 gap-y-1.5 justify-items-center">
                                                {dayNames.map((dn, idx) => {
                                                    const jsWeekday = (idx + 6) % 7;
                                                    return (
                                                        <button 
                                                            key={dn} 
                                                            type="button"
                                                            onClick={() => {
                                                                if (jsWeekday === activeWeekday) {
                                                                    setCustomDays([customDays[0] || 2, 0, getEffectiveDate().getDate()]); 
                                                                } else {
                                                                    setCustomDays([customDays[0] || 2, 0, jsWeekday, 1]); 
                                                                }
                                                            }}
                                                            className={`text-center transition-all w-9 h-9 flex items-center justify-center ${activeWeekday === jsWeekday ? 'text-indigo-600 font-black text-[12px]' : 'text-indigo-300/60 font-bold text-[10px] hover:text-indigo-500'}`}
                                                        >
                                                            {dn}
                                                        </button>
                                                    );
                                                })}
                                                {Array.from({ length: firstDay }).map((_, i) => (
                                                    <div key={`empty-${i}`} className="w-9 h-9" />
                                                ))}
                                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                                    const day = i + 1;
                                                    const d = new Date(now.getFullYear(), now.getMonth(), day);
                                                    const weekday = d.getDay();
                                                    const occurrence = Math.ceil(day / 7);
                                                    
                                                    const isSelected = !isWeekdayMode && selectedDay === day;
                                                    const isOrdinalActive = isWeekdayMode && activeWeekday === weekday;
                                                    const isOrdinalSelected = isOrdinalActive && activeOccurrence === occurrence;
                                                    
                                                    return (
                                                        <button
                                                            key={day}
                                                            type="button"
                                                            onClick={() => {
                                                                if (isWeekdayMode && activeWeekday === weekday) {
                                                                    setCustomDays([customDays[0] || 1, 0, weekday, occurrence]);
                                                                } else {
                                                                    setCustomDays([customDays[0] || 1, 0, day]);
                                                                }
                                                                setShowCustomOptions(false);
                                                            }}
                                                            className={`w-9 h-9 flex items-center justify-center rounded-xl text-[12px] transition-all duration-300 ${
                                                                isSelected || isOrdinalSelected
                                                                ? 'bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] z-10' 
                                                                : isOrdinalActive
                                                                    ? 'bg-indigo-50 text-indigo-400 border border-indigo-100'
                                                                    : 'bg-white text-gray-400 border border-gray-100 hover:border-indigo-200 hover:text-indigo-500'
                                                            }`}
                                                            style={{ fontFamily: 'Acme, sans-serif' }}
                                                        >
                                                            {isOrdinalActive ? occurrence : day}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {frequency === 'monthly' && showMonthlyCalendar && (() => {
                            const now = getEffectiveDate();
                            const firstDayJS = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
                            // Shift JS Sunday-start (0-6) to Saturday-start (0-6)
                            const firstDay = (firstDayJS + 1) % 7;
                            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                            const dayNames = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
                            
                            // Check if currently in weekday occurrence mode
                            const isWeekdayMode = customDays.length === 2;
                            const activeWeekday = isWeekdayMode ? customDays[0] : null;
                            const activeOccurrence = isWeekdayMode ? customDays[1] : null;

                            return (
                                <div className="mt-4 animate-fadeIn overflow-hidden rounded-2xl border border-indigo-100/50 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                                    <div className="bg-indigo-50/30 px-3 py-2 border-b border-indigo-50/50 flex items-center justify-between">
                                        <span className="text-[11px] font-black text-indigo-400 uppercase tracking-wider" style={{ fontFamily: 'Deco, Amiri, serif' }}>
                                            {isWeekdayMode ? `تكرار في ${['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][activeWeekday!]} رقم ${toAr(activeOccurrence!)}` : 'تقويم شهري'}
                                        </span>
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-200 animate-pulse"></div>
                                    </div>
                                    <div className="px-3 pb-3 pt-1 grid grid-cols-7 gap-x-1.5 gap-y-1.5 justify-items-center">
                                        {dayNames.map((dn, idx) => {
                                            // Mapping Saturday-start index back to JS index
                                            const jsWeekday = (idx + 6) % 7;
                                            return (
                                                <button 
                                                    key={dn} 
                                                    onClick={() => {
                                                        if (jsWeekday === activeWeekday) {
                                                            setCustomDays([getEffectiveDate().getDate()]); 
                                                        } else {
                                                            setCustomDays([jsWeekday, 1]); 
                                                        }
                                                    }}
                                                    className={`text-center transition-all w-9 h-9 flex items-center justify-center ${activeWeekday === jsWeekday ? 'text-indigo-600 font-black text-[12px]' : 'text-indigo-300/60 font-bold text-[10px] hover:text-indigo-500'}`}
                                                >
                                                    {dn}
                                                </button>
                                            );
                                        })}
                                        {Array.from({ length: firstDay }).map((_, i) => (
                                            <div key={`empty-${i}`} className="w-9 h-9" />
                                        ))}
                                        {Array.from({ length: daysInMonth }).map((_, i) => {
                                            const day = i + 1;
                                            const d = new Date(now.getFullYear(), now.getMonth(), day);
                                            const weekday = d.getDay();
                                            const occurrence = Math.ceil(day / 7);
                                            
                                            const isSelected = !isWeekdayMode && customDays[0] === day;
                                            const isOrdinalActive = isWeekdayMode && activeWeekday === weekday;
                                            const isOrdinalSelected = isOrdinalActive && activeOccurrence === occurrence;

                                            return (
                                                <button
                                                    key={day}
                                                    type="button"
                                                    onClick={() => {
                                                        if (isWeekdayMode && activeWeekday === weekday) {
                                                            setCustomDays([weekday, occurrence]);
                                                            setIsLastDayOfMonth(false);
                                                        } else {
                                                            setCustomDays([day]);
                                                            const isLastDay = day === daysInMonth;
                                                            if (isLastDay) {
                                                                setShowLastDayConfirm(true);
                                                            } else {
                                                                setIsLastDayOfMonth(false);
                                                            }
                                                        }
                                                        if (day !== daysInMonth) setShowMonthlyCalendar(false);
                                                    }}
                                                    className={`w-9 h-9 flex items-center justify-center rounded-xl text-[12px] transition-all duration-300 ${
                                                        isSelected || isOrdinalSelected
                                                        ? 'bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] z-10' 
                                                        : isOrdinalActive
                                                            ? 'bg-indigo-50 text-indigo-400 border border-indigo-100'
                                                            : 'bg-white text-gray-400 border border-gray-100 hover:border-indigo-200 hover:text-indigo-500'
                                                    }`}
                                                    style={{ fontFamily: 'Acme, sans-serif' }}
                                                >
                                                    {isOrdinalActive ? occurrence : day}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Goal Row with Segmented Control */}
                    <div className="space-y-2 py-6">
                        <div className="flex items-center gap-2.5 mb-2">
                            <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100/60 shadow-sm">
                                <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
                            </div>
                            <label className="text-[18px] font-black text-gray-800 tracking-tight" style={{ fontFamily: 'Deco, Amiri, serif' }}>الانـتـهاء</label>
                        </div>
                        <div className="flex items-stretch gap-3 relative">
                             <div className="w-1/4 flex gap-2">
                                 {/* Main Input */}
                                 <div className={`bg-gray-50/50 rounded-lg border border-gray-200/50 focus-within:bg-white focus-within:border-indigo-200 transition-all ${goalType === 'days' ? 'flex-1' : 'w-full'} ${goalType === 'custom_date' ? 'opacity-0 pointer-events-none' : ''}`}>
                                    <input 
                                        ref={goalValueRef}
                                        type="text"
                                        inputMode="numeric"
                                        value={goalValue || ''} 
                                        onFocus={e => e.target.select()}
                                        onChange={e => {
                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                            setGoalValue(parseInt(val) || 0);
                                        }}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                handleSubmit();
                                            }
                                        }}
                                        placeholder="0"
                                        className="w-full text-base font-medium bg-transparent py-1.5 outline-none text-gray-800 placeholder:text-gray-300 placeholder:text-[12px] text-center"
                                        style={{ fontFamily: 'Acme, sans-serif', direction: 'ltr' }}
                                        disabled={goalType === 'custom_date'}
                                    />
                                </div>

                                 {/* Start Value Input */}
                                 {goalType === 'days' && (
                                     <div className="flex-1 relative bg-gray-50/50 rounded-lg border border-gray-200/50 focus-within:bg-white focus-within:border-indigo-200 transition-all">
                                         {!startValue && (
                                             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                 <span className="text-[10px] text-gray-400 opacity-40" style={{ fontFamily: 'Deco, Amiri, serif' }}>البداية من</span>
                                             </div>
                                         )}
                                         <input 
                                             type="text" 
                                             inputMode="numeric"
                                             value={startValue || ''}
                                             onFocus={e => e.target.select()}
                                             onChange={e => {
                                                 const val = e.target.value.replace(/[^0-9]/g, '');
                                                 setStartValue(parseInt(val) || 0);
                                             }}
                                             className="w-full text-base font-medium bg-transparent py-1.5 outline-none text-gray-800 text-center"
                                             style={{ fontFamily: 'Acme, sans-serif' }}
                                         />
                                     </div>
                                 )}
                             </div>
                             
                              <div className="flex-1 bg-gray-100/40 p-0.5 rounded-lg flex gap-0.5">
                                {(['days', 'weeks', 'months', 'custom_date'] as const).map((type) => (
                                    <div key={type} className="flex-1 relative flex">
                                        <button 
                                            onClick={() => {
                                                if (type === 'custom_date') {
                                                    if (goalType === 'custom_date') {
                                                        setShowCustomCalendar(!showCustomCalendar);
                                                    } else {
                                                        setGoalType(type);
                                                        setShowCustomCalendar(true);
                                                    }
                                                } else {
                                                    setGoalType(type);
                                                    setShowCustomCalendar(false);
                                                }
                                            }}
                                            className={`flex-1 text-[11px] font-bold rounded-lg transition-all duration-300 ${goalType === type ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                            style={{ fontFamily: 'Deco, Amiri, serif' }}
                                        >
                                            {type === 'days' ? 'مرة' : type === 'weeks' ? 'أسبوع' : type === 'months' ? 'شهر' : 'مخصص'}
                                        </button>
                                        {/* Selected Date centered exactly under the "Custom" button, only when custom_date is selected */}
                                        {type === 'custom_date' && goalType === 'custom_date' && goalTargetDate && !showCustomCalendar && (
                                            <div className="absolute top-full pt-0 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
                                                <span className="text-[10px] text-gray-500 border-b border-gray-300/50 pb-[1px]" style={{ fontFamily: 'Acme, sans-serif' }}>
                                                    {goalTargetDate}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>





                        {goalType === 'custom_date' && showCustomCalendar && (() => {
                            const now = getEffectiveDate();
                            const targetDateObj = new Date(now.getFullYear(), now.getMonth() + goalTargetDateMonthOffset, 1);
                            const currentMonth = targetDateObj.getMonth();
                            const currentYear = targetDateObj.getFullYear();
                            
                            const firstDayJS = targetDateObj.getDay();
                            const firstDay = (firstDayJS + 1) % 7; // Shift to Saturday-start
                            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
                            const dayNames = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];
                            
                            return (
                                <div className="mt-4 animate-fadeIn overflow-hidden rounded-2xl border border-indigo-100/50 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                                    <div className="bg-indigo-50/30 px-3 py-2 border-b border-indigo-50/50 flex items-center justify-between">
                                        <button onClick={() => setGoalTargetDateMonthOffset(p => p - 1)} className="p-1 text-indigo-400 hover:bg-indigo-100 rounded-lg transition-colors">
                                            <Icons.ChevronRight size={14} />
                                        </button>
                                        <div className="flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                                            <button 
                                                onClick={() => {
                                                    setGoalTargetDateMonthOffset(0);
                                                    setGoalTargetDate(effectiveTodayStr);
                                                }}
                                                className="w-1.5 h-1.5 rounded-full bg-indigo-300 hover:bg-indigo-500 transition-colors mr-1"
                                                title="العودة لليوم الحالي"
                                            />
                                            <span className="font-black text-indigo-400" style={{ fontFamily: 'Deco, Amiri, serif' }}>{AR_MONTHS[currentMonth]}</span>
                                            <span className="font-normal text-indigo-400" style={{ fontFamily: 'Acme, sans-serif' }}>{currentYear}</span>
                                        </div>
                                        <button onClick={() => setGoalTargetDateMonthOffset(p => p + 1)} className="p-1 text-indigo-400 hover:bg-indigo-100 rounded-lg transition-colors">
                                            <Icons.ChevronLeft size={14} />
                                        </button>
                                    </div>
                                    <div className="px-3 pb-3 pt-1 grid grid-cols-7 gap-x-1.5 gap-y-1.5 justify-items-center">
                                        {dayNames.map((dn) => (
                                            <div key={dn} className="text-center w-9 h-9 flex items-center justify-center text-indigo-300/60 font-bold text-[10px]">
                                                {dn}
                                            </div>
                                        ))}
                                        {Array.from({ length: firstDay }).map((_, i) => (
                                            <div key={`empty-${i}`} className="w-9 h-9" />
                                        ))}
                                        {Array.from({ length: daysInMonth }).map((_, i) => {
                                            const day = i + 1;
                                            const dateStr = toDateStr(currentYear, currentMonth, day);
                                            const isSelected = goalTargetDate === dateStr;
                                            const isTodayInGrid = dateStr === effectiveTodayStr;
                                            
                                            return (
                                                <button
                                                    key={day}
                                                    type="button"
                                                    onClick={() => {
                                                        setGoalTargetDate(dateStr);
                                                        setShowCustomCalendar(false);
                                                    }}
                                                    className={`w-9 h-9 flex items-center justify-center rounded-xl text-[12px] transition-all duration-300 ${
                                                        isSelected
                                                        ? 'bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] z-10' 
                                                        : isTodayInGrid
                                                            ? 'bg-indigo-50/30 text-indigo-600 border border-indigo-100/60'
                                                            : 'bg-white text-gray-400 border border-gray-100 hover:border-indigo-200 hover:text-indigo-500'
                                                    }`}
                                                    style={{ fontFamily: 'Acme, sans-serif' }}
                                                >
                                                    {day}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>


                    {/* Categories Toggle / Selection */}
                    <div className={`space-y-4 transition-all duration-500 pt-6`}>
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2.5">
                                <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100/60 shadow-sm">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
                                </div>
                                <label className="text-[18px] font-black text-gray-800 tracking-tight" style={{ fontFamily: 'Deco, Amiri, serif' }}>التصنيف</label>
                            </div>
                            <button 
                                onClick={() => setShowCategory(!showCategory)}
                                className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all ${showCategory ? 'bg-indigo-50 text-indigo-600 border border-indigo-100/50' : 'bg-gray-50 text-gray-400 border border-transparent hover:bg-gray-100'}`}
                                style={{ fontFamily: 'Deco, Amiri, serif' }}
                            >
                                <Icons.Folder size={12} />
                                {showCategory ? 'إخفاء الخيارات' : 'تحديد تصنيف'}
                            </button>
                        </div>
                        
                        {showCategory && (
                            <div className="space-y-3 animate-fadeIn">
                                <div className="bg-gray-100/60 p-1 rounded-xl flex flex-wrap gap-1">
                                    {(frequency === 'daily' ? existingCategories : existingGroups).filter(c => c !== 'أخرى' && c !== 'عام').map(item => (
                                        <button 
                                            key={item} 
                                            onClick={() => { 
                                                const currentVal = frequency === 'daily' ? category : groupId;
                                                if (!isCreatingNewCategory && currentVal === item) {
                                                    if (frequency === 'daily') setCategory('');
                                                    else setGroupId('');
                                                    setShowCategory(false);
                                                } else {
                                                    if (frequency === 'daily') setCategory(item);
                                                    else setGroupId(item);
                                                    setIsCreatingNewCategory(false);
                                                }
                                            }}
                                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 ${!isCreatingNewCategory && (frequency === 'daily' ? category === item : groupId === item) ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                            style={{ fontFamily: 'Deco, Amiri, serif' }}
                                        >
                                            {item}
                                        </button>
                                    ))}
                                    <button 
                                        onClick={() => setIsCreatingNewCategory(true)}
                                        className={`w-6 h-6 flex items-center justify-center rounded-md transition-all duration-300 ${isCreatingNewCategory ? 'bg-green-500 text-white' : 'text-green-500 hover:bg-green-100/50'}`}
                                    >
                                        <Icons.Plus size={16} strokeWidth={3} />
                                    </button>
                                </div>
                                {isCreatingNewCategory && (
                                    <div className="bg-gray-50 rounded-xl px-5 border border-dashed border-gray-200 mt-2">
                                        <input 
                                            type="text" 
                                            value={newCategoryName} 
                                            onChange={e => setNewCategoryName(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    handleSubmit();
                                                }
                                            }}
                                            placeholder="اسم التصنيف الجديد..."
                                            className="w-full text-sm font-medium bg-transparent py-1.5 outline-none text-gray-800"
                                            style={{ fontFamily: 'Deco, Amiri, serif' }}
                                            autoFocus
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                </div>
            </div>

                {/* Ultra-Premium Actions Footer */}
                <div className="mt-8 -mx-10 -mb-10 px-10 py-6 bg-gray-50/50 border-t border-gray-100/80 flex items-center justify-between rounded-b-2xl">
                    {initialHabit && onDelete ? (
                        <div className="flex items-center bg-white/50 p-1 rounded-2xl border border-gray-200/30 shadow-sm">
                            <button 
                                onClick={() => { onDelete(initialHabit.id); onClose(); }} 
                                className="group flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold text-gray-400 hover:text-red-500 hover:bg-red-50/50 transition-all duration-300"
                                style={{ fontFamily: 'Deco, Amiri, serif' }}
                            >
                                <Icons.Trash size={14} className="opacity-50 group-hover:opacity-100" />
                                <span className="max-w-0 overflow-hidden group-hover:max-w-[100px] transition-all duration-500 whitespace-nowrap">حذف</span>
                            </button>
                             <div className="w-[1px] h-4 bg-gray-200/50 mx-1"></div>
                            
                            {/* Integrated Timer Icon/Input */}
                            <div className="flex items-center gap-1 px-2">
                                <button 
                                    onClick={() => setShowDuration(!showDuration)}
                                    className={`p-1.5 rounded-lg transition-all ${showDuration ? 'text-indigo-600 bg-indigo-50/50' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50/50'}`}
                                >
                                    <Icons.Clock size={14} className={showDuration ? 'animate-pulse' : ''} />
                                </button>
                                 {showDuration && (
                                    <input 
                                        ref={durationRef}
                                        type="text" 
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        lang="en"
                                        value={duration || ''} 
                                        onChange={e => {
                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                            setDuration(parseInt(val) || 0);
                                        }}
                                        autoFocus
                                        onFocus={(e) => e.target.select()}
                                        placeholder="0"
                                        className="w-8 text-center text-[13px] font-black bg-transparent outline-none text-indigo-600 placeholder:text-indigo-300 border-b border-indigo-200/30 focus:border-indigo-400 transition-all tabular-nums"
                                        style={{ fontFamily: 'Acme, sans-serif', direction: 'ltr', unicodeBidi: 'bidi-override' }}
                                    />
                                )}
                            </div>

                            <div className="w-[1px] h-4 bg-gray-200/50 mx-1"></div>
                            <button 
                                onClick={() => setIsFinished(!isFinished)} 
                                className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold transition-all duration-300 ${isFinished ? 'text-green-600' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50/30'}`}
                                style={{ fontFamily: 'Deco, Amiri, serif' }}
                            >
                                <Icons.Check size={14} className={isFinished ? 'animate-bounce' : 'opacity-50 group-hover:opacity-100'} />
                                <span className="whitespace-nowrap">{isFinished ? 'نشطة' : 'إنهاء'}</span>
                            </button>
                        </div>
                    ) : <div />}

                    <div className="flex items-center gap-3">
                        <button 
                            onClick={handleSubmit} 
                            disabled={!title.trim()}
                            className="px-10 py-3 bg-indigo-600/5 border border-indigo-600/20 text-indigo-600 text-sm font-bold rounded-xl hover:bg-indigo-600/10 disabled:opacity-20 transition-all active:scale-95 hover:shadow-lg hover:shadow-indigo-200 shadow-none"
                            style={{ fontFamily: 'Deco, Amiri, serif' }}
                        >
                            حفظ التغييرات
                        </button>
                    </div>
                </div>

                {showLastDayConfirm && (
                    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/5 backdrop-blur-[2px] animate-fadeIn" onClick={(e) => { e.stopPropagation(); setShowLastDayConfirm(false); setShowMonthlyCalendar(false); }}>
                        <div className="w-full max-w-[280px] bg-white p-8 rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.06)] border border-gray-100 text-center animate-pop" onClick={e => e.stopPropagation()}>
                            <p className="text-gray-800 text-[16px] font-black leading-[1.6] mb-8" style={{ fontFamily: 'Deco, Amiri, serif' }}>
                                هل تريد ضبط التذكير بشكل دائم في آخر يوم من كل شهر؟
                            </p>
                            <div className="flex flex-col gap-1">
                                <button 
                                    onClick={() => { setIsLastDayOfMonth(true); setShowLastDayConfirm(false); setShowMonthlyCalendar(false); }}
                                    className="w-full py-3 bg-indigo-600/30 text-indigo-600 rounded-xl font-bold text-[13px] hover:bg-indigo-600/40 active:scale-95 transition-all"
                                    style={{ fontFamily: 'Deco, Amiri, serif' }}
                                >
                                    نعم
                                </button>
                                <button 
                                    onClick={() => { setIsLastDayOfMonth(false); setShowLastDayConfirm(false); setShowMonthlyCalendar(false); }}
                                    className="w-full py-2 text-gray-400 font-bold text-[11px] hover:text-gray-500 active:scale-95 transition-all"
                                    style={{ fontFamily: 'Deco, Amiri, serif' }}
                                >
                                    يوم {toAr(customDays[0])} فقط
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function HabitTimer({ habit, onComplete, onCancel }: { habit: Habit; onComplete: () => void; onCancel: () => void }) {
    const [timeLeft, setTimeLeft] = useState((habit.duration || 1) * 60);
    const [isActive, setIsActive] = useState(true);
    const timerRef = useRef<any>(null);

    useEffect(() => {
        if (isActive && timeLeft > 0) {
            timerRef.current = setInterval(() => {
                setTimeLeft(prev => prev - 1);
            }, 1000);
        } else if (timeLeft === 0) {
            clearInterval(timerRef.current);
            // Notification logic
            if (Notification.permission === 'granted') {
                new Notification('إنجاز: اكتمل الوقت!', { body: `انتهى وقت عادة: ${habit.title}` });
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification('إنجاز: اكتمل الوقت!', { body: `انتهى وقت عادة: ${habit.title}` });
                    }
                });
            }
            onComplete();
        }
        return () => clearInterval(timerRef.current);
    }, [isActive, timeLeft, habit, onComplete]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    };

    return (
        <div className="fixed bottom-6 left-6 z-[300] bg-white/80 backdrop-blur-xl p-4 rounded-3xl shadow-2xl border border-indigo-100 flex items-center gap-4 animate-slideUp">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg animate-pulse">
                <Icons.Clock size={24} />
            </div>
            <div>
                <p 
                    className={`text-xs text-indigo-400 mb-0.5 ${isEnglishText(habit.title) ? 'font-normal' : 'font-bold'}`}
                    style={isEnglishText(habit.title) ? { fontFamily: 'Acme, sans-serif' } : undefined}
                >
                    {habit.title}
                </p>
                <p className="text-xl font-black text-gray-800 tracking-wider tabular-nums" style={{ fontFamily: 'Acme' }}>{formatTime(timeLeft)}</p>
            </div>
            <div className="flex gap-2 mr-2">
                <button onClick={() => setIsActive(!isActive)} className="p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition">
                    {isActive ? <div className="w-4 h-4 border-2 border-indigo-600 rounded-sm bg-indigo-600"></div> : <Icons.ChevronLeft size={16} className="-rotate-90" />}
                </button>
                <button onClick={onCancel} className="p-2 rounded-xl bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-red-400 transition">
                    <Icons.Close size={16} />
                </button>
            </div>
        </div>
    );
}

// ─── Sub-Components ────────────────────────────────────────────────────────
const HabitRow = React.memo(function HabitRow({ 
    habit, columns, todayStr, onToggle, onEdit, onDelete, onStartTimer, 
    isFinishing, isDueToday, className, 
    onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop, isDragOver 
}: any) {
    const progress = getGoalProgress(habit);

    return (
        <tr 
            className={`group transition-all duration-300 hover:bg-indigo-50/10 ${isFinishing ? 'animate-task-fadeout pointer-events-none' : ''} ${isDragOver ? 'bg-indigo-50/60 ring-2 ring-indigo-200/50 scale-[0.99]' : ''} ${className || ''}`}
            draggable
            onDragStart={(e) => onDragStart?.(e, habit.id)}
            onDragOver={(e) => {
                e.preventDefault();
                onDragOver?.(e, habit.id);
            }}
            onDragLeave={() => onDragLeave?.(habit.id)}
            onDragEnd={() => onDragEnd?.()}
            onDrop={(e) => onDrop?.(e, habit.id)}
        >
            {/* Name cell — sticky */}
            <td
                className="p-0 border-none bg-transparent transition-all duration-300 relative"
                style={{ position: 'sticky', right: 0, zIndex: 10 }}
            >
                <div className={`habit-row-anim-wrapper ${className.includes('collapsed') ? 'collapsed' : ''}`}>
                    <div className="habit-row-anim-inner">
                        <div 
                            className={`flex items-center gap-2 px-3.5 py-2 mx-3 my-1.5 rounded-2xl bg-white/85 backdrop-blur-xl border border-white shadow-[0_0_25px_rgba(0,0,0,0.05)] group-hover:shadow-[0_0_0_0.5px_rgba(99,102,241,0.1),0_0_45px_rgba(99,102,241,0.18)] group-hover:border-indigo-400/20 group-hover:translate-x-1 transition-all duration-500 relative overflow-hidden cursor-pointer`}
                            onContextMenu={(e) => { e.preventDefault(); onEdit(habit); }}
                            onClick={() => onEdit(habit)}
                        >
                            {/* Glass Shine Effect */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />
                            
                            {/* Progress Fill - Smooth Animation */}
                            {(progress || habit.isFinished) && (
                                <div 
                                    className="absolute inset-0 pointer-events-none transition-all duration-1000 ease-out opacity-[0.15]"
                                    style={{ 
                                        width: habit.isFinished ? '100%' : `${progress?.percent || 0}%`,
                                        right: 0,
                                        backgroundColor: habit.color || '#6366f1'
                                    }}
                                />
                            )}
                            
                            {/* Floating Progress Percentage */}
                            {progress && (
                                <div className="absolute left-3 bottom-0 pointer-events-none z-20">
                                    <span className="text-[10px] font-normal text-indigo-300/70">
                                        {habit.goal?.type === 'days' ? `${toAr(progress.current)} من ${toAr(progress.total)}` : ''}
                                    </span>
                                </div>
                            )}
                            <div className="flex-1 flex items-center justify-center min-w-0 gap-2">
                                <div className="flex items-center gap-3 min-w-0 justify-center">
                                    <span 
                                        className={`text-[18px] text-gray-700 truncate hover:text-indigo-600 transition-colors leading-[1.7] pb-0.5 ${isEnglishText(habit.title) ? 'font-normal' : 'font-medium'}`}
                                        style={isEnglishText(habit.title) ? { fontFamily: 'Acme, sans-serif' } : undefined}
                                    >
                                        {habit.title}
                                    </span>
                                </div>
                                {habit.duration && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onStartTimer(habit); }}
                                        className={`p-1.5 rounded-lg transition-all text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600`}
                                    >
                                        <Icons.Clock size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </td>

            {/* Day cells */}
            {columns.map((col: any) => {
                const isDue = isHabitDueOnDate(habit, col.dateStr);
                const isToday = col.dateStr === todayStr;

                if (!isDue) {
                    return (
                        <td
                            key={col.dateStr}
                            className={`text-center p-0 border-none transition-all duration-300 ${isToday ? 'bg-indigo-50/20' : ''}`}
                        >
                            <div className={`habit-row-anim-wrapper ${className.includes('collapsed') ? 'collapsed' : ''}`}>
                                <div className="habit-row-anim-inner">
                                    <div className="py-2.5" />
                                </div>
                            </div>
                        </td>
                    );
                }

                const doneCount = (habit.completions || []).filter(d => d === col.dateStr).length;
                const done = doneCount > 0;
                const isMissedInState = (habit.missed || []).includes(col.dateStr);
                
                // For spaced habits, don't show red (missed) if within 7 days unless explicitly marked
                const isSpaced = habit.frequency && habit.frequency !== 'daily';
                let isOldEnough = true;
                if (isSpaced) {
                    const todayDate = new Date(todayStr);
                    const cellDate = new Date(col.dateStr);
                    const diffTime = todayDate.getTime() - cellDate.getTime();
                    const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
                    isOldEnough = diffDays >= 7;
                }

                const missed = isMissedInState || (!done && col.dateStr < todayStr && (!isSpaced || isOldEnough));
                return (
                    <td
                        key={col.dateStr}
                        className={`text-center p-0 border-none transition-all duration-300 ${isToday ? 'bg-indigo-50/20' : ''}`}
                    >
                        <div className={`habit-row-anim-wrapper ${className.includes('collapsed') ? 'collapsed' : ''}`}>
                            <div className="habit-row-anim-inner">
                                <div className={`overflow-hidden py-2.5 opacity-100`}>
                                    <button
                                        onClick={(e) => !col.isFuture && onToggle(habit.id, col.dateStr, 'done', e.shiftKey)}
                                        onContextMenu={(e) => { e.preventDefault(); if (!col.isFuture) onToggle(habit.id, col.dateStr, 'missed'); }}
                                        className="w-full h-full flex items-center justify-center transition-all duration-150 active:scale-90 outline-none"
                                        style={{ cursor: col.isFuture ? 'default' : 'pointer' }}
                                    >
                                        {col.isFuture ? (
                                            <span className="w-4 h-4 rounded-full border border-gray-200 block mx-auto opacity-30" />
                                        ) : (
                                            <span
                                                className={`w-8 h-8 rounded-full border block mx-auto transition-all duration-300 transform ${done ? 'scale-105 shadow-sm' : missed ? 'scale-105 shadow-sm' : 'hover:scale-110 active:scale-95'} flex items-center justify-center relative`}
                                                style={{
                                                    backgroundColor: done ? '#dcfce7' : missed ? '#fef2f2' : 'transparent',
                                                    borderColor: done ? '#4ade80' : missed ? '#fca5a5' : '#e5e7eb',
                                                    opacity: 1,
                                                }}
                                            >
                                                {done && (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M5 13c1.5 1.5 3 4 4 4s7-9 10-10" />
                                                    </svg>
                                                )}
                                                {doneCount >= 2 && (
                                                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-green-500 text-[8px] text-white items-center justify-center font-bold" style={{ fontFamily: 'Acme' }}>
                                                            {toAr(2)}
                                                        </span>
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </td>
                );
            })}
        </tr>
    );
});

// ─── Main View ─────────────────────────────────────────────────────────────
export const HabitsView = React.memo(function HabitsView({ habits, setHabits, separateSpaced, showCompletedSpaced = true, isActive }: HabitsViewProps) {
    const initialDate = getEffectiveDate();
    const [viewYear, setViewYear] = useState(initialDate.getFullYear());
    const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
    const [isAdding, setIsAdding] = useState(false);
    const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
    const [activeTimerHabit, setActiveTimerHabit] = useState<Habit | null>(null);
    
    const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
    const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
    const [showFinishedOnly, setShowFinishedOnly] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [finishingHabitId, setFinishingHabitId] = useState<string | null>(null);
    const [fadingHabitIds, setFadingHabitIds] = useState<Set<string>>(new Set());

    // State for category order
    const [categoryOrder, setCategoryOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('injaz_habit_categories_order');
        return saved ? JSON.parse(saved) : HABIT_CATEGORIES;
    });

    // Collapsed categories for accordion behavior
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('injaz_habit_collapsed_categories');
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });

    // Day transition hour setting
    const [dayTransitionHour, setDayTransitionHour] = useState<number>(() => {
        const saved = localStorage.getItem('injaz_day_transition_hour');
        return saved ? parseInt(saved) : 6;
    });

    // Rename category state
    const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
    const [renameCategoryValue, setRenameCategoryValue] = useState('');
    const [expansionSnapshot, setExpansionSnapshot] = useState<Set<string> | null>(null);
    const [isSpacedGroupOpen, setIsSpacedGroupOpen] = useState(() => {
        return localStorage.getItem('injaz_habit_spaced_section_open') !== 'false'; // default to true
    });
    const [showAllSpaced, setShowAllSpaced] = useState(false);

    useEffect(() => {
        const handleStorage = () => {
            const saved = localStorage.getItem('injaz_day_transition_hour');
            setDayTransitionHour(saved ? parseInt(saved) : 6);
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    useEffect(() => {
        localStorage.setItem('injaz_habit_categories_order', JSON.stringify(categoryOrder));
    }, [categoryOrder]);

    useEffect(() => {
        localStorage.setItem('injaz_habit_collapsed_categories', JSON.stringify(Array.from(collapsedCategories)));
    }, [collapsedCategories]);

    useEffect(() => {
        localStorage.setItem('injaz_habit_spaced_section_open', isSpacedGroupOpen.toString());
    }, [isSpacedGroupOpen]);

    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 2100);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    // Compute "today" based on day-transition hour
    const [todayStr, setTodayStr] = useState(() => {
        const n = getEffectiveDate();
        return toDateStr(n.getFullYear(), n.getMonth(), n.getDate());
    });

    // Auto-update today when date changes or app resumes
    useEffect(() => {
        const updateToday = () => {
            const n = getEffectiveDate();
            const newTodayStr = toDateStr(n.getFullYear(), n.getMonth(), n.getDate());
            setTodayStr(prev => {
                if (prev !== newTodayStr) {
                    console.log('Day transitioned! Updating todayStr to', newTodayStr);
                    return newTodayStr;
                }
                return prev;
            });
        };

        window.addEventListener('focus', updateToday);
        const interval = setInterval(updateToday, 60000); // Check every minute

        return () => {
            window.removeEventListener('focus', updateToday);
            clearInterval(interval);
        };
    }, []);

    const isHabitDueToday = useCallback((habit: Habit) => {
        // We consider a habit pending if its MOST RECENT due date (within 30 days) is untracked.
        const [endY, endM, endD] = todayStr.split('-').map(Number);
        const end = new Date(endY, endM - 1, endD);
        
        const thirtyDaysAgo = new Date(endY, endM - 1, endD);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        let current = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        
        // Go backward from today to 30 days ago to find the most recent due date
        while (current >= thirtyDaysAgo) {
            const ds = toDateStr(current.getFullYear(), current.getMonth(), current.getDate());
            if (isHabitDueOnDate(habit, ds)) {
                const isTracked = habit.completions.includes(ds) || (habit.missed || []).includes(ds);
                return !isTracked;
            }
            current.setDate(current.getDate() - 1);
        }
        return false;
    }, [todayStr]);

    const habitsDueTodayMap = useMemo(() => {
        const map: Record<string, boolean> = {};
        habits.forEach(h => {
            map[h.id] = isHabitDueToday(h);
        });
        return map;
    }, [habits, isHabitDueToday]);
    const columns = useMemo(() => buildMonthColumns(viewYear, viewMonth, todayStr), [viewYear, viewMonth, todayStr]);
    const isCurMonth = useMemo(() => {
        const [y, m] = todayStr.split('-').map(Number);
        return viewYear === y && viewMonth === (m - 1);
    }, [viewYear, viewMonth, todayStr]);
    const goMonth = (d: number) => {
        const next = new Date(viewYear, viewMonth + d, 1);
        setViewYear(next.getFullYear());
        setViewMonth(next.getMonth());
    };

    // Scroll today into view on mount / month change
    const tableRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const todayCell = tableRef.current?.querySelector(`[data-date="${todayStr}"]`);
        if (todayCell) todayCell.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }, [viewMonth, todayStr, habits.length]);

    // Auto-mark ALL past untracked days for ALL habits as missed
    useEffect(() => {
        const n = getEffectiveDate();
        const nowStr = toDateStr(n.getFullYear(), n.getMonth(), n.getDate());

        setHabits(prevHabits => {
            if (!prevHabits || prevHabits.length === 0) return prevHabits;
            
            let changed = false;
            const next = prevHabits.map(h => {
                if (h.isFinished) return h;

                const isSpaced = h.frequency && h.frequency !== 'daily';
                
                // Check last 30 days
                const limitDate = new Date(n);
                limitDate.setDate(n.getDate() - 30);
                const from = limitDate; 

                // For spaced habits, only mark as missed if older than 30 days
                const graceDate = new Date(n);
                if (isSpaced) {
                    graceDate.setDate(n.getDate() - 30);
                }
                const graceStr = toDateStr(graceDate.getFullYear(), graceDate.getMonth(), graceDate.getDate());

                const toAdd: string[] = [];
                const cur = new Date(from);
                cur.setHours(0, 0, 0, 0);

                while (true) {
                    const ds = toDateStr(cur.getFullYear(), cur.getMonth(), cur.getDate());
                    if (ds >= nowStr) break;

                    // If NOT tracked (neither done nor missed), mark as missed 
                    // ONLY if it was due on that day AND (is daily OR is spaced and older than the 30-day grace period)
                    if (ds < graceStr && isHabitDueOnDate(h, ds) && !(h.completions || []).includes(ds) && !(h.missed || []).includes(ds)) {
                        toAdd.push(ds);
                    }
                    
                    cur.setDate(cur.getDate() + 1);
                }

                if (toAdd.length > 0) {
                    changed = true;
                    return { ...h, missed: [...(h.missed || []), ...toAdd] };
                }
                return h;
            });

            return changed ? next : prevHabits;
        });
    }, [todayStr, habits.length, setHabits]);


    const allHabits = useMemo(() => habits.filter(h => showFinishedOnly ? h.isFinished : !h.isFinished), [habits, showFinishedOnly]);
    
    const regularHabits = useMemo(() => {
        if (showFinishedOnly) return allHabits; 
        if (separateSpaced && showAllSpaced) return []; 
        return allHabits.filter(h => !h.frequency || h.frequency === 'daily');
    }, [allHabits, separateSpaced, showAllSpaced, showFinishedOnly]);

    const spacedHabits = useMemo(() => {
        return allHabits.filter(h => h.frequency && h.frequency !== 'daily');
    }, [allHabits]);

    const finishedHabits = useMemo(() => habits.filter(h => h.isFinished), [habits]);

    const spacedHabitsToDisplay = useMemo(() => {
        if (showFinishedOnly) return []; 
        if (showAllSpaced) return spacedHabits; 
        return spacedHabits.filter(h => habitsDueTodayMap[h.id] || fadingHabitIds.has(h.id));
    }, [spacedHabits, showAllSpaced, habitsDueTodayMap, showFinishedOnly, fadingHabitIds]);

    const [draggedHabitId, setDraggedHabitId] = useState<string | null>(null);
    const [dragOverHabitId, setDragOverHabitId] = useState<string | null>(null);
    const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
    const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
    const [spacedGroupOrder, setSpacedGroupOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('injaz_habit_spaced_group_order');
        return saved ? JSON.parse(saved) : [];
    });
    const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
    const [newGroupName, setNewGroupName] = useState('');

    const handleHabitDragStart = (e: React.DragEvent, id: string) => {
        setDraggedHabitId(id);
        e.dataTransfer.setData('habitId', id);
        // Set a drag image or effect if needed
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleHabitDragEnd = () => {
        setDraggedHabitId(null);
        setDragOverHabitId(null);
    };

    const handleGroupDragStart = (e: React.DragEvent, id: string) => {
        setDraggedGroupId(id);
        e.dataTransfer.setData('groupId', id);
    };

    const handleGroupDrop = (e: React.DragEvent, targetGroupId: string) => {
        e.preventDefault();
        const sourceId = draggedGroupId;
        if (!sourceId || sourceId === targetGroupId) {
            setDraggedGroupId(null);
            setDragOverGroupId(null);
            return;
        }

        setSpacedGroupOrder(prev => {
            const currentOrder = prev.length > 0 ? prev : Object.keys(habits.reduce((acc, h) => {
                if (h.groupId) acc[h.groupId] = true;
                return acc;
            }, {} as any));

            const newOrder = [...currentOrder];
            const sourceIndex = newOrder.indexOf(sourceId);
            const targetIndex = newOrder.indexOf(targetGroupId);

            if (sourceIndex > -1 && targetIndex > -1) {
                newOrder.splice(sourceIndex, 1);
                newOrder.splice(targetIndex, 0, sourceId);
            }
            return newOrder;
        });

        setDraggedGroupId(null);
        setDragOverGroupId(null);
    };

    const handleHabitDrop = (e: React.DragEvent, targetHabitId: string) => {
        e.preventDefault();
        setDragOverHabitId(null);
        const sourceId = draggedHabitId || e.dataTransfer.getData('habitId');
        if (!sourceId || sourceId === targetHabitId) {
            setDraggedHabitId(null);
            return;
        }

        setHabits(prev => {
            const sourceHabit = prev.find(h => h.id === sourceId);
            const targetHabit = prev.find(h => h.id === targetHabitId);
            if (!sourceHabit || !targetHabit) return prev;

            const isSourceSpaced = sourceHabit.frequency && sourceHabit.frequency !== 'daily';
            const isTargetSpaced = targetHabit.frequency && targetHabit.frequency !== 'daily';

            if (!isSourceSpaced && !isTargetSpaced) {
                // Regular to Regular: Change category
                return prev.map(h => h.id === sourceId ? { ...h, category: targetHabit.category || 'أخرى' } : h);
            }

            // Spaced habits logic (Groups)
            let newGroupId = targetHabit.groupId;
            if (!newGroupId || newGroupId === 'عام') {
                newGroupId = `group_${generateId()}`;
            }
            
            return prev.map(h => {
                if (h.id === sourceId) return { ...h, groupId: newGroupId };
                if (h.id === targetHabitId && (!targetHabit.groupId || targetHabit.groupId === 'عام')) return { ...h, groupId: newGroupId };
                return h;
            });
        });
        setDraggedHabitId(null);
    };

    const handleMoveHabitToGroup = (habitId: string, groupId: string | undefined) => {
        setHabits(prev => prev.map(h => h.id === habitId ? { ...h, groupId } : h));
    };

    const handleRenameGroup = (oldGroupId: string, newName: string) => {
        if (!newName.trim()) return;
        setHabits(prev => prev.map(h => h.groupId === oldGroupId ? { ...h, groupId: newName.trim() } : h));
        setRenamingGroupId(null);
    };

    const ungroupHabit = (habitId: string) => {
        setHabits(prev => prev.map(h => h.id === habitId ? { ...h, groupId: undefined } : h));
    };

    useEffect(() => {
        localStorage.setItem('injaz_habit_spaced_group_order', JSON.stringify(spacedGroupOrder));
    }, [spacedGroupOrder]);

    const [collapsedSpacedGroups, setCollapsedSpacedGroups] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('injaz_habit_collapsed_spaced_groups');
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });
    const toggleSpacedGroup = (groupId: string) => {
        setCollapsedSpacedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    };
    
    useEffect(() => {
        localStorage.setItem('injaz_habit_collapsed_spaced_groups', JSON.stringify(Array.from(collapsedSpacedGroups)));
    }, [collapsedSpacedGroups]);

    const spacedPendingCount = useMemo(() => {
        return spacedHabitsToDisplay.filter(h => !h.completions.includes(todayStr)).length;
    }, [spacedHabitsToDisplay, todayStr]);

    const uniqueCategories = useMemo(() => Array.from(new Set(habits.map(h => h.category || 'أخرى'))), [habits]);
    const uniqueSpacedGroups = useMemo(() => Array.from(new Set(habits.filter(h => h.frequency && h.frequency !== 'daily').map(h => h.groupId || 'عام'))), [habits]);
    const todayDone = habits.filter(h => h.completions.includes(todayStr)).length;
    const displayedHabits = allHabits;

    // Grouping habits by category
    const habitsByCategory = useMemo(() => {
        return regularHabits.reduce((acc, habit) => {
            const cat = habit.category || 'أخرى';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(habit);
            return acc;
        }, {} as Record<string, Habit[]>);
    }, [regularHabits]);

    const sortedCategories = useMemo(() => {
        const cats = uniqueCategories.filter(cat => regularHabits.some(h => (h.category || 'أخرى') === cat));
        return cats.sort((a, b) => {
            const idxA = categoryOrder.indexOf(a);
            const idxB = categoryOrder.indexOf(b);
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        });
    }, [uniqueCategories, regularHabits, categoryOrder]);

    const toggleExpandAll = useCallback(() => {
        const anyCollapsed = collapsedCategories.size > 0;
        if (anyCollapsed) {
            // Save current state and expand all
            setExpansionSnapshot(new Set(collapsedCategories));
            setCollapsedCategories(new Set());
        } else if (expansionSnapshot) {
            // Restore previous state
            setCollapsedCategories(new Set(expansionSnapshot));
            setExpansionSnapshot(null);
        } else {
            // All were already expanded and no snapshot exists:
            const allCategories = Array.from(new Set(habits.map(h => h.category || 'أخرى')));
            setCollapsedCategories(new Set(allCategories));
            setExpansionSnapshot(new Set()); // Snapshot was "all open"
        }
    }, [collapsedCategories, expansionSnapshot, habits]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            if (!isActive) return;

            // Escape to reset views and close modals - ALWAYS handle this first
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setShowAllSpaced(false);
                setShowFinishedOnly(false);
                setIsAdding(false);
                setEditingHabit(null);
                return;
            }

            // Skip other shortcuts if typing in an input
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

            // 'f' or Arabic 'ب'
            if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key.toLowerCase() === 'f' || e.key === 'ب')) {
                e.preventDefault();
                toggleExpandAll();
            }

            // 'n' or Arabic 'ى' (same physical key as N) or 'ن' (phonetic N)
            if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key.toLowerCase() === 'n' || e.code === 'KeyN' || e.key === 'ى' || e.key === 'ن')) {
                e.preventDefault();
                setIsAdding(true);
            }

            // '1' to toggle spaced habits section
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '1') {
                e.preventDefault();
                setShowAllSpaced(prev => !prev);
            }

            // '2' to toggle spaced group collapse/expand
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '2') {
                e.preventDefault();
                setIsSpacedGroupOpen(prev => !prev);
            }

            // F5 to reset to current month and refresh today
            if (e.key === 'F5') {
                e.preventDefault();
                const now = getEffectiveDate();
                setViewYear(now.getFullYear());
                setViewMonth(now.getMonth());
                setTodayStr(toDateStr(now.getFullYear(), now.getMonth(), now.getDate()));
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (!isActive) return;
            // Mouse button 3 is 'Back', button 4 is 'Forward'
            if (e.button === 3) {
                goMonth(-1);
            } else if (e.button === 4) {
                goMonth(1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [collapsedCategories, expansionSnapshot, habits, viewYear, viewMonth, toggleExpandAll, isActive]);

    const handleToggle = useCallback((habitId: string, dateStr: string, type: 'done' | 'missed' = 'done', isDouble: boolean = false) => {
        let shouldFinish = false;
        let habitTitle = '';

        const habit = habits.find(h => h.id === habitId);
        const wasDueOrPending = habit ? isHabitDueToday(habit) : false;

        setHabits(prev => {
            let updatedList = prev.map(h => {
                if (h.id !== habitId) return h;
                
                const doneList = h.completions || [];
                const missedList = h.missed || [];
                
                let updatedHabit: Habit;
                if (type === 'done') {
                    const doneCount = doneList.filter(d => d === dateStr).length;
                    let newCompletions;
                    
                    if (isDouble) {
                        if (doneCount >= 2) {
                            newCompletions = doneList.filter(d => d !== dateStr);
                        } else {
                            newCompletions = [...doneList.filter(d => d !== dateStr), dateStr, dateStr];
                        }
                    } else {
                        if (doneCount > 0) {
                            newCompletions = doneList.filter(d => d !== dateStr);
                        } else {
                            newCompletions = [...doneList, dateStr];
                        }
                    }

                    updatedHabit = {
                        ...h,
                        completions: newCompletions,
                        missed: missedList.filter(d => d !== dateStr)
                    };
                } else {
                    const isMissed = missedList.includes(dateStr);
                    updatedHabit = {
                        ...h,
                        missed: isMissed ? missedList.filter(d => d !== dateStr) : [...missedList, dateStr],
                        completions: doneList.filter(d => d !== dateStr)
                    };
                }

                // Auto-finish logic: if progress reaches 100%, mark as finished
                const progress = getGoalProgress(updatedHabit);
                if (progress && progress.percent >= 100 && !h.isFinished) {
                    shouldFinish = true;
                    habitTitle = updatedHabit.title;
                } else if (progress && progress.percent < 100 && updatedHabit.isFinished) {
                    updatedHabit.isFinished = false;
                }

                return updatedHabit;
            });

            const newHabit = updatedList.find(h => h.id === habitId);
            const isSpaced = newHabit && newHabit.frequency && newHabit.frequency !== 'daily';
            if (wasDueOrPending && newHabit && !isHabitDueToday(newHabit) && isSpaced) {
                setFadingHabitIds(prev => new Set(prev).add(habitId));
                setTimeout(() => {
                    setFadingHabitIds(prev => {
                        const next = new Set(prev);
                        next.delete(habitId);
                        return next;
                    });
                }, 1000);
            }

            return updatedList;
        });

        if (shouldFinish) {
            setFinishingHabitId(habitId);
            setSuccessMessage(habitTitle);
            setTimeout(() => {
                setHabits(current => current.map(ch => 
                    ch.id === habitId ? { ...ch, isFinished: true } : ch
                ));
                setFinishingHabitId(null);
            }, 800);
        }
    }, [habits, isHabitDueToday, setHabits, todayStr]);
    const handleDelete = useCallback((habitId: string) => setHabits(prev => prev.filter(h => h.id !== habitId)), [setHabits]);
    
    const handleSaveHabit = useCallback((updatedData: Partial<Habit>) => {
        setHabits(prev => {
            if (editingHabit) {
                return prev.map(h => h.id === editingHabit.id ? { ...h, ...updatedData } : h);
            } else {
                return [...prev, {
                    id: generateId(),
                    color: HABIT_COLORS[0],
                    icon: 'Flame',
                    completions: [],
                    createdAt: Date.now(),
                    ...updatedData
                } as Habit];
            }
        });
        setIsAdding(false);
        setEditingHabit(null);
    }, [editingHabit, setHabits]);

    
    // Ensure new categories are added to the order and empty ones are removed
    useEffect(() => {
        setCategoryOrder(prev => {
            const newOrder = prev.filter(c => uniqueCategories.includes(c));
            const missing = uniqueCategories.filter(c => !newOrder.includes(c));
            
            if (newOrder.length !== prev.length || missing.length > 0) {
                const combined = [...newOrder, ...missing];
                if (combined.includes('أخرى')) {
                    const withoutOther = combined.filter(c => c !== 'أخرى');
                    return [...withoutOther, 'أخرى'];
                }
                return combined;
            }
            return prev;
        });
    }, [uniqueCategories]);

    const moveCategory = (cat: string, direction: -1 | 1) => {
        setCategoryOrder(prev => {
            const idx = prev.indexOf(cat);
            if (idx === -1) return prev;
            const newIdx = idx + direction;
            if (newIdx < 0 || newIdx >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
            return next;
        });
    };

    const handleCategoryDragStart = (e: React.DragEvent, category: string) => {
        setDraggedCategory(category);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', category);
    };

    const handleCategoryDragOver = (e: React.DragEvent, category: string) => {
        e.preventDefault();
        if (category === draggedCategory) {
            setDragOverCategory(null);
            return;
        }

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const pos = e.clientY < midY ? 'top' : 'bottom';
        setDragOverCategory(`${category}|${pos}`);
    };

    const handleCategoryDrop = (e: React.DragEvent, targetCategory: string) => {
        e.preventDefault();
        const habitId = draggedHabitId || e.dataTransfer.getData('habitId');
        if (habitId) {
            setHabits(prev => prev.map(h => h.id === habitId ? { ...h, category: targetCategory } : h));
            setDraggedHabitId(null);
            setDragOverCategory(null);
            return;
        }

        const sourceCategory = draggedCategory || e.dataTransfer.getData('text/plain');
        
        if (sourceCategory && sourceCategory !== targetCategory && dragOverCategory) {
            const pos = dragOverCategory.split('|')[1];
            setCategoryOrder(prev => {
                const newOrder = [...prev];
                const sourceIdx = newOrder.indexOf(sourceCategory);
                const rawTargetIdx = newOrder.indexOf(targetCategory);
                
                if (sourceIdx !== -1 && rawTargetIdx !== -1) {
                    newOrder.splice(sourceIdx, 1);
                    // Adjust target index if source came before it
                    const adjustedTargetIdx = sourceIdx < rawTargetIdx ? rawTargetIdx - 1 : rawTargetIdx;
                    const finalIdx = pos === 'bottom' ? adjustedTargetIdx + 1 : adjustedTargetIdx;
                    newOrder.splice(finalIdx, 0, sourceCategory);
                }
                return newOrder;
            });
        }
        
        setDraggedCategory(null);
        setDragOverCategory(null);
    };

    const handleCategoryDragEnd = () => {
        setDraggedCategory(null);
        setDragOverCategory(null);
    };

    // ── Empty states ──────────────────────────────────────────────
    if (habits.length === 0) return (
        <div dir="rtl" className="flex flex-col items-center justify-center py-32 text-center" style={{ fontFamily: '"DecoType Naskh", Amiri, serif' }}>
            <div className="w-20 h-20 rounded-full bg-orange-50 flex items-center justify-center mb-4">
                <Icons.Sparkles size={40} className="text-orange-300" />
            </div>
            <h3 className="text-2xl font-bold text-gray-600 mb-2">لا توجد عادات بعد</h3>
            <p className="text-gray-400 text-base mb-6 max-w-xs">أضف أول عادة يومية وابدأ رحلتك نحو حياة أفضل</p>
            <button onClick={() => setIsAdding(true)}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-bold transition active:scale-95 shadow-lg shadow-orange-200">
                <Icons.Plus size={18} /> أضف أول عادة
            </button>
            {(isAdding || editingHabit) && createPortal(
                <HabitEditModal 
                    initialHabit={editingHabit || undefined} 
                    onSave={handleSaveHabit} 
                    onDelete={handleDelete}
                    onClose={() => { setIsAdding(false); setEditingHabit(null); }} 
                    existingCategories={uniqueCategories} 
                    existingGroups={uniqueSpacedGroups} 
                />,
                document.body
            )}
        </div>
    );

    // If we have habits but the current filtered list is empty
    const isEmptyFiltered = displayedHabits.length === 0;

    return (
        <div dir="rtl" className={`flex flex-col flex-1 bg-gray-50/20 ${isActive ? 'animate-view-entry' : ''}`} style={{ fontFamily: '"DecoType Naskh", Amiri, serif' }}>

            {/* ── Top bar ── */}
            <div className="flex items-center justify-between py-3 px-4 border-b border-gray-100 flex-shrink-0 bg-white">
                {/* Month navigator */}
                <div className="flex items-center gap-3">
                    <button onClick={() => goMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-700">
                        <Icons.ChevronRight size={18} />
                    </button>
                    <h2 className="text-xl font-bold text-gray-800 min-w-[130px] text-center">
                        {AR_MONTHS[viewMonth]} {toAr(viewYear)}
                    </h2>
                    <button onClick={() => goMonth(1)} disabled={isCurMonth}
                        className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed">
                        <Icons.ChevronLeft size={18} />
                    </button>
                </div>

                {/* Right side */}
                <div className="flex items-center gap-3">
                    {isCurMonth && habits.length > 0 && (
                        <span className="text-sm text-gray-500">
                            <span className="font-bold text-indigo-600">{toAr(todayDone)}</span>/{toAr(habits.length)} اليوم
                        </span>
                    )}
                    <button onClick={() => setIsAdding(true)}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-md shadow-indigo-200 transition active:scale-95">
                        <Icons.Plus size={16} /> عادة جديدة
                    </button>
                </div>
            </div>

            {/* Finished Toggle Label */}
            {showFinishedOnly && (
                <div className="bg-amber-50 px-4 py-2 text-center border-b border-amber-100">
                    <span className="text-amber-800 font-bold text-sm">أنت تشاهد العادات المنتهية</span>
                </div>
            )}

            {/* ── Workspace ── */}
            <div className="flex-1 p-8 pb-0 bg-gray-50/20">
                {/* ── Premium Card Container ── */}
                <div ref={tableRef} className="h-full w-full bg-white rounded-[2.5rem] shadow-[0_0_80px_12px_rgba(0,0,0,0.05)] border border-gray-200/40 overflow-auto scrollbar-hide pb-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    <style>{`
                        .scrollbar-hide::-webkit-scrollbar {
                            display: none;
                        }
                        @keyframes habitViewEntrance {
                            0% { opacity: 0; filter: blur(40px); transform: scale(0.99); }
                            15% { opacity: 0.2; filter: blur(30px); }
                            100% { opacity: 1; filter: blur(0); transform: scale(1); }
                        }
                        .animate-view-entry {
                            animation: habitViewEntrance 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                            will-change: opacity, filter, transform;
                        }
                        .habit-row-anim-wrapper {
                            display: grid;
                            grid-template-rows: 1fr;
                            transition: grid-template-rows 0.4s cubic-bezier(0.16, 1, 0.3, 1), 
                                        opacity 0.3s ease, 
                                        transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                            opacity: 1;
                            transform: scale(1) translateY(0);
                            will-change: grid-template-rows, opacity, transform;
                            backface-visibility: hidden;
                        }
                        .habit-row-anim-wrapper.collapsed {
                            grid-template-rows: 0fr;
                            opacity: 0;
                            transform: scale(0.98) translateY(-5px);
                            pointer-events: none;
                        }
                        .habit-row-anim-inner {
                            overflow: hidden;
                        }
                    `}</style>
                    {isEmptyFiltered ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                            {showFinishedOnly ? <Icons.Check size={32} className="text-gray-300" /> : <Icons.Sparkles size={32} className="text-gray-300" />}
                        </div>
                        <p className="text-gray-400 font-bold">
                            {showFinishedOnly ? 'لا توجد عادات منتهية حالياً' : 'أحسنت! لقد أنهيت جميع عاداتك'}
                        </p>
                    </div>
                ) : (
                    <table className="border-collapse" style={{ width: '100%', tableLayout: 'fixed' }}>
                    <colgroup>
                        {/* Habit name column — narrowed */}
                        <col style={{ width: '200px', minWidth: '200px' }} />
                        {/* One column per day — equal width */}
                        {columns.map(col => (
                            <col key={col.dateStr} style={{ width: '54px', minWidth: '54px' }} />
                        ))}
                    </colgroup>

                    <thead style={{ position: 'sticky', top: 0, zIndex: 20 }}>
                        <tr>
                            {/* Habit header */}
                            <th
                                className="text-center text-lg font-medium text-gray-800 px-4 py-3 border-b-2 border-gray-200 bg-gray-50"
                                style={{ position: 'sticky', right: 0, zIndex: 30, backgroundColor: '#f9fafb' }}
                            >
                                العادة
                            </th>

                            {/* Day headers: day 1 appears first (rightmost in RTL) */}
                            {columns.map(col => {
                                const isToday = col.dateStr === todayStr;
                                const isThisMonth = isCurMonth;
                                return (
                                    <th
                                        key={col.dateStr}
                                        data-date={col.dateStr}
                                        className="text-center border-b-2 border-gray-200 px-0"
                                        style={{
                                            backgroundColor: isToday ? '#f0f4ff' : '#f9fafb',
                                            minWidth: '54px',
                                            paddingTop: '18px',
                                            paddingBottom: '10px',
                                        }}
                                    >
                                        <div className={`text-[20px] font-medium leading-tight whitespace-nowrap ${isToday ? 'text-indigo-600' : 'text-gray-700'}`}>
                                            {col.dayName}
                                        </div>
                                        <div className={`text-[15px] font-medium leading-tight mt-4 ${isToday ? 'text-indigo-400' : col.isFuture ? 'text-gray-300' : 'text-gray-400'}`}>
                                            {toAr(col.day)}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {sortedCategories.map((category, catIdx, arr) => (
                            <React.Fragment key={category}>
                                {/* Category Header */}
                                <tr className="group/cat"
                                    onClick={() => setCollapsedCategories(prev => {
                                        const next = new Set(prev);
                                        if (next.has(category)) next.delete(category); else next.add(category);
                                        return next;
                                    })}
                                    draggable
                                    onDragStart={(e) => handleCategoryDragStart(e, category)}
                                    onDragOver={(e) => handleCategoryDragOver(e, category)}
                                    onDragLeave={() => setDragOverCategory(null)}
                                    onDrop={(e) => handleCategoryDrop(e, category)}
                                    onDragEnd={handleCategoryDragEnd}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setRenamingCategory(category);
                                        setRenameCategoryValue(category);
                                    }}
                                    style={{
                                        opacity: draggedCategory === category ? 0.5 : 1,
                                        borderTop: dragOverCategory === `${category}|top` ? '2px solid #f59e0b' : undefined,
                                        borderBottom: dragOverCategory === `${category}|bottom` ? '2px solid #f59e0b' : undefined,
                                        cursor: 'pointer'
                                    }}
                                >
                                    <td colSpan={columns.length + 1}
                                        className="px-3 py-2 border-y border-amber-100/60 sticky right-0 z-10 text-right transition-all duration-300"
                                        style={{
                                            backgroundColor: dragOverCategory?.startsWith(category) ? '#fef3c7' : '#fffdf0',
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={`transition-transform duration-300 text-amber-400 ${collapsedCategories.has(category) ? '-rotate-90' : 'rotate-0'}`}>
                                                    <Icons.ChevronDown size={14} />
                                                </span>
                                                {renamingCategory === category ? (
                                                    <div className="relative flex items-center justify-center animate-fadeIn">
                                                        <input
                                                            autoFocus
                                                            className="text-[17px] font-medium text-amber-700/80 bg-white/90 backdrop-blur-md border border-amber-200/50 rounded-full px-4 py-1 outline-none text-center shadow-[0_4px_15px_rgba(245,158,11,0.1)] focus:shadow-[0_4px_20px_rgba(245,158,11,0.15)] focus:border-amber-400/50 transition-all min-w-[140px]"
                                                            value={renameCategoryValue}
                                                            onChange={e => setRenameCategoryValue(e.target.value)}
                                                            onClick={e => e.stopPropagation()}
                                                            onBlur={() => {
                                                                if (renameCategoryValue.trim() && renameCategoryValue !== category) {
                                                                    setHabits(prev => prev.map(h =>
                                                                        h.category === category ? { ...h, category: renameCategoryValue.trim() } : h
                                                                    ));
                                                                    setCategoryOrder(prev => prev.map(c => c === category ? renameCategoryValue.trim() : c));
                                                                }
                                                                setRenamingCategory(null);
                                                            }}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                                                if (e.key === 'Escape') setRenamingCategory(null);
                                                            }}
                                                            style={{ fontFamily: 'Deco, Amiri, serif' }}
                                                        />
                                                        <div className="absolute -inset-0.5 bg-amber-500/10 blur-sm rounded-full -z-10 animate-pulse"></div>
                                                    </div>
                                                ) : (
                                                    <span className="text-[17px] font-medium text-amber-700/80">{category}</span>
                                                )}
                                            </div>

                                            {/* Reorder Buttons */}
                                            <div className="flex items-center gap-1 opacity-0 group-hover/cat:opacity-100 transition-opacity">
                                                <button
                                                    onClick={e => { e.stopPropagation(); moveCategory(category, -1); }}
                                                    disabled={catIdx === 0}
                                                    className="p-1 rounded bg-white border border-amber-100 text-amber-600 hover:bg-amber-50 shadow-sm disabled:opacity-30 transition"
                                                >
                                                    <Icons.ChevronRight size={12} className="rotate-90" />
                                                </button>
                                                <button
                                                    onClick={e => { e.stopPropagation(); moveCategory(category, 1); }}
                                                    disabled={catIdx === arr.length - 1}
                                                    className="p-1 rounded bg-white border border-amber-100 text-amber-600 hover:bg-amber-50 shadow-sm disabled:opacity-30 transition"
                                                >
                                                    <Icons.ChevronRight size={12} className="-rotate-90" />
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>

                                {/* Category Habits */}
                                {(habitsByCategory[category] || []).map((habit) => (
                                    <HabitRow 
                                        key={habit.id}
                                        habit={habit}
                                        columns={columns}
                                        todayStr={todayStr}
                                        onToggle={handleToggle}
                                        onEdit={setEditingHabit}
                                        onDelete={handleDelete}
                                        onStartTimer={setActiveTimerHabit}
                                        isFinishing={finishingHabitId === habit.id || fadingHabitIds.has(habit.id)}
                                        isDueToday={habitsDueTodayMap[habit.id]}
                                        className={`${collapsedCategories.has(category) ? 'collapsed' : ''} ${finishingHabitId === habit.id || fadingHabitIds.has(habit.id) ? 'finishing' : ''}`}
                                        onDragStart={handleHabitDragStart}
                                        onDragOver={(e: any, id: any) => setDragOverHabitId(id)}
                                        onDragLeave={() => setDragOverHabitId(null)}
                                        onDrop={handleHabitDrop}
                                        onDragEnd={handleHabitDragEnd}
                                        isDragOver={dragOverHabitId === habit.id}
                                    />
                                ))}
                            </React.Fragment>
                        ))}

                        {/* Spaced Habits Group */}
                        {spacedHabitsToDisplay.length > 0 && (
                            <React.Fragment>
                                <tr className="group/cat cursor-pointer"
                                    onClick={() => setIsSpacedGroupOpen(!isSpacedGroupOpen)}
                                >
                                    <td colSpan={columns.length + 1}
                                        className="px-3 py-2 border-y border-indigo-100/60 sticky right-0 z-10 text-right transition-all duration-300 bg-indigo-50/40"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={`transition-transform duration-300 text-indigo-400 ${!isSpacedGroupOpen ? '-rotate-90' : 'rotate-0'}`}>
                                                    <Icons.ChevronDown size={14} />
                                                </span>
                                                <span className="text-[17px] font-medium text-indigo-900/80">عادات متباعدة</span>
                                                {spacedPendingCount > 0 && (
                                                    <span className="text-[10px] font-bold text-indigo-300 bg-indigo-50 px-1.5 py-0.5 rounded-full mr-1">
                                                        {toAr(spacedPendingCount)}
                                                    </span>
                                                )}

                                            </div>
                                        </div>
                                    </td>
                                </tr>

                                {(() => {
                                    const grouped: Record<string, Habit[]> = {};
                                    
                                    spacedHabitsToDisplay.forEach(h => {
                                        const gid = h.groupId || 'عام';
                                        if (!grouped[gid]) grouped[gid] = [];
                                        grouped[gid].push(h);
                                    });

                                    return (
                                        <React.Fragment>
                                            {/* Groups */}
                                            {(() => {
                                                const groupEntries = Object.entries(grouped);
                                                // Sort entries based on spacedGroupOrder
                                                groupEntries.sort(([idA], [idB]) => {
                                                    const idxA = spacedGroupOrder.indexOf(idA);
                                                    const idxB = spacedGroupOrder.indexOf(idB);
                                                    if (idxA === -1 && idxB === -1) return 0;
                                                    if (idxA === -1) return 1;
                                                    if (idxB === -1) return -1;
                                                    return idxA - idxB;
                                                });

                                                return groupEntries.map(([groupId, habits]) => {
                                                    const isCollapsed = collapsedSpacedGroups.has(groupId);
                                                    const isGroupDraggingOver = dragOverGroupId === groupId;
                                                    const isGroupDragged = draggedGroupId === groupId;

                                                    return (
                                                        <React.Fragment key={groupId}>
                                                            <tr 
                                                                className={`transition-all duration-300 ${!isSpacedGroupOpen ? 'hidden opacity-0' : 'opacity-100'} ${isGroupDraggingOver ? 'bg-indigo-50/30' : ''} ${isGroupDragged ? 'opacity-30' : ''}`}
                                                                draggable
                                                                onDragStart={(e) => handleGroupDragStart(e, groupId)}
                                                                onDragOver={(e) => {
                                                                    if (draggedGroupId) {
                                                                        e.preventDefault();
                                                                        setDragOverGroupId(groupId);
                                                                    }
                                                                }}
                                                                onDragLeave={() => setDragOverGroupId(null)}
                                                                onDragEnd={() => { setDraggedGroupId(null); setDragOverGroupId(null); }}
                                                                onDrop={(e) => {
                                                                    if (draggedGroupId) {
                                                                        handleGroupDrop(e, groupId);
                                                                    }
                                                                }}
                                                            >
                                                                <td colSpan={columns.length + 1} className="px-4 pt-6 pb-2 cursor-pointer group/divider"
                                                                    onClick={() => toggleSpacedGroup(groupId)}
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="h-[1px] flex-1 bg-gradient-to-l from-indigo-100/50 to-transparent group-hover/divider:from-indigo-300 transition-all"></div>
                                                                        {renamingGroupId === groupId ? (
                                                                            <div className="relative flex items-center justify-center animate-fadeIn">
                                                                                <input
                                                                                    autoFocus
                                                                                    className="text-[12px] font-bold text-indigo-600 bg-white/90 backdrop-blur-md border border-indigo-200/50 rounded-full px-4 py-1 outline-none text-center shadow-[0_4px_15px_rgba(99,102,241,0.1)] focus:shadow-[0_4px_20px_rgba(99,102,241,0.15)] focus:border-indigo-400/50 transition-all min-w-[120px]"
                                                                                    value={newGroupName}
                                                                                    onChange={e => setNewGroupName(e.target.value)}
                                                                                    onBlur={() => handleRenameGroup(groupId, newGroupName)}
                                                                                    onKeyDown={e => {
                                                                                        if (e.key === 'Enter') handleRenameGroup(groupId, newGroupName);
                                                                                        if (e.key === 'Escape') setRenamingGroupId(null);
                                                                                        e.stopPropagation();
                                                                                    }}
                                                                                    onClick={e => e.stopPropagation()}
                                                                                    style={{ fontFamily: 'Deco, Amiri, serif' }}
                                                                                />
                                                                                <div className="absolute -inset-0.5 bg-indigo-500/10 blur-sm rounded-full -z-10 animate-pulse"></div>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="flex items-center gap-2">
                                                                                <span 
                                                                                    className={`text-[11px] font-black uppercase tracking-widest transition-colors ${isCollapsed ? 'text-indigo-300/40' : 'text-indigo-300/60 group-hover/divider:text-indigo-400'}`}
                                                                                    style={{ fontFamily: 'Deco, Amiri, serif' }}
                                                                                    onContextMenu={(e) => { 
                                                                                        e.preventDefault();
                                                                                        e.stopPropagation(); 
                                                                                        setRenamingGroupId(groupId); 
                                                                                        setNewGroupName(groupId.startsWith('group_') ? '' : groupId); 
                                                                                    }}
                                                                                >
                                                                                    {groupId.startsWith('group_') ? 'مجموعة جديدة' : groupId}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                        <div className="h-[1px] flex-1 bg-gradient-to-r from-indigo-100/50 to-transparent group-hover/divider:from-indigo-300 transition-all"></div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                            {habits.map(habit => (
                                                                <HabitRow 
                                                                    key={habit.id}
                                                                    habit={habit}
                                                                    columns={columns}
                                                                    todayStr={todayStr}
                                                                    onToggle={handleToggle}
                                                                    onEdit={setEditingHabit}
                                                                    onDelete={handleDelete}
                                                                    onStartTimer={setActiveTimerHabit}
                                                                    isFinishing={finishingHabitId === habit.id || fadingHabitIds.has(habit.id)}
                                                                    isDueToday={habitsDueTodayMap[habit.id]}
                                                                    className={`${!isSpacedGroupOpen || isCollapsed ? 'collapsed' : ''} ${finishingHabitId === habit.id || fadingHabitIds.has(habit.id) ? 'finishing' : ''} ${isGroupDraggingOver ? 'bg-indigo-50/20' : ''}`}
                                                                    onDragStart={handleHabitDragStart}
                                                                    onDragOver={(e, id) => {
                                                                        if (draggedGroupId) {
                                                                            e.preventDefault();
                                                                            setDragOverGroupId(groupId);
                                                                        } else {
                                                                            setDragOverHabitId(id);
                                                                        }
                                                                    }}
                                                                    onDragLeave={() => {
                                                                        if (draggedGroupId) {
                                                                            setDragOverGroupId(null);
                                                                        } else {
                                                                            setDragOverHabitId(null);
                                                                        }
                                                                    }}
                                                                    onDragEnd={handleHabitDragEnd}
                                                                    onDrop={(e, id) => {
                                                                        if (draggedGroupId) {
                                                                            handleGroupDrop(e, groupId);
                                                                        } else {
                                                                            handleHabitDrop(e, id);
                                                                        }
                                                                    }}
                                                                    isDragOver={draggedGroupId ? false : dragOverHabitId === habit.id}
                                                                />
                                                            ))}
                                                        </React.Fragment>
                                                    );
                                                });
                                            })()}


                                            {/* Drop Zone to move to General */}
                                            {draggedHabitId && (
                                                <tr 
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        setDragOverHabitId('general_drop_zone');
                                                    }}
                                                    onDragLeave={() => setDragOverHabitId(null)}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        setDragOverHabitId(null);
                                                        if (draggedHabitId) {
                                                            setHabits(prev => prev.map(h => h.id === draggedHabitId ? { ...h, groupId: 'عام' } : h));
                                                            setDraggedHabitId(null);
                                                        }
                                                    }}
                                                    className={`transition-all duration-300 ${!isSpacedGroupOpen ? 'hidden opacity-0' : 'opacity-100'}`}
                                                >
                                                    <td colSpan={columns.length + 1} className="px-4 py-8">
                                                        <div className={`flex items-center justify-center gap-3 py-4 border-2 border-dashed rounded-3xl transition-all duration-500 ${dragOverHabitId === 'general_drop_zone' ? 'bg-indigo-50/50 border-indigo-300 scale-[0.98]' : 'border-gray-100/50 opacity-40'}`}>
                                                            <Icons.Plus size={20} className={dragOverHabitId === 'general_drop_zone' ? 'text-indigo-400' : 'text-gray-300'} />
                                                            <span className={`text-[13px] font-bold ${dragOverHabitId === 'general_drop_zone' ? 'text-indigo-400' : 'text-gray-300'}`} style={{ fontFamily: 'Deco, Amiri, serif' }}>
                                                                إسقاط هنا للنقل إلى المجموعات العامة
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })()}
                            </React.Fragment>
                        )}

                    </tbody>
                </table>
                )}
                </div>
            </div>

            {/* Add Modal */}
            {(isAdding || editingHabit) && createPortal(
                <HabitEditModal 
                    initialHabit={editingHabit || undefined} 
                    onSave={handleSaveHabit} 
                    onDelete={handleDelete}
                    onClose={() => { setIsAdding(false); setEditingHabit(null); }} 
                    existingCategories={uniqueCategories} 
                    existingGroups={uniqueSpacedGroups} 
                />,
                document.body
            )}
            {activeTimerHabit && (
                <HabitTimer 
                    habit={activeTimerHabit} 
                    onComplete={() => {
                        handleToggle(activeTimerHabit.id, todayStr, 'done');
                        setActiveTimerHabit(null);
                    }}
                    onCancel={() => setActiveTimerHabit(null)}
                />
            )}

            {/* Action Buttons */}
            <div className="fixed bottom-6 right-6 z-[150] flex items-center gap-3">
                {/* Finished Habits Toggle */}
                <button 
                    onClick={() => {
                        setShowFinishedOnly(!showFinishedOnly);
                        if (!showFinishedOnly) setShowAllSpaced(false); // Reset other view
                    }}
                    className={`flex items-center gap-2 px-5 py-3 rounded-2xl shadow-2xl transition-all active:scale-95 border outline-none ${showFinishedOnly ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-white text-gray-600 border-gray-100 hover:bg-gray-50'}`}
                    style={{ fontFamily: '"DecoType Naskh", Amiri, serif' }}
                >
                    <Icons.Check size={18} />
                    <span className="font-bold text-sm">{showFinishedOnly ? 'العودة للنشطة' : 'منتهي'}</span>
                    {!showFinishedOnly && finishedHabits.length > 0 && (
                        <span className="bg-indigo-50 text-indigo-300 text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold px-1 border border-indigo-100/50">
                            {toAr(finishedHabits.length)}
                        </span>
                    )}
                </button>

                {/* Spaced Habits Toggle */}
                <button 
                    onClick={() => {
                        setShowAllSpaced(!showAllSpaced);
                        if (!showAllSpaced) setShowFinishedOnly(false); // Reset other view
                    }}
                    className={`flex items-center gap-2 px-5 py-3 rounded-2xl shadow-2xl transition-all active:scale-95 border outline-none ${showAllSpaced ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-white text-gray-600 border-gray-100 hover:bg-gray-50'}`}
                    style={{ fontFamily: '"DecoType Naskh", Amiri, serif' }}
                >
                    <Icons.Clock size={18} />
                    <span className="font-bold text-sm">عادات متباعدة</span>
                    {!showAllSpaced && spacedPendingCount > 0 && (
                        <span className="bg-indigo-50 text-indigo-300 text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold px-1 border border-indigo-100/50">
                            {toAr(spacedPendingCount)}
                        </span>
                    )}
                </button>
            </div>

            {/* Success Celebration Message */}
            {successMessage && (
                <div className="fixed inset-0 z-[600] flex items-center justify-center pointer-events-none">
                    <div className="bg-white/80 backdrop-blur-2xl border border-indigo-100/50 px-12 py-10 rounded-[3rem] shadow-[0_30px_70px_rgba(79,70,229,0.18)] flex flex-col items-center gap-2 animate-success-pop select-none">
                        <div className="text-center">
                            <p className="text-[11px] font-bold text-indigo-400 uppercase tracking-[0.4em] mb-2">إنجاز رائع</p>
                            <h3 className="text-3xl font-black text-gray-800 tracking-tight">{successMessage}</h3>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
