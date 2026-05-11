import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Task, Priority, ViewMode, Breadcrumb, TaskList, Habit } from './types';
import { Icons } from './components/Icons';
import { TaskModal } from './components/TaskModal';
import { CalendarView } from './components/CalendarView';
import { HabitsView } from './components/HabitsView';

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

interface AppPreferences {
    zoom: number;
    arFont: string;
    enFont: string;
    customFontName?: string;
    customFontUrl?: string;
    autoCollapse?: boolean;
    focusBlur?: boolean;
    startupGroupBehavior?: 'lastOpened' | 'collapseAll' | 'uncategorized';
    separateSpacedHabits?: boolean;
    multiExpandSubtasks?: boolean;
    showCompletedSpacedInMain?: boolean;
    completionAnimation?: boolean;
}

export default function App() {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updateDownloaded, setUpdateDownloaded] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle');
    const [updateErrorMsg, setUpdateErrorMsg] = useState('');

    const handleBellClick = () => {
        const ipc = (window as any).require?.('electron')?.ipcRenderer;
        
        if (updateAvailable && updateStatus !== 'downloaded' && updateStatus !== 'downloading') {
            if (confirm('هل تود تنزيل التحديث الجديد؟')) {
                setUpdateStatus('downloading');
                ipc?.send('download_update');
            }
        } else if (updateDownloaded || updateStatus === 'downloaded') {
            if (confirm('تم تحميل التحديث بنجاح! هل تريد إعادة التشغيل للتثبيت الآن؟')) {
                ipc?.send('quit-and-install');
            }
        } else if (updateStatus === 'downloading') {
            alert('جاري تحميل التحديث بالفعل في الخلفية...');
        } else if (updateStatus === 'error') {
            alert('حدث خطأ أثناء التحديث: ' + updateErrorMsg);
        } else if (updateStatus === 'checking') {
            alert('جاري البحث عن تحديثات...');
        } else {
            alert('أنت على أحدث إصدار بالفعل!');
        }
    };

    // --- PREFERENCES STATE ---
    const [preferences, setPreferences] = useState<AppPreferences>(() => {
        const saved = localStorage.getItem('injaz_preferences');
        return saved ? JSON.parse(saved) : {
            zoom: 1.4,
            arFont: 'Tajawal',
            enFont: 'Acme',
            customFontName: '',
            customFontUrl: '',
            autoCollapse: false,
            focusBlur: true,
            startupGroupBehavior: 'lastOpened',
            separateSpacedHabits: localStorage.getItem('injaz_separate_spaced') === 'true',
            multiExpandSubtasks: true,
            showCompletedSpacedInMain: localStorage.getItem('injaz_show_completed_spaced') !== 'false', // default to true
            completionAnimation: localStorage.getItem('injaz_completion_animation') !== 'false' // default to true
        };
    });

    // --- SETTINGS STATE ---
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isReordering, setIsReordering] = useState(false);
    const [folderActionPromptId, setFolderActionPromptId] = useState<string | null>(null);
    const [settingsTab, setSettingsTab] = useState<'general' | 'appearance' | 'shortcuts' | 'behavior' | 'habits'>('appearance');

    const [hotkeys, setHotkeys] = useState<{ newTask: string, toggleSidebar: string, globalQuickAdd: string, toggleApp: string, hideNotes: string }>(() => {
        const saved = localStorage.getItem('injaz_hotkeys');
        return saved ? JSON.parse(saved) : { newTask: 'N', toggleSidebar: 'B', globalQuickAdd: 'Alt+Shift+W', toggleApp: 'Control+Alt+A', hideNotes: 'Alt+Shift+H' };
    });

    // UI State for recording hotkey
    const [recordingAction, setRecordingAction] = useState<'newTask' | 'toggleSidebar' | 'globalQuickAdd' | 'toggleApp' | 'hideNotes' | null>(null);

    const [autoBackupInterval, setAutoBackupInterval] = useState<number>(() => {
        return parseInt(localStorage.getItem('injaz_backup_interval') || '0'); // 0 = off, value in minutes
    });

    // --- GOOGLE TASKS STATE ---
    const [googleTokens, setGoogleTokens] = useState<any>(() => {
        const saved = localStorage.getItem('injaz_google_tokens');
        return saved ? JSON.parse(saved) : null;
    });
    const [googleListId, setGoogleListId] = useState<string | null>(() => localStorage.getItem('injaz_google_list_id'));
    const [googleSelectedListIds, setGoogleSelectedListIds] = useState<string[]>(() => {
        const saved = localStorage.getItem('injaz_google_selected_lists');
        return saved ? JSON.parse(saved) : [];
    });
    const [googleAllLists, setGoogleAllLists] = useState<any[]>([]);
    const [isGoogleListsExpanded, setIsGoogleListsExpanded] = useState(false);
    const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
    const isSyncingGoogleRef = useRef(false);



    // --- LISTS STATE ---
    const [lists, setLists] = useState<TaskList[]>(() => {
        const saved = localStorage.getItem('injaz_lists');
        return saved ? JSON.parse(saved) : [{ id: 'default', title: 'مهامي', themeColor: 'indigo' }];
    });

    // Improved Active List Initialization
    const [activeListId, setActiveListId] = useState<string>(() => {
        const savedId = localStorage.getItem('injaz_active_list');
        const savedLists = localStorage.getItem('injaz_lists');

        if (savedId && savedLists) {
            const parsedLists: TaskList[] = JSON.parse(savedLists);
            if (parsedLists.some(l => l.id === savedId)) {
                return savedId;
            }
            if (parsedLists.length > 0) return parsedLists[0].id;
        }
        return 'default';
    });

    // History stack for list navigation
    const [listHistory, setListHistory] = useState<string[]>([]);
    const [listForwardHistory, setListForwardHistory] = useState<string[]>([]);

    // Navigation Helper
    const navigateToList = (newListId: string) => {
        if (activeListId === newListId) return;
        setListHistory(prev => [...prev, activeListId]);
        setListForwardHistory([]); // Clear forward history on new navigation
        setActiveListId(newListId);
        // Reset view to root when switching lists
        setCurrentFolderId(null);
        setBreadcrumbs([{ id: 'root', title: 'الرئيسية' }]);
        setExpandedFolderIds(new Set()); // Optional: Collapse folders? Maybe keep them.
    };

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isCreatingList, setIsCreatingList] = useState(false);
    const [newListTitle, setNewListTitle] = useState('');

    // List Renaming State
    const [renamingListId, setRenamingListId] = useState<string | null>(null);
    const [renamingListTitle, setRenamingListTitle] = useState('');

    const [viewMode, setViewMode] = useState<ViewMode>('groups');
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('injaz_collapsed_groups');
        return saved ? new Set(JSON.parse(saved)) : new Set(['__ungrouped__']);
    });

    // --- TASKS STATE & HISTORY ---
    const [tasks, setTasks] = useState<Task[]>(() => {
        const saved = localStorage.getItem('injaz_tasks');
        let loadedTasks = saved ? JSON.parse(saved) : [];

        const migrateTasks = (list: Task[]) => {
            return list.map(t => {
                if (!t.parentId && !t.listId) {
                    return { ...t, listId: 'default' };
                }
                return t;
            });
        };
        return migrateTasks(loadedTasks);
    });

    const findTask = (id: string, list: Task[]): Task | undefined => {
        for (const task of list) {
            if (task.id === id) return task;
            if (task.children) {
                const found = findTask(id, task.children);
                if (found) return found;
            }
        }
        return undefined;
    };

    // --- UNIFIED UNDO/REDO STACK (tasks + habits) ---
    type UndoEntry = { type: 'tasks'; state: Task[] } | { type: 'habits'; state: Habit[] };
    const undoStackRef = useRef<UndoEntry[]>([]);
    const redoStackRef = useRef<UndoEntry[]>([]);
    const tasksRef = useRef<Task[]>([]); // Keep sync copy for undo/redo
    const habitsRef = useRef<Habit[]>([]); // Keep sync copy for habits undo/redo
    const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
    const setTasksRef = useRef(setTasks); // Keep ref to setTasks
    const setHabitsRef = useRef<React.Dispatch<React.SetStateAction<Habit[]>> | null>(null);

    // Initialize tasksRef with initial tasks value
    if (tasksRef.current.length === 0 && tasks.length > 0) {
        tasksRef.current = tasks;
    }

    // Keep setTasksRef updated
    setTasksRef.current = setTasks;

    // Track if drag handle is held down
    const isDragHandleDown = useRef(false);

    // Track enter key for focus management (prevent onBlur interference)
    const isEnterPressed = useRef(false);

    // Text Direction Helper
    const getDirection = (text: string) => {
        if (!text) return 'auto';
        // Strip HTML tags for accurate detection
        const plain = text.replace(/<[^>]+>/g, '');
        // Check for Arabic characters first
        const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        if (arabicPattern.test(plain)) return 'rtl';
        // Check for English/Latin characters
        const latinPattern = /[A-Za-z]/;
        if (latinPattern.test(plain)) return 'ltr';
        return 'auto';
    };

    const syncGoogleTasks = useCallback(async (tokens = googleTokens, forceSwitch = false) => {
        if (!tokens || isSyncingGoogleRef.current) return;
        isSyncingGoogleRef.current = true;
        setIsSyncingGoogle(true);
        try {
            const ipc = (window as any).require?.('electron')?.ipcRenderer;
            if (!ipc) return;

            // Fetch all selected lists
            const selectedIds = googleSelectedListIds.length > 0 ? googleSelectedListIds : [googleListId || '@default'];
            const result = await ipc.invoke('google-tasks:fetch', { tokens, listIds: selectedIds });
            const { tasks: gTasks } = result;

            if (!gTasks) {
                setIsSyncingGoogle(false);
                return;
            }

            const targetListId = lists.length > 0 ? lists[0].id : 'default';

            setTasks(prev => {
                // Keep only non-google synced tasks
                const otherTasks = prev.filter(t => !t.isGoogleSynced && t.id !== 'google_main_folder' && !t.id.startsWith('google_'));
                
                const googleFolderId = 'google_main_folder';
                const rootGTasks = gTasks.filter((gt: any) => !gt.parent);
                const subGTasks = gTasks.filter((gt: any) => !!gt.parent);

                const buildTask = (gt: any, parentId: string): Task => {
                    const taskId = `google_${gt.id}`;
                    const taskSubtasks = subGTasks.filter((st: any) => st.parent === gt.id);
                    return {
                        id: taskId,
                        googleTaskId: gt.id,
                        googleListId: gt.listId, // Now provided by the main process
                        title: gt.title || '(بدون عنوان)',
                        type: 'item',
                        priority: Priority.Medium,
                        color: '#4285F4',
                        parentId: parentId,
                        listId: targetListId, // Injected into the primary list
                        isGoogleSynced: true,
                        isCompleted: gt.status === 'completed',
                        createdAt: new Date(gt.updated || Date.now()).getTime(),
                        completedAt: gt.completed ? new Date(gt.completed).getTime() : undefined,
                        dueDate: gt.due ? gt.due.split('T')[0] : undefined,
                        children: taskSubtasks.map((st: any) => buildTask(st, taskId))
                    };
                };

                const googleFolder: Task = {
                    id: googleFolderId,
                    title: 'مهام جوجل',
                    type: 'folder',
                    color: '#4285F4',
                    priority: Priority.Medium,
                    parentId: null,
                    listId: targetListId, // Root of the primary list
                    isGoogleSynced: true,
                    isCompleted: false,
                    createdAt: Date.now(),
                    children: rootGTasks.map((gt: any) => buildTask(gt, googleFolderId))
                };

                return [...otherTasks, googleFolder];
            });

            // Cleanup: Remove any "google_tasks" list if it exists
            setLists(prev => prev.filter(l => l.id !== 'google_tasks'));

            if (forceSwitch) {
                setActiveListId(targetListId);
                setViewMode('groups');
                setActiveTab('tasks');
                localStorage.setItem('injaz_active_list', targetListId);
            }

        } catch (error) {
            console.error('[Sync] Failed to sync Google Tasks:', error);
        } finally {
            isSyncingGoogleRef.current = false;
            setIsSyncingGoogle(false);
        }
    }, [googleTokens, googleSelectedListIds, googleListId]);

    const initialSyncDone = useRef(false);
    useEffect(() => {
        if (googleTokens) {
            const ipc = (window as any).require?.('electron')?.ipcRenderer;
            if (ipc) {
                ipc.invoke('google-tasks:fetch-lists', googleTokens).then((lists: any[]) => {
                    setGoogleAllLists(lists);
                    // If none selected yet, default to the primary one
                    if (googleSelectedListIds.length === 0 && lists.length > 0) {
                        const primary = lists[0].id;
                        setGoogleSelectedListIds([primary]);
                        localStorage.setItem('injaz_google_selected_lists', JSON.stringify([primary]));
                    }
                });
            }
        }
    }, [googleTokens]);

    useEffect(() => {
        if (googleTokens && !initialSyncDone.current) {
            syncGoogleTasks(googleTokens, true);
            initialSyncDone.current = true;
        }
    }, [googleTokens, syncGoogleTasks]);

    useEffect(() => {
        if (googleTokens && initialSyncDone.current) {
            syncGoogleTasks();
        }
    }, [googleSelectedListIds, syncGoogleTasks]);

    // Periodic and focus-based sync
    useEffect(() => {
        if (googleTokens) {
            
            // Sync when window gets focus (user returns to the app)
            const handleFocus = () => {
                syncGoogleTasks();
            };
            window.addEventListener('focus', handleFocus);

            // Periodic sync every 2 minutes
            const interval = setInterval(syncGoogleTasks, 2 * 60 * 1000); 
            
            return () => {
                window.removeEventListener('focus', handleFocus);
                clearInterval(interval);
            };
        }
    }, [googleTokens, syncGoogleTasks]);

    // Wrapper to set tasks and save to unified undo stack
    const modifyTasks = useCallback((newTasksOrFn: Task[] | ((prev: Task[]) => Task[]), merge = false) => {
        setTasks(prev => {
            const next = typeof newTasksOrFn === 'function' ? newTasksOrFn(prev) : newTasksOrFn;
            if (next !== prev) {
                if (!merge) {
                    undoStackRef.current = [...undoStackRef.current, { type: 'tasks', state: prev }];
                    redoStackRef.current = []; // Clear redo stack on new action
                }
                tasksRef.current = next; // Update ref immediately
            }
            return next;
        });
    }, []);

    // Wrapper to set habits and save to unified undo stack
    const modifyHabits = useCallback((newHabitsOrFn: Habit[] | ((prev: Habit[]) => Habit[])) => {
        if (!setHabitsRef.current) return;
        setHabitsRef.current(prev => {
            const next = typeof newHabitsOrFn === 'function' ? newHabitsOrFn(prev) : newHabitsOrFn;
            if (next !== prev) {
                undoStackRef.current = [...undoStackRef.current, { type: 'habits', state: prev }];
                redoStackRef.current = []; // Clear redo stack on new action
                habitsRef.current = next;
            }
            return next;
        });
    }, []);

    const addTaskToFolderById = (list: Task[], folderId: string, taskToAdd: Task): Task[] => {
        if (folderId === 'root') return [taskToAdd, ...list];
        let found = false;
        const newList = list.map(t => {
            if (t.id === folderId) {
                found = true;
                const activeChildren = (t.children || []).filter(c => !c.isCompleted);
                if (t.type === 'item' && activeChildren.length === 1 && activeChildren[0].title === "") {
                    const placeholderId = activeChildren[0].id;
                    const newChildren = (t.children || []).map(c => c.id === placeholderId ? taskToAdd : c);
                    return { ...t, isArchived: false, children: newChildren };
                }
                return { ...t, isArchived: false, children: [taskToAdd, ...(t.children || [])] };
            }
            if (t.children && t.children.length > 0) {
                const updatedChildren = addTaskToFolderById(t.children, folderId, taskToAdd);
                if (updatedChildren !== t.children) {
                    found = true;
                    return { ...t, isArchived: false, children: updatedChildren };
                }
            }
            return t;
        });
        return found ? newList : list;
    };

    const addTask = useCallback((newTaskData: Partial<Task>) => {
        const targetListId = newTaskData.listId || activeListId;
        const finalTargetId = 'root';

        const newId = generateId();
        const newTask: Task = {
            id: newId,
            title: newTaskData.title!,
            type: 'item', // Forced item
            priority: newTaskData.priority!,
            color: newTaskData.color || '#64748b',
            parentId: newTaskData.parentId || null,
            listId: targetListId,
            children: [],
            isCompleted: false,
            createdAt: Date.now(),
            dueDate: newTaskData.dueDate,
            dueTime: newTaskData.dueTime,
            recurrence: newTaskData.recurrence,
            imageUrl: newTaskData.imageUrl,
            isGoogleSynced: targetListId === 'google_tasks'
        };

        // Use modifyTasks for undo support
        modifyTasks(prev => {
            if (newTask.parentId) {
                // If it has a parent, add to parent's children
                return addTaskToFolderById(prev, newTask.parentId, newTask);
            }
            return [newTask, ...prev];
        });
        return newId;
    }, [activeListId, modifyTasks]);

    // Global undo/redo handlers - completely outside React's control
    useEffect(() => {
        const ipc = (window as any).require?.('electron')?.ipcRenderer;
        if (ipc) {
            ipc.on('checking_for_update', () => {
                setUpdateStatus('checking');
            });
            ipc.on('update_available', () => {
                setUpdateAvailable(true);
                setUpdateStatus('available');
            });
            ipc.on('update_not_available', () => {
                setUpdateStatus('idle');
            });
            ipc.on('update_downloaded', () => {
                setUpdateDownloaded(true);
                setUpdateStatus('downloaded');
            });
            ipc.on('update_error', (event: any, error: any) => {
                setUpdateStatus('error');
                setUpdateErrorMsg(error);
                console.error('Update error:', error);
            });
            return () => {
                ipc.removeAllListeners('checking_for_update');
                ipc.removeAllListeners('update_available');
                ipc.removeAllListeners('update_not_available');
                ipc.removeAllListeners('update_downloaded');
                ipc.removeAllListeners('update_error');
            };
        }
    }, []);

    useEffect(() => {
        const handleUndoRedoGlobal = (e: KeyboardEvent) => {
            const tagName = (e.target as HTMLElement).tagName;
            const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName);
            const isContentEditable = (e.target as HTMLElement).isContentEditable;

            if (isInput || isContentEditable) return;

            // Use e.code instead of e.key to work with any keyboard language
            // Undo: Ctrl+Z
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (undoStackRef.current.length === 0) return;
                const entry = undoStackRef.current[undoStackRef.current.length - 1];
                undoStackRef.current = undoStackRef.current.slice(0, -1);

                if (entry.type === 'tasks') {
                    const current = tasksRef.current;
                    redoStackRef.current = [{ type: 'tasks', state: current }, ...redoStackRef.current];
                    tasksRef.current = entry.state;
                    flushSync(() => setTasksRef.current(entry.state));
                } else if (entry.type === 'habits') {
                    const current = habitsRef.current;
                    redoStackRef.current = [{ type: 'habits', state: current }, ...redoStackRef.current];
                    habitsRef.current = entry.state;
                    flushSync(() => setHabitsRef.current && setHabitsRef.current(entry.state));
                }
                return;
            }
            // Redo: Ctrl+Y or Ctrl+Shift+Z
            if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (redoStackRef.current.length === 0) return;
                const entry = redoStackRef.current[0];
                redoStackRef.current = redoStackRef.current.slice(1);

                if (entry.type === 'tasks') {
                    const current = tasksRef.current;
                    undoStackRef.current = [...undoStackRef.current, { type: 'tasks', state: current }];
                    tasksRef.current = entry.state;
                    flushSync(() => setTasksRef.current(entry.state));
                } else if (entry.type === 'habits') {
                    const current = habitsRef.current;
                    undoStackRef.current = [...undoStackRef.current, { type: 'habits', state: current }];
                    habitsRef.current = entry.state;
                    flushSync(() => setHabitsRef.current && setHabitsRef.current(entry.state));
                }
                return;
            }
        };

        document.addEventListener('keydown', handleUndoRedoGlobal, { capture: true });
        return () => document.removeEventListener('keydown', handleUndoRedoGlobal, { capture: true });
    }, []); // Empty deps - never recreated


    // Apply zoom to document
    useEffect(() => {
        document.body.style.zoom = `${preferences.zoom}`;
        localStorage.setItem('injaz_zoom', preferences.zoom.toString());
    }, [preferences.zoom]);

    // Ctrl+Scroll to zoom
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                setPreferences(prev => {
                    const newZoom = Math.max(0.5, Math.min(2, prev.zoom + delta));
                    const roundedZoom = Math.round(newZoom * 10) / 10;
                    return { ...prev, zoom: roundedZoom };
                });
            }
        };

        window.addEventListener('wheel', handleWheel, { passive: false });
        return () => window.removeEventListener('wheel', handleWheel);
    }, []);
    const viewModeRef = useRef(viewMode);
    useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
    const collapsedGroupIdsRef = useRef(collapsedGroupIds);
    useEffect(() => { collapsedGroupIdsRef.current = collapsedGroupIds; }, [collapsedGroupIds]);
    const activeListIdRef = useRef(activeListId);
    useEffect(() => { activeListIdRef.current = activeListId; }, [activeListId]);

    // Listen for tasks added from Quick Notes window
    useEffect(() => {
        const handleQuickTaskAdded = (e: any) => {
            const newTask = e.detail;
            const groupId = newTask.parentId || '__ungrouped__';

            // Check if this group was previously empty/hidden in the current list
            const currentListTasks = tasksRef.current.filter(t => t.listId === activeListIdRef.current);
            const wasEmpty = !currentListTasks.some(t => 
                (groupId === '__ungrouped__' ? (t.parentId === null && t.type !== 'folder') : (t.parentId === groupId)) && !t.isCompleted
            );

            const saved = localStorage.getItem('injaz_tasks');
            if (saved) {
                const loadedTasks = JSON.parse(saved);
                setTasks(loadedTasks);
                tasksRef.current = loadedTasks;
            }

            // If adding to "Uncategorized" and it was empty, and there's another folder open, 
            // keep "Uncategorized" collapsed so it doesn't pop up and distract.
            if (viewModeRef.current === 'groups' && wasEmpty && groupId === '__ungrouped__') {
                const folders = tasksRef.current.filter(t => t.type === 'folder' && t.listId === activeListIdRef.current);
                const anyFolderOpen = folders.some(f => !collapsedGroupIdsRef.current.has(f.id));

                if (anyFolderOpen) {
                    setCollapsedGroupIds(prev => {
                        const next = new Set(prev);
                        next.add('__ungrouped__');
                        return next;
                    });
                }
            }
        };

        const handleQuickListAdded = () => {
            const savedLists = localStorage.getItem('injaz_lists');
            if (savedLists) {
                setLists(JSON.parse(savedLists));
            }
        };

        window.addEventListener('injaz-task-added', handleQuickTaskAdded as any);
        window.addEventListener('injaz-list-added', handleQuickListAdded);

        const ipc = (window as any).require?.('electron')?.ipcRenderer;
        if (ipc) {
            const handleBroadcastSync = (_: any, type: string) => {
                if (type === 'tasks') {
                    const saved = localStorage.getItem('injaz_tasks');
                    if (saved) {
                        const loaded = JSON.parse(saved);
                        setTasks(loaded);
                        tasksRef.current = loaded;
                    }
                } else if (type === 'lists') {
                    const saved = localStorage.getItem('injaz_lists');
                    if (saved) setLists(JSON.parse(saved));
                }
            };
            ipc.on('data-updated', handleBroadcastSync);
            return () => {
                window.removeEventListener('injaz-task-added', handleQuickTaskAdded as any);
                window.removeEventListener('injaz-list-added', handleQuickListAdded);
                ipc.removeListener('data-updated', handleBroadcastSync);
            };
        }

        const handleGlobalMouseUp = () => {
            isDragHandleDown.current = false;
        };
        window.addEventListener('mouseup', handleGlobalMouseUp);

        return () => {
            window.removeEventListener('injaz-task-added', handleQuickTaskAdded as any);
            window.removeEventListener('injaz-list-added', handleQuickListAdded);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [viewMode]);

    // Auto-close sidebar on window blur or click outside
    useEffect(() => {
        if (!isSidebarOpen) return;

        const closeSidebar = () => setIsSidebarOpen(false);

        const handleClickOutside = (e: MouseEvent) => {
            const sidebar = document.querySelector('[data-sidebar]');
            const trigger = document.querySelector('[data-sidebar-trigger]');
            const isContextMenu = (e.target as HTMLElement).closest('[data-context-menu]') || (e.target as HTMLElement).closest('[data-list-context-menu]');
            
            if (sidebar && !sidebar.contains(e.target as Node) && (!trigger || !trigger.contains(e.target as Node)) && !isContextMenu) {
                closeSidebar();
            }
        };

        // Mouse leaving the window entirely
        const handleMouseLeave = (e: MouseEvent) => {
            // Check if mouse is actually leaving the window
            if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
                closeSidebar();
            }
        };

        // Window visibility change (tab switch, minimize, etc)
        const handleVisibilityChange = () => {
            if (document.hidden) closeSidebar();
        };

        // IPC listener for window blur (Electron specific)
        const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
        if (ipcRenderer) {
            ipcRenderer.on('window-blur', closeSidebar);
        }

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('mouseleave', handleMouseLeave);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('mouseleave', handleMouseLeave);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (ipcRenderer) ipcRenderer.removeListener('window-blur', closeSidebar);
        };
    }, [isSidebarOpen]);

    const hasInitGroupsRef = useRef(false);
    const groupsContainerRef = useRef<HTMLDivElement>(null);
    const groupsScrollPos = useRef(0);

    useEffect(() => {
        localStorage.setItem('injaz_collapsed_groups', JSON.stringify(Array.from(collapsedGroupIds)));
    }, [collapsedGroupIds]);

    const lastBroadcastTasksRef = useRef<string>('');
    const lastBroadcastListsRef = useRef<string>('');

    useEffect(() => {
        const ipc = (window as any).require?.('electron')?.ipcRenderer;
        if (ipc) {
            const tasksJson = JSON.stringify(tasks);
            if (tasks.length > 0 && tasksJson !== lastBroadcastTasksRef.current) {
                lastBroadcastTasksRef.current = tasksJson;
                ipc.send('data-updated', 'tasks');
            }
        }
    }, [tasks]);

    useEffect(() => {
        const ipc = (window as any).require?.('electron')?.ipcRenderer;
        if (ipc) {
            const listsJson = JSON.stringify(lists);
            if (lists.length > 0 && listsJson !== lastBroadcastListsRef.current) {
                lastBroadcastListsRef.current = listsJson;
                ipc.send('data-updated', 'lists');
            }
        }
    }, [lists]);

    // --- HABITS STATE ---
    const [habits, setHabits] = useState<Habit[]>(() => {
        const saved = localStorage.getItem('injaz_habits');
        return saved ? JSON.parse(saved) : [];
    });

    // Keep setHabitsRef updated so the undo/redo handler can call it
    setHabitsRef.current = setHabits;
    // Keep habitsRef in sync
    habitsRef.current = habits;

    useEffect(() => {
        localStorage.setItem('injaz_habits', JSON.stringify(habits));
    }, [habits]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

    // --- INLINE EDITING STATE ---
    const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
    const [inlineEditText, setInlineEditText] = useState('');
    const cancelInlineEdit = useCallback(() => {
        setInlineEditingId(null);
        setInlineEditText('');
    }, []);
    const inlineEditRef = useRef<HTMLDivElement>(null); // Use ref for contentEditable

    // --- QUICK ADD STATE ---
    const [isQuickAdding, setIsQuickAdding] = useState(false);
    const lastQuickAddOpenTime = useRef<number>(0);

    const [quickAddTitle, setQuickAddTitle] = useState('');
    const [quickAddPriority, setQuickAddPriority] = useState<Priority>(Priority.Medium);

    // Prevent body scroll when settings or modals are open
    useEffect(() => {
        if (isSettingsOpen || isModalOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
    }, [isSettingsOpen, isModalOpen]);


    // Sorting State
    const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
    const [sortBy, setSortBy] = useState<'custom' | 'priority' | 'created'>(() => {
        const saved = localStorage.getItem('injaz_sort_by');
        if (saved === 'custom' || saved === 'priority' || saved === 'created') {
            return saved;
        }
        return 'priority';
    });
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    // Delete Confirmation State
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean, taskId: string | null }>({
        isOpen: false,
        taskId: null
    });
    const [listDeleteConfirm, setListDeleteConfirm] = useState<string | null>(null);

    // Bulk Delete Confirmation State
    const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);

    // Group Creation State
    const [groupCreation, setGroupCreation] = useState<{ isOpen: boolean, sourceId: string | null, targetId: string | null }>({
        isOpen: false,
        sourceId: null,
        targetId: null
    });
    const [newGroupName, setNewGroupName] = useState('');

    const [activeTab, setActiveTab] = useState<'tasks' | 'calendar' | 'habits'>('tasks');
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        const ipc = (window as any).require?.('electron')?.ipcRenderer;
        if (!ipc) return;
        if (activeTab === 'habits') {
            ipc.send('maximize-window');
        } else {
            ipc.send('unmaximize-window');
        }
    }, [activeTab]);

    const getEffectiveTaskCount = useCallback((taskList: Task[]): number => {
        let count = 0;
        taskList.forEach(t => {
            if (t.isCompleted) return;
            
            const incompleteChildren = (t.children || []).filter(c => !c.isCompleted);
            
            if (incompleteChildren.length > 0) {
                // If it has incomplete children, it acts as a Parent Task.
                // Count its subtasks recursively but NOT the parent itself.
                count += getEffectiveTaskCount(incompleteChildren);
            } else if (t.title.trim() !== '') {
                // If it has NO incomplete children (either none exist or all are completed),
                // it acts as a basic task. Count it as 1.
                count += 1;
            }
        });
        return count;
    }, []);

    // Restore groups horizontal scroll when returning to groups view
    useEffect(() => {
        if (activeTab === 'tasks' && viewMode === 'groups') {
            const timer1 = setTimeout(() => {
                if (groupsContainerRef.current) {
                    groupsContainerRef.current.scrollLeft = groupsScrollPos.current;
                }
            }, 10);
            // Backup timer to ensure the scroll is applied after layout reflow
            const timer2 = setTimeout(() => {
                if (groupsContainerRef.current) {
                    groupsContainerRef.current.scrollLeft = groupsScrollPos.current;
                }
            }, 100);
            return () => {
                clearTimeout(timer1);
                clearTimeout(timer2);
            };
        }
    }, [activeTab, viewMode]);

    const [showCompleted, setShowCompleted] = useState(false);
    const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: 'root', title: 'الرئيسية' }]);
    const [showEmptyFolders, setShowEmptyFolders] = useState(false);


    // Drag and Drop State
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
    const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
    const [dragOverPosition, setDragOverPosition] = useState<'top' | 'bottom' | 'center' | null>(null);
    const [draggedListId, setDraggedListId] = useState<string | null>(null);
    const [dragOverListId, setDragOverListId] = useState<string | null>(null);
    const [dragOverListPos, setDragOverListPos] = useState<'top' | 'bottom' | null>(null);

    // Notification State
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [isNotificationExiting, setIsNotificationExiting] = useState(false);
    const [recentlyCompletedId, setRecentlyCompletedId] = useState<string | null>(null);

    // Manage Notification Lifecycle
    useEffect(() => {
        if (notification) {
            setIsNotificationExiting(false);
            const timer1 = setTimeout(() => {
                setIsNotificationExiting(true);
            }, 300); // Show for only 0.3s (Flash!)

            const timer2 = setTimeout(() => {
                setNotification(null);
                setIsNotificationExiting(false);
            }, 500); // 0.3s + 0.2s animation

            return () => { clearTimeout(timer1); clearTimeout(timer2); };
        }
    }, [notification]);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{
        isOpen: boolean;
        x: number;
        y: number;
        taskId: string | null;
        source: 'context' | 'trigger' | 'priority-dot';
    }>({ isOpen: false, x: 0, y: 0, taskId: null, source: 'context' });
    const [activeSubmenu, setActiveSubmenu] = useState<'priority' | 'list' | 'date' | null>(null);
    const [moveTargetListId, setMoveTargetListId] = useState<string | null>(null);
    const submenuTimeoutRef = useRef<any>(null); // Ref for submenu closing grace period

    // List Context Menu State
    const [listContextMenu, setListContextMenu] = useState<{
        isOpen: boolean;
        x: number;
        y: number;
        listId: string | null;
    }>({ isOpen: false, x: 0, y: 0, listId: null });


    // --- MULTI-SELECTION STATE ---
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);
    const selectionRef = useRef<HTMLDivElement>(null);
    const clickPosRef = useRef<{ x: number, y: number } | null>(null);

    // --- EFFECT: F5 SORT ---

    const activeList = lists.find(l => l.id === activeListId) || lists[0];
    const currentFolder = currentFolderId ? findTask(currentFolderId, tasks) : null;
    const currentTasks = React.useMemo(() => {
        if (currentFolderId) {
            return currentFolder?.children || [];
        } else {
            return tasks.filter(t => t.parentId === null && t.listId === activeListId);
        }
    }, [tasks, currentFolderId, activeListId, currentFolder]);


    // --- EFFECT: PERSIST DATA (debounced for tasks) ---
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            localStorage.setItem('injaz_tasks', JSON.stringify(tasks));
        }, 300);
        return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
    }, [tasks]);
    useEffect(() => { localStorage.setItem('injaz_lists', JSON.stringify(lists)); }, [lists]);
    useEffect(() => { localStorage.setItem('injaz_active_list', activeListId); }, [activeListId]);
    useEffect(() => { localStorage.setItem('injaz_sort_by', sortBy); }, [sortBy]);
    useEffect(() => { localStorage.setItem('injaz_hotkeys', JSON.stringify(hotkeys)); }, [hotkeys]);
    useEffect(() => { localStorage.setItem('injaz_backup_interval', autoBackupInterval.toString()); }, [autoBackupInterval]);

    // --- EFFECT: DATA SYNC (Quick Add) ---
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'injaz_tasks' && e.newValue) {
                setTasks(JSON.parse(e.newValue));
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // --- EFFECT: AUTO LAUNCH CHECK ---
    const [autoLaunch, setAutoLaunch] = useState(false);
    useEffect(() => {
        try {
            const ipc = (window as any).require?.('electron')?.ipcRenderer;
            if (ipc) {
                ipc.invoke('get-auto-launch').then((val: boolean) => setAutoLaunch(val));
            }
        } catch (e) { console.log('Not in Electron mode'); }
    }, []);

    const toggleAutoLaunch = (val: boolean) => {
        setAutoLaunch(val);
        try {
            const ipc = (window as any).require?.('electron')?.ipcRenderer;
            if (ipc) ipc.send('set-auto-launch', val);
        } catch (e) { }
    };

    // Preferences Effect
    useEffect(() => {
        localStorage.setItem('injaz_preferences', JSON.stringify(preferences));
        // Apply Zoom
        (document.body.style as any).zoom = preferences.zoom;

        // Inject Custom Font if URL provided
        const linkEl = document.getElementById('custom-font-link') as HTMLLinkElement;
        if (linkEl) {
            if (preferences.customFontUrl) {
                linkEl.href = preferences.customFontUrl;
            } else {
                linkEl.href = '';
            }
        }

        // Apply Fonts
        document.documentElement.style.setProperty('--font-ar', preferences.arFont === 'Custom' ? (preferences.customFontName || 'sans-serif') : preferences.arFont);
        document.documentElement.style.setProperty('--font-en', preferences.enFont === 'Custom' ? (preferences.customFontName || 'sans-serif') : preferences.enFont);

        // Logic for numbers (Always English/Western)
        document.documentElement.style.setProperty('--font-nums', 'Cairo');
        document.documentElement.style.setProperty('--dir-nums', 'ltr');
    }, [preferences]);

    // --- EFFECT: STORAGE SYNC (Multi-window support) ---
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'injaz_tasks' && e.newValue) {
                setTasks(JSON.parse(e.newValue));
            }
            if (e.key === 'injaz_lists' && e.newValue) {
                setLists(JSON.parse(e.newValue));
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // --- EFFECT: AUTO BACKUP ---
    useEffect(() => {
        if (autoBackupInterval <= 0) return;
        const intervalId = setInterval(() => {
            const backupData = {
                timestamp: new Date().toISOString(),
                lists,
                tasks,
                habits,
                hotkeys
            };
            localStorage.setItem('injaz_auto_backup', JSON.stringify(backupData));
            console.log('Auto-backup saved at', new Date().toLocaleTimeString());
        }, autoBackupInterval * 60 * 1000); // convert minutes to ms

        return () => clearInterval(intervalId);
    }, [autoBackupInterval, lists, tasks, habits, hotkeys]);

    // --- EFFECT: DATA PERSISTENCE ---
    useEffect(() => {
        localStorage.setItem('injaz_tasks', JSON.stringify(tasks));
    }, [tasks]);

    useEffect(() => {
        localStorage.setItem('injaz_lists', JSON.stringify(lists));
    }, [lists]);

    useEffect(() => {
        localStorage.setItem('injaz_active_list', activeListId);
    }, [activeListId]);

    // --- EFFECT: HOTKEYS (Persistence & IPC) ---
    useEffect(() => {
        localStorage.setItem('injaz_hotkeys', JSON.stringify(hotkeys));

        // Update Electron Shortcuts
        try {
            const ipc = (window as any).require?.('electron')?.ipcRenderer;
            if (ipc) {
                ipc.send('set-global-shortcut', hotkeys.globalQuickAdd);
                ipc.send('set-app-toggle-shortcut', hotkeys.toggleApp);
                ipc.send('set-hide-notes-shortcut', hotkeys.hideNotes);
            }
        } catch (e) { }
    }, [hotkeys]);


    // --- EFFECT: HOTKEYS & CLICKS ---

    // --- HELPERS: SORT & MOVE (Hoisted for Keyboard Access) ---
    const getSortedList = useCallback((list: Task[]) => {
        return [...list].sort((a, b) => {
            // 1. Pin Status (Top pins first, then unpinned, then bottom pins)
            const aPin = a.pinStatus === 'top' ? -1 : (a.pinStatus === 'bottom' ? 1 : 0);
            const bPin = b.pinStatus === 'top' ? -1 : (b.pinStatus === 'bottom' ? 1 : 0);
            if (aPin !== bPin) return aPin - bPin;

            // 2. Empty Parent Tasks at the bottom
            const isTaskEmptyParent = (t: Task) => {
                if (t.isCompleted) return false;
                
                // No title + no children = brand new task being created, not an empty parent
                const hasNoChildren = !t.children || t.children.length === 0;
                if (hasNoChildren && !t.title.trim()) return false;
                
                // Smart fix for "Tab" / new subtask workflow:
                // 1. When a new subtask is created (e.g., via Tab), there is a 100ms delay before inlineEditingId is set.
                //    We use a 1-second grace period (hasJustCreatedChild) to prevent it from flashing to the bottom.
                // 2. Once inlineEditingId is active, we keep it at the top ONLY IF the child being edited is relatively new.
                //    This ensures that clicking an OLD empty parent to edit it keeps it at the bottom, 
                //    while typing a NEW Tab task keeps it at the top.
                // 3. When you finish editing and it's empty, inlineEditingId clears and it drops immediately.
                const editingChild = (t.children || []).find(c => c.id === inlineEditingId);
                const isEditingNewChild = editingChild && (Date.now() - editingChild.createdAt < 60000);
                const hasJustCreatedChild = (t.children || []).some(c => Date.now() - c.createdAt < 1000);
                if (isEditingNewChild || hasJustCreatedChild) return false;

                return getEffectiveTaskCount([t]) === 0;
            };
            const aEmptyParent = isTaskEmptyParent(a);
            const bEmptyParent = isTaskEmptyParent(b);
            if (aEmptyParent && !bEmptyParent) return 1;
            if (!aEmptyParent && bEmptyParent) return -1;

            if (sortBy === 'custom') return 0;
            const modifier = sortDirection === 'asc' ? 1 : -1;
            const getPriority = (t: Task) => t.priority;
            const aPriority = getPriority(a);
            const bPriority = getPriority(b);
            if (aPriority !== bPriority) return aPriority - bPriority;
            if (a.type !== b.type) return a.type === 'folder' ? 1 : -1;
            if (sortBy === 'priority') return 0;
            else if (sortBy === 'created') return (a.createdAt - b.createdAt) * modifier;
            return 0;
        });
    }, [sortBy, sortDirection, inlineEditingId]);

    const sortedActiveTasks = React.useMemo(() => {
        const active = currentTasks.filter(t => !t.isCompleted || t.id === recentlyCompletedId);
        const sorted = getSortedList(active);

        // Separate empty folders from non-empty items
        const nonEmptyItems = sorted.filter(t =>
            t.type !== 'folder' || 
            (t.children && t.children.filter(c => !c.isCompleted).length > 0)
        );
        const emptyFolders = sorted.filter(t =>
            t.type === 'folder' && 
            (!t.children || t.children.filter(c => !c.isCompleted).length === 0)
        );

        return [...nonEmptyItems, ...emptyFolders];
    }, [currentTasks, getSortedList, recentlyCompletedId]);


    const handleMoveTask = useCallback((taskId: string, direction: 'up' | 'down' | 'top' | 'bottom', isRepeat: boolean = false) => {
        if (sortBy !== 'custom') setSortBy('custom');
        let visualList: Task[] = [];
        const task = findTask(taskId, tasks);
        if (!task) return;

        if (task.parentId === null) {
            visualList = activeListId === 'dashboard' ? sortedActiveTasks : sortedActiveTasks;
        } else {
            const findParent = (list: Task[]): Task | null => {
                for (const t of list) {
                    if (t.children && t.children.some(c => c.id === taskId)) return t;
                    if (t.children) {
                        const found = findParent(t.children);
                        if (found) return found;
                    }
                }
                return null;
            };
            const parent = findParent(tasks);
            if (parent) {
                const activeChildren = parent.children.filter(t => !t.isCompleted || t.id === recentlyCompletedId);
                visualList = getSortedList(activeChildren);
            }
        }

        if (visualList.length === 0) return;
        const currentIdx = visualList.findIndex(t => t.id === taskId);
        if (currentIdx === -1) return;

        // Pinning and movement logic
        let newPinStatus = task.pinStatus;
        let newIdx = currentIdx;

        if (direction === 'top') {
            if (task.pinStatus === 'top') {
                newPinStatus = null;
                newIdx = currentIdx; // Unpin but stay in place
            } else {
                newPinStatus = 'top';
                newIdx = 0; // Pin and move to top
            }
        } else if (direction === 'bottom') {
            if (task.pinStatus === 'bottom') {
                newPinStatus = null;
                newIdx = currentIdx; // Unpin but stay in place
            } else {
                newPinStatus = 'bottom';
                newIdx = visualList.length - 1; // Pin and move to bottom
            }
        } else {
            // Regular up/down movement
            if (direction === 'up') newIdx = Math.max(0, currentIdx - 1);
            if (direction === 'down') newIdx = Math.min(visualList.length - 1, currentIdx + 1);
            
            // Unpinning logic: Toggle pin if moving "out" of the section boundaries via regular Arrows
            if (task.pinStatus === 'top' && direction === 'down' && currentIdx === visualList.filter(t => t.pinStatus === 'top').length - 1) {
                newPinStatus = null;
            } else if (task.pinStatus === 'bottom' && direction === 'up' && currentIdx === visualList.findIndex(t => t.pinStatus === 'bottom')) {
                newPinStatus = null;
            }
        }

        if (newIdx === currentIdx && newPinStatus === task.pinStatus) return;

        const visualOrderIds = visualList.map(t => t.id);
        visualOrderIds.splice(currentIdx, 1);
        visualOrderIds.splice(newIdx, 0, taskId);

        modifyTasks(prevGlobal => {
            // Apply pin status change first if any
            let updatedGlobal = prevGlobal;
            if (newPinStatus !== task.pinStatus) {
                const updateStatus = (list: Task[]): Task[] => {
                    return list.map(t => {
                        if (t.id === taskId) return { ...t, pinStatus: newPinStatus };
                        if (t.children && t.children.length > 0) return { ...t, children: updateStatus(t.children) };
                        return t;
                    });
                };
                updatedGlobal = updateStatus(prevGlobal);
            }

            let taskMap: Map<string, Task>;
            const parentId = task.parentId;
            if (parentId) {
                const findFullParent = (list: Task[]): Task | null => {
                    for (const t of list) {
                        if (t.id === parentId) return t;
                        if (t.children) {
                            const f = findFullParent(t.children);
                            if (f) return f;
                        }
                    }
                    return null;
                };
                const fullParent = findFullParent(updatedGlobal);
                if (!fullParent) return updatedGlobal;
                taskMap = new Map(fullParent.children.map(t => [t.id, t]));
            } else {
                const rootTasks = updatedGlobal.filter(t => t.parentId === null && t.listId === activeListId);
                taskMap = new Map(rootTasks.map(t => [t.id, t]));
            }

            const reorderedTasks: Task[] = [];
            for (const id of visualOrderIds) {
                const t = taskMap.get(id);
                if (t) {
                    reorderedTasks.push(t);
                    taskMap.delete(id);
                }
            }
            for (const t of taskMap.values()) reorderedTasks.push(t);

            if (parentId) {
                const updateRecursive = (list: Task[]): Task[] => {
                    return list.map(t => {
                        if (t.id === parentId) return { ...t, children: reorderedTasks };
                        if (t.children && t.children.length > 0) return { ...t, children: updateRecursive(t.children) };
                        return t;
                    });
                };
                return updateRecursive(updatedGlobal);
            } else {
                const otherItems = updatedGlobal.filter(t => !(t.parentId === null && t.listId === activeListId));
                return [...otherItems, ...reorderedTasks.map(t => ({ ...t, parentId: null, listId: activeListId }))];
            }
        });
        setContextMenu(prev => ({ ...prev, isOpen: false }));
    }, [tasks, activeListId, sortedActiveTasks, getSortedList, modifyTasks, setSortBy, sortBy]);

    // Hoisted helper: create a group from ids. Declared before hotkeys so it can be called from keyboard handler.
    function createGroup(idsToGroup: string[], name: string = 'مجموعة جديدة', editAfterCreate: boolean = false) {
        if (!idsToGroup || idsToGroup.length === 0) return;
        const newFolderId = generateId();
        const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        modifyTasks(currentTasks => {
            const itemsToMove: Task[] = [];
            let tasksWithoutItems = [...currentTasks];

            // Find the position of the first item to maintain order
            let insertIndex = currentTasks.findIndex(t => idsToGroup.includes(t.id));
            if (insertIndex === -1) insertIndex = currentTasks.length;

            idsToGroup.forEach(id => {
                const t = findTask(id, currentTasks);
                if (t) itemsToMove.push(t);
                tasksWithoutItems = removeTaskById(tasksWithoutItems, id);
            });

            const newFolder: Task = {
                id: newFolderId,
                title: name || 'مجموعة جديدة',
                type: 'folder',
                priority: Priority.Medium,
                color: randomColor,
                parentId: null,
                listId: activeListId,
                children: itemsToMove.map(t => ({ ...t, parentId: newFolderId })),
                isCompleted: false,
                createdAt: Date.now()
            };

            // Reverted back to original, but prevent opening if it breaks the accordion rule maliciously? Actually let's just leave it as next.add(newFolderId) if it was. Or just don't expand the new one.
            setExpandedFolderIds(prev => prev); // Leave new folder closed rather than forcefully opening it and breaking accordion

            // Insert folder at the original position of the first item
            const result = [...tasksWithoutItems];
            // Adjust insert index after removal (items before insertIndex were removed)
            const adjustedIndex = Math.min(insertIndex, result.length);
            result.splice(adjustedIndex, 0, newFolder);
            return result;
        });

        // Clear selection and drag state
        setSelectedTaskIds(new Set());
        setDraggedTaskId(null); setDragOverTaskId(null); setDragOverPosition(null);

        if (editAfterCreate) {
            // Open modal for naming the group
            setGroupCreation({ isOpen: true, sourceId: newFolderId, targetId: null });
            setNewGroupName('');
        }
    }

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tagName = (e.target as HTMLElement).tagName;
            const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName);
            // Check for contentEditable
            const isContentEditable = (e.target as HTMLElement).isContentEditable;

            // Escape key to stop editing
            if (e.key === 'Escape') {
                if (inlineEditingId) {
                    setInlineEditingId(null);
                    return;
                }
                if (isQuickAdding) {
                    setIsQuickAdding(false);
                    setQuickAddTitle('');
                    return;
                }
                if (selectedTaskIds.size > 0) {
                    setSelectedTaskIds(new Set());
                    return;
                }
                if (isSettingsOpen) {
                    setIsSettingsOpen(false);
                    return;
                }
            }

            if (isInput || isContentEditable) return;

            // Skip undo/redo here - handled by separate listener
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
                return;
            }

            // Spacebar Grouping Shortcut: create group immediately
            if (e.code === 'Space' && selectedTaskIds.size > 0 && !isModalOpen && !isSettingsOpen && !groupCreation.isOpen && !inlineEditingId) {
                e.preventDefault(); // Prevent scrolling
                const ids = Array.from(selectedTaskIds) as string[];
                if (ids.length > 0) {
                    createGroup(ids, '', true);
                }
            }

            // Delete Shortcut: immediate delete without confirmation
            if (e.key === 'Delete' && selectedTaskIds.size > 0 && !isModalOpen && !isSettingsOpen && !groupCreation.isOpen && !inlineEditingId && !isQuickAdding) {
                e.preventDefault();
                performBulkDelete();
            }

            // Complete Shortcut: Key 'C' for bulk completion
            if (e.key.toLowerCase() === 'c' && selectedTaskIds.size > 0 && !isModalOpen && !isSettingsOpen && !groupCreation.isOpen && !inlineEditingId && !isQuickAdding) {
                e.preventDefault();
                handleBulkComplete();
            }

            // Arrow Reordering
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedTaskIds.size === 1 && !isModalOpen && !isSettingsOpen && !groupCreation.isOpen && !inlineEditingId && !isQuickAdding) {
                const taskId = Array.from(selectedTaskIds)[0];
                const direction = e.key === 'ArrowUp'
                    ? (e.shiftKey ? 'top' : 'up')
                    : (e.shiftKey ? 'bottom' : 'down');

                e.preventDefault();
                handleMoveTask(taskId, direction, e.repeat);
            }

            // Calculate Accelerator
            const isModifier = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);
            if (isModifier) return;

            const modifiers = [];
            if (e.ctrlKey) modifiers.push('Ctrl');
            if (e.altKey) modifiers.push('Alt');
            if (e.shiftKey) modifiers.push('Shift');
            if (e.metaKey) modifiers.push('Super');

            const key = e.code.replace('Key', '');
            const accelerator = [...modifiers, key].join('+');

            if (accelerator === hotkeys.newTask || (hotkeys.newTask && hotkeys.newTask.replace('Key', '') === accelerator)) {
                if (activeTab === 'tasks' && viewMode !== 'groups') {
                    e.preventDefault();
                    // Toggle quick add instead of modal
                    setIsQuickAdding(true);
                    lastQuickAddOpenTime.current = Date.now();
                }
            }
            if (accelerator === hotkeys.toggleSidebar || (hotkeys.toggleSidebar && hotkeys.toggleSidebar.replace('Key', '') === accelerator)) {
                e.preventDefault();
                setIsSidebarOpen(prev => !prev);
            }
            // Select All shortcut (Ctrl+A)
            if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !isModalOpen && !isSettingsOpen && !groupCreation.isOpen && !inlineEditingId && !isQuickAdding) {
                e.preventDefault();
                const allVisibleIds = currentTasks.map(t => t.id);
                setSelectedTaskIds(new Set(allVisibleIds));
            }
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (contextMenu.isOpen) {
                // If the click is inside the context menu, don't close it here.
                // The menu items will handle their own closing via onClick.
                if ((e.target as HTMLElement).closest('[data-context-menu]')) return;

                setContextMenu({ ...contextMenu, isOpen: false });
                setActiveSubmenu(null);
            }
            if (inlineEditingId && !(e.target as HTMLElement).closest('[data-inline-edit]')) {
                handleCommitInlineEdit();
            }
            if (isSettingsOpen && !(e.target as HTMLElement).closest('[data-settings-panel]') && !(e.target as HTMLElement).closest('[data-settings-trigger]')) {
                setIsSettingsOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('mousedown', handleMouseDown, true);

        // Mouse back/forward buttons for list navigation
        const handleMouseButton = (e: MouseEvent) => {
            if (e.button === 3) { // Back button
                e.preventDefault();
                // Priority: Folder Breadcrumbs -> List History
                if (breadcrumbs.length > 1) {
                    setBreadcrumbs(prev => prev.slice(0, -1));
                    // Ideally update currentFolderId based on breadcrumbs, but logic implies breadcrumbs drive view
                } else if (listHistory.length > 0) {
                    // Go back to previous list
                    const prevListId = listHistory[listHistory.length - 1];
                    setListForwardHistory(prev => [...prev, activeListId]); // Push to forward
                    setListHistory(prev => prev.slice(0, -1));
                    setActiveListId(prevListId);
                    // Reset view for target list
                    setCurrentFolderId(null);
                    setBreadcrumbs([{ id: 'root', title: 'الرئيسية' }]);
                    setExpandedFolderIds(new Set());
                }
            } else if (e.button === 4) { // Forward button
                e.preventDefault();
                if (listForwardHistory.length > 0) {
                    const nextListId = listForwardHistory[listForwardHistory.length - 1];
                    setListHistory(prev => [...prev, activeListId]); // Push to back
                    setListForwardHistory(prev => prev.slice(0, -1));
                    setActiveListId(nextListId);
                    // Reset view for target list
                    setCurrentFolderId(null);
                    setBreadcrumbs([{ id: 'root', title: 'الرئيسية' }]);
                    setExpandedFolderIds(new Set());
                }
            }
        };
        window.addEventListener('mouseup', handleMouseButton);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mousedown', handleMouseDown, true);
            window.removeEventListener('mouseup', handleMouseButton);
        };
    }, [hotkeys, contextMenu, selectedTaskIds, currentTasks, isModalOpen, isSettingsOpen, groupCreation.isOpen, inlineEditingId, isQuickAdding]);



    // Close menus on click outside
    useEffect(() => {
        const handleClickOutside = () => {
            if (activeMenuId) setActiveMenuId(null);
            if (isSortMenuOpen) setIsSortMenuOpen(false);
            if (folderActionPromptId) handleFolderPromptAction(folderActionPromptId, 'delete');
        };
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, [activeMenuId, isSortMenuOpen]);

    // --- SETTINGS LOGIC ---
    const handleExportData = () => {
        const data = {
            version: 1,
            date: new Date().toISOString(),
            lists,
            tasks,
            habits,
            habitCategoryOrder: localStorage.getItem('injaz_habit_categories_order'),
            habitCollapsedCategories: localStorage.getItem('injaz_habit_collapsed_categories'),
            dayTransitionHour: localStorage.getItem('injaz_day_transition_hour'),
            preferences: { hotkeys, autoBackupInterval, sortBy, appPreferences: preferences }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `injaz_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            let imported: any;
            try {
                imported = JSON.parse(event.target?.result as string);
            } catch (err) {
                console.error('Import JSON parse error:', err);
                setNotification({ message: 'خطأ في قراءة الملف، تأكد من صحة الملف.', type: 'error' });
                return;
            }

            // Apply imported data (outside try-catch to prevent false errors)
            if (imported.lists && Array.isArray(imported.lists)) setLists(imported.lists);
            if (imported.tasks && Array.isArray(imported.tasks)) {
                setTasks(imported.tasks);
                tasksRef.current = imported.tasks;
                undoStackRef.current = []; redoStackRef.current = [];
            }
            if (imported.habits && Array.isArray(imported.habits)) {
                setHabits(imported.habits);
                habitsRef.current = imported.habits;
            }
            if (imported.habitCategoryOrder) localStorage.setItem('injaz_habit_categories_order', imported.habitCategoryOrder);
            if (imported.habitCollapsedCategories) localStorage.setItem('injaz_habit_collapsed_categories', imported.habitCollapsedCategories);
            if (imported.dayTransitionHour) {
                localStorage.setItem('injaz_day_transition_hour', imported.dayTransitionHour);
                window.dispatchEvent(new Event('storage')); // Notify components watching this key
            }
            if (imported.preferences) {
                if (imported.preferences.hotkeys) setHotkeys(imported.preferences.hotkeys);
                if (imported.preferences.autoBackupInterval) setAutoBackupInterval(imported.preferences.autoBackupInterval);
                if (imported.preferences.appPreferences) setPreferences(imported.preferences.appPreferences);
            }

            // Show success notification
            setTimeout(() => {
                setNotification({ message: 'تم استيراد البيانات بنجاح!', type: 'success' });
                setIsSettingsOpen(false);
            }, 100);
        };
        reader.readAsText(file);
        // Reset input value to allow selecting the same file again
        e.target.value = '';
    };

    const recordHotkey = (action: 'newTask' | 'toggleSidebar' | 'globalQuickAdd' | 'toggleApp' | 'hideNotes') => {
        setRecordingAction(action);
        // Optional: specific logic if we want to clear the old hotkey immediately on start
        // setHotkeys(prev => ({ ...prev, [action]: '' })); 

        const handler = (e: KeyboardEvent) => {
            e.preventDefault();

            const isModifier = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);

            // 1. Calculate new accelerator string based on current keys held
            const modifiers = [];
            if (e.ctrlKey) modifiers.push('Ctrl');
            if (e.altKey) modifiers.push('Alt');
            if (e.shiftKey) modifiers.push('Shift');
            if (e.metaKey) modifiers.push('Super');

            let key = '';
            // Only add the main key if it's NOT a modifier
            if (!isModifier) {
                // Remove 'Key' prefix (KeyA -> A, Digit1 -> Digit1? No, usually usually code is fine, but let's stick to existing logic)
                key = e.code.replace('Key', '');
            }

            // Join parts
            const parts = [...modifiers];
            if (key) parts.push(key);
            const accelerator = parts.join('+');

            // 2. LIVE UPDATE: Update state immediately so user sees "Alt", "Alt+Shift", etc.
            if (accelerator) {
                setHotkeys(prev => ({ ...prev, [action]: accelerator }));
            }

            // 3. Stop condition: If a non-modifier key was pressed, we are done.
            if (!isModifier && key) {
                setRecordingAction(null);
                window.removeEventListener('keydown', handler);
                window.removeEventListener('click', clickHandler);
            }
        };
        const clickHandler = (e: MouseEvent) => {
            // Handle click outside to cancel? For now, we rely on the user successfully recording or clicking toggle again (which re-triggers, maybe ok).
            // If we want click-to-cancel, we'd need to check target. 
            // Simplest: just keep waiting for key input.
        };

        window.addEventListener('keydown', handler);
    };

    // --- LIST MANAGEMENT ---
    const handleAddList = (keepOpen: boolean = false) => {
        if (!newListTitle.trim()) {
            if (!keepOpen) setIsCreatingList(false);
            return;
        }
        const newList: TaskList = {
            id: generateId(),
            title: newListTitle,
            themeColor: ['indigo', 'pink', 'blue', 'purple', 'orange'][Math.floor(Math.random() * 5)]
        };
        setLists([...lists, newList]);
        setActiveListId(newList.id);
        setNewListTitle('');
        if (!keepOpen) {
            setIsCreatingList(false);
            setIsSidebarOpen(false);
        }
    };

    const handleQuickAddList = (title: string): string => {
        const newList: TaskList = {
            id: generateId(),
            title: title,
            themeColor: ['indigo', 'pink', 'blue', 'purple', 'orange'][Math.floor(Math.random() * 5)]
        };
        setLists(prev => [...prev, newList]);
        return newList.id;
    };

    const handleRenameList = () => {
        if (!renamingListTitle.trim() || !renamingListId) return;
        setLists(lists.map(l => l.id === renamingListId ? { ...l, title: renamingListTitle } : l));
        setRenamingListId(null);
        setRenamingListTitle('');
    };

    const startRenamingList = (e: React.MouseEvent, list: TaskList) => {
        e.stopPropagation();
        setRenamingListId(list.id);
        setRenamingListTitle(list.title);
    };

    const handleDeleteList = (id: string) => {
        if (lists.length <= 1) return;
        const newLists = lists.filter(l => l.id !== id);
        setLists(newLists);

        modifyTasks(prev => prev.filter(t => t.listId !== id));

        if (activeListId === id) setActiveListId(newLists[0].id);
        setListDeleteConfirm(null);
    };

    // ... (Keep existing drag handlers for List unchanged) ...
    const handleListDragStart = (e: React.DragEvent, id: string) => {
        setDraggedListId(id);
        e.dataTransfer.effectAllowed = 'move';
    };
    const handleListDragOver = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        if (draggedListId === targetId) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        setDragOverListId(targetId);
        setDragOverListPos(e.clientY < midY ? 'top' : 'bottom');
    };
    const handleListDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        if (!draggedListId || draggedListId === targetId) {
            setDraggedListId(null); setDragOverListId(null); setDragOverListPos(null); return;
        }
        const newLists = [...lists];
        const draggedIndex = newLists.findIndex(l => l.id === draggedListId);
        const targetIndex = newLists.findIndex(l => l.id === targetId);
        const [draggedItem] = newLists.splice(draggedIndex, 1);
        const freshTargetIndex = newLists.findIndex(l => l.id === targetId);
        const finalIndex = dragOverListPos === 'bottom' ? freshTargetIndex + 1 : freshTargetIndex;
        newLists.splice(finalIndex, 0, draggedItem);
        setLists(newLists);
        setDraggedListId(null); setDragOverListId(null); setDragOverListPos(null);
    };

    // --- TASK LOGIC ---

    const getFolderOptions = useCallback((list: Task[]): { id: string, title: string }[] => {
        let options: { id: string, title: string }[] = [];
        list.forEach(t => {
            if (t.type === 'folder') {
                options.push({ id: t.id, title: t.title });
                options = [...options, ...getFolderOptions(t.children)];
            }
        });
        return options;
    }, []);
    const availableFolders = React.useMemo(() => {
        const roots = tasks.filter(t => t.parentId === null && t.listId === activeListId);
        return getFolderOptions(roots);
    }, [tasks, activeListId, getFolderOptions]);
    const existingCategories = React.useMemo(() => {
        return currentTasks.filter(t => t.type === 'folder').map(t => t.title);
    }, [currentTasks]);

    const getCompletedTasksFlat = (list: Task[], parentName: string = 'الرئيسية', parentColor: string = '#cbd5e1'): { task: Task, origin: string, originColor: string }[] => {
        let completed: { task: Task, origin: string, originColor: string }[] = [];
        list.forEach(t => {
            if (t.isCompleted) {
                completed.push({ task: t, origin: parentName, originColor: parentColor });
            }
            const effectiveColor = t.type === 'folder' ? t.color : parentColor;
            const effectiveName = t.type === 'folder' ? t.title : parentName;
            if (t.children.length > 0) {
                completed = [...completed, ...getCompletedTasksFlat(t.children, effectiveName, effectiveColor)];
            }
        });
        return completed;
    };





    const flatCompletedTasks = React.useMemo(() => {
        const rootTasks = tasks.filter(t => t.parentId === null && t.listId === activeListId);
        const flats = getCompletedTasksFlat(rootTasks, 'الرئيسية', '#cbd5e1');
        // Sort by completedAt descending (newest first)
        return flats.sort((a, b) => {
            const timeA = a.task.completedAt || 0;
            const timeB = b.task.completedAt || 0;
            return timeB - timeA;
        });
    }, [tasks, activeListId]);

    const toggleFolderExpand = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setExpandedFolderIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
                // Deep Collapse: Recursively remove all children from expanded set to prevent "Ghost Blur"
                const task = findTask(id, tasks);
                if (task) {
                    const removeChildrenRecursive = (t: Task) => {
                        if (t.children && t.children.length > 0) {
                            t.children.forEach(child => {
                                newSet.delete(child.id);
                                removeChildrenRecursive(child);
                            });
                        }
                    };
                    removeChildrenRecursive(task);
                }
            } else {
                if (viewMode === 'groups') {
                    const task = findTask(id, tasks);
                    const isTaskWithChildren = task && task.type !== 'folder';
                    const multiExpandEnabled = preferences.multiExpandSubtasks !== false; // Default to true

                    if (!isTaskWithChildren || !multiExpandEnabled) {
                        // Force accordion behavior for folders, OR for tasks if multi-expand is disabled
                        newSet.clear();
                    }
                    newSet.add(id);
                } else if (preferences.autoCollapse) {
                    // Auto-collapse mode: Close everything except ancestors
                    const ancestors = new Set<string>();
                    let current = findTask(id, tasks);
                    while (current && current.parentId) {
                        ancestors.add(current.parentId);
                        current = findTask(current.parentId, tasks);
                    }

                    // Rebuild set: Keep only ancestors, add new one
                    const nextSet = new Set<string>();
                    prev.forEach(expandedId => {
                        if (ancestors.has(expandedId)) nextSet.add(expandedId);
                    });
                    nextSet.add(id);
                    return nextSet;
                } else {
                    newSet.add(id);
                }
            }
            return newSet;
        });
    };

    const handleSaveTask = (taskData: Partial<Task>) => {
        if (editingTask) {
            updateTask(editingTask.id, taskData);
        } else {
            addTask(taskData);
        }
        setEditingTask(null);
    };

    const handleQuickAddFolder = (title: string): string => {
        const newId = generateId();
        const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const newFolder: Task = {
            id: newId,
            title: title,
            type: 'folder',
            priority: Priority.Medium,
            color: randomColor,
            parentId: null,
            listId: activeListId,
            children: [],
            isCompleted: false,
            createdAt: Date.now()
        };
        modifyTasks(prev => [...prev, newFolder]);
        return newId;
    };

    const handleAddNewGroup = () => {
        const newFolderId = handleQuickAddFolder('');
        // Focus tasks tab if not already there
        if (activeTab !== 'tasks') setActiveTab('tasks');
        
        // Start inline editing immediately
        setTimeout(() => {
            setInlineEditingId(newFolderId);
            setInlineEditText('');
        }, 150);
        return newFolderId;
    };

    const removeTaskRecursive = (list: Task[], idToDelete: string): Task[] => {
        return list.filter(t => t.id !== idToDelete).map(t => {
            if (t.children && t.children.length > 0) {
                return { ...t, children: removeTaskRecursive(t.children, idToDelete) };
            }
            return t;
        });
    };
    const removeTaskById = (list: Task[], idToRemove: string): Task[] => { return removeTaskRecursive(list, idToRemove); };

    const updateTask = (id: string, updates: Partial<Task>, merge = false) => {
        // Sync title to Google if it's a synced task
        if (updates.title !== undefined) {
            const task = findTask(id, tasks);
            if (task && task.isGoogleSynced && task.googleTaskId) {
                const ipc = (window as any).require?.('electron')?.ipcRenderer;
                if (ipc) {
                    ipc.invoke('google-tasks:update-task', {
                        tokens: googleTokens,
                        taskId: task.googleTaskId,
                        listId: googleListId,
                        title: updates.title
                    });
                }
            }
        }

        modifyTasks(prevTasks => {
            const originalTask = findTask(id, prevTasks);

            if (originalTask && updates.listId && updates.listId !== originalTask.listId) {
                // Move to another list
                const tasksWithoutItem = removeTaskById(prevTasks, id);
                const updatedTask = {
                    ...originalTask,
                    ...updates,
                    parentId: updates.parentId !== undefined ? updates.parentId : null,
                    listId: updates.listId
                };
                if (updatedTask.parentId) {
                    return addTaskToFolderById(tasksWithoutItem, updatedTask.parentId, updatedTask);
                }
                return [...tasksWithoutItem, updatedTask];
            } else if (originalTask && updates.parentId !== undefined && updates.parentId !== (originalTask.parentId || 'root')) {
                // Move folders
                const tasksWithoutItem = removeTaskById(prevTasks, id);
                const updatedTask = { ...originalTask, ...updates };
                const targetId = updatedTask.parentId || 'root';
                return addTaskToFolderById(tasksWithoutItem, targetId, updatedTask);
            } else {
                const updateRecursive = (list: Task[]): Task[] => {
                    return list.map(t => {
                        if (t.id === id) return { ...t, ...updates };
                        if (t.children.length > 0) return { ...t, children: updateRecursive(t.children) };
                        return t;
                    });
                };
                return updateRecursive(prevTasks);
            }
        }, merge);
    };

    const requestDeleteTask = (e: React.MouseEvent | undefined, id: string) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        setDeleteConfirmation({ isOpen: true, taskId: id });
    };
    const confirmDeleteTask = () => {
        const id = deleteConfirmation.taskId;
        if (id) {
            // Soft Delete: Mark as completed instead of removing
            toggleComplete(id);
            setIsModalOpen(false); setEditingTask(null); setActiveMenuId(null);
        }
        setDeleteConfirmation({ isOpen: false, taskId: null });
    };
    const cancelDeleteTask = () => { setDeleteConfirmation({ isOpen: false, taskId: null }); };

    const handleInlinePasteImage = useCallback((e: React.ClipboardEvent, taskId: string) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const dataUrl = event.target?.result as string;
                        // Capture current text to prevent it from being lost on re-render
                        const currentText = inlineEditRef.current?.innerText || '';
                        updateTask(taskId, { imageUrl: dataUrl, title: currentText.trim() || undefined });
                    };
                    reader.readAsDataURL(blob);
                    e.preventDefault();
                    return;
                }
            }
        }
    }, [updateTask]);

    // --- INLINE EDIT HANDLERS ---
    const handleCommitInlineEdit = () => {
        if (!inlineEditingId || !inlineEditRef.current) return;

        // Capture the content BEFORE clearing any state
        // Check tag name to handle both Input (controlled) and ContentEditable (uncontrolled)
        let newText = '';
        if (inlineEditRef.current.tagName === 'INPUT' || inlineEditRef.current.tagName === 'TEXTAREA') {
            newText = (inlineEditRef.current as HTMLInputElement).value;
        } else {
            newText = inlineEditRef.current.innerText; // Use innerText to avoid HTML tags
            if (!newText.trim() && inlineEditRef.current.textContent) newText = inlineEditRef.current.textContent;
        }

        const taskId = inlineEditingId;
        const task = findTask(taskId, tasks);

        // Clear state first
        setInlineEditingId(null);
        setInlineEditText('');

        // Delete if empty, otherwise update
        if (!newText.trim()) {
            modifyTasks(prevTasks => removeTaskRecursive(prevTasks, taskId));
        } else if (task && !task.title) {
            // New task being committed
            const trimmedTitle = newText.trim();
            updateTask(taskId, { title: trimmedTitle }, true);

            // If it's a google task, create it on Google
            if (task.isGoogleSynced && !task.googleTaskId) {
                const ipc = (window as any).require?.('electron')?.ipcRenderer;
                if (ipc) {
                    // We find the parent's google taskId if possible
                    let googleParentId: string | undefined = undefined;
                    if (task.parentId && task.parentId !== 'google_main_folder') {
                        const parentTask = findTask(task.parentId, tasks);
                        if (parentTask && parentTask.googleTaskId) {
                            googleParentId = parentTask.googleTaskId;
                        }
                    }

                    ipc.invoke('google-tasks:create-task', {
                        tokens: googleTokens,
                        listId: googleListId,
                        title: trimmedTitle,
                        parentId: googleParentId
                    }).then(newGoogleId => {
                        if (newGoogleId) {
                            updateTask(taskId, { googleTaskId: newGoogleId }, true);
                        }
                    });
                }
            }
        } else {
            updateTask(taskId, { title: newText.trim() });
        }
    };

    // Set innerHTML when inline editing starts (but don't reset on every render)
    useEffect(() => {
        if (inlineEditingId && inlineEditRef.current) {
            const element = inlineEditRef.current;

            // Scroll element into view - use 'auto' for instant scroll
            // Scroll element into view - removed as per user request to prevent jumping
            // element.scrollIntoView({ behavior: 'auto', block: 'center' });

            // Set content
            element.innerHTML = inlineEditText || '';

            // Focus immediately
            element.focus();

            // Move cursor to start for empty content (ready for typing)
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const sel = window.getSelection();
                    if (!element) return;

                    // 1. Try to position based on Click Coordinates (if available)
                    if (clickPosRef.current && document.caretRangeFromPoint) {
                        const range = document.caretRangeFromPoint(clickPosRef.current.x, clickPosRef.current.y);
                        if (range && element.contains(range.startContainer)) {
                            sel?.removeAllRanges();
                            sel?.addRange(range);
                            clickPosRef.current = null; // Consume
                            element.focus(); // Ensure focus
                            return;
                        }
                    }

                    // 2. Fallback: Collapse to end
                    const range = document.createRange();
                    if (element.childNodes.length > 0) {
                        range.selectNodeContents(element);
                        range.collapse(false); // Collapse to end
                    } else {
                        range.setStart(element, 0);
                        range.collapse(true);
                    }
                    sel?.removeAllRanges();
                    sel?.addRange(range);

                    // Final focus
                    element.focus();
                });
            });
        }
    }, [inlineEditingId, inlineEditText]);


    // Auto-collapse groups on first entry based on behavior setting
    useEffect(() => {
        if (viewMode === 'groups' && !hasInitGroupsRef.current) {
            hasInitGroupsRef.current = true;
            const behavior = preferences.startupGroupBehavior || 'lastOpened';

            const allFolderIds = tasks
                .filter(t => t.type === 'folder')
                .map(t => t.id);

            if (behavior === 'collapseAll') {
                if (allFolderIds.length > 0) {
                    setCollapsedGroupIds(new Set([...allFolderIds, '__ungrouped__']));
                } else {
                    setCollapsedGroupIds(new Set(['__ungrouped__']));
                }
            } else if (behavior === 'uncategorized') {
                if (allFolderIds.length > 0) {
                    setCollapsedGroupIds(new Set(allFolderIds));
                }
            }
            // If 'lastOpened', do nothing (state is initialized from localStorage)
        }
    }, [viewMode, preferences.startupGroupBehavior, tasks]);

    const seenColumnsRef = useRef<Set<string>>(new Set());
    const hasPopulatedSeenColumnsRef = useRef(false);

    // Auto-collapse newly populated groups (e.g. from quick note background additions)
    useEffect(() => {
        // Only start tracking after initial group behavior has been applied
        if (viewMode === 'groups' || hasInitGroupsRef.current) {
            const currentColumnIds = tasks
                .filter(t => t.type === 'folder' && (t.children || []).some(c => !c.isCompleted))
                .map(t => t.id);

            const hasUngrouped = tasks.some(t => t.type !== 'folder' && !t.isCompleted);
            if (hasUngrouped) currentColumnIds.push('__ungrouped__');

            if (!hasPopulatedSeenColumnsRef.current) {
                currentColumnIds.forEach(id => seenColumnsRef.current.add(id));
                hasPopulatedSeenColumnsRef.current = true;
                return;
            }

            const newColumnIds = currentColumnIds.filter(id => !seenColumnsRef.current.has(id));
            if (newColumnIds.length > 0) {
                setCollapsedGroupIds(prev => new Set([...prev, ...newColumnIds]));
            }

            currentColumnIds.forEach(id => seenColumnsRef.current.add(id));
        }
    }, [tasks, viewMode]);


    // Auto-hide notification after 3 seconds
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => {
                setNotification(null);
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    // Handle Enter key for list deletion confirmation
    useEffect(() => {
        if (!listDeleteConfirm) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleDeleteList(listDeleteConfirm);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [listDeleteConfirm]);

    const handleStartInlineEdit = (e: React.MouseEvent, task: Task) => {
        e.stopPropagation();

        // Save coordinates for precise cursor placement
        clickPosRef.current = { x: e.clientX, y: e.clientY };

        // Commit any previous edit if we are switching tasks
        if (inlineEditingId && inlineEditingId !== task.id) {
            handleCommitInlineEdit();
        }
        setInlineEditingId(task.id);
        setInlineEditText(task.title);
    };

    const confirmQuickAdd = (keepOpen: boolean = true) => {
        if (!quickAddTitle.trim()) {
            setIsQuickAdding(false);
            return;
        }
        addTask({ title: quickAddTitle, priority: quickAddPriority });
        setQuickAddTitle('');
        setQuickAddPriority(Priority.Medium);
        if (!keepOpen) {
            setIsQuickAdding(false);
        }
    };

    const confirmCreateGroup = () => {
        // Delegate to generic createGroup helper using modal-provided name
        const ids = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : (groupCreation.sourceId ? [groupCreation.sourceId] : []);
        createGroup(ids, newGroupName.trim() || 'مجموعة جديدة', false);
        setGroupCreation({ isOpen: false, sourceId: null, targetId: null });
        setNewGroupName('');
    };
    const cancelGroupCreation = () => {
        setGroupCreation({ isOpen: false, sourceId: null, targetId: null });
        setNewGroupName(''); setDraggedTaskId(null); setDragOverTaskId(null); setDragOverPosition(null);
    };

    const toggleComplete = (id: string) => {
        // Fix: Remove from selection if it was selected
        if (selectedTaskIds.has(id)) {
            setSelectedTaskIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
            });
        }

        // Fix 'Ghost Blur': Remove from expanded set if it's being completed/deleted
        if (expandedFolderIds.has(id)) {
            setExpandedFolderIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
            });
        }

        modifyTasks(prevTasks => {
            const toggledTask = findTask(id, prevTasks);
            
            const toggleRecursive = (list: Task[]): Task[] => {
                return list.map(t => {
                    if (t.id === id) {
                        const isNowComplete = !t.isCompleted;

                        // NEW LOGIC: Only apply "Reset to Empty" if the parent is NOT a folder (i.e. it's a regular task with subtasks)
                        if (isNowComplete && t.parentId && t.parentId !== 'root') {
                            const parent = findTask(t.parentId, prevTasks);
                            if (parent && parent.type !== 'folder') {
                                // Count active non-empty siblings including this one
                                const activeNonEmpty = parent.children.filter(c => !c.isCompleted && c.title.trim() !== '');
                                if (activeNonEmpty.length === 1 && activeNonEmpty[0].id === id) {
                                    // It's the last one! Clear its title and keep it incomplete
                                    return {
                                        ...t,
                                        title: '',
                                        isCompleted: false
                                    };
                                }
                            }
                        }

                        if (t.isGoogleSynced && t.googleTaskId) {
                            try {
                                const ipc = (window as any).require?.('electron')?.ipcRenderer;
                                if (ipc) ipc.invoke('google-tasks:update-task', { 
                                    tokens: googleTokens, 
                                    taskId: t.googleTaskId, 
                                    listId: t.googleListId || googleListId, 
                                    completed: isNowComplete 
                                });
                            } catch (e) { console.error('Failed to update Google Task:', e); }
                        }
                        return {
                            ...t,
                            isCompleted: isNowComplete,
                            completedAt: isNowComplete ? Date.now() : undefined
                        };
                    }
                    if (t.children.length > 0) return { ...t, children: toggleRecursive(t.children) };
                    return t;
                });
            };

            let newTasks = toggleRecursive(prevTasks);

            // NEW: Collapse parent task if its last subtask is finished (Item Parents only)
            if (toggledTask && toggledTask.parentId && toggledTask.parentId !== 'root') {
                const parent = findTask(toggledTask.parentId, newTasks);
                if (parent && parent.type !== 'folder') {
                    const wasIncomplete = !toggledTask.isCompleted;
                    if (wasIncomplete) {
                        // Check if there are no more non-empty active subtasks
                        const hasActive = parent.children.some(c => !c.isCompleted && c.title.trim() !== '');
                        if (!hasActive) {
                            // All subtasks are done (or the last one was reset to empty).
                            // COLLAPSE the parent task instead of completing it.
                            setExpandedFolderIds(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(parent.id)) {
                                    newSet.delete(parent.id);
                                    return newSet;
                                }
                                return prev;
                            });
                        }
                    }
                }
            }

            // [ORIGINAL LOGIC]: Check if this was the last task in a folder
            if (toggledTask && toggledTask.parentId && toggledTask.parentId !== 'root' && !toggledTask.isCompleted) {
                let folderId: string | null = null;
                let currentId: string | undefined = toggledTask.parentId;
                let folderTask: Task | null = null;
                
                // Traverse up to find the folder that contains this task
                while (currentId && currentId !== 'root') {
                    const p = findTask(currentId, newTasks);
                    if (!p) break;
                    if (p.type === 'folder') {
                        folderId = p.id;
                        folderTask = p;
                        break;
                    }
                    currentId = p.parentId;
                }

                if (folderTask) {
                    const effectiveCount = getEffectiveTaskCount(folderTask.children);
                    const hasActive = folderTask.children.some(c => !c.isCompleted);
                    
                    if (!hasActive) {
                        // Completely empty of active tasks (Original logic -> show prompt)
                        setFolderActionPromptId(folderTask.id);
                    } else if (effectiveCount === 0) {
                        // Folder has active tasks (e.g. parent tasks), BUT effective count is 0.
                        // This means it only contains parent tasks with instructional subtasks!
                        
                        // Collapse the folder immediately to trigger the closing animation
                        setCollapsedGroupIds(prev => {
                            const newSet = new Set(prev);
                            newSet.add(folderTask!.id);
                            return newSet;
                        });

                        // Delay archiving by 500ms to allow the collapse animation to play out
                        setTimeout(() => {
                            updateTask(folderTask!.id, { isArchived: true });
                        }, 500);
                    }
                }
            }

            // [ORIGINAL LOGIC]: Fix 'Ghost Blur'
            if (expandedFolderIds.size > 0) {
                setTimeout(() => {
                    setExpandedFolderIds(prev => {
                        const newSet = new Set(prev);
                        let changed = false;
                        const checkFolder = (list: Task[]): void => {
                            for (const t of list) {
                                if (t.type === 'folder' && prev.has(t.id)) {
                                    const hasIncompleteChildren = t.children.some(child => !child.isCompleted);
                                    if (!hasIncompleteChildren) {
                                        newSet.delete(t.id);
                                        changed = true;
                                    }
                                }
                                if (t.children.length > 0) checkFolder(t.children);
                            }
                        };
                        checkFolder(newTasks);
                        return changed ? newSet : prev;
                    });
                }, 100);
            }

            return newTasks;
        });
    };
    
    const handleCompleteInGroups = (id: string) => {
        const targetTask = findTask(id, tasks);
        if (!targetTask || targetTask.isCompleted || !preferences.completionAnimation) {
            toggleComplete(id);
            return;
        }

        setCompletingTaskId(id);
        setTimeout(() => {
            toggleComplete(id);
            setCompletingTaskId(null);
        }, 250); // Matches the premium animation duration
    };

    const handleFolderPromptAction = (folderId: string, action: 'archive' | 'delete') => {
        if (action === 'delete') {
            modifyTasks(prev => removeTaskById(prev, folderId));
        }
        // If 'archive', we just clear the prompt. 
        // The folder is already "archived" in our logic because it has no active tasks
        // and won't be shown once folderActionPromptId is null.
        setFolderActionPromptId(null);
    };

    const handleDragStart = (e: React.DragEvent, taskId: string) => {
        // Enforce Handle-Only Dragging using Ref (Robust)
        if (!isDragHandleDown.current) {
            e.preventDefault();
            return;
        }

        const task = findTask(taskId, tasks);

        // If dragging an item that is NOT selected, clear selection and select just this one
        if (!selectedTaskIds.has(taskId)) {
            setSelectedTaskIds(new Set([taskId]));
        }
        setDraggedTaskId(taskId);
        e.dataTransfer.setData('text/plain', taskId);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
    };

    const handleDragOver = (e: React.DragEvent, task: Task) => {
        e.preventDefault(); e.stopPropagation();
        // Do not allow dragging a selection onto one of its own members
        if (selectedTaskIds.has(task.id)) return;

        setDragOverTaskId(task.id);

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        // Auto-scroll when dragging near window edges
        const scrollThreshold = 100;
        if (e.clientY < scrollThreshold) {
            window.scrollBy(0, -15);
        } else if (e.clientY > window.innerHeight - scrollThreshold) {
            window.scrollBy(0, 15);
        }

        // Standard positioning
        if (task.type === 'folder') {
            if (y < height * 0.25) setDragOverPosition('top');
            else if (y > height * 0.75) setDragOverPosition('bottom');
            else setDragOverPosition('center');
        } else {
            if (y < height * 0.4) setDragOverPosition('top');
            else if (y > height * 0.6) setDragOverPosition('bottom');
            else setDragOverPosition('center');
        }
    };

    const handleDrop = (e: React.DragEvent, targetTask: Task) => {
        e.preventDefault(); e.stopPropagation();
        const draggedId = e.dataTransfer.getData('text/plain');

        const idsToMove = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : [draggedId];

        // Check for circular drag-and-drop (dragging a parent into its own child)
        const isDescendantOfAny = idsToMove.some(id => {
            const parentTask = findTask(id, tasks);
            if (!parentTask || !parentTask.children) return false;

            const checkChildren = (children: Task[]): boolean => {
                for (const child of children) {
                    if (child.id === targetTask.id) return true;
                    if (child.children && child.children.length > 0 && checkChildren(child.children)) return true;
                }
                return false;
            };
            return checkChildren(parentTask.children);
        });

        if (idsToMove.includes(targetTask.id) || isDescendantOfAny) {
            setDragOverTaskId(null); setDraggedTaskId(null); setDragOverPosition(null); return;
        }

        // Recalculate position from EVENT explicitly to avoid stale state
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        let dropPos: 'top' | 'bottom' | 'center' = 'center';

        if (targetTask.type === 'folder') {
            if (y < height * 0.25) dropPos = 'top';
            else if (y > height * 0.75) dropPos = 'bottom';
            else dropPos = 'center';
        } else {
            // Standard for items
            if (y < height * 0.4) dropPos = 'top';
            else if (y > height * 0.6) dropPos = 'bottom';
            else dropPos = 'center';
        }

        if (dropPos === 'top' || dropPos === 'bottom') {
            // Switch to custom sort mode
            if (sortBy !== 'custom') setSortBy('custom');

            const draggedId = idsToMove[0];
            const targetId = targetTask.id;

            // NEW SOLUTION: Tree-Based Move (Handles Cross-Folder & Reparenting)
            modifyTasks(prevGlobal => {
                let taskToMove: Task | null = null;
                let removalSuccess = false;

                // 1. Recursive Remove (Immutable)
                const removeRecursive = (list: Task[]): Task[] => {
                    const newList: Task[] = [];
                    let listChanged = false;

                    for (const t of list) {
                        if (t.id === draggedId) {
                            taskToMove = t;
                            listChanged = true;
                            removalSuccess = true;
                            continue; // Skip (Remove)
                        }

                        // Recursive check
                        if (t.children && t.children.length > 0) {
                            const newChildren = removeRecursive(t.children);
                            if (newChildren !== t.children) {
                                newList.push({ ...t, children: newChildren });
                                listChanged = true;
                                continue;
                            }
                        }

                        newList.push(t);
                    }
                    return listChanged ? newList : list;
                };

                const newGlobal = removeRecursive(prevGlobal);

                if (!taskToMove || !removalSuccess) return prevGlobal; // Failed to find/remove

                // 2. Prepare Task (Reparent)
                // Prevent circular logic: Cannot move parent into its own child
                const isCircular = (parent: Task, childId: string): boolean => {
                    if (parent.id === childId) return true;
                    if (parent.children) return parent.children.some(c => isCircular(c, childId));
                    return false;
                };

                // 3. Insert into Destination
                const newParentId = targetTask.parentId;
                let insertionSuccess = false;

                // Helper: Recursive Insert
                const insertRecursive = (list: Task[]): Task[] => {
                    // Case A: Target is at current level
                    const targetIndex = list.findIndex(x => x.id === targetTask.id);
                    if (targetIndex !== -1) {
                        const insertAt = dropPos === 'bottom' ? targetIndex + 1 : targetIndex;
                        const updatedTask = { ...taskToMove!, parentId: newParentId, listId: targetTask.listId };

                        // Check circular before inserting?
                        // Actually, we just need to ensure we aren't inserting inside ourselves.
                        // But we already removed ourselves from the tree, so we can't be found in the tree unless we have a clone.
                        // Assuming unique IDs.

                        const newList = [...list];
                        newList.splice(insertAt, 0, updatedTask);
                        insertionSuccess = true;
                        return newList;
                    }

                    // Case B: Look deeper (only if target parent matches or we need to find it)
                    return list.map(t => {
                        // Optimization: Only traverse if we haven't inserted yet
                        if (!insertionSuccess && t.children && t.children.length > 0) {
                            const newChildren = insertRecursive(t.children);
                            if (newChildren !== t.children) {
                                return { ...t, children: newChildren };
                            }
                        }
                        return t;
                    });
                };

                // Special check for Root Level insertion attempts logic mismatch
                // If newParentId is null, we expect to find target in root list.
                // If newParentId is NOT null, we expect to find target inside that parent.

                // The insertRecursive above is generic: it looks for targetTask in list OR children.
                // This is correct because we stripped taskToMove, so the target must exist somewhere valid.

                const finalGlobal = insertRecursive(newGlobal);

                if (!insertionSuccess) {
                    console.error("Failed to insert task after removal! Reverting.");
                    return prevGlobal;
                }

                return finalGlobal;
            });
        } else if (dropPos === 'center') {
            if (targetTask.type === 'folder') {
                moveTasksToFolder(idsToMove, targetTask.id);
            } else {
                // Target is item -> Create Group
                setGroupCreation({ isOpen: true, sourceId: idsToMove[0], targetId: targetTask.id });
            }
        }

        setDragOverTaskId(null); setDragOverPosition(null); setSelectedTaskIds(new Set()); setDraggedTaskId(null);
    };

    const handleDragEnd = () => {
        isDragHandleDown.current = false; // Reset
        setDraggedTaskId(null);
        setDragOverTaskId(null);
        setDragOverPosition(null);
        setSelectedTaskIds(new Set());
    };

    const moveTasksToFolder = (draggedIds: string[], targetFolderId: string) => {
        modifyTasks(currentList => {
            const itemsToMove: Task[] = [];
            let list = [...currentList];

            draggedIds.forEach(id => {
                const t = findTask(id, list);
                if (t) {
                    itemsToMove.push(t);
                    list = removeTaskById(list, id);
                }
            });

            if (itemsToMove.length === 0) return currentList;

            let finalTasks = list;
            itemsToMove.forEach(task => {
                const updatedTask = { ...task, parentId: targetFolderId === 'root' ? null : targetFolderId };
                finalTasks = addTaskToFolderById(finalTasks, targetFolderId, updatedTask);
            });

            return finalTasks;
        });
        setDraggedTaskId(null); setDragOverTaskId(null); setDragOverPosition(null); setSelectedTaskIds(new Set());
    };

    const reorderTasksMulti = (draggedIds: string[], targetId: string, position: 'top' | 'bottom') => {
        modifyTasks(currentList => {
            // 1. Find all dragged items and remove them
            const itemsToMove: Task[] = [];
            let list = [...currentList];

            draggedIds.forEach(id => {
                const t = findTask(id, list);
                if (t) {
                    itemsToMove.push(t);
                    list = removeTaskById(list, id);
                }
            });

            if (itemsToMove.length === 0) return currentList;

            // 2. Find target's parent list
            const findParentList = (tasks: Task[], tid: string): { parent: Task | null, siblings: Task[] } | null => {
                // Check root level
                const rootIdx = tasks.findIndex(t => t.id === tid);
                if (rootIdx > -1) return { parent: null, siblings: tasks };

                // Check children recursively
                for (const t of tasks) {
                    if (t.children && t.children.length > 0) {
                        const childIdx = t.children.findIndex(c => c.id === tid);
                        if (childIdx > -1) return { parent: t, siblings: t.children };

                        const deeper = findParentList(t.children, tid);
                        if (deeper) return deeper;
                    }
                }
                return null;
            };

            const parentInfo = findParentList(list, targetId);
            if (!parentInfo) return currentList;

            const { parent, siblings } = parentInfo;
            const targetIndex = siblings.findIndex(t => t.id === targetId);
            const insertIndex = position === 'top' ? targetIndex : targetIndex + 1;

            // 3. Update parentId for moved items
            const newParentId = parent ? parent.id : null;
            const preparedItems = itemsToMove.map(t => ({ ...t, parentId: newParentId }));

            // 4. Insert items at correct position
            if (parent === null) {
                // Root level insertion
                const newList = [...list];
                newList.splice(insertIndex, 0, ...preparedItems);
                return newList;
            } else {
                // Nested insertion - update parent's children
                const updateParentChildren = (tasks: Task[]): Task[] => {
                    return tasks.map(t => {
                        if (t.id === parent.id) {
                            const newChildren = [...t.children];
                            newChildren.splice(insertIndex, 0, ...preparedItems);
                            return { ...t, children: newChildren };
                        }
                        if (t.children && t.children.length > 0) {
                            return { ...t, children: updateParentChildren(t.children) };
                        }
                        return t;
                    });
                };
                return updateParentChildren(list);
            }
        });

        setDraggedTaskId(null);
        setDragOverTaskId(null);
        setDragOverPosition(null);
        setSelectedTaskIds(new Set());
    };


    const openEditModal = (task: Task) => { setEditingTask(task); setIsModalOpen(true); };
    const openNewTaskModal = () => { setEditingTask(null); setIsModalOpen(true); };
    const handleMenuToggle = (e: React.MouseEvent, taskId: string) => {
        e.stopPropagation(); e.preventDefault(); setActiveMenuId(activeMenuId === taskId ? null : taskId);
    };

    // --- CONTEXT MENU HANDLERS ---
    const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
        e.preventDefault();
        e.stopPropagation();

        // Toggle logic: If already open for this task, close it.
        if (contextMenu.isOpen && contextMenu.taskId === taskId) {
            setContextMenu(prev => ({ ...prev, isOpen: false }));
            return;
        }

        setContextMenu({
            isOpen: true,
            x: e.clientX / preferences.zoom,
            y: e.clientY / preferences.zoom,
            taskId: taskId,
            source: 'context'
        });
        setActiveSubmenu(null);
        // If right-clicked item is not in selection, select it exclusively
        if (!selectedTaskIds.has(taskId)) {
            setSelectedTaskIds(new Set([taskId]));
        }
    };

    const handleChangePriority = (taskId: string, priority: Priority) => {
        updateTask(taskId, { priority });
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        setActiveSubmenu(null);
    };

    const handleMoveToList = (taskId: string, listId: string) => {
        updateTask(taskId, { listId });
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        setActiveSubmenu(null);
    };

    const handleQuickDate = (taskId: string, date: string) => {
        updateTask(taskId, { dueDate: date });
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        setActiveSubmenu(null);
    };

    // Bulk change priority for selected tasks (or single)
    const changePriorityForSelected = (priority: Priority) => {
        if (selectedTaskIds.size === 0 && !contextMenu.taskId) return;
        const ids = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : [contextMenu.taskId!];
        modifyTasks(prev => {
            const updateRecursive = (list: Task[]): Task[] => {
                return list.map(t => {
                    if (ids.includes(t.id)) {
                        return { ...t, priority };
                    }
                    if (t.children && t.children.length > 0) {
                        return { ...t, children: updateRecursive(t.children) };
                    }
                    return t;
                });
            };
            return updateRecursive(prev);
        });
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        setActiveSubmenu(null);
        setSelectedTaskIds(new Set());
    };

    // Move selected tasks to another list
    const moveSelectedToList = (listId: string) => {
        if (selectedTaskIds.size === 0 && !contextMenu.taskId) return;
        const ids = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : [contextMenu.taskId!];
        modifyTasks(prev => {
            const updateRecursive = (list: Task[]): Task[] => {
                return list.map(t => {
                    if (ids.includes(t.id)) {
                        return { ...t, listId, parentId: null };
                    }
                    if (t.children && t.children.length > 0) {
                        return { ...t, children: updateRecursive(t.children) };
                    }
                    return t;
                });
            };
            return updateRecursive(prev);
        });
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        setActiveSubmenu(null);
        setSelectedTaskIds(new Set());
    };

    // --- SELECTION BOX HANDLERS ---
    const handleSelectionMouseDown = (e: React.MouseEvent) => {
        // Ignore if clicking on a task or interactive element
        if ((e.target as HTMLElement).closest('[data-task-card]') ||
            (e.target as HTMLElement).closest('button') ||
            (e.target as HTMLElement).closest('input') ||
            (e.target as HTMLElement).closest('textarea') ||
            (e.target as HTMLElement).isContentEditable) { // Added contentEditable ignore
            return;
        }
        if (activeTab !== 'tasks') return;

        setIsSelecting(true);
        const rect = selectionRef.current?.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY + window.scrollY; // Handle scroll
        setSelectionBox({ startX, startY, currentX: startX, currentY: startY });

        // Clear selection if not holding shift/ctrl
        if (!e.shiftKey && !e.ctrlKey) {
            setSelectedTaskIds(new Set());
        }
    };

    const handleSelectionMouseMove = (e: React.MouseEvent) => {
        if (!isSelecting || !selectionBox) return;

        const currentX = e.clientX;
        const currentY = e.clientY + window.scrollY;
        setSelectionBox({ ...selectionBox, currentX, currentY });

        // Calculate intersection
        const boxLeft = Math.min(selectionBox.startX, currentX);
        const boxRight = Math.max(selectionBox.startX, currentX);
        const boxTop = Math.min(selectionBox.startY, currentY);
        const boxBottom = Math.max(selectionBox.startY, currentY);

        const newSelected = new Set(selectedTaskIds);

        const taskElements = document.querySelectorAll('[data-task-card]');
        taskElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            const taskTop = rect.top + window.scrollY;

            const intersect = !(rect.left > boxRight ||
                rect.right < boxLeft ||
                taskTop > boxBottom ||
                (taskTop + rect.height) < boxTop);

            const taskId = el.getAttribute('data-task-id');
            if (taskId) {
                if (intersect) newSelected.add(taskId);
                else if (!e.shiftKey && !e.ctrlKey) newSelected.delete(taskId);
            }
        });
        setSelectedTaskIds(newSelected);
    };

    const handleSelectionMouseUp = () => {
        setIsSelecting(false);
        setSelectionBox(null);
    };

    // --- BULK ACTIONS ---
    const handleBulkComplete = () => {
        modifyTasks(prevTasks => {
            const completeRecursive = (list: Task[]): Task[] => {
                return list.map(t => {
                    let newTask = t;
                    // If specifically selected, mark complete
                    if (selectedTaskIds.has(t.id) && !t.isCompleted) {
                        newTask = { ...t, isCompleted: true };
                        // Sync to Google
                        if (t.isGoogleSynced && t.googleTaskId) {
                            try {
                                const ipc = (window as any).require?.('electron')?.ipcRenderer;
                                if (ipc) ipc.invoke('google-tasks:update-task', { 
                                    tokens: googleTokens, 
                                    taskId: t.googleTaskId, 
                                    listId: t.googleListId || googleListId, 
                                    completed: true 
                                });
                            } catch (e) { console.error('Failed to sync bulk completion to Google:', e); }
                        }
                    }
                    // Recursively check children
                    if (t.children && t.children.length > 0) {
                        newTask = { ...newTask, children: completeRecursive(t.children) };
                    }
                    return newTask;
                });
            };
            return completeRecursive(prevTasks);
        });
        setSelectedTaskIds(new Set());
    };

    const performBulkDelete = () => {
        // Fix: Clean up expandedFolderIds for deleted/completed items
        if (expandedFolderIds.size > 0 && selectedTaskIds.size > 0) {
            setExpandedFolderIds(prev => {
                const newSet = new Set(prev);
                let changed = false;
                selectedTaskIds.forEach(id => {
                    if (newSet.has(id)) {
                        newSet.delete(id);
                        changed = true;
                    }
                });
                return changed ? newSet : prev;
            });
        }

        modifyTasks(prevTasks => {
            const deleteRecursive = (list: Task[]): Task[] => {
                return list.map(t => {
                    // Soft Delete Selected: Mark as complete
                    if (selectedTaskIds.has(t.id)) {
                        // Sync to Google if it's a synced task
                        if (t.isGoogleSynced && t.googleTaskId && !t.isCompleted) {
                            try {
                                const ipc = (window as any).require?.('electron')?.ipcRenderer;
                                if (ipc) ipc.invoke('google-tasks:update-task', { 
                                    tokens: googleTokens, 
                                    taskId: t.googleTaskId, 
                                    listId: t.googleListId || googleListId, 
                                    completed: true 
                                });
                            } catch (e) { console.error('Failed to sync deletion completion to Google:', e); }
                        }
                        return {
                            ...t,
                            isCompleted: true,
                            completedAt: Date.now()
                        };
                    }
                    if (t.children && t.children.length > 0) {
                        return { ...t, children: deleteRecursive(t.children) };
                    }
                    return t;
                });
            };
            return deleteRecursive(prevTasks);
        });
        setSelectedTaskIds(new Set());
        setIsBulkDeleteModalOpen(false);
    };

    const handleBulkGroupInit = () => {
        setGroupCreation({ isOpen: true, sourceId: null, targetId: null });
        setNewGroupName('');
    };





    const renderTaskCard = (task: Task, inheritedColor: string | null = null, originBadge: { name: string, color: string } | null = null, index: number = 0, total: number = 1, isSubTask: boolean = false) => {
        const isDragged = draggedTaskId === task.id;
        const isDragOver = dragOverTaskId === task.id;
        const isMenuOpen = activeMenuId === task.id;
        const isExpanded = expandedFolderIds.has(task.id);
        const isSelected = selectedTaskIds.has(task.id);
        const isEditing = inlineEditingId === task.id;

        const activeChildren = task.children ? task.children.filter(t => !t.isCompleted || t.id === recentlyCompletedId) : [];
        const sortedChildren = getSortedList(activeChildren);

        // Tie opacity directly to the task count: if the task "counts" (shows a number),
        // it's a real task and should have full opacity. If it doesn't count (0), dim it.
        const isEditingChild = (task.children || []).some(c => c.id === inlineEditingId);
        const isEmptyParent = !task.isCompleted
            && getEffectiveTaskCount([task]) === 0
            && inlineEditingId !== task.id
            && !isEditingChild;


        let baseColor = task.color;
        let shadowClass = isSelected ? 'shadow-md ring-2 ring-indigo-400 bg-indigo-50' : 'shadow-sm hover:shadow-md bg-white';

        if (task.type === 'item') {
            const priorityColors = { [Priority.High]: '#ef4444', [Priority.Medium]: '#3b82f6', [Priority.Low]: '#334155' };
            baseColor = priorityColors[task.priority] || '#64748b';
        }
        if (!baseColor || baseColor === 'default') baseColor = '#64748b';
        const isDraggable = !task.isCompleted && !isMenuOpen && !isEditing;

        // Focus Mode Logic: Apply to ALL tasks
        const isAnyFolderExpanded = expandedFolderIds.size > 0;
        const isChildOfExpandedFolder = inheritedColor !== null;
        let focusClass = '';
        if (preferences.focusBlur !== false && isAnyFolderExpanded && !isExpanded && !isChildOfExpandedFolder && !isSubTask) {
            focusClass = 'blur-[2px] opacity-40 brightness-75 grayscale-[0.2] hover:blur-0 hover:opacity-100 hover:brightness-100 hover:grayscale-0 transition-all duration-500 ease-in-out';
        }

        if (task.type === 'folder') {
            const hasChildren = activeChildren.length > 0;
            const isEmpty = activeChildren.length === 0;

            // Focus Mode logic moved to top

            return (
                <div key={task.id} className={`mb-3 transition-all duration-500 ease-in-out ${isExpanded ? 'bg-gray-50/60 rounded-2xl border border-gray-100 shadow-sm' : ''} ${focusClass}`}>
                    {/* Header Row */}
                    <div
                        data-task-card
                        data-task-id={task.id}
                        draggable={false}
                        onDragOver={(e) => handleDragOver(e, task)}
                        onDrop={(e) => handleDrop(e, task)}
                        onContextMenu={(e) => handleContextMenu(e, task.id)}
                        onClick={(e) => toggleFolderExpand(e, task.id)}
                        className={`group flex items-center gap-2 p-3 cursor-pointer transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isExpanded ? 'border-b border-gray-100/50' : 'hover:bg-gray-50 rounded-lg'} ${isDragOver && dragOverPosition === 'center' ? 'bg-indigo-50 ring-2 ring-indigo-200' : ''} ${isDragged ? 'opacity-50 scale-[0.98]' : ''} ${isEmpty ? 'opacity-[0.85]' : ''} ${isSelected ? 'ring-2 ring-indigo-400 rounded-lg bg-indigo-50' : ''}`}
                        style={isEmptyParent ? { opacity: 0.5 } : {}}
                    >
                        <div onClick={(e) => toggleFolderExpand(e, task.id)} className={`cursor-pointer p-1 transition-transform duration-300 ease-out ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                            <Icons.ChevronDown size={20} className="text-gray-400" />
                        </div>
                        {task.pinStatus && (
                            <div 
                                className={`absolute left-2 ${task.pinStatus === 'top' ? 'top-3' : 'bottom-3'} w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] z-10`}
                                title={task.pinStatus === 'top' ? 'مثبت في الأعلى' : 'مثبت في الأسفل'}
                            />
                        )}

                        <div onClick={(e) => toggleFolderExpand(e, task.id)} className="flex-1 text-lg text-gray-800 flex items-center gap-2 cursor-pointer transition-all duration-300 rounded-lg px-2 py-0.5">
                            {!isEditing && (
                                <div
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        // Toggle: if already open as priority-dot, close it.
                                        if (contextMenu.isOpen && contextMenu.taskId === task.id && contextMenu.source === 'priority-dot') {
                                            setContextMenu(prev => ({ ...prev, isOpen: false }));
                                            return;
                                        }
                                        setContextMenu({
                                            isOpen: true,
                                            x: e.clientX / preferences.zoom,
                                            y: e.clientY / preferences.zoom,
                                            taskId: task.id,
                                            source: 'priority-dot'
                                        });
                                    }}
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300 opacity-0 group-hover:opacity-100 cursor-pointer hover:scale-150 mt-4 ${task.priority === Priority.High ? 'bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.9)]' : ''} ${task.priority === Priority.Medium ? 'bg-indigo-500 shadow-[0_0_16px_rgba(99,102,241,0.9)]' : ''} ${task.priority === Priority.Low ? 'bg-gray-400' : ''}`}
                                />
                            )}

                            {isEditing ? (
                                <div
                                    ref={inlineEditRef as any}
                                    data-inline-edit
                                    contentEditable
                                    onBlur={handleCommitInlineEdit}
                                    onInput={(e) => setInlineEditText(e.currentTarget.textContent || '')}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleCommitInlineEdit();
                                        }
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            cancelInlineEdit();
                                        }
                                    }}
                                    className="flex-1 bg-transparent border-b-2 border-indigo-500 focus:outline-none px-1 pb-1 whitespace-pre-wrap break-words overflow-wrap-anywhere outline-none min-h-[1.5em] leading-relaxed"
                                    autoFocus
                                    dir={task.title ? 'auto' : 'rtl'}
                                    placeholder={isSubTask ? "مهمة فرعية جديدة" : "مهمة جديدة"}
                                    onClick={(e) => e.stopPropagation()}
                                    dangerouslySetInnerHTML={{ __html: inlineEditText }}
                                />
                            ) : (
                                <span 
                                    className={`text-lg text-red-600 leading-relaxed transition-all duration-300 ${task.isCompleted ? 'line-through text-gray-400' : ''}`}
                                    style={isEmptyParent ? { opacity: 0.5 } : {}}
                                >
                                    {task.title}
                                </span>
                            )}
                            {activeChildren.length > 0 && (
                                <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full font-en mx-2 inline-block shadow-sm" style={{ fontFamily: 'Acme' }}>
                                    {task.type === 'folder' ? activeChildren.length : activeChildren.filter(c => c.title.trim() !== '').length}
                                </span>
                            )}
                        </div>

                        <div className="relative flex items-center" onClick={e => e.stopPropagation()}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    setContextMenu({
                                        isOpen: true,
                                        x: (e.clientX + (document.dir === 'rtl' ? 10 : -10)) / preferences.zoom,
                                        y: (e.clientY + 20) / preferences.zoom,
                                        taskId: task.id,
                                        source: 'trigger'
                                    });
                                }}
                                className="p-1 px-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition"
                            >
                                <Icons.More size={18} />
                            </button>
                        </div>
                    </div >

                    {/* Smart Dynamic Height Animation */}
                    <div
                        className={`grid transition-all duration-[550ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                    >
                        <div className="overflow-hidden">
                            <div className="flex flex-col divide-y divide-gray-100/40 pt-1">
                                {hasChildren ? sortedChildren.map((child, idx) => (
                                    <div
                                        key={child.id}
                                        className={`transition-all duration-[550ms] ease-out transform ${isExpanded ? 'opacity-100 blur-0 translate-y-0' : 'opacity-0 blur-sm translate-y-12'}`}
                                        style={{ transitionDelay: `${isExpanded ? idx * 50 : (sortedChildren.length - 1 - idx) * 20}ms` }}
                                    >
                                        {renderTaskCard(child, task.color, null, idx, activeChildren.length)}
                                    </div>
                                )) : <div className="py-6 text-center text-sm text-gray-400 italic bg-gray-50/30">لا يوجد مهام في هذا القسم</div>}
                            </div>
                        </div>
                    </div >
                </div >
            );

        }
        const containerClasses = (isChildOfExpandedFolder ? `group/card relative p-3 rounded-lg transition-colors duration-200` : `group/card relative mb-2 p-3 rounded-xl border border-gray-100 transition-all duration-300 ${shadowClass}`) + (sortedChildren.length > 0 ? ' cursor-pointer' : ' cursor-default') + ` ${focusClass} transition-all duration-300`;

        return (
            <React.Fragment key={task.id}>
                <div
                    data-task-card
                    data-task-id={task.id}
                    draggable={isDraggable}
                    onDragStart={(e) => isDraggable && handleDragStart(e, task.id)}
                    onDragOver={(e) => handleDragOver(e, task)}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverTaskId(null); setDragOverPosition(null); } }}
                    onDrop={(e) => handleDrop(e, task)}
                    onDragEnd={handleDragEnd}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                    // Click to select/deselect if Ctrl is held, otherwise let bubble up to clear
                    // Click to select/deselect if Ctrl is held, otherwise let bubble up to clear
                    onClick={(e) => {
                        // Special handling for Parent Tasks: Toggle Expand on single click
                        if (sortedChildren.length > 0 && !e.ctrlKey && !e.metaKey && !isEditing) {
                            e.stopPropagation();
                            toggleFolderExpand(e, task.id);
                            return;
                        }

                        if (e.ctrlKey || e.metaKey) {
                            e.stopPropagation();
                            const newSet = new Set(selectedTaskIds);
                            if (newSet.has(task.id)) newSet.delete(task.id);
                            else newSet.add(task.id);
                            setSelectedTaskIds(newSet);
                        } else {
                            // Standard Click: Select strictly this one
                            e.stopPropagation();
                            setSelectedTaskIds(new Set([task.id]));
                        }
                    }}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        // Parent Tasks: Double click empty space ignored.
                        // Renaming is handled via double click on the title TEXT only.
                    }}
                    className={` ${containerClasses} ${recentlyCompletedId === task.id ? 'animate-task-fadeout' : ''} ${(Date.now() - task.createdAt) < 2000 ? 'animate-slideDown' : ''} ${task.isCompleted && recentlyCompletedId !== task.id ? 'opacity-60' : ''} ${isDragged ? 'opacity-50 scale-[0.98]' : ''} ${isDragOver && dragOverPosition === 'top' ? 'shadow-[0_-4px_12px_-2px_rgba(129,140,248,0.5)]' : ''} ${isDragOver && dragOverPosition === 'bottom' ? 'shadow-[0_4px_12px_-2px_rgba(129,140,248,0.5)]' : ''}`}
                    style={{ ...(isEmptyParent ? { opacity: 0.5 } : {}) }}
                >
                    {/* Background highlight for the whole group - triggered by header hover */}
                    <div className="absolute inset-0 bg-indigo-50/30 opacity-0 group-hover/header:opacity-100 pointer-events-none transition-opacity duration-200" />
                    
                    {isDragOver && dragOverPosition === 'center' && <div className="absolute inset-0 border-2 border-indigo-500 rounded-xl z-20 bg-indigo-50/20 pointer-events-none flex items-center justify-center animate-fadeIn"><div className="bg-indigo-600 text-white text-xs px-2 py-1 rounded shadow-md font-bold">إنشاء مجموعة</div></div>}

                    <div className="group/header relative z-10 flex items-start gap-3 hover:bg-indigo-50/60 rounded-lg transition-all duration-200">
                        {/* Drag Handle */}
                        <div
                            data-drag-handle
                            className={`cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-opacity mt-3 ${isDragged ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            onMouseDown={(e) => {
                                isDragHandleDown.current = true;
                                // Allow drag start to bubble up to the parent div which has onDragStart
                            }}
                        >
                            <Icons.Grip size={14} />
                        </div>
                        {task.pinStatus && (
                            <div 
                                className={`absolute left-2 ${task.pinStatus === 'top' ? 'top-2' : 'bottom-2'} w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] z-10`}
                                title={task.pinStatus === 'top' ? 'مثبت في الأعلى' : 'مثبت في الأسفل'}
                            />
                        )}
                        {sortedChildren.length > 0 && (
                            <button
                                onClick={(e) => { e.stopPropagation(); toggleFolderExpand(e, task.id); }}
                                className={`p-0.5 transition-transform duration-300 mt-1.5 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                            >
                                <Icons.ChevronDown size={14} className="text-gray-400" />
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); toggleComplete(task.id); }}
                            className={`rounded-full flex items-center justify-center border active:scale-90 mt-2.5 ${recentlyCompletedId === task.id ? 'animate-complete-pop' : ''} ${isSubTask ? 'w-4 h-4 border-gray-300' : 'w-6 h-6 border-2'}`}
                            style={{
                                backgroundColor: task.isCompleted ? (isSubTask ? '#9ca3af' : '#22c55e') : 'transparent',
                                borderColor: task.isCompleted ? (isSubTask ? '#9ca3af' : '#22c55e') : (isSubTask ? '#d1d5db' : baseColor),
                            }}
                        >
                            <Icons.Check
                                size={isSubTask ? 10 : 16}
                                style={{
                                    color: task.isCompleted ? 'white' : 'transparent',
                                    transform: task.isCompleted ? 'scale(1)' : 'scale(0)',
                                    transition: 'all 0.2s ease-out'
                                }}
                            />
                        </button>
                        <div className="flex-1 min-w-0">
                            {/* Sub-Task Full Line Click Target */}
                            <div
                                className={`flex items-start gap-2 w-full ${(isSubTask || sortedChildren.length > 0) ? 'flex-1 h-full min-h-[32px]' : ''} ${isSubTask ? 'cursor-text' : (sortedChildren.length > 0 ? 'cursor-pointer' : '')}`}
                                onClick={(e) => {
                                    if (isSubTask && !isEditing) {
                                        handleStartInlineEdit(e, task);
                                    } else if (sortedChildren.length > 0) {
                                        e.stopPropagation(); // Critical: Prevent bubbling to Card
                                        toggleFolderExpand(e, task.id);
                                    }
                                }}
                            >
                                {isEditing ? (
                                    <div
                                        ref={inlineEditRef}
                                        data-inline-edit
                                        contentEditable
                                        suppressContentEditableWarning
                                        onPaste={(e) => handleInlinePasteImage(e, task.id)}
                                        dir={getDirection(inlineEditText)}
                                        className={`w-full cursor-text bg-transparent border-b border-indigo-500 focus:outline-none text-gray-900 resize-none overflow-hidden whitespace-pre-wrap break-words overflow-wrap-anywhere outline-none py-1 leading-loose ${isSubTask ? 'text-base opacity-70' : 'text-lg'}`}

                                        onBlur={() => {
                                            if (!isEnterPressed.current) {
                                                handleCommitInlineEdit();
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'ArrowUp') {
                                                e.preventDefault();
                                                handleMoveTask(task.id, e.shiftKey ? 'top' : 'up', e.repeat);
                                            }
                                            if (e.key === 'ArrowDown') {
                                                e.preventDefault();
                                                handleMoveTask(task.id, e.shiftKey ? 'bottom' : 'down', e.repeat);
                                            }

                                            if (e.key === 'Enter') {
                                                if (e.shiftKey) {
                                                    // Allow default behavior (new line)
                                                    return;
                                                }
                                                
                                                e.preventDefault();

                                                if (e.ctrlKey) {
                                                    if (isSubTask && task.parentId) {
                                                        const currentText = inlineEditRef.current?.innerText?.trim();
                                                        if (currentText) {
                                                            updateTask(task.id, { title: currentText }, !task.title);
                                                            const newId = addTask({ title: '', priority: Priority.Medium, parentId: task.parentId, listId: activeListId });
                                                            setExpandedFolderIds(prev => new Set(prev).add(task.parentId!));
                                                            setInlineEditingId(newId);
                                                            setInlineEditText('');
                                                            isEnterPressed.current = true;
                                                            setTimeout(() => { isEnterPressed.current = false; }, 100);
                                                        } else {
                                                            handleCommitInlineEdit();
                                                        }
                                                    } else {
                                                        // Standard Task Infinite Creation Mode
                                                        const currentText = inlineEditRef.current?.innerText?.trim();
                                                        if (currentText) {
                                                            updateTask(task.id, { title: currentText }, !task.title);
                                                            const newId = addTask({ title: '', priority: Priority.Medium, parentId: undefined, listId: activeListId });

                                                            setInlineEditingId(newId);
                                                            setInlineEditText('');
                                                            isEnterPressed.current = true;
                                                            setTimeout(() => { isEnterPressed.current = false; }, 100);
                                                        } else {
                                                            handleCommitInlineEdit();
                                                        }
                                                    }
                                                } else {
                                                    handleCommitInlineEdit();
                                                }
                                            }

                                            if (e.key === 'Escape') {
                                                e.preventDefault();
                                                handleCommitInlineEdit(); // Save and Close
                                            }

                                            if (e.key === 'Tab') {
                                                e.preventDefault();
                                                handleCommitInlineEdit();
                                                // Create sub-task
                                                const newId = addTask({
                                                    title: '',
                                                    priority: Priority.Medium,
                                                    parentId: task.id,
                                                    listId: activeListId
                                                });
                                                setExpandedFolderIds(prev => new Set(prev).add(task.id));
                                                // Trigger focus on new sub-task
                                                setTimeout(() => {
                                                    setInlineEditingId(newId);
                                                    setInlineEditText('');
                                                }, 100);
                                            }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    // Render HTML Title safely
                                    <div
                                        onClick={(e) => {
                                            // For Parent Tasks (folders), we let the event bubble up to the container
                                            // which handles the toggle behavior efficiently.
                                            if (sortedChildren.length === 0) {
                                                e.stopPropagation();
                                                handleStartInlineEdit(e, task);
                                            }
                                        }}
                                        onDoubleClick={(e) => {
                                            if (sortedChildren.length > 0) {
                                                e.stopPropagation();
                                                handleStartInlineEdit(e, task);
                                            }
                                        }}
                                        className={`w-full ${isSubTask ? 'cursor-text' : (sortedChildren.length > 0 ? 'cursor-pointer' : 'cursor-default')} whitespace-pre-wrap transition-all duration-500 ${isSubTask ? 'text-base opacity-50' : 'text-lg'} ${task.isCompleted ? 'text-gray-400 line-through decoration-gray-400' : 'text-gray-900'} ${sortedChildren.length > 0 ? 'font-bold underline decoration-1 underline-offset-4 decoration-indigo-200' : ''}`}
                                        style={isEmptyParent ? { opacity: 0.5 } : {}}
                                        dir={getDirection(task.title)}
                                        dangerouslySetInnerHTML={{ __html: task.title || (isSubTask ? '<span class="italic text-gray-400">مهمة فرعية جديدة</span>' : '') }}
                                    />
                                )}
                                {originBadge && !isEditing && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{originBadge.name}</span>}
                            </div>
                            {task.imageUrl && (
                                <div 
                                    className="mt-2 mb-1 rounded-lg overflow-hidden border border-gray-100/60 shadow-sm bg-gray-50 cursor-zoom-in group/listimg"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(task.imageUrl, '_blank');
                                    }}
                                >
                                    <img 
                                        src={task.imageUrl} 
                                        alt="" 
                                        className="w-full h-auto max-h-48 object-cover transition-transform duration-500 group-hover/listimg:scale-105" 
                                        onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                                    />
                                </div>
                            )}
                            {task.dueDate && !isEditing && <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 font-en"><Icons.Clock size={10} /> {task.dueDate}</div>}
                        </div>
                        <div className="relative flex items-center" onClick={e => e.stopPropagation()}>
                            <div className="relative flex items-center" onClick={e => e.stopPropagation()}>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setContextMenu({
                                            isOpen: true,
                                            x: e.clientX / preferences.zoom,
                                            y: e.clientY / preferences.zoom + 20,
                                            taskId: task.id,
                                            source: 'trigger'
                                        });
                                    }}
                                    className="p-1 px-2 text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded-full transition opacity-0 group-hover:opacity-100"
                                >
                                    <Icons.More size={16} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Render children for regular items too (Sub-tasks) */}
                    {sortedChildren.length > 0 && (
                        <div
                            className={`grid transition-all duration-[550ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'} relative mr-[9px]`}
                            style={{ paddingRight: '19px' }}
                        >
                            {/* Rounded "Quarter Square" connectors */}
                            <div className="absolute top-[12px] right-[-2px] w-[12px] h-[12px] border-r-2 border-t-2 border-gray-200/50 rounded-tr-lg" />
                            <div className="absolute top-[24px] bottom-[20px] right-[-2px] border-r-2 border-gray-200/50" />
                            <div className="absolute bottom-[8px] right-[-2px] w-[12px] h-[12px] border-r-2 border-b-2 border-gray-200/50 rounded-br-lg" />
                            <div className="overflow-hidden">
                                <div className="flex flex-col pt-3 pb-2">
                                    {sortedChildren.map((child, idx) => (
                                        <div
                                            key={child.id}
                                            className={`transition-all duration-[550ms] ease-out transform ${isExpanded ? 'opacity-100 blur-0 translate-x-0' : 'opacity-0 blur-sm translate-x-4'}`}
                                            style={{ transitionDelay: `${isExpanded ? idx * 50 : (sortedChildren.length - 1 - idx) * 20}ms` }}
                                        >
                                            {idx > 0 && <div className="mx-10 h-px bg-gray-200/50 my-1" />}
                                            {renderTaskCard(child, inheritedColor, null, idx, sortedChildren.length, true)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </React.Fragment >
        );
    };

    const contextMenuTask = contextMenu.taskId ? findTask(contextMenu.taskId, tasks) : null;

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // Skip ALL shortcuts if user is typing in any input or contentEditable
            const activeEl = document.activeElement as HTMLElement;
            const tag = activeEl?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable) return;

            if (e.key === 'F5') {
                e.preventDefault();
                setIsReordering(true);
                setTimeout(() => setIsReordering(false), 400);
                modifyTasks(prev => {
                    const sortRecursive = (list: Task[]): Task[] => {
                        // 1. Sort current level
                        const sorted = [...list].sort((a, b) => {
                            // Folders always go to bottom
                            if (a.type !== b.type) return a.type === 'folder' ? 1 : -1;

                            // If folders, sort by task count (asc)
                            if (a.type === 'folder' && b.type === 'folder') {
                                const aCount = (a.children || []).filter(c => !c.isCompleted && c.type !== 'folder').length;
                                const bCount = (b.children || []).filter(c => !c.isCompleted && c.type !== 'folder').length;
                                return aCount - bCount;
                            }

                            // Sort by Priority (Ascending value: 1=High, 3=Low)
                            // We want High(1) first, so a.priority - b.priority
                            if (a.priority !== b.priority) {
                                return a.priority - b.priority;
                            }
                            return 0;
                        });

                        // 2. Recurse for children
                        return sorted.map(t => {
                            if (t.children && t.children.length > 0) {
                                return { ...t, children: sortRecursive(t.children) };
                            }
                            return t;
                        });
                    };
                    return sortRecursive(prev);
                });

                // Show notification and change sort indicator to priority
                setSortBy('priority');

                // Trigger Google Tasks Sync
                syncGoogleTasks();
            }
            if (e.code === 'KeyQ' || e.key === 'ض') {
                if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                    const tag = (document.activeElement as HTMLElement)?.tagName;
                    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
                        e.preventDefault();
                        setActiveTab(prev => prev === 'habits' ? 'tasks' : 'habits');
                    }
                }
            }
            // W / و = toggle between habits and tasks (keeping last viewMode)
            if (e.code === 'KeyW' || e.key === 'و' || e.key === 'ص') {
                if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                    const tag = (document.activeElement as HTMLElement)?.tagName;
                    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
                        // User's request: Don't return from habits, and skip if handled by widget nav
                        if (activeTab === 'habits') return;
                        if (activeTab === 'tasks' && viewMode === 'groups') return;

                        e.preventDefault();
                        setActiveTab('habits');
                    }
                }
            }

            // New Group shortcut (Shift + N)
            const isShiftN = (e.key === 'N' && e.shiftKey) || (e.code === 'KeyN' && e.shiftKey);
            if (isShiftN && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const activeEl = document.activeElement as HTMLElement;
                const tag = activeEl?.tagName;
                const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable;
                
                if (!isInput) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleAddNewGroup();
                    return;
                }
            }
            // New Task shortcut (N / ى / ن)
            const isNKey = e.key.toLowerCase() === 'n' || e.code === 'KeyN' || e.key === 'ى' || e.key === 'ن' || e.which === 78;
            if (isNKey) {
                if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                    const activeEl = document.activeElement as HTMLElement;
                    const tag = activeEl?.tagName;
                    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable;

                    if (!isInput) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (activeTab === 'tasks') {
                            if (viewMode === 'groups') {
                                // Intelligent group selection for 'N'
                                // 1. Find all folders that are currently acting as columns
                                const folders = tasks.filter(t => t.type === 'folder' && t.listId === activeListId && !t.isArchived);
                                const expandedFolders = folders.filter(f => {
                                    const hasActiveChildren = (f.children || []).some(c => !c.isCompleted);
                                    return !collapsedGroupIds.has(f.id) && hasActiveChildren;
                                });

                                let targetParentId: string | null = null;
                                if (expandedFolders.length > 0) {
                                    targetParentId = expandedFolders[0].id;
                                } else if (!collapsedGroupIds.has('__ungrouped__')) {
                                    targetParentId = null;
                                } else {
                                    // Fallback: If everything is collapsed, pick the first available or ungrouped
                                    targetParentId = expandedFolders.length > 0 ? expandedFolders[0].id : null;
                                }

                                const newId = addTask({ title: '', priority: Priority.Medium, parentId: targetParentId, listId: activeListId });
                                
                                // Prevent auto-collapse effect from hiding our newly opened group
                                seenColumnsRef.current.add(targetParentId || '__ungrouped__');

                                // Ensure the target group is expanded
                                setCollapsedGroupIds(prev => {
                                    const next = new Set(prev);
                                    next.delete(targetParentId || '__ungrouped__');
                                    return next;
                                });

                                setTimeout(() => {
                                    setInlineEditingId(newId);
                                    setInlineEditText('');
                                }, 150);
                            } else {
                                setIsQuickAdding(true);
                            }
                        }
                    }
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [modifyTasks, activeTab, viewMode, addTask, activeListId, tasks, collapsedGroupIds]);

    // --- EFFECT: AUTO-ARCHIVE INSTRUCTIONAL-ONLY GROUPS (e.g. after Undo) ---
    useEffect(() => {
        const timeoutIds: NodeJS.Timeout[] = [];
        
        tasks.forEach(t => {
            if (t.type === 'folder' && !t.isArchived && t.listId === activeListId) {
                const hasActive = t.children.some(c => !c.isCompleted);
                const effectiveCount = getEffectiveTaskCount(t.children);
                
                // Only target folders with 0 effective count BUT still having active tasks (instructional only)
                if (hasActive && effectiveCount === 0) {
                    const isEditing = inlineEditingId === t.id || t.children.some(c => c.id === inlineEditingId || (c.children && c.children.some(sub => sub.id === inlineEditingId)));
                    
                    if (!isEditing) {
                        // Collapse immediately
                        setCollapsedGroupIds(prev => {
                            if (prev.has(t.id)) return prev;
                            const next = new Set(prev);
                            next.add(t.id);
                            return next;
                        });
                        
                        // Delay archive
                        const tid = setTimeout(() => {
                            updateTask(t.id, { isArchived: true });
                        }, 500);
                        timeoutIds.push(tid);
                    }
                }
            }
        });
        
        return () => timeoutIds.forEach(clearTimeout);
    }, [tasks, activeListId, inlineEditingId, getEffectiveTaskCount]);

    // --- EFFECT: WIDGET ARROW NAVIGATION ---
    useEffect(() => {
        const handleWidgetNavigation = (e: KeyboardEvent) => {
            if (activeTab !== 'tasks' || viewMode !== 'groups') return;
            
            // Skip shortcuts if user is typing in any input or contentEditable
            const activeEl = document.activeElement as HTMLElement;
            const tag = activeEl?.tagName;
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable;
            if (isInput || inlineEditingId) return;

            // Toggle Expand/Collapse (W / ص)
            if (e.key === 'w' || e.key === 'W' || e.key === 'ص' || e.key === 'و') {
                e.preventDefault();
                const sortedActive = currentTasks.filter(t => (!t.isCompleted && !t.isArchived) || t.id === recentlyCompletedId);
                const folders = sortedActive.filter(t => t.type === 'folder');
                const allIds = folders.map(f => f.id);
                if (sortedActive.some(t => t.type !== 'folder' && t.parentId === null)) {
                    allIds.push('__ungrouped__');
                }
                
                const isAnyCollapsed = allIds.some(id => collapsedGroupIds.has(id));
                if (isAnyCollapsed) {
                    setCollapsedGroupIds(new Set());
                } else {
                    setCollapsedGroupIds(new Set(allIds));
                }
                return;
            }

            // Collapse All Only (S / س)
            if (e.key === 's' || e.key === 'S' || e.key === 'س') {
                e.preventDefault();
                const sortedActive = currentTasks.filter(t => (!t.isCompleted && !t.isArchived) || t.id === recentlyCompletedId);
                const folders = sortedActive.filter(t => t.type === 'folder');
                const allIds = folders.map(f => f.id);
                if (sortedActive.some(t => t.type !== 'folder' && t.parentId === null)) {
                    allIds.push('__ungrouped__');
                }
                setCollapsedGroupIds(new Set(allIds));
                return;
            }


            const isRight = e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'ي' || e.key === 'د';
            const isLeft = e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ش';

            if (isRight || isLeft) {
                // Replicate column calculation logic from JSX (lines 3900+)
                const sortedActive = currentTasks.filter(t => (!t.isCompleted && !t.isArchived) || t.id === recentlyCompletedId);
                const folders = sortedActive
                    .filter(t => t.type === 'folder')
                    .sort((a, b) => a.priority - b.priority);
                const ungrouped = sortedActive.filter(t => t.type !== 'folder');

                const cols: string[] = [];
                folders.forEach(folder => {
                    const activeChildren = (folder.children || []).filter(c => !c.isCompleted);
                    if (activeChildren.length > 0 || folderActionPromptId === folder.id) {
                        cols.push(folder.id);
                    }
                });

                if (ungrouped.length > 0) {
                    cols.push('__ungrouped__');
                }

                if (cols.length === 0) return;

                // Find currently "open" column
                let currentIndex = cols.findIndex(id => !collapsedGroupIds.has(id));
                let nextIndex;

                if (currentIndex === -1) {
                    // If all closed, start at the first one
                    nextIndex = 0;
                } else {
                    nextIndex = currentIndex;
                    // RTL Support: Right goes to lower index (visually right), Left goes to higher index (visually left)
                    if (isRight) {
                        nextIndex = currentIndex - 1;
                    } else if (isLeft) {
                        nextIndex = currentIndex + 1;
                    }
                }

                if (nextIndex >= 0 && nextIndex < cols.length) {
                    e.preventDefault();
                    const targetId = cols[nextIndex];
                    
                    // Simulate click: Open target and handle auto-collapse
                    setCollapsedGroupIds(prev => {
                        const next = new Set(prev);
                        next.delete(targetId); // Open target
                        
                        if (preferences.autoCollapse) {
                            cols.forEach(id => {
                                if (id !== targetId) next.add(id);
                            });
                        }
                        return next;
                    });

                    // Smooth scroll to the target column
                    setTimeout(() => {
                        const targetEl = document.getElementById(`widget-col-${targetId}`);
                        if (targetEl && groupsContainerRef.current) {
                            targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                        }
                    }, 50);
                }
            }
        };

        window.addEventListener('keydown', handleWidgetNavigation);
        return () => window.removeEventListener('keydown', handleWidgetNavigation);
    }, [activeTab, viewMode, currentTasks, recentlyCompletedId, collapsedGroupIds, folderActionPromptId, preferences.autoCollapse, inlineEditingId]);

    return (
        <div
            className="min-h-screen flex flex-col bg-white text-slate-800 font-naskh"
            onMouseDown={handleSelectionMouseDown}
            onMouseMove={handleSelectionMouseMove}
            onMouseUp={handleSelectionMouseUp}
            ref={selectionRef}
        >
            {/* Notification */}
            {notification && (
                <div className={`fixed top-24 inset-x-0 mx-auto max-w-fit -translate-x-24 z-[10000] pointer-events-none ${isNotificationExiting ? 'animate-fade-out' : 'animate-fadeIn'}`}>
                    <div className={`px-6 py-4 rounded-xl shadow-2xl border pointer-events-auto min-w-[300px] bg-white ${notification.type === 'success'
                        ? 'border-l-4 border-l-green-500 border-gray-100'
                        : 'border-l-4 border-l-red-500 border-gray-100'
                        }`}>
                        <div className="flex items-center gap-4">
                            {notification.type === 'success' ? (
                                <div className="bg-green-100 p-2 rounded-full">
                                    <Icons.Check size={24} className="text-green-600" />
                                </div>
                            ) : (
                                <div className="bg-red-100 p-2 rounded-full">
                                    <Icons.Close size={24} className="text-red-600" />
                                </div>
                            )}
                            <div>
                                <h3 className={`font-bold text-base ${notification.type === 'success' ? 'text-gray-800' : 'text-gray-800'}`}>
                                    {notification.type === 'success' ? 'نجاح' : 'تنبيه'}
                                </h3>
                                <p className={`text-sm ${notification.type === 'success' ? 'text-gray-600' : 'text-gray-600'
                                    }`}>
                                    {notification.message}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Navbar */}
            <nav className="bg-white border-b border-gray-100 px-4 py-3 grid grid-cols-3 items-center sticky top-0 z-30" style={{ WebkitAppRegion: 'drag' } as any}>
                <div className="flex items-center gap-3 justify-start" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <div className="flex items-center gap-2">
                        <div className="bg-indigo-600 p-2 rounded-lg text-white"><Icons.Check size={24} /></div>
                        <h1 className="text-xl font-bold text-indigo-900">إنجاز</h1>
                    </div>
                </div>

                <div className="flex gap-2 justify-center" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <div className="relative">
                        <button
                            data-settings-trigger
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                            className={`p-2 rounded-lg transition ${isSettingsOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50 hover:text-indigo-600'}`}
                            title="الإعدادات"
                        >
                            <Icons.Settings size={20} />
                        </button>
                    </div>

                    {/* COMPACT SETTINGS DROPDOWN */}
                    {isSettingsOpen && (
                        <div
                            data-settings-panel
                            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[440px] bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden animate-fadeIn z-[70] origin-top"
                        >
                            {/* Header Tabs */}
                            <div 
                                className="flex border-b border-gray-100 bg-gray-50/50"
                                onWheel={(e) => {
                                    const tabs: any[] = ['appearance', 'general', 'shortcuts', 'behavior', 'habits', 'connections'];
                                    const currentIndex = tabs.indexOf(settingsTab);
                                    if (e.deltaY > 0) {
                                        const prev = (currentIndex - 1 + tabs.length) % tabs.length;
                                        setSettingsTab(tabs[prev]);
                                    } else if (e.deltaY < 0) {
                                        const next = (currentIndex + 1) % tabs.length;
                                        setSettingsTab(tabs[next]);
                                    }
                                }}
                            >
                                <button
                                    onClick={() => setSettingsTab('appearance')}
                                    className={`flex-1 py-3 text-[13px] font-bold transition ${settingsTab === 'appearance' ? 'text-indigo-600 bg-white border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    المظهر
                                </button>
                                <button
                                    onClick={() => setSettingsTab('general')}
                                    className={`flex-1 py-3 text-[13px] font-bold transition ${settingsTab === 'general' ? 'text-indigo-600 bg-white border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    البيانات
                                </button>
                                <button
                                    onClick={() => setSettingsTab('shortcuts')}
                                    className={`flex-1 py-3 text-[13px] font-bold transition ${settingsTab === 'shortcuts' ? 'text-indigo-600 bg-white border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    الاختصارات
                                </button>
                                <button
                                    onClick={() => setSettingsTab('behavior')}
                                    className={`flex-1 py-3 text-[13px] font-bold transition ${settingsTab === 'behavior' ? 'text-indigo-600 bg-white border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    السلوك
                                </button>
                                <button
                                    onClick={() => setSettingsTab('habits')}
                                    className={`flex-1 py-3 text-[13px] font-bold transition ${settingsTab === 'habits' ? 'text-indigo-600 bg-white border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    العادات
                                </button>
                                <button
                                    onClick={() => setSettingsTab('connections' as any)}
                                    className={`flex-1 py-3 text-[13px] font-bold transition ${settingsTab === ('connections' as any) ? 'text-indigo-600 bg-white border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    الربط
                                </button>
                            </div>

                            <div className="px-6 py-3 space-y-3 max-h-[65vh] overflow-y-auto overflow-x-hidden">
                                {settingsTab === 'general' && (
                                    <div className="space-y-3 animate-fadeIn">
                                        {/* Data Actions */}
                                        <div>
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">بدء التشغيل</h4>
                                            <label className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition group mb-3">
                                                <span className="text-sm font-bold text-gray-700">تشغيل مع بدء تشغيل الجهاز</span>
                                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={autoLaunch}
                                                        onChange={(e) => toggleAutoLaunch(e.target.checked)}
                                                    />
                                                    <div className={`block w-10 h-6 rounded-full transition-colors ${autoLaunch ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${autoLaunch ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>
                                            <div className="h-px bg-gray-100 my-3" />
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-2">البيانات والنسخ الاحتياطي</h4>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button onClick={handleExportData} className="flex flex-col items-center justify-center p-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition gap-1 group">
                                                    {/* Swap: Export uses Upload Icon */}
                                                    <Icons.Upload size={20} className="text-indigo-600 group-hover:scale-110 transition" />
                                                    <span className="text-xs font-bold text-indigo-700">تصدير</span>
                                                </button>
                                                <label className="flex flex-col items-center justify-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition gap-1 cursor-pointer group">
                                                    {/* Swap: Import uses Download Icon */}
                                                    <Icons.Download size={20} className="text-gray-600 group-hover:scale-110 transition" />
                                                    <span className="text-xs font-bold text-gray-700">استيراد</span>
                                                    <input type="file" accept=".json" onChange={handleImportData} className="hidden" />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="h-px bg-gray-100 my-3" />
                                        <div>
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">الحفظ التلقائي</h4>
                                            <div className="relative">
                                                <select
                                                    value={autoBackupInterval}
                                                    onChange={(e) => setAutoBackupInterval(parseInt(e.target.value))}
                                                    className="w-full p-2 pl-10 rounded-lg border border-gray-200 text-sm font-bold bg-white appearance-none cursor-pointer focus:outline-none focus:border-indigo-500 hover:border-indigo-300 transition"
                                                >
                                                    <option value="0">إيقاف</option>
                                                    <option value="5">كل 5 دقائق</option>
                                                    <option value="15">كل 15 دقيقة</option>
                                                </select>
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                                                    <Icons.ChevronDown size={18} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {settingsTab === 'shortcuts' && (
                                    <div className="space-y-3 animate-fadeIn">
                                        <div>
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">تخصيص الاختصارات</h4>
                                            <div className="space-y-2">
                                                <button onClick={() => recordHotkey('newTask')} className={`w-full flex justify-between items-center p-2 rounded-lg text-xs font-bold transition border ${recordingAction === 'newTask' ? 'bg-indigo-100 border-indigo-400 text-indigo-800' : 'bg-indigo-50 border-indigo-100 hover:bg-indigo-100 text-indigo-700'}`}>
                                                    <div className="flex items-center gap-2">
                                                        <Icons.Plus size={14} className="text-indigo-400" />
                                                        <span>مهمة جديدة</span>
                                                    </div>
                                                    <span className={`font-en ${recordingAction === 'newTask' ? 'animate-pulse' : 'text-indigo-600'}`}>{hotkeys.newTask}</span>
                                                </button>

                                                <button onClick={() => recordHotkey('toggleSidebar')} className={`w-full flex justify-between items-center p-2 rounded-lg text-xs font-bold transition border ${recordingAction === 'toggleSidebar' ? 'bg-indigo-100 border-indigo-400 text-indigo-800' : 'bg-indigo-50 border-indigo-100 hover:bg-indigo-100 text-indigo-700'}`}>
                                                    <div className="flex items-center gap-2">
                                                        <Icons.Menu size={14} className="text-indigo-400" />
                                                        <span>القائمة الجانبية</span>
                                                    </div>
                                                    <span className={`font-en ${recordingAction === 'toggleSidebar' ? 'animate-pulse' : 'text-indigo-600'}`}>{hotkeys.toggleSidebar}</span>
                                                </button>
                                                <button onClick={() => recordHotkey('toggleApp')} className={`w-full flex justify-between items-center p-2 rounded-lg text-xs font-bold transition border ${recordingAction === 'toggleApp' ? 'bg-indigo-100 border-indigo-400 text-indigo-800' : 'bg-indigo-50 border-indigo-100 hover:bg-indigo-100'}`}>
                                                    <span className="flex items-center gap-1">إظهار / إخفاء التطبيق</span>
                                                    <span className={`font-en ${recordingAction === 'toggleApp' ? 'animate-pulse' : 'text-indigo-700'}`}>{hotkeys.toggleApp || 'Not Set'}</span>
                                                </button>

                                                <div className="h-px bg-gray-100 my-3" />

                                                <button onClick={() => recordHotkey('globalQuickAdd')} className={`w-full flex justify-between items-center p-2 rounded-lg text-xs font-bold transition border ${recordingAction === 'globalQuickAdd' ? 'bg-indigo-100 border-indigo-400 text-indigo-800' : 'bg-indigo-50 border-indigo-100 hover:bg-indigo-100'}`}>
                                                    <span className="flex items-center gap-1">ملاحظات سريعة</span>
                                                    <span className={`font-en ${recordingAction === 'globalQuickAdd' ? 'animate-pulse' : 'text-indigo-700'}`}>{hotkeys.globalQuickAdd}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {settingsTab === 'appearance' && (
                                    <div className="space-y-3 animate-fadeIn">
                                        {/* Zoom Control */}
                                        <div>
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">حجم الواجهة (Zoom)</h4>
                                            <div className="flex items-center justify-between bg-gray-50 p-2.5 rounded-lg">
                                                <button onClick={() => setPreferences(p => ({ ...p, zoom: Math.max(0.5, p.zoom - 0.1) }))} className="p-1 hover:bg-gray-200 rounded"><Icons.ChevronDown size={16} /></button>
                                                <span className="font-en font-bold text-sm">{Math.round(preferences.zoom * 100)}%</span>
                                                <button onClick={() => setPreferences(p => ({ ...p, zoom: Math.min(2, p.zoom + 0.1) }))} className="p-1 hover:bg-gray-200 rounded"><Icons.ChevronUp size={16} /></button>
                                            </div>
                                        </div>
                                        <div className="h-px bg-gray-100 my-3" />
                                        {/* Font Settings */}
                                        <div>
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">نوع الخط العربي</h4>
                                            <div className="relative mb-4">
                                                <select
                                                    value={preferences.arFont}
                                                    onChange={(e) => setPreferences({ ...preferences, arFont: e.target.value })}
                                                    className="w-full p-2 pl-10 rounded-lg border border-gray-200 text-sm font-bold bg-white appearance-none cursor-pointer focus:outline-none focus:border-indigo-500 hover:border-indigo-300 transition"
                                                >
                                                    <option value="Tajawal">Tajawal (الافتراضي)</option>
                                                    <option value="Neirizi">Neirizi</option>
                                                    <option value="Cairo">Cairo (كايرو)</option>
                                                    <option value="Amiri">Amiri (أميري)</option>
                                                    <option value="Custom">خط مخصص...</option>
                                                </select>
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                                                    <Icons.ChevronDown size={18} />
                                                </div>
                                            </div>

                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">نوع الخط الإنجليزي</h4>
                                            <div className="relative mb-4">
                                                <select
                                                    value={preferences.enFont}
                                                    onChange={(e) => setPreferences({ ...preferences, enFont: e.target.value })}
                                                    className="w-full p-2 pl-10 rounded-lg border border-gray-200 text-sm font-bold bg-white appearance-none cursor-pointer focus:outline-none focus:border-indigo-500 hover:border-indigo-300 transition font-en"
                                                >
                                                    <option value="Acme">Acme</option>
                                                    <option value="Roboto">Roboto</option>
                                                    <option value="Inter">Inter</option>
                                                    <option value="Custom">Custom Font...</option>
                                                </select>
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                                                    <Icons.ChevronDown size={18} />
                                                </div>
                                            </div>

                                            {(preferences.arFont === 'Custom' || preferences.enFont === 'Custom') && (
                                                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 mt-2 space-y-2">
                                                    <input
                                                        type="text"
                                                        placeholder="اسم الخط (مثلاً: Tahoma)"
                                                        value={preferences.customFontName || ''}
                                                        onChange={(e) => setPreferences({ ...preferences, customFontName: e.target.value })}
                                                        className="w-full p-1.5 text-xs border rounded"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="رابط الخط (CSS URL) - اختياري"
                                                        value={preferences.customFontUrl || ''}
                                                        onChange={(e) => setPreferences({ ...preferences, customFontUrl: e.target.value })}
                                                        className="w-full p-1.5 text-xs border rounded text-left font-en"
                                                    />
                                                    <p className="text-[10px] text-gray-400">مثال للرابط: https://fonts.googleapis.com/css2?family=Oswald&display=swap</p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="h-px bg-gray-100 my-3" />
                                        {/* Completion Animation Toggle */}
                                        <div className="pt-1">
                                            <label className="flex items-center justify-between p-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition">
                                                <span className="text-sm font-bold text-gray-700">أنميشن إنهاء المهام (الويدجز)</span>
                                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={preferences.completionAnimation !== false}
                                                        onChange={(e) => setPreferences({ ...preferences, completionAnimation: e.target.checked })}
                                                    />
                                                    <div className={`block w-10 h-6 rounded-full transition-colors ${preferences.completionAnimation !== false ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${preferences.completionAnimation !== false ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {settingsTab === 'behavior' && (
                                    <div className="space-y-3 animate-fadeIn">
                                        <div>
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">سلوك القوائم</h4>
                                            <label className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition">
                                                <span className="text-sm font-bold text-gray-700">طي المجموعات الأخرى تلقائياً (Accordion)</span>
                                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={preferences.autoCollapse || false}
                                                        onChange={(e) => setPreferences({ ...preferences, autoCollapse: e.target.checked })}
                                                    />
                                                    <div className={`block w-10 h-6 rounded-full transition-colors ${preferences.autoCollapse ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${preferences.autoCollapse ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>

                                        </div>

                                        <div className="pt-1">
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">وضع التركيز</h4>
                                            <label className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition">
                                                <span className="text-sm font-bold text-gray-700">تعتيم العناصر الأخرى (Focus Mode)</span>
                                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={preferences.focusBlur !== false}
                                                        onChange={(e) => setPreferences({ ...preferences, focusBlur: e.target.checked })}
                                                    />
                                                    <div className={`block w-10 h-6 rounded-full transition-colors ${preferences.focusBlur !== false ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${preferences.focusBlur !== false ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>

                                        </div>

                                        <div className="pt-1">
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">سلوك المهام الفرعية</h4>
                                            <label className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition">
                                                <span className="text-sm font-bold text-gray-700">فتح عدة مهام فرعية معاً</span>
                                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={preferences.multiExpandSubtasks !== false}
                                                        onChange={(e) => setPreferences({ ...preferences, multiExpandSubtasks: e.target.checked })}
                                                    />
                                                    <div className={`block w-10 h-6 rounded-full transition-colors ${preferences.multiExpandSubtasks !== false ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${preferences.multiExpandSubtasks !== false ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>

                                        </div>

                                        <div className="pt-1">
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">سلوك المجموعات عند البدء (Widgets)</h4>
                                            <div className="p-2.5 bg-gray-50 rounded-lg">
                                                <select
                                                    value={preferences.startupGroupBehavior || 'lastOpened'}
                                                    onChange={(e) => setPreferences({ ...preferences, startupGroupBehavior: e.target.value as any })}
                                                    className="w-full bg-white border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-bold outline-none"
                                                >
                                                    <option value="lastOpened">فتح آخر حالة كانت عليها المجموعات (الافتراضي)</option>
                                                    <option value="collapseAll">طي جميع المجموعات عند البدء</option>
                                                    <option value="uncategorized">الإبقاء على "مهام غير مصنفة" مفتوحة فقط</option>
                                                </select>

                                            </div>
                                        </div>

                                    </div>
                                )}

                                {settingsTab === 'habits' && (
                                    <div className="space-y-3 animate-fadeIn">
                                        <div>
                                            <h4 className="text-[11px] text-gray-400 font-bold mb-1.5">عرض العادات</h4>
                                            <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition group mb-2">
                                                <span className="text-sm font-bold text-gray-700">فصل العادات المتباعدة في صفحة مستقلة</span>
                                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={preferences.separateSpacedHabits || false}
                                                        onChange={(e) => {
                                                            const val = e.target.checked;
                                                            setPreferences({ ...preferences, separateSpacedHabits: val });
                                                            localStorage.setItem('injaz_separate_spaced', val.toString());
                                                        }}
                                                    />
                                                    <div className={`block w-10 h-6 rounded-full transition-colors ${preferences.separateSpacedHabits ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${preferences.separateSpacedHabits ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>
                                            
                                            <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition group">
                                                <span className="text-sm font-bold text-gray-700">إظهار العادات المتباعدة المنتهية في القائمة</span>
                                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only"
                                                        checked={preferences.showCompletedSpacedInMain !== false}
                                                        onChange={(e) => {
                                                            const val = e.target.checked;
                                                            setPreferences({ ...preferences, showCompletedSpacedInMain: val });
                                                            localStorage.setItem('injaz_show_completed_spaced', val.toString());
                                                        }}
                                                    />
                                                    <div className={`block w-10 h-6 rounded-full transition-colors ${preferences.showCompletedSpacedInMain !== false ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${preferences.showCompletedSpacedInMain !== false ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                                </div>
                                            </label>
                                        </div>
                                        <div className="h-px bg-gray-100 my-3" />
                                        <div className="pt-1">
                                            <h4 className="text-xs text-gray-400 font-bold mb-2">انتقال اليوم (العادات)</h4>
                                            <div className="p-3 bg-gray-50 rounded-lg">
                                                <select
                                                    defaultValue={localStorage.getItem('injaz_day_transition_hour') || '6'}
                                                    onChange={(e) => {
                                                        localStorage.setItem('injaz_day_transition_hour', e.target.value);
                                                        window.dispatchEvent(new Event('storage'));
                                                    }}
                                                    className="w-full bg-white border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-bold outline-none appearance-none cursor-pointer"
                                                >
                                                    {Array.from({ length: 13 }, (_, i) => i).map(h => (
                                                        <option key={h} value={h}>{String(h).padStart(2, '0')}:00 {h === 0 ? '(منتصف الليل)' : 'صباحاً'}</option>
                                                    ))}
                                                </select>

                                            </div>
                                        </div>
                                    </div>
                                )}

                                {settingsTab === ('connections' as any) && (
                                    <div className="space-y-3 animate-fadeIn mt-1">
                                        <div>
                                            <h4 className="text-[13px] text-gray-500 font-bold mb-3">ربط الخدمات الخارجية</h4>
                                            
                                            {!googleTokens ? (
                                                <button 
                                                    onClick={async (e) => {
                                                        const btn = e.currentTarget;
                                                        btn.disabled = true;
                                                        btn.style.opacity = '0.6';
                                                        try {
                                                            const ipc = (window as any).require?.('electron')?.ipcRenderer;
                                                            if (!ipc) {
                                                                setNotification({ message: 'لا يمكن الوصول إلى Electron IPC.', type: 'error' });
                                                                return;
                                                            }
                                                            const tokens = await ipc.invoke('google-tasks:auth');
                                                            setGoogleTokens(tokens);
                                                            localStorage.setItem('injaz_google_tokens', JSON.stringify(tokens));
                                                            setNotification({ message: 'تم الربط بجوجل بنجاح!', type: 'success' });
                                                        } catch (err: any) {
                                                            console.error('Google Auth Error:', err);
                                                            const msg = err?.message || String(err) || 'خطأ غير معروف';
                                                            setNotification({ message: `فشل الربط: ${msg}`, type: 'error' });
                                                        } finally {
                                                            btn.disabled = false;
                                                            btn.style.opacity = '1';
                                                        }
                                                    }}
                                                    className="w-full p-3 bg-white border border-gray-200 rounded-xl flex items-center justify-center gap-3 hover:bg-gray-50 transition group shadow-sm"
                                                >
                                                    <svg width="18" height="18" viewBox="0 0 18 18">
                                                        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                                                        <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                                                        <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.712s.102-1.172.282-1.712V4.956H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.044l3.007-2.332z" fill="#FBBC05"/>
                                                        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.443 2.048.957 4.956l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58z" fill="#EA4335"/>
                                                    </svg>
                                                    <span className="text-sm font-bold text-gray-700">الربط مع مهام جوجل (Google Tasks)</span>
                                                </button>
                                            ) : (
                                                <div className="space-y-3">
                                                    <div className="p-3 bg-green-50 border border-green-100 rounded-lg flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                                            <span className="text-sm font-bold text-green-700">مرتبط بمهام جوجل</span>
                                                        </div>
                                                        <button 
                                                            onClick={() => {
                                                                setGoogleTokens(null);
                                                                localStorage.removeItem('injaz_google_tokens');
                                                                setNotification({ message: 'تم فصل الحساب.', type: 'success' });
                                                            }}
                                                            className="text-[10px] font-bold text-red-600 hover:underline"
                                                        >
                                                            فصل الحساب
                                                        </button>
                                                    </div>
                                                    
                                                    <button 
                                                        onClick={() => syncGoogleTasks()}
                                                        disabled={isSyncingGoogle}
                                                        className={`w-full p-2 rounded-lg bg-indigo-600 text-white font-bold text-sm transition flex items-center justify-center gap-2 ${isSyncingGoogle ? 'opacity-50 cursor-not-allowed' : 'hover:bg-indigo-700'}`}
                                                    >
                                                        {isSyncingGoogle ? (
                                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                        ) : (
                                                            <Icons.RefreshCw size={14} />
                                                        )}
                                                        <span>تحديث يدوي الآن</span>
                                                    </button>

                                                    {/* List Selection UI - Toggle style */}
                                                    <div className="pt-3 border-t border-gray-100">
                                                        <button 
                                                            onClick={() => setIsGoogleListsExpanded(!isGoogleListsExpanded)}
                                                            className="w-full flex items-center justify-between text-[11px] font-bold text-gray-500 mb-2 hover:text-indigo-600 transition-colors"
                                                        >
                                                            <span>القوائم المتزامنة ({googleSelectedListIds.length === 0 ? 'لا يوجد' : `${googleSelectedListIds.length} قائمة`})</span>
                                                            <Icons.ChevronDown size={14} className={`transition-transform duration-200 ${isGoogleListsExpanded ? 'rotate-180' : ''}`} />
                                                        </button>
                                                        
                                                        {isGoogleListsExpanded && (
                                                            <div className="space-y-1 max-h-48 overflow-y-auto pr-1 animate-fadeIn">
                                                                {googleAllLists.length === 0 && (
                                                                    <p className="text-[10px] text-gray-400 italic">جاري تحميل القوائم...</p>
                                                                )}
                                                                {googleAllLists.map(list => (
                                                                    <label key={list.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition border border-transparent hover:border-gray-100">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            checked={googleSelectedListIds.includes(list.id)}
                                                                            onChange={(e) => {
                                                                                const checked = e.target.checked;
                                                                                setGoogleSelectedListIds(prev => {
                                                                                    const next = checked ? [...prev, list.id] : prev.filter(id => id !== list.id);
                                                                                    localStorage.setItem('injaz_google_selected_lists', JSON.stringify(next));
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                            className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                                        />
                                                                        <span className="text-xs font-bold text-gray-700">{list.title}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <button onClick={() => { setActiveTab('tasks'); setViewMode('list'); }} className={`p-2 rounded-lg transition ${activeTab === 'tasks' && viewMode !== 'groups' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'}`} title="عرض القائمة">
                        <Icons.List size={20} />
                    </button>
                    <button onClick={() => { setActiveTab('tasks'); setViewMode('groups'); }} className={`p-2 rounded-lg transition ${activeTab === 'tasks' && viewMode === 'groups' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'}`} title="عرض المجموعات">
                        <Icons.Grid size={20} />
                    </button>
                    <button onClick={() => setActiveTab('calendar')} className={`p-2 rounded-lg transition ${activeTab === 'calendar' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'}`} title="التقويم">
                        <Icons.Calendar size={20} />
                    </button>
                    <button onClick={() => setActiveTab('habits')} className={`p-2 rounded-lg transition ${activeTab === 'habits' ? 'bg-orange-50 text-orange-500' : 'text-gray-400 hover:bg-gray-50'}`} title="العادات (Q)">
                        <Icons.Sparkles size={20} />
                    </button>
                </div>

                {/* Empty third column for balance */}
                <div style={{ WebkitAppRegion: 'no-drag' } as any} className="flex justify-end px-4">
                    {/* Bell Icon */}
                    <button 
                        onClick={handleBellClick} 
                        className={`relative p-2 rounded-lg transition ${updateAvailable ? 'text-red-500 hover:bg-red-50' : 'text-gray-400 hover:bg-gray-50 hover:text-indigo-600'}`}
                        title="التحديثات"
                    >
                        <Icons.Bell size={20} className={updateAvailable ? 'animate-pulse' : ''} />
                        {updateAvailable && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>}
                        {updateAvailable && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>}
                    </button>
                </div>
            </nav>

            {/* Main Content */}
            <main
                className={`flex-1 flex flex-col ${activeTab === 'habits' ? '' : viewMode === 'groups' && activeTab === 'tasks' ? 'px-4 md:px-6 py-4' : 'container mx-auto p-4 md:p-6 max-w-3xl'} relative ${isReordering ? 'animate-reorder' : ''}`}
                onDragOver={(e) => {
                    e.preventDefault();
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (draggedId) {
                        const idsToMove = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : [draggedId];
                        moveTasksToFolder(idsToMove, 'root');
                    }
                }}
            >
                {/* =========== HABITS VIEW =========== */}
                <div className={`flex-1 flex flex-col ${activeTab === 'habits' ? '' : 'hidden'}`}>
                    <HabitsView
                        habits={habits}
                        setHabits={modifyHabits}
                        separateSpaced={preferences.separateSpacedHabits}
                        showCompletedSpaced={preferences.showCompletedSpacedInMain !== false}
                        isActive={activeTab === 'habits'}
                    />
                </div>

                {/* =========== GROUP VIEW =========== */}
                {viewMode === 'groups' && activeTab === 'tasks' && (
                    <div
                        ref={groupsContainerRef}
                        dir="rtl"
                        className="flex gap-5 pb-20 overflow-x-auto items-start pl-32"
                        style={{ minHeight: 'calc(100vh - 130px)' }}
                        onScroll={e => {
                            const target = e.target as HTMLDivElement;
                            if (target.scrollWidth > target.clientWidth + 10) {
                                groupsScrollPos.current = target.scrollLeft;
                            }
                        }}
                        onContextMenu={e => {
                            if (e.target === e.currentTarget) {
                                e.preventDefault();
                                setContextMenu({ isOpen: true, x: e.clientX / preferences.zoom, y: e.clientY / preferences.zoom, taskId: null, source: 'widgets-bg' });
                            }
                        }}
                        onClick={e => {
                            if (e.target === e.currentTarget && folderActionPromptId) {
                                handleFolderPromptAction(folderActionPromptId, 'delete');
                            }
                        }}
                    >
                        {(() => {
                            // Sort folders by priority (High=1 first), skip empty ones
                            const folders = sortedActiveTasks
                                .filter(t => t.type === 'folder' && !t.isArchived)
                                .sort((a, b) => a.priority - b.priority);

                            const ungrouped = sortedActiveTasks.filter(t => t.type !== 'folder');

                            // Build columns: folders with active tasks + ungrouped
                            const columns: { id: string; title: string; tasks: any[] }[] = [];

                            folders.forEach(folder => {
                                const activeChildren = getSortedList((folder.children || [])
                                    .filter(c => !c.isCompleted));
                                // Skip empty folders UNLESS they have a pending prompt
                                if (activeChildren.length === 0 && folderActionPromptId !== folder.id && inlineEditingId !== folder.id) return;
                                columns.push({ id: folder.id, title: folder.title, tasks: activeChildren });
                            });

                            if (ungrouped.length > 0) {
                                columns.push({ id: '__ungrouped__', title: 'غير معنون', tasks: getSortedList(ungrouped) });
                            }

                            if (columns.length === 0) {
                                return (
                                    <div className="flex-1 flex flex-col items-center justify-center py-24">
                                        <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
                                            <Icons.Check size={32} className="text-green-400" strokeWidth={2} />
                                        </div>
                                        <p className="text-gray-400">تمت المهام بنجاح</p>
                                    </div>
                                );
                            }


                            return columns.map(col => (
                                <div
                                    key={col.id}
                                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-red-400', 'bg-red-50/20'); }}
                                    onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-red-400', 'bg-red-50/20'); }}
                                    onDrop={e => {
                                        e.preventDefault();
                                        e.currentTarget.classList.remove('ring-2', 'ring-red-400', 'bg-red-50/20');
                                        const draggedId = e.dataTransfer.getData('taskId');
                                        const fromColId = e.dataTransfer.getData('colId');
                                        if (!draggedId || fromColId === col.id) return;
                                        // Move task: remove from source, add to target
                                        modifyTasks(prev => {
                                            // Find & remove from source
                                            let draggedTask: Task | null = null;
                                            const removeFrom = (list: Task[]): Task[] => list.map(t => {
                                                if (t.id === draggedId) { draggedTask = { ...t }; return null!; }
                                                if (t.children) return { ...t, children: removeFrom(t.children).filter(Boolean) };
                                                return t;
                                            }).filter(Boolean);
                                            let updated = removeFrom(prev);
                                            if (!draggedTask) return prev;
                                            const dt = draggedTask as Task;
                                            if (col.id === '__ungrouped__') {
                                                // Move to root (no parent)
                                                return [{ ...dt, parentId: null }, ...updated];
                                            } else {
                                                // Move into target folder
                                                return updated.map(t => {
                                                    if (t.id === col.id) return { ...t, children: [...(t.children || []), { ...dt, parentId: col.id }] };
                                                    return t;
                                                });
                                            }
                                        });
                                    }}
                                    id={`widget-col-${col.id}`}
                                    className={`flex-shrink-0 w-80 bg-white/60 backdrop-blur-sm border border-gray-200/50 rounded-2xl overflow-hidden transition-all duration-500 ease-in-out ${preferences.focusBlur !== false && columns.some(c => !collapsedGroupIds.has(c.id) && c.id !== col.id) && collapsedGroupIds.has(col.id) ? 'blur-[1px] opacity-40 brightness-75 hover:blur-0 hover:opacity-100 hover:brightness-100' : ''}`}
                                >
                                    {/* Column Header - click to collapse/expand */}
                                    <div
                                        className="flex items-center gap-2 px-4 py-3 border-b border-gray-100/80 cursor-pointer hover:bg-red-50/50 transition-colors select-none"
                                        onClick={() => {
                                            setCollapsedGroupIds(prev => {
                                                const next = new Set(prev);
                                                const isCurrentlyCollapsed = next.has(col.id);
                                                if (isCurrentlyCollapsed) {
                                                    // Opening this column
                                                    next.delete(col.id);
                                                    // autoCollapse: collapse all other columns
                                                    if (preferences.autoCollapse) {
                                                        columns.forEach(c => { if (c.id !== col.id) next.add(c.id); });
                                                    }
                                                } else {
                                                    next.add(col.id);
                                                }
                                                return next;
                                            });
                                        }}
                                        onContextMenu={e => {
                                            if (col.id === '__ungrouped__') return;
                                            e.preventDefault();
                                            setContextMenu({ isOpen: true, x: e.clientX / preferences.zoom, y: e.clientY / preferences.zoom, taskId: col.id, source: 'context' });
                                        }}
                                    >
                                                                        <Icons.ChevronDown
                                                                            size={15}
                                                                            className={`text-gray-400 flex-shrink-0 transition-transform duration-200 ${collapsedGroupIds.has(col.id) ? '-rotate-90' : ''}`}
                                                                        />
                                                                        {inlineEditingId === col.id ? (
                                                                            <div
                                                                                ref={inlineEditRef as any}
                                                                                data-inline-edit
                                                                                contentEditable
                                                                                onBlur={handleCommitInlineEdit}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === 'Enter') { 
                                                                                        e.preventDefault(); 
                                                                                        const newTitle = e.currentTarget.textContent?.trim() || '';
                                                                                        if (col.id) {
                                                                                            const folder = findTask(col.id, tasks);
                                                                                            updateTask(col.id, { title: newTitle });
                                                                                            
                                                                                            // Only trigger "Add Task" flow if it was a newly created empty group
                                                                                            if (!folder?.title || folder.title === '') {
                                                                                                const newTaskId = addTask({ title: '', priority: Priority.Medium, parentId: col.id, listId: activeListId });
                                                                                                seenColumnsRef.current.add(col.id);
                                                                                                setCollapsedGroupIds(prev => {
                                                                                                    const next = new Set(prev);
                                                                                                    next.delete(col.id);
                                                                                                    return next;
                                                                                                });
                                                                                                setTimeout(() => {
                                                                                                    setInlineEditingId(newTaskId);
                                                                                                    setInlineEditText('');
                                                                                                }, 100);
                                                                                            } else {
                                                                                                // Existing group renamed: just commit and close editing
                                                                                                setInlineEditingId(null);
                                                                                            }
                                                                                        } else {
                                                                                            setInlineEditingId(null);
                                                                                        }
                                                                                     }
                                                                                    if (e.key === 'Escape') { e.preventDefault(); setInlineEditingId(null); }
                                                                                }}
                                                                                className={`flex-1 bg-transparent outline-none text-base text-red-500 ${/[\u0600-\u06FF]/.test(inlineEditText || col.title) ? 'font-bold' : 'font-medium'} transition-all relative empty:before:content-[attr(placeholder)] empty:before:text-red-200 empty:before:pointer-events-none`}
                                                                                placeholder="اسم المجموعة"
                                                                                onInput={(e) => setInlineEditText(e.currentTarget.textContent || '')}
                                                                                autoFocus
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                dangerouslySetInnerHTML={{ __html: inlineEditText }}
                                                                            />
                                                                        ) : (
                                                                            <span
                                                                                className={`${/[\u0600-\u06FF]/.test(col.title) ? 'font-bold' : 'font-medium'} text-red-500 text-base flex-1`}
                                                                                onDoubleClick={(e) => {
                                                                                    if (col.id === '__ungrouped__') return;
                                                                                    e.stopPropagation();
                                                                                    const folder = findTask(col.id, tasks);
                                                                                    if (folder) handleStartInlineEdit(e as any, folder);
                                                                                }}
                                                                            >
                                                                                {col.title}
                                                                            </span>
                                                                        )}
                                                                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                                                                             {getEffectiveTaskCount(col.tasks)}
                                                                         </span>
                                                                    </div>
                                                                    {/* Column Tasks - animated expand/collapse like list view */}
                                                                    <div className={`grid transition-all duration-[500ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${collapsedGroupIds.has(col.id) ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
                                                                        <div className="overflow-hidden">
                                                                            <div
                                                                                className="px-3 py-2 flex flex-col min-h-[40px]"
                                                                            >
                                                                                 {col.id === folderActionPromptId ? (
                                                                                     <div className="py-4 px-2 bg-indigo-50/50 rounded-xl animate-fadeIn text-center">
                                                                                         <p className="text-xs font-bold text-indigo-600 mb-3">انتهت مهام المجموعة، ماذا تفعل بها؟</p>
                                                                                         <div className="flex gap-2 justify-center">
                                                                                             <button 
                                                                                                 onClick={(e) => { e.stopPropagation(); handleFolderPromptAction(col.id, 'archive'); }}
                                                                                                 className="px-4 py-1.5 bg-white border border-indigo-100 rounded-lg text-xs font-bold text-indigo-600 hover:bg-indigo-100 transition-colors shadow-sm"
                                                                                             >
                                                                                                 أرشفة
                                                                                             </button>
                                                                                             <button 
                                                                                                 onClick={(e) => { e.stopPropagation(); handleFolderPromptAction(col.id, 'delete'); }}
                                                                                                 className="px-4 py-1.5 bg-red-50 border border-red-100 rounded-lg text-xs font-bold text-red-600 hover:bg-red-100 transition-colors shadow-sm"
                                                                                             >
                                                                                                 لا
                                                                                             </button>
                                                                                         </div>
                                                                                     </div>
                                                                                 ) : col.tasks.length === 0 ? (
                                                                                    <p className="text-center text-gray-300 text-sm py-4">فارغة</p>
                                                                                ) : (
                                                                                    col.tasks.map((task, idx) => {
                                                                                        const isEditingChild = (task.children || []).some((c: Task) => c.id === inlineEditingId);
                                                                                        const isTaskEmpty = !task.isCompleted
                                                                                            && getEffectiveTaskCount([task]) === 0
                                                                                            && inlineEditingId !== task.id
                                                                                            && !isEditingChild;
                                                                                        return (
                                                                                        <div
                                                                                            key={task.id}
                                                                                            draggable
                                                                                            onDragStart={e => {
                                                                                                e.dataTransfer.setData('taskId', task.id);
                                                                                                e.dataTransfer.setData('colId', col.id);
                                                                                                e.dataTransfer.effectAllowed = 'move';
                                                                                            }}
                                                                                            className={`flex items-start gap-2 px-2 py-2.5 cursor-pointer hover:bg-indigo-50/60 transition-all rounded-lg relative ${inlineEditingId === task.id ? 'bg-indigo-50/50' : ''} ${idx < col.tasks.length - 1 ? 'border-b border-gray-100/60' : ''} ${completingTaskId === task.id ? 'animate-premium-complete' : ''} ${isTaskEmpty ? 'opacity-25' : ''}`}
                                                                                            onClick={e => {
                                                                                                const hasSubtasks = task.children && task.children.filter((c: Task) => !c.isCompleted).length > 0;
                                                                                                if (hasSubtasks) {
                                                                                                    const target = e.target as HTMLElement;
                                                                                                    const isTextClick = target.closest('[data-task-title]') !== null;
                                                                                                    if (isTextClick) {
                                                                                                        handleStartInlineEdit(e, task);
                                                                                                    } else {
                                                                                                        e.stopPropagation();
                                                                                                        toggleFolderExpand(e, task.id);
                                                                                                    }
                                                                                                } else {
                                                                                                    handleStartInlineEdit(e, task);
                                                                                                }
                                                                                            }}
                                                                                            onDoubleClick={e => {
                                                                                                e.stopPropagation();
                                                                                                handleStartInlineEdit(e, task);
                                                                                            }}
                                                                                            onContextMenu={e => {
                                                                                                e.preventDefault();
                                                                                                setContextMenu({ isOpen: true, x: e.clientX / preferences.zoom, y: e.clientY / preferences.zoom, taskId: task.id, source: 'context' });
                                                                                            }}
                                                                                        >
                                                                                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2.5 ${task.priority === 1 ? 'bg-red-500' : task.priority === 2 ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                                                                                            {task.pinStatus && (
                                                                                                <div 
                                                                                                    className={`absolute left-1 ${task.pinStatus === 'top' ? 'top-1.5' : 'bottom-1.5'} w-1 h-1 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)] z-10`}
                                                                                                    title={task.pinStatus === 'top' ? 'مثبت في الأعلى' : 'مثبت في الأسفل'}
                                                                                                />
                                                                                            )}
                                                                                            <button
                                                                                                onClick={e => { e.stopPropagation(); handleCompleteInGroups(task.id); }}
                                                                                                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-1.5 transition-all duration-300 ${task.isCompleted || completingTaskId === task.id ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-green-400'} ${completingTaskId === task.id ? 'scale-125' : ''}`}
                                                                                            >
                                                                                                {(task.isCompleted || completingTaskId === task.id) && <Icons.Check size={8} className={`text-white ${completingTaskId === task.id ? 'animate-premium-check' : ''}`} strokeWidth={3} />}
                                                                                            </button>
                                                                                            <div className="flex-1 min-w-0">
                                                                                                {inlineEditingId === task.id ? (
                                                                                                    <div
                                                                                                        ref={inlineEditRef as any}
                                                                                                        data-inline-edit
                                                                                                        autoFocus
                                                                                                        contentEditable
                                                                                                        onPaste={(e) => handleInlinePasteImage(e, task.id)}
                                                                                                        onBlur={handleCommitInlineEdit}
                                                                                                        onKeyDown={e => {
                                                                                                            if (e.key === 'ArrowUp') {
                                                                                                                e.preventDefault();
                                                                                                                handleMoveTask(task.id, e.shiftKey ? 'top' : 'up', e.repeat);
                                                                                                            }
                                                                                                            if (e.key === 'ArrowDown') {
                                                                                                                e.preventDefault();
                                                                                                                handleMoveTask(task.id, e.shiftKey ? 'bottom' : 'down', e.repeat);
                                                                                                            }

                                                                                                            if (e.key === 'Enter') {
                                                                                                                if (e.shiftKey) return; // New line
                                                                                                                e.preventDefault();
                                                                                                                if (e.ctrlKey) {
                                                                                                                    const val = e.currentTarget.textContent?.trim();
                                                                                                                    if (!val && !task.title) {
                                                                                                                        modifyTasks(prev => removeTaskById(prev, task.id));
                                                                                                                        setInlineEditingId(null);
                                                                                                                    } else {
                                                                                                                        updateTask(task.id, { title: val || task.title }, !task.title);
                                                                                                                        const newId = addTask({ title: '', priority: Priority.Medium, parentId: task.parentId, listId: activeListId });
                                                                                                                        setTimeout(() => {
                                                                                                                            setInlineEditingId(newId);
                                                                                                                            setInlineEditText('');
                                                                                                                        }, 50);
                                                                                                                    }
                                                                                                                } else {
                                                                                                                    handleCommitInlineEdit();
                                                                                                                }
                                                                                                            }
                                                                                                            if (e.key === 'Escape') {
                                                                                                                e.preventDefault();
                                                                                                                const val = e.currentTarget.textContent?.trim();
                                                                                                                if (!val && !task.title) {
                                                                                                                    modifyTasks(prev => removeTaskById(prev, task.id));
                                                                                                                } else if (val) {
                                                                                                                    updateTask(task.id, { title: val }, !task.title);
                                                                                                                }
                                                                                                                setInlineEditingId(null);
                                                                                                            }
                                                                                                            if (e.key === 'Tab') {
                                                                                                                e.preventDefault();
                                                                                                                const val = e.currentTarget.textContent?.trim();
                                                                                                                if (val || task.title) {
                                                                                                                    updateTask(task.id, { title: val || task.title }, !task.title);
                                                                                                                    const newSubId = addTask({
                                                                                                                        title: '',
                                                                                                                        priority: Priority.Medium,
                                                                                                                        parentId: task.id,
                                                                                                                        listId: activeListId
                                                                                                                    });
                                                                                                                    setExpandedFolderIds(prev => new Set(prev).add(task.id));
                                                                                                                    setTimeout(() => {
                                                                                                                        setInlineEditingId(newSubId);
                                                                                                                        setInlineEditText('');
                                                                                                                     }, 100);
                                                                                                                }
                                                                                                            }
                                                                                                            if (e.key === 'ArrowUp') {
                                                                                                                e.preventDefault();
                                                                                                                handleMoveTask(task.id, 'up');
                                                                                                            }
                                                                                                            if (e.key === 'ArrowDown') {
                                                                                                                e.preventDefault();
                                                                                                                handleMoveTask(task.id, 'down');
                                                                                                            }
                                                                                                            if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
                                                                                                                e.preventDefault();
                                                                                                                setInlineEditingId(null);
                                                                                                                setTimeout(() => {
                                                                                                                    document.dispatchEvent(new KeyboardEvent('keydown', {
                                                                                                                        key: e.key,
                                                                                                                        code: e.code,
                                                                                                                        ctrlKey: e.ctrlKey,
                                                                                                                        metaKey: e.metaKey,
                                                                                                                        shiftKey: e.shiftKey,
                                                                                                                        bubbles: true
                                                                                                                    }));
                                                                                                                }, 10);
                                                                                                            }
                                                                                                        }}
                                                                                                        className="w-full text-sm font-medium leading-relaxed bg-transparent border-b border-indigo-400 outline-none text-gray-700 min-w-0 min-h-[1.5em] pb-1 whitespace-pre-wrap break-words overflow-wrap-anywhere"
                                                                                                        onClick={e => e.stopPropagation()}
                                                                                                        dir={task.title ? 'auto' : 'rtl'}
                                                                                                        placeholder="مهمة جديدة"
                                                                                                        dangerouslySetInnerHTML={{ __html: task.title }}
                                                                                                    />
                                                                                                ) : (
                                                                                                    <div className="flex items-start gap-1">
                                                                                                        {(task.children && task.children.filter((c: Task) => !c.isCompleted).length > 0) && (
                                                                                                            <button
                                                                                                                onClick={e => { e.stopPropagation(); toggleFolderExpand(e, task.id); }}
                                                                                                                className={`p-0.5 text-gray-400 hover:text-gray-600 transition-transform duration-200 flex-shrink-0 mt-1 ${expandedFolderIds.has(task.id) ? 'rotate-0' : '-rotate-90'}`}
                                                                                                            >
                                                                                                                <Icons.ChevronDown size={12} />
                                                                                                            </button>
                                                                                                        )}
                                                                                                        <div className="flex-1 min-w-0 flex items-start">
                                                                                                            <span data-task-title dir="auto" className={`text-sm font-medium leading-relaxed whitespace-pre-wrap break-words overflow-wrap-anywhere cursor-text ${task.isCompleted ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                                                                                                                {task.title || <span className="italic text-gray-300">بدون عنوان</span>}
                                                                                                            </span>
                                                                                                        </div>
                                                                                                        {task.children && task.children.filter((c: Task) => !c.isCompleted && c.title.trim() !== '').length > 0 && (
                                                                                                            <span className="text-[10px] text-gray-400/40 border border-gray-200/40 px-1.5 rounded-full font-en" style={{ fontFamily: 'Acme' }}>{task.children.filter((c: Task) => !c.isCompleted && c.title.trim() !== '').length}</span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                )}

                                                                                                {task.imageUrl && (
                                                                                                    <div 
                                                                                                        className="mt-2 rounded-lg overflow-hidden border border-gray-100/50 shadow-sm bg-gray-50 cursor-zoom-in group/img"
                                                                                                        onClick={(e) => {
                                                                                                            e.stopPropagation();
                                                                                                            window.open(task.imageUrl, '_blank');
                                                                                                        }}
                                                                                                    >
                                                                                                        <img 
                                                                                                            src={task.imageUrl} 
                                                                                                            alt="" 
                                                                                                            className="w-full h-auto max-h-48 object-cover transition-transform duration-500 group-hover/img:scale-110" 
                                                                                                            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                                                                                                        />
                                                                                                    </div>
                                                                                                )}

                                                                                                {/* Sub-tasks with decorative vertical line and hooks */}
                                                                                                {task.children && task.children.filter((c: Task) => !c.isCompleted).length > 0 && (
                                                                                                    <div className={`grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${expandedFolderIds.has(task.id) ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
                                                                                                        <div className="overflow-hidden">
                                                                                                            <div className="flex flex-col gap-1.5 pr-[4px] mr-[9px] relative pb-1">
                                                                                                        {/* Rounded "Quarter Square" connectors */}
                                                                                                        <div className="absolute top-0 right-[-2px] w-[10px] h-[10px] border-r-2 border-t-2 border-indigo-100 rounded-tr-md" />
                                                                                                        <div className="absolute top-[10px] bottom-[10px] right-[-2px] border-r-2 border-indigo-100" />
                                                                                                        <div className="absolute bottom-0 right-[-2px] w-[10px] h-[10px] border-r-2 border-b-2 border-indigo-100 rounded-br-md" />
                                                                                                        {task.children.filter((c: Task) => !c.isCompleted).map((child: Task) => (
                                                                                                            <div
                                                                                                                key={child.id}
                                                                                                                className={`flex items-start gap-2 py-1.5 cursor-pointer hover:opacity-70 transition-all ${completingTaskId === child.id ? 'animate-premium-complete' : ''}`}
                                                                                                                onClick={e => handleStartInlineEdit(e, child)}
                                                                                                                onContextMenu={e => {
                                                                                                                    e.preventDefault();
                                                                                                                    setContextMenu({ isOpen: true, x: e.clientX / preferences.zoom, y: e.clientY / preferences.zoom, taskId: child.id, source: 'context' });
                                                                                                                }}
                                                                                                            >
                                                                                                                <div className="w-1.5 flex-shrink-0" />
                                                                                                                <button
                                                                                                                    onClick={e => { e.stopPropagation(); handleCompleteInGroups(child.id); }}
                                                                                                                    className={`w-3 h-3 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-1.5 transition-all duration-300 ${child.isCompleted || completingTaskId === child.id ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-green-400'} ${completingTaskId === child.id ? 'scale-125' : ''}`}
                                                                                                                >
                                                                                                                    {(child.isCompleted || completingTaskId === child.id) && <Icons.Check size={6} className={`text-white ${completingTaskId === child.id ? 'animate-premium-check' : ''}`} strokeWidth={3} />}
                                                                                                                </button>
                                                                                                                {inlineEditingId === child.id ? (
                                                                                                                    <div
                                                                                                                        ref={inlineEditRef as any}
                                                                                                                        data-inline-edit
                                                                                                                        autoFocus
                                                                                                                        contentEditable
                                                                                                                        dir={child.title ? 'auto' : 'rtl'}
                                                                                                                        onBlur={handleCommitInlineEdit}
                                                                                                                        onKeyDown={e => {
                                                                                                                            if (e.key === 'ArrowUp') {
                                                                                                                                e.preventDefault();
                                                                                                                                handleMoveTask(child.id, 'up');
                                                                                                                            }
                                                                                                                            if (e.key === 'ArrowDown') {
                                                                                                                                e.preventDefault();
                                                                                                                                handleMoveTask(child.id, 'down');
                                                                                                                            }
                                                                                                                            if (e.key === 'Enter') {
                                                                                                                                if (e.shiftKey) return; // New line
                                                                                                                                e.preventDefault();
                                                                                                                                if (e.ctrlKey) {
                                                                                                                                    const val = e.currentTarget.textContent?.trim();
                                                                                                                                    if (!val && !child.title) { modifyTasks(prev => removeTaskById(prev, child.id)); setInlineEditingId(null); }
                                                                                                                                    else {
                                                                                                                                        updateTask(child.id, { title: val || child.title }, !child.title);
                                                                                                                                        const newId = addTask({ title: '', priority: Priority.Medium, parentId: task.id, listId: activeListId });
                                                                                                                                        setTimeout(() => { setInlineEditingId(newId); setInlineEditText(''); }, 50);
                                                                                                                                    }
                                                                                                                                } else {
                                                                                                                                    handleCommitInlineEdit();
                                                                                                                                }
                                                                                                                            }
                                                                                                                            if (e.key === 'Escape') {
                                                                                                                                e.preventDefault();
                                                                                                                                const val = e.currentTarget.textContent?.trim();
                                                                                                                                if (!val && !child.title) modifyTasks(prev => removeTaskById(prev, child.id));
                                                                                                                                else if (val) updateTask(child.id, { title: val }, !child.title);
                                                                                                                                setInlineEditingId(null);
                                                                                                                            }
                                                                                                                        }}
                                                                                                                        className="flex-1 text-xs bg-transparent border-b border-indigo-400 outline-none text-gray-600 min-w-0 min-h-[1.5em] pb-1 whitespace-pre-wrap break-words overflow-wrap-anywhere leading-relaxed"
                                                                                                                        onClick={e => e.stopPropagation()}
                                                                                                                        placeholder="مهمة فرعية جديدة"
                                                                                                                        dangerouslySetInnerHTML={{ __html: child.title }}
                                                                                                                    />
                                                                                                                ) : (
                                                                                                                    <span dir="auto" className={`flex-1 text-xs leading-relaxed whitespace-pre-wrap break-words overflow-wrap-anywhere ${child.isCompleted ? 'line-through text-gray-300' : 'text-gray-500'}`}>
                                                                                                                        {child.title || <span className="italic text-gray-300">مهمة فرعية جديدة</span>}
                                                                                                                    </span>
                                                                                                                )}
                                                                                                            </div>
                                                                                                        ))}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                </div>
                                                            ));

                        })()}
                    </div>
                )}


                {/* =========== NORMAL LIST VIEW =========== */}
                {viewMode !== 'groups' && (
                    <>
                        <div className="bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-2xl p-4 md:p-6 min-h-[calc(100vh-140px)]">
                            {activeTab === 'tasks' && (
                                <>
                                    <div className="flex justify-between items-center mb-6">
                                        <div className="flex items-center gap-3">
                                            <h2 className="text-2xl font-bold text-gray-800">{activeList.title}</h2>
                                            <div className="relative" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex bg-gray-100 rounded-lg p-1">
                                                    <button onClick={() => setIsSortMenuOpen(!isSortMenuOpen)} className="px-3 py-1 text-sm font-bold text-gray-600 hover:bg-white hover:shadow-sm rounded-md transition flex items-center gap-1">
                                                        {sortBy === 'priority' ? <Icons.Flag size={16} className="text-indigo-600" /> : sortBy === 'created' ? <Icons.Clock size={16} className="text-indigo-600" /> : <Icons.Grip size={16} className="text-indigo-600" />}
                                                        {sortBy === 'custom' && 'مخصص'} {sortBy === 'priority' && 'الأولوية'} {sortBy === 'created' && 'الأحدث'}
                                                        <Icons.ChevronDown size={14} className="text-gray-400" />
                                                    </button>
                                                    {sortBy !== 'custom' && (
                                                        <button onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')} className="px-2 hover:bg-white hover:shadow-sm rounded-md transition text-gray-500">
                                                            {sortDirection === 'asc' ? <Icons.SortAsc size={16} /> : <Icons.SortDesc size={16} />}
                                                        </button>
                                                    )}
                                                </div>
                                                {isSortMenuOpen && (
                                                    <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-40 animate-fadeIn overflow-hidden">
                                                        <div className="px-3 py-2 text-xs font-bold text-gray-400 border-b bg-gray-50/50">ترتيب حسب</div>
                                                        <button onClick={() => { setSortBy('priority'); setIsSortMenuOpen(false); }} className={`w-full text-right px-4 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-600 transition flex items-center gap-2 ${sortBy === 'priority' ? 'text-indigo-600 bg-indigo-50 font-bold' : 'text-gray-600'}`}><Icons.Flag size={14} /> الأولوية</button>
                                                        <button onClick={() => { setSortBy('custom'); setIsSortMenuOpen(false); }} className={`w-full text-right px-4 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-600 transition flex items-center gap-2 ${sortBy === 'custom' ? 'text-indigo-600 bg-indigo-50 font-bold' : 'text-gray-600'}`}><Icons.Grip size={14} /> مخصص (سحب)</button>
                                                        <button onClick={() => { setSortBy('created'); setIsSortMenuOpen(false); }} className={`w-full text-right px-4 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-600 transition flex items-center gap-2 ${sortBy === 'created' ? 'text-indigo-600 bg-indigo-50 font-bold' : 'text-gray-600'}`}><Icons.Clock size={14} /> الأحدث</button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <button onClick={() => setIsQuickAdding(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-lg shadow-indigo-200 transition"><Icons.Plus size={24} /></button>
                                    </div>

                                    <div
                                        className="flex flex-col gap-1 pb-20 min-h-[50vh] transition-all duration-700 ease-out"
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            // Auto-scroll when dragging near window edges
                                            const scrollThreshold = 100;
                                            if (e.clientY < scrollThreshold) {
                                                window.scrollBy(0, -15);
                                            } else if (e.clientY > window.innerHeight - scrollThreshold) {
                                                window.scrollBy(0, 15);
                                            }
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            // If dropped here (on empty space), move to root
                                            const draggedId = e.dataTransfer.getData('text/plain');
                                            if (draggedId) {
                                                const idsToMove = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : [draggedId];
                                                moveTasksToFolder(idsToMove, 'root');
                                            }
                                        }}
                                    >
                                        {sortedActiveTasks.length === 0 && !isQuickAdding && (
                                            <div className="flex-1 flex flex-col items-center justify-center py-24">
                                                <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
                                                    <Icons.Check size={32} className="text-green-400" strokeWidth={2} />
                                                </div>
                                                <p className="text-gray-400">تمت المهام بنجاح</p>
                                            </div>
                                        )}

                                        {isQuickAdding && (
                                            <div className="mb-3 animate-slideDown">
                                                <div className="bg-white p-3 rounded-2xl border-2 border-indigo-100 shadow-sm flex items-start gap-3 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-50/50 transition-all">
                                                    <button
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => setQuickAddPriority(prev => {
                                                            if (prev === Priority.Medium) return Priority.High;
                                                            if (prev === Priority.High) return Priority.Low;
                                                            return Priority.Medium; // Low -> Medium
                                                        })}
                                                        className={`w-2 h-2 rounded-full mt-2.5 ms-1 cursor-pointer transition-all ${quickAddPriority === Priority.High ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]' : quickAddPriority === Priority.Medium ? 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)]' : 'bg-gray-400'}`}
                                                        title="تغيير الأولوية"
                                                    >
                                                        {/* Optional: Checkmark or icon could go here, but solid color is clean */}
                                                    </button>
                                                    <textarea
                                                        autoFocus
                                                        dir={getDirection(quickAddTitle)}
                                                        placeholder=""
                                                        className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400 font-naskh resize-none overflow-hidden py-1 leading-loose"
                                                        value={quickAddTitle}
                                                        rows={1}
                                                        style={{ minHeight: '38px' }}
                                                        onChange={e => {
                                                            setQuickAddTitle(e.target.value);
                                                            e.target.style.height = 'auto';
                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                        }}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                                e.preventDefault();
                                                                if (e.ctrlKey) {
                                                                    // Infinite Creation: Add and Keep Open
                                                                    if (quickAddTitle.trim()) {
                                                                        addTask({ title: quickAddTitle, priority: quickAddPriority });
                                                                        setQuickAddTitle(''); // Clear for next
                                                                    }
                                                                } else {
                                                                    // Add and Close
                                                                    if (quickAddTitle.trim()) {
                                                                        addTask({ title: quickAddTitle, priority: quickAddPriority });
                                                                    }
                                                                    setIsQuickAdding(false);
                                                                    setQuickAddTitle('');
                                                                }
                                                            } else if (e.key === 'Tab') {
                                                                e.preventDefault();
                                                                // Convert to Sub-task flow (Add parent, then open generic subtask editor? 
                                                                // Or just add and focus it?
                                                                // For now, let's keep Tab logic consistent with adding subtask to the just-created task?
                                                                // Logic below adds the task then immediately adds a child.
                                                                if (quickAddTitle.trim()) {
                                                                    const newId = addTask({ title: quickAddTitle, priority: quickAddPriority });
                                                                    // We cannot keep QuickAdd open if we switch to Inline Edit for subtask.
                                                                    setIsQuickAdding(false);
                                                                    setQuickAddTitle('');

                                                                    setTimeout(() => {
                                                                        const subId = addTask({
                                                                            title: '',
                                                                            priority: Priority.Medium,
                                                                            parentId: newId,
                                                                            listId: activeListId
                                                                        });
                                                                        setExpandedFolderIds(prev => new Set(prev).add(newId));
                                                                        setTimeout(() => {
                                                                            setInlineEditingId(subId);
                                                                            setInlineEditText('');
                                                                        }, 100);
                                                                    }, 200);
                                                                }
                                                            } else if (e.key === 'Escape') {
                                                                e.preventDefault();
                                                                // Save and Close
                                                                if (quickAddTitle.trim()) {
                                                                    addTask({ title: quickAddTitle, priority: quickAddPriority });
                                                                }
                                                                setIsQuickAdding(false);
                                                                setQuickAddTitle('');
                                                            }
                                                        }}
                                                        onBlur={() => {
                                                            // If there is text, confirm/save it
                                                            if (quickAddTitle.trim()) {
                                                                confirmQuickAdd(false); // Close after blur
                                                            } else {
                                                                // Grace period: ignore blurs within 500ms of opening (avoids startup focus jitter)
                                                                const timeSinceOpen = Date.now() - lastQuickAddOpenTime.current;
                                                                if (timeSinceOpen > 500) {
                                                                    setIsQuickAdding(false);
                                                                } else {
                                                                    console.log('Ignoring Quick Add blur due to grace period:', timeSinceOpen, 'ms');
                                                                }
                                                            }
                                                        }}
                                                    />
                                                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setIsQuickAdding(false); setQuickAddTitle(''); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded-full mt-1"><Icons.Close size={18} /></button>
                                                </div>
                                            </div>
                                        )}
                                        {(() => {
                                            // Separate non-empty and empty folders
                                            const nonEmptyTasks = sortedActiveTasks.filter(task =>
                                                task.type !== 'folder' || (task.children && task.children.filter(c => !c.isCompleted).length > 0)
                                            );
                                            const emptyFolders = sortedActiveTasks.filter(task =>
                                                task.type === 'folder' && (!task.children || task.children.filter(c => !c.isCompleted).length === 0)
                                            );

                                            return (
                                                <>
                                                    {/* Render non-empty tasks */}
                                                    {nonEmptyTasks.map(task => renderTaskCard(task))}

                                                    {/* Empty folders section with click toggle */}
                                                    {emptyFolders.length > 0 && (
                                                        <div
                                                            onClick={() => setShowEmptyFolders(!showEmptyFolders)}
                                                            className="relative cursor-pointer"
                                                        >
                                                            {/* Separator line with count */}
                                                            <div className="flex items-center gap-2 my-3">
                                                                <div className="w-36 h-px bg-gray-200/40 hover:bg-gray-300/60 transition-colors duration-200" />
                                                                <span className="text-xs text-gray-300 select-none" style={{ fontFamily: 'Acme, sans-serif' }}>
                                                                    {emptyFolders.length}
                                                                </span>
                                                            </div>

                                                            {/* Empty folders container with animation */}
                                                            <div
                                                                className={`overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${showEmptyFolders ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
                                                            >
                                                                <div className="flex flex-col gap-1">
                                                                    {emptyFolders.map((task, idx) => (
                                                                        <div
                                                                            key={task.id}
                                                                            className={`transition-all duration-500 ease-out ${showEmptyFolders ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
                                                                            style={{ transitionDelay: showEmptyFolders ? `${idx * 80}ms` : `${(emptyFolders.length - 1 - idx) * 50}ms` }}
                                                                        >
                                                                            {renderTaskCard(task)}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </>
                            )}
                            {activeTab === 'calendar' && <CalendarView
                                tasks={tasks}
                                onSelectTask={openEditModal}
                                selectedTaskIds={selectedTaskIds}
                                onToggleSelect={(id: string, additive: boolean) => {
                                    if (additive) {
                                        setSelectedTaskIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(id)) next.delete(id);
                                            else next.add(id);
                                            return next;
                                        });
                                    } else {
                                        setSelectedTaskIds(new Set([id]));
                                    }
                                }}
                            />}
                        </div>

                        {/* Completed tasks - outside the bordered area */}
                        {
                            activeTab === 'tasks' && flatCompletedTasks.length > 0 && (
                                <div className="mt-4 pt-4 opacity-60">
                                    <button onClick={() => setShowCompleted(!showCompleted)} className="flex items-center gap-2 text-sm font-bold text-gray-400 hover:text-gray-600 mb-4 transition">
                                        {showCompleted ? <Icons.ChevronUp size={16} /> : <Icons.ChevronDown size={16} />} مهام منتهية ({flatCompletedTasks.length})
                                    </button>
                                    {showCompleted && <div className="flex flex-col gap-1">{flatCompletedTasks.map(({ task, origin, originColor }) => renderTaskCard(task, null, { name: origin, color: originColor }))}</div>}
                                </div>
                            )
                        }
                    </>
                )}
            </main >





            {/* --- SIDEBAR DRAWER (ALWAYS MOUNTED FOR TRANSITION) --- */}
            <div
                className={`fixed inset-0 z-50 transition-visibility duration-500 ${isSidebarOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}
            >
                {/* Backdrop */}
                <div
                    className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-500 ease-in-out ${isSidebarOpen ? 'opacity-100' : 'opacity-0'}`}
                ></div>

                {/* Drawer - positioned on left side explicitly */}
                <div
                    data-sidebar
                    className={`absolute top-0 left-0 bg-white w-80 h-full shadow-2xl flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
                >
                    <div className="p-6 border-b flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-800">قوائمي</h2>
                        <button onClick={() => setIsSidebarOpen(false)} className="text-gray-400 hover:text-gray-600"><Icons.Close size={20} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ direction: 'rtl' }}>
                        {lists.map(list => {
                            const isDragged = draggedListId === list.id;
                            const isDragOver = dragOverListId === list.id;
                            const isRenaming = renamingListId === list.id;
                            const taskCount = tasks.filter(t => t.listId === list.id && !t.isCompleted).length;
                            return (
                                <div
                                    key={list.id} draggable={!isRenaming}
                                    onDragStart={(e) => handleListDragStart(e, list.id)}
                                    onDragOver={(e) => handleListDragOver(e, list.id)}
                                    onDrop={(e) => handleListDrop(e, list.id)}
                                    onDragEnd={() => { setDraggedListId(null); setDragOverListId(null); setDragOverListPos(null); }}
                                    onClick={() => { if (!isRenaming) { navigateToList(list.id); setIsSidebarOpen(false); } }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setListContextMenu({ isOpen: true, x: e.clientX / preferences.zoom, y: e.clientY / preferences.zoom, listId: list.id });
                                    }}
                                    className={`group relative flex items-center justify-between p-3 rounded-xl cursor-pointer transition border ${activeListId === list.id ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'hover:bg-gray-50 border-transparent text-gray-600'} ${isDragged ? 'opacity-30' : ''}`}
                                >
                                    {isDragOver && dragOverListPos === 'top' && <div className="absolute -top-1 left-0 right-0 h-1 bg-indigo-500 rounded-full z-10"></div>}
                                    {isDragOver && dragOverListPos === 'bottom' && <div className="absolute -bottom-1 left-0 right-0 h-1 bg-indigo-500 rounded-full z-10"></div>}

                                    <div className="flex items-center gap-2 flex-1">
                                        <div className={`w-2 h-2 rounded-full ${activeListId === list.id ? 'bg-indigo-500' : 'bg-gray-300'}`}></div>

                                        {isRenaming ? (
                                            <input
                                                type="text" autoFocus
                                                value={renamingListTitle}
                                                onChange={(e) => setRenamingListTitle(e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameList(); if (e.key === 'Escape') setRenamingListId(null); }}
                                                onBlur={handleRenameList}
                                                className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-indigo-100 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50/50 outline-none text-sm font-bold transition-all leading-loose shadow-inner"
                                            />
                                        ) : (
                                            <>
                                                <span className="font-bold truncate py-1 leading-relaxed">{list.title}</span>
                                                {taskCount > 0 && (
                                                    <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{taskCount}</span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="p-4 border-t bg-gray-50">
                        {isCreatingList ? (
                            <div className="animate-fadeIn">
                                <input
                                    type="text" autoFocus placeholder="اسم القائمة..."
                                    className="w-full px-3 py-2 rounded-lg bg-slate-700 text-white border-2 border-transparent focus:border-indigo-500 outline-none mb-2 text-sm font-bold placeholder-slate-400"
                                    value={newListTitle} onChange={(e) => setNewListTitle(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddList(true); if (e.key === 'Escape') setIsCreatingList(false); }}
                                    onBlur={() => { if (newListTitle.trim()) handleAddList(false); else setIsCreatingList(false); }}
                                />
                                <div className="flex gap-2">
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => handleAddList(false)} className="flex-1 bg-indigo-600 text-white py-1.5 rounded-lg text-sm font-bold">إضافة</button>
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => setIsCreatingList(false)} className="flex-1 bg-gray-200 text-gray-600 py-1.5 rounded-lg text-sm font-bold">إلغاء</button>
                                </div>
                            </div>
                        ) : (
                            <button onClick={() => setIsCreatingList(true)} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition font-bold"><Icons.Plus size={20} /> قائمة جديدة</button>
                        )}
                    </div>
                </div>
            </div>

            {/* Bulk actions bar removed as requested */}

            {/* Context menu (right-click) */}
            {
                contextMenu.isOpen && (
                    <div
                        key={contextMenu.taskId}
                        data-context-menu
                        style={{
                            position: 'fixed',
                            left: (() => {
                                const menuWidth = 180;
                                const padding = 10;
                                // If near right edge, shift left
                                if (contextMenu.x + menuWidth > window.innerWidth) {
                                    return Math.max(padding, window.innerWidth - menuWidth - padding);
                                }
                                return Math.max(padding, contextMenu.x);
                            })(),
                            top: (() => {
                                let approxHeight = 350;
                                if (contextMenu.source === 'priority-dot') approxHeight = 180;
                                if (contextMenu.source === 'widgets-bg') approxHeight = 70;
                                const padding = 10;
                                const hasSpaceBelow = contextMenu.y + approxHeight < window.innerHeight;
                                // If near bottom, show above the click point
                                if (!hasSpaceBelow) {
                                    return Math.max(padding, contextMenu.y - approxHeight);
                                }
                                return contextMenu.y;
                            })(),
                            zIndex: 1200
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="animate-slideDownBlur"
                    >
                        <style>{`
                            @keyframes submenuSlide {
                                from { opacity: 0; transform: translateX(10px); }
                                to { opacity: 1; transform: translateX(0); }
                            }
                            .animate-submenu {
                                animation: submenuSlide 0.2s ease-out forwards;
                            }
                        `}</style>
                        <div
                            className="relative"
                            onMouseLeave={() => {
                                // Start grace period for closing
                                submenuTimeoutRef.current = setTimeout(() => {
                                    setActiveSubmenu(null);
                                }, 300);
                            }}
                            onMouseEnter={() => {
                                // Cancel closing if we re-enter (e.g. crossing from main to sub)
                                if (submenuTimeoutRef.current) {
                                    clearTimeout(submenuTimeoutRef.current);
                                    submenuTimeoutRef.current = null;
                                }
                            }}
                        >
                            {/* Main menu panel */}
                            <div className="bg-white rounded-xl shadow-2xl border border-gray-100 min-w-[140px] overflow-hidden animate-context-menu">
                                <div className="px-3 py-2 text-[10px] text-red-400 font-bold border-b border-gray-50 uppercase tracking-wider">خيارات</div>
                                <div className="p-1">
                                    {/* Reorder Options (Generic for all, mostly used for Groups) - ONLY SHOW IF TRIGGERED BY BUTTON */}
                                    {contextMenu.taskId && contextMenu.source === 'trigger' && (() => {
                                        // Calculate position to enable/disable buttons
                                        const t = findTask(contextMenu.taskId!, tasks);
                                        if (!t) return null;
                                        // Find siblings logic duplicated for rendering state check
                                        let isFirst = false;
                                        let isLast = false;
                                        if (t.parentId === null) {
                                            const idx = sortedActiveTasks.findIndex(x => x.id === t.id);
                                            if (idx === 0) isFirst = true;
                                            if (idx === sortedActiveTasks.length - 1) isLast = true;
                                        } else {
                                            // Nested - simplified check
                                            // We assume if you're clicking it, its parent is expanded or it is visible
                                            // We can use the generic findParent logic or just check activeChildren of parent if known
                                            // For simplicity, allow all unless obviously wrong
                                        }

                                        return (
                                            <>
                                                <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-gray-50">
                                                    <div className="flex gap-1">
                                                        <button
                                                            disabled={isFirst}
                                                            onClick={() => handleMoveTask(t.id, 'top')}
                                                            className="p-1 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                                            title="نقل للأعلى تماماً"
                                                        >
                                                            <Icons.Up size={16} />
                                                        </button>
                                                        <button
                                                            disabled={isFirst}
                                                            onClick={() => handleMoveTask(t.id, 'up')}
                                                            className="p-1 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                                            title="نقل للأعلى"
                                                        >
                                                            <Icons.ChevronUp size={16} />
                                                        </button>
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <button
                                                            disabled={isLast}
                                                            onClick={() => handleMoveTask(t.id, 'down')}
                                                            className="p-1 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                                            title="نقل للأسفل"
                                                        >
                                                            <Icons.ChevronDown size={16} />
                                                        </button>
                                                        <button
                                                            disabled={isLast}
                                                            onClick={() => handleMoveTask(t.id, 'bottom')}
                                                            className="p-1 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                                            title="نقل للأسفل تماماً"
                                                        >
                                                            <Icons.Down size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        );
                                    })()}

                                    {contextMenu.source === 'priority-dot' ? (
                                        <div className="space-y-1">
                                            {(() => {
                                                const t = contextMenu.taskId ? findTask(contextMenu.taskId, tasks) : null;
                                                return (
                                                    <>
                                                        <button onClick={() => changePriorityForSelected(Priority.High)} className={`w-full px-3 py-2 text-sm rounded-lg hover:bg-red-50 flex items-center gap-2 transition-colors ${t?.priority === Priority.High ? 'bg-red-100 ring-1 ring-red-200' : ''}`}>
                                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                                                            <span className="font-bold text-gray-700">عالية</span>
                                                            {t?.priority === Priority.High && <Icons.Check size={14} className="text-red-500 mr-auto" />}
                                                        </button>
                                                        <button onClick={() => changePriorityForSelected(Priority.Medium)} className={`w-full px-3 py-2 text-sm rounded-lg hover:bg-indigo-50 flex items-center gap-2 transition-colors ${t?.priority === Priority.Medium ? 'bg-indigo-100 ring-1 ring-indigo-200' : ''}`}>
                                                            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500"></div>
                                                            <span className="font-bold text-gray-700">عادية</span>
                                                            {t?.priority === Priority.Medium && <Icons.Check size={14} className="text-indigo-500 mr-auto" />}
                                                        </button>
                                                        <button onClick={() => changePriorityForSelected(Priority.Low)} className={`w-full px-3 py-2 text-sm rounded-lg hover:bg-gray-100 flex items-center gap-2 transition-colors ${t?.priority === Priority.Low ? 'bg-gray-200 ring-1 ring-gray-300' : ''}`}>
                                                            <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                                                            <span className="font-bold text-gray-700">منخفضة</span>
                                                            {t?.priority === Priority.Low && <Icons.Check size={14} className="text-gray-500 mr-auto" />}
                                                        </button>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    ) : (
                                        <div className="p-1">
                                            {contextMenu.source === 'widgets-bg' ? (
                                                <button
                                                    onClick={() => {
                                                        handleAddNewGroup();
                                                        setContextMenu({ isOpen: false, x: 0, y: 0, taskId: null, source: 'context' });
                                                    }}
                                                    className="w-full flex items-center gap-2.5 px-2 py-1.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors cursor-pointer group"
                                                >
                                                    <div className="w-7 h-7 rounded-md bg-indigo-50 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-100 transition-colors">
                                                        <Icons.FolderOpen size={15} />
                                                    </div>
                                                    <span className="font-bold">مجموعة جديدة</span>
                                                </button>
                                            ) : (
                                                <div className="p-0.5">

                                                    {/* Add Task to Folder - only for folders */}
                                                    {contextMenu.taskId && findTask(contextMenu.taskId, tasks)?.type === 'folder' && (
                                                        <>
                                                            <div
                                                                onClick={() => {
                                                                    if (contextMenu.taskId) {
                                                                        const newTaskId = generateId();
                                                                        const newTask: Task = {
                                                                            id: newTaskId,
                                                                            title: '',
                                                                            type: 'item',
                                                                            priority: Priority.Medium,
                                                                            color: 'default',
                                                                            parentId: contextMenu.taskId,
                                                                            listId: activeListId,
                                                                            children: [],
                                                                            isCompleted: false,
                                                                            createdAt: Date.now()
                                                                        };
                                                                        modifyTasks(prevTasks => {
                                                                            const addToFolder = (list: Task[]): Task[] => {
                                                                                return list.map(t => {
                                                                                    if (t.id === contextMenu.taskId) {
                                                                                        return { ...t, isArchived: false, children: [newTask, ...t.children] };
                                                                                    }
                                                                                    if (t.children && t.children.length > 0) {
                                                                                        return { ...t, children: addToFolder(t.children) };
                                                                                    }
                                                                                    return t;
                                                                                });
                                                                            };
                                                                            return addToFolder(prevTasks);
                                                                        });
                                                                        // Auto-expand the folder and start inline editing
                                                                        setExpandedFolderIds(prev => new Set(prev).add(contextMenu.taskId!));
                                                                        setTimeout(() => {
                                                                            setInlineEditingId(newTaskId);
                                                                            setInlineEditText('');
                                                                        }, 100);
                                                                    }
                                                                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                                                                }}
                                                                className="px-3 py-2 rounded-lg cursor-pointer text-sm font-bold flex items-center gap-2 transition-colors hover:bg-green-50 text-green-600 mb-1 border-b border-gray-50"
                                                            >
                                                                <Icons.Plus size={14} />
                                                                <span className="flex-1">إضافة مهمة</span>
                                                            </div>
                                                            {/* Edit Name option - for folders */}
                                                            <div
                                                                onClick={() => {
                                                                    const task = findTask(contextMenu.taskId!, tasks);
                                                                    if (task) {
                                                                        handleStartInlineEdit({ stopPropagation: () => { } } as any, task);
                                                                    }
                                                                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                                                                }}
                                                                className="px-3 py-2 rounded-lg cursor-pointer text-sm font-bold flex items-center gap-2 transition-colors hover:bg-gray-50 text-gray-700"
                                                            >
                                                                <Icons.Edit size={14} />
                                                                <span className="flex-1">تعديل الاسم</span>
                                                            </div>
                                                        </>
                                                    )}

                                                    <div
                                                        onMouseEnter={() => {
                                                            if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
                                                            setActiveSubmenu('priority');
                                                        }}
                                                        className={`px-3 py-2 rounded-lg cursor-pointer text-sm font-bold flex items-center gap-2 transition-colors ${activeSubmenu === 'priority' ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-gray-50 text-gray-700'}`}
                                                    >
                                                        <Icons.Flag size={14} />
                                                        <span className="flex-1">الأولوية</span>
                                                        <Icons.ChevronLeft size={14} className="text-gray-300" />
                                                    </div>
                                                    <div
                                                        onMouseEnter={() => {
                                                            if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
                                                            setActiveSubmenu('list');
                                                            setMoveTargetListId(null);
                                                        }}
                                                        className={`px-3 py-2 rounded-lg cursor-pointer text-sm font-bold flex items-center gap-2 transition-colors ${activeSubmenu === 'list' ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-gray-50 text-gray-700'}`}
                                                    >
                                                        <Icons.List size={14} />
                                                        <span className="flex-1">نقل إلى</span>
                                                        <Icons.ChevronLeft size={14} className="text-gray-300" />
                                                    </div>
                                                    {contextMenu.taskId && findTask(contextMenu.taskId, tasks)?.type === 'folder' && (
                                                        <>
                                                            <div
                                                                onClick={(e) => {
                                                                    if (contextMenu.taskId) {
                                                                        updateTask(contextMenu.taskId, { isArchived: true });
                                                                    }
                                                                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                                                                }}
                                                                className="px-3 py-2 rounded-lg cursor-pointer text-sm font-bold flex items-center gap-2 transition-colors hover:bg-amber-50 text-amber-600 mt-1 border-t border-gray-50"
                                                            >
                                                                <Icons.Archive size={14} />
                                                                <span className="flex-1">أرشفة المجموعة</span>
                                                            </div>
                                                            <div
                                                                onClick={(e) => {
                                                                    if (contextMenu.taskId) {
                                                                        modifyTasks(prevTasks => removeTaskRecursive(prevTasks, contextMenu.taskId!));
                                                                    }
                                                                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                                                                }}
                                                                className="px-3 py-2 rounded-lg cursor-pointer text-sm font-bold flex items-center gap-2 transition-colors hover:bg-red-50 text-red-500 mt-1 border-t border-gray-50"
                                                            >
                                                                <Icons.Trash size={14} />
                                                                <span className="flex-1">حذف المجموعة</span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Submenu floating panel (appears to the left/west, aligned with the item) */}
                            {activeSubmenu && (
                                <div
                                    className="absolute bg-white rounded-xl shadow-2xl border border-gray-100 p-2 min-w-[140px] animate-submenu"
                                    style={(() => {
                                        const menuX = Math.max(10, Math.min(contextMenu.x, window.innerWidth - 170));
                                        // Prefer left side: show to left unless there's not enough space (< 160px)
                                        const showToLeft = menuX > 160;
                                        
                                        // Calculate dynamic top to align "قصاد العنوان"
                                        // Header (~31px) + P1 padding (4px) + P0.5 padding (2px) = 37px
                                        let offsetTop = 37; 
                                        
                                        // If reorder options are present (source is trigger)
                                        if (contextMenu.taskId && contextMenu.source === 'trigger') {
                                            offsetTop += 34; // Height of reorder box + margin
                                        }
                                        
                                        // If it's a folder, Add Task and Edit Name are present
                                        const isFolder = contextMenu.taskId && findTask(contextMenu.taskId, tasks)?.type === 'folder';
                                        if (isFolder) {
                                            offsetTop += 37; // "إضافة مهمة" height (with margin/border)
                                            offsetTop += 36; // "تعديل الاسم" height
                                        }
                                        
                                        // Final position based on which submenu is active
                                        // Each item is ~36px tall
                                        const finalTop = activeSubmenu === 'priority' ? offsetTop : offsetTop + 36;

                                        return {
                                            right: showToLeft ? '100%' : 'auto',
                                            left: showToLeft ? 'auto' : '100%',
                                            marginRight: showToLeft ? '8px' : '0',
                                            marginLeft: showToLeft ? '0' : '8px',
                                            top: `${finalTop}px`
                                        };
                                    })()}
                                >
                                    {/* Invisible Bridge to bridge the gap */}
                                    <div
                                        className="absolute top-0 bottom-0 w-4 bg-transparent"
                                        style={(() => {
                                            const menuX = Math.max(10, Math.min(contextMenu.x, window.innerWidth - 170));
                                            const showToLeft = menuX > 160;
                                            return {
                                                left: showToLeft ? 'auto' : '-16px',
                                                right: showToLeft ? '-16px' : 'auto',
                                            };
                                        })()}
                                    />
                                    {activeSubmenu === 'priority' && (() => {
                                        const t = contextMenu.taskId ? findTask(contextMenu.taskId, tasks) : null;
                                        return (
                                            <div className="space-y-1">
                                                <button onClick={() => changePriorityForSelected(Priority.High)} className={`w-full px-3 py-2 text-sm rounded-lg hover:bg-red-50 flex items-center gap-2 transition-colors ${t?.priority === Priority.High ? 'bg-red-100 ring-1 ring-red-200' : ''}`}>
                                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                                                    <span className="font-bold text-gray-700">عالية</span>
                                                </button>
                                                <button onClick={() => changePriorityForSelected(Priority.Medium)} className={`w-full px-3 py-2 text-sm rounded-lg hover:bg-indigo-50 flex items-center gap-2 transition-colors ${t?.priority === Priority.Medium ? 'bg-indigo-100 ring-1 ring-indigo-200' : ''}`}>
                                                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500"></div>
                                                    <span className="font-bold text-gray-700">عادية</span>
                                                </button>
                                                <button onClick={() => changePriorityForSelected(Priority.Low)} className={`w-full px-3 py-2 text-sm rounded-lg hover:bg-gray-100 flex items-center gap-2 transition-colors ${t?.priority === Priority.Low ? 'bg-gray-200 ring-1 ring-gray-300' : ''}`}>
                                                    <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                                                    <span className="font-bold text-gray-700">منخفضة</span>
                                                </button>
                                            </div>
                                        );
                                    })()}
                                    {activeSubmenu === 'list' && (
                                        <div className="space-y-1 max-h-64 overflow-y-auto">
                                            {!moveTargetListId ? (
                                                lists.map(l => (
                                                    <button 
                                                        key={l.id} 
                                                        onClick={() => setMoveTargetListId(l.id)} 
                                                        className={`w-full px-3 py-2 text-sm rounded-lg hover:bg-indigo-50 flex items-center justify-between transition-colors ${activeListId === l.id ? 'bg-gray-50 opacity-60' : ''}`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2.5 h-2.5 rounded-full bg-indigo-400"></div>
                                                            <span className="font-bold text-gray-700">{l.title}</span>
                                                        </div>
                                                        <Icons.ChevronLeft size={12} className="text-gray-300" />
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="animate-fadeIn">
                                                    <button 
                                                        onClick={() => setMoveTargetListId(null)}
                                                        className="w-full px-3 py-1.5 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center gap-1 mb-1 border-b border-indigo-50"
                                                    >
                                                        <Icons.ChevronRight size={12} />
                                                        <span>رجوع للقوائم</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => {
                                                            if (contextMenu.taskId) handleMoveToList(contextMenu.taskId, moveTargetListId);
                                                            setMoveTargetListId(null);
                                                        }}
                                                        className="w-full px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50 rounded-lg flex items-center gap-2 mb-1"
                                                    >
                                                        <div className="w-4 h-4 rounded border border-dashed border-gray-300 flex items-center justify-center text-[10px]">/</div>
                                                        <span>بدون مجموعة</span>
                                                    </button>
                                                    {tasks.filter(t => t.listId === moveTargetListId && t.type === 'folder').map(folder => (
                                                        <button 
                                                            key={folder.id} 
                                                            onClick={() => {
                                                                if (contextMenu.taskId) updateTask(contextMenu.taskId, { listId: moveTargetListId, parentId: folder.id });
                                                                setContextMenu(prev => ({ ...prev, isOpen: false }));
                                                                setActiveSubmenu(null);
                                                                setMoveTargetListId(null);
                                                            }}
                                                            className="w-full px-3 py-2 text-sm rounded-lg hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                                                        >
                                                            <Icons.Folder size={14} className="text-indigo-400" />
                                                            <span className="font-bold text-gray-700">{folder.title}</span>
                                                        </button>
                                                    ))}
                                                    {tasks.filter(t => t.listId === moveTargetListId && t.type === 'folder').length === 0 && (
                                                        <div className="px-3 py-4 text-center text-[10px] text-gray-400 italic">لا توجد مجموعات</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )
            }

            {/* Bulk delete confirmation modal */}
            {
                isBulkDeleteModalOpen && (
                    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
                        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                            <h3 className="text-lg font-bold">حذف {selectedTaskIds.size} مهمة</h3>
                            <p className="text-sm text-gray-500 mt-2">هل أنت متأكد أنك تريد حذف العناصر المحددة؟ هذا الإجراء لا يمكن التراجع عنه.</p>
                            <div className="mt-4 flex justify-end gap-2">
                                <button onClick={() => setIsBulkDeleteModalOpen(false)} className="px-4 py-2 bg-gray-100 rounded-lg font-bold">إلغاء</button>
                                <button onClick={performBulkDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold">حذف</button>
                            </div>
                        </div>
                    </div>
                )
            }


            {/* Task Delete Confirmation Modal */}
            {
                deleteConfirmation.isOpen && (
                    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 p-4" onClick={cancelDeleteTask}>
                        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-fadeIn" onClick={e => e.stopPropagation()}>
                            <h3 className="text-lg font-bold">حذف مهمة</h3>
                            <p className="text-sm text-gray-500 mt-2">هل أنت متأكد من حذف هذا العنصر؟</p>
                            <div className="mt-4 flex justify-end gap-2">
                                <button onClick={cancelDeleteTask} className="px-4 py-2 bg-gray-100 rounded-lg font-bold hover:bg-gray-200 transition">إلغاء</button>
                                <button onClick={confirmDeleteTask} className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition">حذف</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* List delete confirmation modal */}
            {
                listDeleteConfirm && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
                        onClick={() => setListDeleteConfirm(null)}
                    >
                        <div
                            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-fadeIn"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-bold text-gray-800">حذف القائمة</h3>
                            <p className="text-sm text-gray-500 mt-2">هل أنت متأكد من حذف هذه القائمة؟ سيتم حذف جميع المهام الموجودة فيها.</p>
                            <div className="mt-4 flex justify-end gap-2">
                                <button onClick={() => setListDeleteConfirm(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold transition">إلغاء</button>
                                <button onClick={() => handleDeleteList(listDeleteConfirm)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition">حذف</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* List Context Menu */}
            {
                listContextMenu.isOpen && listContextMenu.listId && (
                    <>
                        <div className="fixed inset-0 z-[80]" onClick={() => setListContextMenu({ isOpen: false, x: 0, y: 0, listId: null })} />
                        <div
                            data-list-context-menu
                            className="fixed z-[85] bg-white rounded-xl shadow-2xl border border-gray-100 py-2 min-w-[160px] animate-context-menu"
                            style={{
                                top: Math.min(listContextMenu.y, window.innerHeight - 120),
                                left: Math.min(listContextMenu.x, window.innerWidth - 180)
                            }}
                        >
                            <button
                                onClick={() => {
                                    const list = lists.find(l => l.id === listContextMenu.listId);
                                    if (list) {
                                        setRenamingListId(list.id);
                                        setRenamingListTitle(list.title);
                                    }
                                    setListContextMenu({ isOpen: false, x: 0, y: 0, listId: null });
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                            >
                                <Icons.Edit size={16} />
                                <span className="font-medium">إعادة تسمية</span>
                            </button>
                            {lists.length > 1 && (
                                <button
                                    onClick={() => {
                                        setListDeleteConfirm(listContextMenu.listId);
                                        setListContextMenu({ isOpen: false, x: 0, y: 0, listId: null });
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                >
                                    <Icons.Trash size={16} />
                                    <span className="font-medium">حذف القائمة</span>
                                </button>
                            )}
                        </div>
                    </>
                )
            }

            {/* Group Name Modal - for naming groups created with Space */}
            {
                groupCreation.isOpen && groupCreation.sourceId && !groupCreation.targetId && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm transition-all"
                        onClick={() => {
                            // CANCEL LOGIC: Remove the folder and restore children
                            if (groupCreation.sourceId) {
                                modifyTasks(prev => {
                                    const folderId = groupCreation.sourceId!;
                                    const updateRecursive = (list: Task[]): Task[] => {
                                        const newList: Task[] = [];
                                        for (const t of list) {
                                            if (t.id === folderId) {
                                                // Found folder, append its children instead of it (Ungroup)
                                                t.children.forEach(child => {
                                                    newList.push({ ...child, parentId: t.parentId, listId: t.listId });
                                                });
                                            } else {
                                                const newTask = { ...t };
                                                if (t.children.length > 0) {
                                                    newTask.children = updateRecursive(t.children);
                                                }
                                                newList.push(newTask);
                                            }
                                        }
                                        return newList;
                                    };
                                    return updateRecursive(prev);
                                });
                            }
                            setGroupCreation({ isOpen: false, sourceId: null, targetId: null });
                            setNewGroupName('');
                        }}
                    >
                        <div
                            className="bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] max-w-md w-full p-6 animate-modal-entrance overflow-hidden border border-gray-100"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h3 className="text-xl font-bold text-gray-800 mb-4">اسم المجموعة</h3>
                            <input
                                type="text"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const finalName = newGroupName.trim() || 'مجموعة جديدة';
                                        if (groupCreation.sourceId) {
                                            const folderId = groupCreation.sourceId;
                                            updateTask(folderId, { title: finalName }, true);

                                            // Look for the folder in the current state to check if it's empty
                                            const folderTask = findTask(folderId, tasks);
                                            if (folderTask && folderTask.children.length === 0 && groupCreation.targetId === null) {
                                                const newTaskId = generateId();
                                                const newTask: Task = {
                                                    id: newTaskId,
                                                    title: '',
                                                    type: 'item',
                                                    priority: Priority.Medium,
                                                    color: 'default',
                                                    parentId: folderId,
                                                    listId: activeListId,
                                                    children: [], // No sub-children expected initially
                                                    isCompleted: false,
                                                    createdAt: Date.now()
                                                };

                                                // Prevent auto-collapse effect from hiding our newly opened group
                                                seenColumnsRef.current.add(folderId);

                                                modifyTasks(prevTasks => {
                                                    const addToFolder = (list: Task[]): Task[] => {
                                                        return list.map(t => {
                                                            if (t.id === folderId) {
                                                                return { ...t, children: [newTask, ...t.children] };
                                                            }
                                                            if (t.children && t.children.length > 0) {
                                                                return { ...t, children: addToFolder(t.children) };
                                                            }
                                                            return t;
                                                        });
                                                    };
                                                    return addToFolder(prevTasks);
                                                });

                                                setExpandedFolderIds(prev => new Set(prev).add(folderId));
                                                setTimeout(() => {
                                                    setInlineEditingId(newTaskId);
                                                    setInlineEditText('');
                                                }, 100);
                                            }
                                        }
                                        setGroupCreation({ isOpen: false, sourceId: null, targetId: null });
                                        setNewGroupName('');
                                    } else if (e.key === 'Escape') {
                                        // CANCEL LOGIC
                                        if (groupCreation.sourceId) {
                                            modifyTasks(prev => {
                                                const folderId = groupCreation.sourceId!;
                                                const updateRecursive = (list: Task[]): Task[] => {
                                                    const newList: Task[] = [];
                                                    for (const t of list) {
                                                        if (t.id === folderId) {
                                                            t.children.forEach(child => {
                                                                newList.push({ ...child, parentId: t.parentId, listId: t.listId });
                                                            });
                                                        } else {
                                                            const newTask = { ...t };
                                                            if (t.children.length > 0) {
                                                                newTask.children = updateRecursive(t.children);
                                                            }
                                                            newList.push(newTask);
                                                        }
                                                    }
                                                    return newList;
                                                };
                                                return updateRecursive(prev);
                                            });
                                        }
                                        setGroupCreation({ isOpen: false, sourceId: null, targetId: null });
                                        setNewGroupName('');
                                    }
                                }}
                                placeholder="مجموعة جديدة"
                                autoFocus
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-lg transition-all shadow-sm"
                            />
                        </div>
                    </div>
                )
            }


            {/* Update Notification Banner */}
            {
                (updateAvailable || updateDownloaded) && (
                    <div className="fixed bottom-4 left-4 z-[2000] bg-white rounded-xl shadow-2xl p-4 max-w-sm w-full border border-gray-100 animate-slideUp" dir="rtl">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                                <span className="text-lg">📥</span>
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold text-gray-800">
                                    {updateDownloaded ? 'التحديث جاهز للتثبيت!' : 'جاري تحميل تحديث جديد...'}
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">
                                    {updateDownloaded ? 'تم تحميل التحديث بنجاح. أعد تشغيل التطبيق لتطبيقه.' : 'يتم تحميل التحديث في الخلفية.'}
                                </p>
                                <div className="mt-3 flex justify-end gap-2">
                                    {!updateDownloaded && (
                                        <button onClick={() => { setUpdateAvailable(false); setUpdateDownloaded(false); }} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold transition">
                                            إغلاق
                                        </button>
                                    )}
                                    {updateDownloaded && (
                                        <>
                                            <button onClick={() => { setUpdateAvailable(false); setUpdateDownloaded(false); }} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold transition">
                                                لاحقاً
                                            </button>
                                            <button onClick={() => {
                                                const ipc = (window as any).require?.('electron')?.ipcRenderer;
                                                if (ipc) ipc.send('quit-and-install');
                                            }} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition">
                                                إعادة التشغيل
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
}
