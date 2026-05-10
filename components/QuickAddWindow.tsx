import React, { useState, useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
// Assuming electron API is available globally or via window (nodeIntegration: true)
const electron = (window as any).require ? (window as any).require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;
const clipboard = electron ? electron.clipboard : null;
const nativeImage = electron ? electron.nativeImage : null;

interface TaskList {
    id: string;
    title: string;
    icon?: string;
    themeColor?: string;
}

interface Folder {
    id: string;
    title: string;
    type: 'folder';
}

export const QuickAddWindow = () => {
    const inputRef = useRef<HTMLDivElement>(null);

    // Popup state
    const [showListPopup, setShowListPopup] = useState(false);
    const [lists, setLists] = useState<TaskList[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Folder sub-menu state
    const [hoveredListId, setHoveredListId] = useState<string | null>(null);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [selectedFolderIndex, setSelectedFolderIndex] = useState(-1); // -1 means root list selected
    const [showFolderPopup, setShowFolderPopup] = useState(false);

    // Parent Tasks sub-menu state (third level)
    const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);
    const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
    const [parentTasks, setParentTasks] = useState<any[]>([]);
    const [selectedParentIndex, setSelectedParentIndex] = useState(-1);
    const [showParentTasksPopup, setShowParentTasksPopup] = useState(false);

    // Inline Creation State
    const [isCreatingList, setIsCreatingList] = useState(false);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newListName, setNewListName] = useState('');
    const [newFolderName, setNewFolderName] = useState('');
    const [folderContextMenu, setFolderContextMenu] = useState<{ x: number, y: number, folderId: string } | null>(null);

    // Saved selection state - to preserve selection when popup opens
    const [savedSelection, setSavedSelection] = useState<{ text: string; range: Range | null } | null>(null);

    // Priority state for quick add
    const [selectedPriority, setSelectedPriority] = useState<1 | 2 | 3>(2); // 1=High, 2=Medium, 3=Low

    // Maximize toggle state
    const [isMaximized, setIsMaximized] = useState(false);

    // Animation visibility state
    const [isVisible, setIsVisible] = useState(false);

    // Dynamic container direction (follows keyboard language)
    const [containerDir, setContainerDir] = useState<'rtl' | 'ltr'>('rtl');

    // State to track if we should clear data on hide (true for Close button, false for Shortcuts)
    const shouldClearRef = useRef(false);
    const lastClickRef = useRef<{ time: number, folderId: string | null }>({ time: 0, folderId: null });

    useEffect(() => {
        if (!ipcRenderer) return;
        const handleShow = () => setIsVisible(true);
        const handleHide = () => {
            shouldClearRef.current = false; // Just hide, don't clear
            setIsVisible(false);
        };
        const handleClearAndClose = () => {
            shouldClearRef.current = true; // Clear and hide
            setIsVisible(false);
        };

        ipcRenderer.on('show-quick-note', handleShow);
        ipcRenderer.on('hide-quick-note', handleHide);
        ipcRenderer.on('request-clear-and-close', handleClearAndClose);
        
        const handleBroadcastSync = (_: any, type: string) => {
            // When main window changes something, we might need to refresh lists/folders
            if (showListPopup) {
                ipcRenderer.invoke('get-lists').then((fetchedLists: TaskList[]) => {
                    setLists(fetchedLists || []);
                });
            }
            if (hoveredListId) {
                ipcRenderer.invoke('get-folders-for-list', hoveredListId).then((fetchedFolders: Folder[]) => {
                    setFolders(fetchedFolders || []);
                });
            }
        };
        ipcRenderer.on('data-updated', handleBroadcastSync);

        return () => {
            ipcRenderer.off('show-quick-note', handleShow);
            ipcRenderer.off('hide-quick-note', handleHide);
            ipcRenderer.off('request-clear-and-close', handleClearAndClose);
            ipcRenderer.off('data-updated', handleBroadcastSync);
        };
    }, [showListPopup, hoveredListId]);

    const handleTransitionEnd = () => {
        if (!isVisible && ipcRenderer) {
            ipcRenderer.send('quick-note-hidden');

            // Only clear content if explicitly requested (e.g. via Close button)
            if (shouldClearRef.current) {
                if (inputRef.current) {
                    inputRef.current.innerHTML = '';
                }
                setShowListPopup(false);
                setLists([]);
                setFolders([]);
                setParentTasks([]);
                setHoveredListId(null);
                setHoveredFolderId(null);
                setExpandedFolderId(null);
                setSavedSelection(null);
                setFolderContextMenu(null);
            }
        }
    };

    const hideWindow = () => {
        setIsVisible(false); // Trigger local animation immediately
        // ipcRenderer.send('hide-quick-note'); // No need for round trip
    };

    // Double Shift detection
    const lastShiftTime = useRef(0);

    const toggleMaximize = () => {
        if (ipcRenderer) {
            ipcRenderer.invoke('toggle-quick-note-size', !isMaximized);
            setIsMaximized(!isMaximized);
        }
    };

    // Double Shift key handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return; // Ignore hold-down repeats

            if (e.key === 'Shift' && !e.altKey && !e.ctrlKey && !e.metaKey) {
                const now = Date.now();
                if (now - lastShiftTime.current < 300) {
                    toggleMaximize();
                    lastShiftTime.current = 0;
                } else {
                    lastShiftTime.current = now;
                }
            } else {
                // If ANY other key is pressed (or Shift with modifier), invalidate the sequence
                lastShiftTime.current = 0;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMaximized]);

    // Auto-maximize on overflow
    useEffect(() => {
        const node = inputRef.current;
        if (!node) return;

        const checkOverflow = () => {
            if (!isMaximized && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 5) {
                if (ipcRenderer) {
                    ipcRenderer.invoke('toggle-quick-note-size', true);
                    setIsMaximized(true);
                }
            }
        };

        const observer = new MutationObserver(checkOverflow);
        observer.observe(node, { childList: true, subtree: true, characterData: true });

        // Check initially in case of pasted content or fast typing
        checkOverflow();

        return () => {
            observer.disconnect();
        };
    }, [isMaximized]);

    // Focus Listeners & Transparency Fix
    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        if (inputRef.current) inputRef.current.focus();
        const focusHandler = () => inputRef.current?.focus();

        if (ipcRenderer) {
            ipcRenderer.on('focus-quick-add', focusHandler);
        }

        return () => {
            document.body.style.backgroundColor = '';
            if (ipcRenderer) ipcRenderer.removeListener('focus-quick-add', focusHandler);
        };
    }, []);

    // Fetch lists when popup opens
    useEffect(() => {
        if (showListPopup && ipcRenderer) {
            ipcRenderer.invoke('get-lists').then((fetchedLists: TaskList[]) => {
                setLists(fetchedLists || []);
                setSelectedIndex(0);
                setHoveredListId(null);
                setFolders([]);
                setShowFolderPopup(false);
                setExpandedFolderId(null);
            });
        }
    }, [showListPopup]);

    // Fetch folders when hovering over a list
    useEffect(() => {
        if (hoveredListId && ipcRenderer) {
            ipcRenderer.invoke('get-folders-for-list', hoveredListId).then((fetchedFolders: Folder[]) => {
                setFolders(fetchedFolders || []);
                setSelectedFolderIndex(-1);
                setShowFolderPopup(fetchedFolders && fetchedFolders.length > 0);
                setExpandedFolderId(null);
            });
        } else if (hoveredListId === null) {
            setFolders([]);
            setShowFolderPopup(false);
            setExpandedFolderId(null);
        }
    }, [hoveredListId]);

    // Fetch parent tasks only when a folder is expanded
    useEffect(() => {
        if (expandedFolderId && hoveredListId && ipcRenderer) {
            ipcRenderer.invoke('get-parent-tasks-for-folder', { listId: hoveredListId, folderId: expandedFolderId }).then((fetchedParents: any[]) => {
                setParentTasks(fetchedParents || []);
                setSelectedParentIndex(-1);
            });
        } else if (!expandedFolderId) {
            setParentTasks([]);
        }
    }, [expandedFolderId, hoveredListId]);

    // Sort folders: Non-empty ones stay at the top. Empty ones below them.
    // Within each group, sort by lastActivityAt descending (most recent activity first).
    const sortedFolders = React.useMemo(() => {
        const nonEmptyFolders = folders.filter(f => (f as any).taskCount > 0);
        const emptyFolders = folders.filter(f => !(f as any).taskCount || (f as any).taskCount === 0);
        
        // Sort both groups by lastActivityAt descending (most recent first)
        const sortByActivity = (a: any, b: any) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
        
        emptyFolders.sort(sortByActivity);
        nonEmptyFolders.sort(sortByActivity);
        
        // Non-empty folders at the top, then recently active empty ones
        return [...nonEmptyFolders, ...emptyFolders];
    }, [folders]);

    // --- COPY HANDLER (Images) ---
    const handleCopy = (e: React.ClipboardEvent) => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const div = document.createElement('div');
            div.appendChild(range.cloneContents());
            const img = div.querySelector('img');

            // If selection contains an image (and mostly just the image)
            if (img && img.src.startsWith('data:image') && clipboard && nativeImage) {
                e.preventDefault();
                try {
                    const image = nativeImage.createFromDataURL(img.src);
                    clipboard.writeImage(image);
                } catch (err) {
                    console.error('Failed to copy image', err);
                }
            }
        }
    };

    // --- CUT HANDLER (Images) ---
    const handleCut = (e: React.ClipboardEvent) => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const div = document.createElement('div');
            div.appendChild(range.cloneContents());
            const img = div.querySelector('img');

            // If selection contains an image (and mostly just the image)
            if (img && img.src.startsWith('data:image') && clipboard && nativeImage) {
                e.preventDefault();
                try {
                    const image = nativeImage.createFromDataURL(img.src);
                    clipboard.writeImage(image);

                    // Delete the image from the document using execCommand to preserve undo stack
                    document.execCommand('delete');
                } catch (err) {
                    console.error('Failed to cut image', err);
                }
            }
        }
    };

    // --- PASTE HANDLER (Images & Clean Text) ---
    // --- PASTE HANDLER (Images & Smart Rich Text) ---
    const handlePaste = (e: React.ClipboardEvent) => {
        // 1. Handle Images
        if (e.clipboardData.files.length > 0) {
            e.preventDefault();
            const files = Array.from(e.clipboardData.files);
            files.forEach(file => {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const imgHtml = `<img src="${ev.target?.result}" class="rounded-lg shadow-sm border border-gray-100 my-1 cursor-pointer hover:shadow-md transition-shadow" style="max-width: 50%; height: auto;" onclick="this.classList.toggle('ring-2'); this.classList.toggle('ring-indigo-500');" />`;
                        document.execCommand('insertHTML', false, imgHtml);
                    };
                    reader.readAsDataURL(file);
                }
            });
            return;
        }

        // 2. Handle Text & Rich Content
        const html = e.clipboardData.getData('text/html');
        const plainText = e.clipboardData.getData('text/plain');

        if (html || plainText) {
            e.preventDefault();
            
            let contentToInsert = '';

            if (html) {
                // ... (existing sanitize logic) ...
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const cleanNode = (node: Node): string => {
                    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        const tag = el.tagName.toLowerCase();
                        const style = el.getAttribute('style') || '';
                        const isBold = style.includes('font-weight: bold') || style.includes('font-weight: 700') || 
                                       tag === 'b' || tag === 'strong' || el.style.fontWeight === 'bold' || el.style.fontWeight === '700';
                        const isItalic = tag === 'i' || tag === 'em' || style.includes('font-style: italic');
                        const isUnderline = tag === 'u' || style.includes('text-decoration: underline');
                        let innerContent = '';
                        el.childNodes.forEach(child => { innerContent += cleanNode(child); });
                        if (tag === 'a') {
                            const href = el.getAttribute('href') || '';
                            return `<a href="${href}" contenteditable="false" class="text-blue-600 hover:underline cursor-pointer" style="color: #2563eb; text-decoration: underline;">${innerContent}</a>`;
                        }
                        let result = innerContent;
                        if (isBold) result = `<strong>${result}</strong>`;
                        if (isItalic) result = `<em>${result}</em>`;
                        if (isUnderline) result = `<u>${result}</u>`;
                        // Block level elements: convert to div wrapper for Injaz style
                        if (tag === 'div' || tag === 'p' || tag === 'br') return `|LINE_BREAK|${result || '<br>'}|LINE_BREAK|`;
                        return result;
                    }
                    return '';
                };

                let rawContent = '';
                doc.body.childNodes.forEach(child => { rawContent += cleanNode(child); });
                
                // Split by our marker and filter out empty segments from double breaks
                const lines = rawContent.split('|LINE_BREAK|').filter(l => l !== '');
                if (lines.length > 0) {
                    // If multiple lines, we'll use a safer approach:
                    // Insert first line content at cursor, then insert other lines as siblings
                    const firstLineHtml = lines[0];
                    document.execCommand('insertHTML', false, firstLineHtml);
                    
                    if (lines.length > 1) {
                        // For simplicity in this complex contentEditable, 
                        // we can generate a temporary fragment of divs and insert it.
                        const remainingHtml = lines.slice(1).map(l => `<div>${l}</div>`).join('');
                        document.execCommand('insertHTML', false, remainingHtml);
                    }
                }
            } else if (plainText) {
                const lines = plainText.split(/\r?\n/);
                if (lines.length > 1) {
                    // Insert first line content
                    document.execCommand('insertText', false, lines[0]);
                    // Insert others as divs
                    const remainingHtml = lines.slice(1).map(l => `<div>${l || '<br>'}</div>`).join('');
                    document.execCommand('insertHTML', false, remainingHtml);
                } else {
                    document.execCommand('insertText', false, plainText);
                }
            }
        }
    };

    // --- LINK & IMAGE CLICK HANDLER ---
    const handleContentClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;

        // Handle Links
        if (target.tagName === 'A') {
            const href = target.getAttribute('href');
            if (href && ipcRenderer) {
                e.preventDefault();
                ipcRenderer.invoke('open-external', href);
            }
        }

        // Handle Images (Selection / Resize simulation)
        if (target.tagName === 'IMG') {
            // Already handled by onclick attribute for visual ring, 
            // but we can ensure native selection for copy/resize
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNode(target);
            sel?.removeAllRanges();
            sel?.addRange(range);
        }

        // Update container direction based on what line was clicked
        setTimeout(checkAndUpdateContainerDir, 0);
    };

    // AUTO-LINKIFY FUNCTION
    const linkifyText = (text: string): string => {
        const urlRegex = /((https?:\/\/|www\.)[^\s]+)/g;
        return text.replace(urlRegex, (url) => {
            const href = url.startsWith('www.') ? 'http://' + url : url;
            return `<a href="${href}" contenteditable="false" class="text-blue-600 hover:underline cursor-pointer select-none">${url}</a>`;
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Handle parent tasks sub-menu navigation (third level)
        if (showParentTasksPopup && parentTasks.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedParentIndex(prev => Math.min(prev + 1, parentTasks.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedParentIndex(prev => Math.max(prev - 1, -1)); return; }
            if (e.key === 'ArrowLeft') { e.preventDefault(); setShowParentTasksPopup(false); setHoveredFolderId(null); return; }
            if (e.key === 'Enter') {
                e.preventDefault();
                const parentTaskId = selectedParentIndex >= 0 ? parentTasks[selectedParentIndex].id : null;
                addTaskToList(hoveredListId!, hoveredFolderId!, parentTaskId);
                return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setShowParentTasksPopup(false); setHoveredFolderId(null); return; }
        }

        // ... (Keep existing Folder/List navigation logic 133-238) ...
        if (showFolderPopup && sortedFolders.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedFolderIndex(prev => Math.min(prev + 1, sortedFolders.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedFolderIndex(prev => Math.max(prev - 1, -1)); return; }
            if (e.key === 'ArrowLeft') { e.preventDefault(); setShowFolderPopup(false); /* Keep hoveredListId and parent tasks open */ return; }
            if (e.key === 'ArrowRight' && selectedFolderIndex >= 0) { e.preventDefault(); setHoveredFolderId(sortedFolders[selectedFolderIndex].id); return; }
            if (e.key === 'Enter') { e.preventDefault(); const parentId = selectedFolderIndex >= 0 ? sortedFolders[selectedFolderIndex].id : null; addTaskToList(hoveredListId!, parentId); return; }
            if (e.key === '+') { e.preventDefault(); setIsCreatingFolder(true); setNewFolderName(''); return; }
            if (e.key === 'Escape') { e.preventDefault(); setShowFolderPopup(false); /* Keep hoveredListId and parent tasks open */ return; }
        }
        if (showListPopup) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(prev => Math.min(prev + 1, lists.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(prev => Math.max(prev - 1, 0)); return; }
            if (e.key === 'ArrowRight' && lists[selectedIndex]) { e.preventDefault(); setHoveredListId(lists[selectedIndex].id); return; }
            if (e.key === 'Enter') { e.preventDefault(); if (lists[selectedIndex]) { if (showFolderPopup && selectedFolderIndex >= 0) { addTaskToList(lists[selectedIndex].id, folders[selectedFolderIndex].id); } else { addTaskToList(lists[selectedIndex].id); } } return; }
            if (e.key === '+') { e.preventDefault(); setIsCreatingList(true); setNewListName(''); return; }
            if (e.key === 'Escape') { e.preventDefault(); setShowListPopup(false); setHoveredListId(null); inputRef.current?.focus(); return; }
            if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
            setShowListPopup(false); setHoveredListId(null); return;
        }

        // Tab opens popup
        if (e.key === 'Tab') {
            e.preventDefault();
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && inputRef.current && inputRef.current.contains(sel.anchorNode)) {
                if (sel.rangeCount > 0) { setSavedSelection({ text: sel.toString(), range: sel.getRangeAt(0).cloneRange() }); }
            } else { setSavedSelection(null); }
            setShowListPopup(true);
            return;
        }

        if (e.key === 'Escape') hideWindow();

        // Arrow key navigation: update caret direction based on destination line
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
            !showListPopup && !showFolderPopup && !showParentTasksPopup) {
            setTimeout(checkAndUpdateContainerDir, 0);
        }

        // Immediate direction switch from typed character
        // This fires BEFORE the character appears, giving instant caret repositioning
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const arabicChar = /[\u0600-\u06FF]/.test(e.key);
            const latinChar = /[a-zA-Z]/.test(e.key);
            if (arabicChar) {
                setContainerDir('rtl');
            } else if (latinChar) {
                setContainerDir('ltr');
            }
        }

        // --- ENHANCED ENTER HANDLER ---
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();

            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                let currentLine: HTMLElement | null = null;
                let node: Node | null = range.commonAncestorContainer;
                while (node && node !== inputRef.current) {
                    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'DIV') { currentLine = node as HTMLElement; break; }
                    node = node.parentNode;
                }

                if (currentLine) {
                    const text = currentLine.textContent || '';
                    const html = currentLine.innerHTML || '';

                    console.log('Enter pressed - text:', JSON.stringify(text), 'html:', html.substring(0, 200));

                    // 1. Check for List Continuation - More flexible patterns
                    // Supports: "1. ", "1- ", "1) ", "• " plus styled versions
                    const bulletMatch = text.match(/^[\s\u00A0]*•/);

                    // Plain text number match - at start of line
                    const numberMatch = text.match(/^[\s\u00A0]*(\d+|[٠-٩]+)([\.\-\)])/);

                    // Styled number match - look for number in span tags in HTML
                    const styledNumberMatch = html.match(/<span[^>]*>[\s\u00A0]*(\d+|[٠-٩]+)[\s\u00A0]*<\/span>[\s\u00A0]*<span[^>]*>([\.\-\)])<\/span>/);

                    // Also try matching just the textContent for styled numbers (textContent ignores tags)
                    const anyNumberMatch = text.match(/^[\s\u00A0]*(\d+|[٠-٩]+)[\s\u00A0]*([\.\-\)])/);

                    console.log('Matches - bullet:', !!bulletMatch, 'number:', numberMatch, 'styled:', styledNumberMatch, 'any:', anyNumberMatch);

                    // Continue List
                    let nextNumStr = '';
                    let separator = '';
                    let hasListPrefix = false;

                    if (bulletMatch) {
                        hasListPrefix = true;
                    } else if (numberMatch || styledNumberMatch || anyNumberMatch) {
                        hasListPrefix = true;
                        // Extract number and separator from whichever match worked
                        const match = numberMatch || styledNumberMatch || anyNumberMatch;
                        const numStr = match![1];
                        separator = match![2];

                        const digitMap: { [key: string]: string } = { '0': '٠', '1': '١', '2': '٢', '3': '٣', '4': '٤', '5': '٥', '6': '٦', '7': '٧', '8': '٨', '9': '٩', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
                        let engNum = '';
                        for (let char of numStr) { engNum += (char >= '0' && char <= '9') ? char : (digitMap[char] || char); }
                        const nextNum = parseInt(engNum) + 1;
                        nextNumStr = nextNum.toString();

                        // Convert back to Arabic numerals if original was Arabic
                        if (/[٠-٩]/.test(numStr)) {
                            const revDigitMap: { [key: string]: string } = { '0': '٠', '1': '١', '2': '٢', '3': '٣', '4': '٤', '5': '٥', '6': '٦', '7': '٧', '8': '٨', '9': '٩' };
                            nextNumStr = nextNumStr.replace(/[0-9]/g, m => revDigitMap[m]);
                        }
                    }

                    console.log('hasListPrefix:', hasListPrefix, 'nextNumStr:', nextNumStr, 'separator:', separator);

                    if (hasListPrefix) {
                        // Check if current line is ONLY the list prefix with no actual content
                        // If so, end the list instead of continuing it
                        const trimmedText = text.replace(/^[\s\u00A0]*/, '').replace(/[\s\u00A0]*$/, '');
                        const isEmptyListItem = (
                            (bulletMatch && trimmedText === '•') ||
                            (anyNumberMatch && trimmedText.match(/^(\d+|[٠-٩]+)[\s\u00A0]*([\.\-\)])[\s\u00A0]*$/))
                        );

                        if (isEmptyListItem) {
                            // End the list - clear the current line and make it a plain empty line
                            currentLine.innerHTML = '<br>';
                            currentLine.style.fontWeight = 'normal';

                            // Move cursor to start of line
                            const newRange = document.createRange();
                            newRange.selectNodeContents(currentLine);
                            newRange.collapse(true);
                            selection.removeAllRanges();
                            selection.addRange(newRange);
                            return;
                        }

                        const isRtl = currentLine.style.direction === 'rtl' || text.match(/[\u0600-\u06FF]/);

                        // Create new line element using direct DOM manipulation
                        const newLine = document.createElement('div');
                        newLine.style.backgroundColor = 'transparent';
                        newLine.style.direction = isRtl ? 'rtl' : 'ltr';
                        newLine.style.textAlign = isRtl ? 'right' : 'left';

                        if (bulletMatch) {
                            // Bullet prefix
                            const bulletSpan = document.createElement('span');
                            bulletSpan.style.fontWeight = 'bold';
                            bulletSpan.style.opacity = '0.5';
                            bulletSpan.style.position = 'relative';
                            bulletSpan.style.top = '1px';
                            bulletSpan.textContent = '•';
                            newLine.appendChild(bulletSpan);
                            // Add space with normal font weight
                            const spaceSpan = document.createElement('span');
                            spaceSpan.style.fontWeight = 'normal';
                            spaceSpan.innerHTML = '&nbsp;';
                            newLine.appendChild(spaceSpan);
                        } else if (nextNumStr) {
                            // Number prefix - bold with 50% opacity
                            const numSpan = document.createElement('span');
                            numSpan.style.fontWeight = 'bold';
                            numSpan.style.opacity = '0.5';
                            numSpan.textContent = nextNumStr;
                            newLine.appendChild(numSpan);

                            // Separator - also with 50% opacity
                            const sepSpan = document.createElement('span');
                            sepSpan.style.fontWeight = 'bold';
                            sepSpan.style.opacity = '0.5';
                            sepSpan.style.position = 'relative';
                            sepSpan.style.top = '1px';
                            sepSpan.textContent = separator;
                            newLine.appendChild(sepSpan);

                            // Add space with normal font weight for text after
                            const spaceSpan = document.createElement('span');
                            spaceSpan.style.fontWeight = 'normal';
                            spaceSpan.innerHTML = '&nbsp;';
                            newLine.appendChild(spaceSpan);
                        }

                        // Insert new line after current line
                        if (currentLine.nextSibling) {
                            inputRef.current!.insertBefore(newLine, currentLine.nextSibling);
                        } else {
                            inputRef.current!.appendChild(newLine);
                        }

                        // Move cursor to end of new line
                        const newRange = document.createRange();
                        newRange.selectNodeContents(newLine);
                        newRange.collapse(false);
                        selection.removeAllRanges();
                        selection.addRange(newRange);

                        return;
                    }
                }
            }


            // --- AUTO-LINKIFY ON ENTER ---
            // Before creating new line, check if we just typed a URL and convert it
            // Reuse selection from above
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                let currentLine: HTMLElement | null = null;
                let node: Node | null = range.commonAncestorContainer;
                while (node && node !== inputRef.current) {
                    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'DIV') {
                        currentLine = node as HTMLElement;
                        break;
                    }
                    node = node.parentNode;
                }

                if (currentLine) {
                    // Get text content and check for URLs
                    const text = currentLine.textContent || '';
                    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;

                    if (urlRegex.test(text)) {
                        // Convert URLs to links
                        const innerHTML = currentLine.innerHTML;
                        const linkedHTML = innerHTML.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, (url) => {
                            // Skip if already in anchor tag
                            if (innerHTML.indexOf(`href="${url}"`) !== -1 || innerHTML.indexOf(`href='${url}'`) !== -1) {
                                return url;
                            }
                            const href = url.startsWith('www.') ? 'http://' + url : url;
                            return `<a href="${href}" contenteditable="false" class="text-blue-600 hover:underline cursor-pointer" style="color: #2563eb; text-decoration: underline;">${url}</a>`;
                        });

                        if (linkedHTML !== innerHTML) {
                            currentLine.innerHTML = linkedHTML;
                            // Move cursor to end of line
                            const newRange = document.createRange();
                            newRange.selectNodeContents(currentLine);
                            newRange.collapse(false);
                            selection.removeAllRanges();
                            selection.addRange(newRange);
                        }
                    }
                }
            }

            // Fallback: Just New Line (allow multiple)
            // Use standard execCommand if possible, or manual insertion if needed
            // But 'insertHTML' with a div often fails to stack.
            // Let's force a simpler line break if no special handling occurred.

            // Standard behavior works best for simple new lines in contentEditable
            // But we want to enforce styling/direction.
            // Let's simply insert a BR if the last line was empty too?
            // Actually, inserting a div with a br inside is standard.

            e.preventDefault();
            
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);

            // 1. Find the current line (div)
            let currentLine: HTMLElement | null = null;
            let node: Node | null = range.commonAncestorContainer;
            while (node && node !== inputRef.current) {
                if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'DIV') {
                    currentLine = node as HTMLElement;
                    break;
                }
                node = node.parentNode;
            }

            // 2. Create the new line
            const newLine = document.createElement('div');
            newLine.style.backgroundColor = 'transparent';
            newLine.style.fontWeight = 'normal';
            newLine.innerHTML = '<br>'; // Give it height

            // Inherit direction and alignment
            if (currentLine) {
                newLine.style.direction = currentLine.style.direction || 'rtl';
                newLine.style.textAlign = currentLine.style.textAlign || 'right';
            } else {
                newLine.style.direction = 'rtl';
                newLine.style.textAlign = 'right';
            }

            // 3. Insert the new line
            if (currentLine) {
                // If we are at the end of the line or in the middle, we should ideally split.
                // But for a "Quick Note", inserting after is often sufficient if they are at the end.
                // To be robust, let's just use insertNode but ensure we are NOT nesting.
                
                // If we are INSIDE a div, we want to insert the new div AFTER it.
                currentLine.parentNode?.insertBefore(newLine, currentLine.nextSibling);
            } else {
                // Not in a div (e.g. empty editor), just append
                inputRef.current?.appendChild(newLine);
            }

            // 4. Move caret to the new line
            const newRange = document.createRange();
            newRange.selectNodeContents(newLine);
            newRange.collapse(true); // Start of line
            sel.removeAllRanges();
            sel.addRange(newRange);

            // Smooth scroll to caret if needed
            newLine.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            
            return;
        }

        // --- SPACE BAR HANDLER (Auto-Format) ---
        if (e.key === ' ') {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const node = range.endContainer;
                const offset = range.endOffset;

                // 1. Auto-Linkify Last Word
                if (node.nodeType === Node.TEXT_NODE && node.textContent) {
                    const textBefore = node.textContent.substring(0, offset);

                    // 2. AUTO-FORMAT LISTS (Number + Dot + Space detected)
                    // Regex to detect "1." or "١." at end of text (triggered by Space key, so no space in text yet)
                    const listMatch = textBefore.match(/(^|\n)(\d+|[٠-٩]+)([\.\-\)])$/);
                    if (listMatch) {
                        // Found a list pattern trigger!
                        e.preventDefault();

                        const fullMatch = listMatch[0]; // e.g., "1."

                        const numStr = listMatch[2];
                        const separator = listMatch[3];

                        // Create custom HTML for the list item prefix
                        // Number: Bold with 50% opacity, Separator: same, Text after: normal weight
                        const separatorHtml = `<span style="font-weight: bold; opacity: 0.5; position: relative; top: 1px;">${separator}</span>`;
                        const numberHtml = `<span style="font-weight: bold; opacity: 0.5;">${numStr}</span>`;
                        const spaceHtml = `<span style="font-weight: normal;">&nbsp;</span>`;
                        const newHtml = numberHtml + separatorHtml + spaceHtml;

                        // We need to replace the plain text with this HTML
                        // Since we are in a contentEditable, we can manipulate the Range.

                        // 1. Delete the plain text typed so far (the prefix)
                        const rangeToReplace = document.createRange();
                        // Find start point: offset - length of match (ignoring newline group if it didn't consume chars in textNode?)
                        // listMatch[2] (digits) + listMatch[3] (separator)
                        const matchLength = listMatch[2].length + listMatch[3].length;

                        rangeToReplace.setStart(node, offset - matchLength);
                        rangeToReplace.setEnd(node, offset);
                        rangeToReplace.deleteContents();

                        // 2. Insert the HTML
                        const span = document.createElement('span');
                        span.innerHTML = newHtml;
                        range.insertNode(span);

                        // 3. Move caret to end
                        range.setStartAfter(span);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                        return; // Done
                    }

                    // 3. AUTO-FORMAT BULLETS (Dot + Space detected)
                    // Regex to detect ". " at end of text (but not "1. ") - actually "1." is handled above.
                    // We just check if it ends with ". " and wasn't caught by listMatch.
                    const bulletTrigger = textBefore.match(/(^|\n| )(\.)\s$/);
                    // Ensure it's not a number list (handled above)
                    if (bulletTrigger && !textBefore.match(/(\d+|[٠-٩]+)\.\s$/)) {
                        e.preventDefault();

                        // Create custom HTML for the bullet
                        // Style: Bold (like numbers), 50% opacity, lowered
                        const bulletHtml = `<span style="font-weight: bold; opacity: 0.5; position: relative; top: 1px;">•</span>&nbsp;`;

                        const rangeToReplace = document.createRange();
                        // Match is ". ", length 2.
                        rangeToReplace.setStart(node, offset - 2);
                        rangeToReplace.setEnd(node, offset);
                        rangeToReplace.deleteContents();

                        const span = document.createElement('span');
                        span.innerHTML = bulletHtml;
                        range.insertNode(span);

                        range.setStartAfter(span);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                        return;
                    }

                    const words = textBefore.split(' ');
                    const lastWord = words[words.length - 1];

                    if (lastWord.match(/^((https?:\/\/|www\.)[^\s]+)/)) {
                        // It's a URL, let's linkify it
                        // (Complex to linkify strictly one word in contentEditable without library, 
                        // but simpler approach: detect common patterns)
                        // For now, let's skip complex inline replacement to avoid cursor jumps, unless requested strongly.
                        // User asked "Support links... blue...".
                        // We can rely on handleInput/blur or specific Space trigger.
                    }
                }
            }
        }

        // Keep standard shortcuts
        if (e.ctrlKey) {
            switch (e.key.toLowerCase()) {
                case 'b': e.preventDefault(); document.execCommand('bold'); break;
                case 'u': e.preventDefault(); document.execCommand('underline'); break;
                case 'i': e.preventDefault(); document.execCommand('italic'); break;
            }
        }

        // ... (Highlight logic 328-396) ...
        if (e.ctrlKey && e.shiftKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
            // ... existing highlight logic ...
            e.preventDefault(); document.execCommand('styleWithCSS', false, true);
            document.execCommand('hiliteColor', false, '#FFFF00'); // Simplified for brevity in this replace
        }

        // Ctrl+1 → Arabic (RTL) | Ctrl+2 → English (LTR)
        if (e.ctrlKey && !e.shiftKey && !e.altKey) {
            if (e.key === '1') {
                e.preventDefault();
                isArabicLayoutRef.current = true;
                setContainerDir('rtl');
            } else if (e.key === '2') {
                e.preventDefault();
                isArabicLayoutRef.current = false;
                setContainerDir('ltr');
            }
        }

    };

    // Keyboard Layout Detection
    const isArabicLayoutRef = useRef(false);

    const updateKeyboardLayout = async () => {
        if ('keyboard' in navigator && (navigator as any).keyboard?.getLayoutMap) {
            try {
                const map = await (navigator as any).keyboard.getLayoutMap();
                const keyA = map.get('KeyA'); // 'a' in English, 'ش' in Arabic
                const arabicRegex = /[\u0600-\u06FF]/;
                const isArabic = arabicRegex.test(keyA || '');
                isArabicLayoutRef.current = isArabic;

                // Update container direction immediately based on keyboard layout
                // BUT only if the input is empty or current line has no strong chars
                if (inputRef.current) {
                    const text = inputRef.current.innerText.trim();
                    const hasArabic = /[\u0600-\u06FF]/.test(text);
                    const hasLatin = /[a-zA-Z]/.test(text);
                    // If no strong characters, follow keyboard layout
                    if (!hasArabic && !hasLatin) {
                        setContainerDir(isArabic ? 'rtl' : 'ltr');
                    }
                } else {
                    setContainerDir(isArabic ? 'rtl' : 'ltr');
                }
            } catch (e) {
                // Fallback or permission denied
            }
        }
    };

    useEffect(() => {
        updateKeyboardLayout();
        window.addEventListener('focus', updateKeyboardLayout);
        window.addEventListener('keyup', updateKeyboardLayout);
        return () => {
            window.removeEventListener('focus', updateKeyboardLayout);
            window.removeEventListener('keyup', updateKeyboardLayout);
        };
    }, []);



    const addTaskToList = async (listId: string, parentId?: string | null, parentTaskId?: string | null, initialSubtaskTitle?: string) => {
        if (!inputRef.current || !ipcRenderer) return;

        let title = '';
        let isSelection = false;

        // 1. Check saved selection first (from Tab press)
        if (savedSelection) {
            title = savedSelection.text.trim();
            isSelection = true;
        }

        // 2. Check live selection if no saved selection
        if (!title) {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                if (inputRef.current.contains(range.commonAncestorContainer)) {
                    title = selection.toString().trim();
                    isSelection = true;
                }
            }
        }

        // 3. Fallback: use all text
        if (!title) {
            title = inputRef.current.innerText.trim();
        }

        if (!title) {
            setShowListPopup(false);
            setHoveredListId(null);
            setSavedSelection(null);
            return;
        }

        try {
            await ipcRenderer.invoke('add-task-to-list', {
                listId,
                title,
                parentId: parentTaskId || parentId || null,
                priority: selectedPriority,
                initialSubtaskTitle
            });

            if (isSelection) {
                // Delete selected text
                if (savedSelection && savedSelection.range) {
                    savedSelection.range.deleteContents();
                    setSavedSelection(null);
                } else {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        range.deleteContents();
                        sel.collapseToStart();
                    }
                }
            } else {
                // Clear the entire input
                inputRef.current.innerHTML = '';
            }

            setShowListPopup(false);
            setHoveredListId(null);
            setSelectedPriority(2); // Reset to medium
            inputRef.current.focus();
        } catch (err) {
            console.error('Failed to add task:', err);
        }
    };

    // Convert ". " to "• " for bullet points AND auto-detect text direction per line
    const handleInput = () => {
        if (!inputRef.current) return;

        const selection = window.getSelection();
        const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
        const digitMap: { [key: string]: string } = { '0': '٠', '1': '١', '2': '٢', '3': '٣', '4': '٤', '5': '٥', '6': '٦', '7': '٧', '8': '٨', '9': '٩' };

        // Ensure all content is wrapped in divs (fix first line issue)
        // Ensure all content is wrapped in divs (fix first line issue)
        const children = Array.from(inputRef.current.childNodes);
        children.forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE && child.textContent && child.textContent.trim()) {
                // Wrap text nodes in div
                const oldText = child.textContent;
                const div = document.createElement('div');
                div.style.backgroundColor = 'transparent';
                div.textContent = oldText;

                // Track cursor before replacement
                const shouldRestoreCursor = selection && selection.anchorNode === child;
                const cursorOffset = selection && shouldRestoreCursor ? selection.anchorOffset : 0;

                inputRef.current!.replaceChild(div, child);

                // Restore cursor inside the new div (at the end of its text node)
                if (shouldRestoreCursor && selection) {
                    const textNode = div.firstChild;
                    if (textNode) {
                        const newRange = document.createRange();
                        newRange.setStart(textNode, Math.min(cursorOffset, textNode.textContent?.length || 0));
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                    }
                }
            }
        });

        // Process each line (div)
        const updatedChildren = Array.from(inputRef.current.childNodes);
        updatedChildren.forEach((child) => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const el = child as HTMLElement;

                // Helper to safely replace text in text nodes without destroying HTML structure
                const safeReplaceDigits = (element: HTMLElement, map: { [key: string]: string }, regex: RegExp) => {
                    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
                    const nodes: Text[] = [];
                    let node;
                    while (node = walker.nextNode()) nodes.push(node as Text);

                    nodes.forEach(textNode => {
                        const original = textNode.nodeValue;
                        if (original && regex.test(original)) {
                            const converted = original.replace(regex, m => map[m]);
                            if (converted !== original) {
                                // Preserve cursor if it's in this node
                                const offset = selection?.focusOffset || 0;
                                const isFocusedNode = selection?.focusNode === textNode;

                                textNode.nodeValue = converted;

                                if (selection && isFocusedNode) {
                                    try {
                                        const range = document.createRange();
                                        range.setStart(textNode, Math.min(offset, converted.length));
                                        range.collapse(true);
                                        selection.removeAllRanges();
                                        selection.addRange(range);
                                    } catch (e) { }
                                }
                            }
                        }
                    });
                };

                let text = el.textContent || '';

                // 1. DIRECTION DETECTION
                const arabicLetterRegex = /[\u0600-\u06FF]/;
                const latinLetterRegex = /[a-zA-Z]/;

                // Defaults to System Layout unless strong character found
                // If system thinks it's Arabic, we start true. If English, start false.
                let isArabic = isArabicLayoutRef.current;

                for (let i = 0; i < text.length; i++) {
                    const charCode = text.charCodeAt(i);
                    // Skip ASCII digits (0-9)
                    if (charCode >= 48 && charCode <= 57) continue;
                    // Skip Arabic-Indic digits (٠-٩)
                    if (charCode >= 0x0660 && charCode <= 0x0669) continue;
                    // Skip Extended Arabic-Indic digits
                    if (charCode >= 0x06F0 && charCode <= 0x06F9) continue;

                    if (arabicLetterRegex.test(text[i])) { isArabic = true; break; }
                    if (latinLetterRegex.test(text[i])) { isArabic = false; break; }
                }

                if (isArabic) {
                    el.style.direction = 'rtl';
                    el.style.textAlign = 'right';

                    // 2. DIGIT CONVERSION (English to Hindi)
                    safeReplaceDigits(el, digitMap, /[0-9]/g);
                } else {
                    el.style.direction = 'ltr';
                    el.style.textAlign = 'left';

                    // 2. DIGIT CONVERSION (Hindi to English)
                    const revDigitMap: { [key: string]: string } = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
                    safeReplaceDigits(el, revDigitMap, /[٠-٩]/g);
                }

                // Update container direction based on the ACTIVE (focused) line
                // This ensures the caret position follows the current line's language
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && inputRef.current?.contains(sel.anchorNode)) {
                    const activeNode = sel.anchorNode;
                    let activeLine: HTMLElement | null = null;
                    let n: Node | null = activeNode;
                    while (n && n !== inputRef.current) {
                        if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'DIV') {
                            activeLine = n as HTMLElement;
                            break;
                        }
                        n = n.parentNode;
                    }
                    if (activeLine && activeLine === el) {
                        setContainerDir(isArabic ? 'rtl' : 'ltr');
                    }
                }

                // 3. AUTO-BOLDING REMOVED
                // We now handle list styling explicitly in the Space handler with spans.
                // Removing this block prevents:
                // a) Overriding the opacity/font-weight of our custom spans
                // b) Making the rest of the text bold unnecessarily through inheritance
            }
        });

        // 4. BULLET POINT & LINK CONVERSION
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const textNode = range.startContainer;
            if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
                const text = textNode.textContent;
                const cursorPos = range.startOffset;

                // Links: Auto-detect URL patterns on Input (rudimentary)
                // For proper link behavior, we usually rely on space/enter.
                // Here, we just ensure existing links are clickable (handled by onClick).
                // Bullet conversion moved to Space Handler in handleKeyDown for consistency and styling.
            }
        }
    };



    // Helper: Inspect the active cursor line and update containerDir to match its language
    const checkAndUpdateContainerDir = () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !inputRef.current) return;
        const anchorNode = sel.anchorNode;
        if (!inputRef.current.contains(anchorNode)) return;

        // Walk up to find the line <div>
        let n: Node | null = anchorNode;
        let activeLine: HTMLElement | null = null;
        while (n && n !== inputRef.current) {
            if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'DIV') {
                activeLine = n as HTMLElement;
                break;
            }
            n = n.parentNode;
        }

        const text = activeLine ? (activeLine.textContent || '') : (inputRef.current.innerText || '');
        const arabicLetterRegex = /[\u0600-\u06FF]/;
        const latinLetterRegex = /[a-zA-Z]/;
        let isArabic = isArabicLayoutRef.current;
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            if (c >= 48 && c <= 57) continue;
            if (c >= 0x0660 && c <= 0x0669) continue;
            if (c >= 0x06F0 && c <= 0x06F9) continue;
            if (arabicLetterRegex.test(text[i])) { isArabic = true; break; }
            if (latinLetterRegex.test(text[i])) { isArabic = false; break; }
        }
        setContainerDir(isArabic ? 'rtl' : 'ltr');
    };

    const themeClass = 'bg-[#FFF2AA] text-gray-800';

    const startCreatingList = (e: React.SyntheticEvent) => {
        e.stopPropagation();
        setIsCreatingList(true);
        setNewListName('');
    };

    const submitCreateList = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newListName.trim() || !ipcRenderer) {
            setIsCreatingList(false);
            return;
        }
        await ipcRenderer.invoke('create-list', newListName.trim());
        const fetched = await ipcRenderer.invoke('get-lists');
        setLists(fetched);
        setIsCreatingList(false);
        setNewListName('');
    };

    const startCreatingGroup = (e: React.SyntheticEvent) => {
        e.stopPropagation();
        if (!hoveredListId) return;
        setIsCreatingFolder(true);
        setNewFolderName('');
    };

    const submitCreateGroup = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newFolderName.trim() || !ipcRenderer || !hoveredListId) {
            setIsCreatingFolder(false);
            return;
        }
        await ipcRenderer.invoke('create-folder', { listId: hoveredListId, title: newFolderName.trim() });
        const fetched = await ipcRenderer.invoke('get-folders-for-list', hoveredListId);
        setFolders(fetched);
        setIsCreatingFolder(false);
        setNewFolderName('');
    };

    const deleteGroup = async (folderId: string) => {
        if (!ipcRenderer) return;
        await ipcRenderer.invoke('delete-folder', folderId);
        if (hoveredListId) {
            const fetched = await ipcRenderer.invoke('get-folders-for-list', hoveredListId);
            setFolders(fetched || []);
        }
        setFolderContextMenu(null);
    };

    const renameGroup = async (folderId: string, currentTitle: string) => {
        if (!ipcRenderer) return;
        const newTitle = window.prompt('اسم المجموعة الجديد:', currentTitle);
        if (newTitle && newTitle.trim() && newTitle.trim() !== currentTitle) {
            await ipcRenderer.invoke('update-folder', { folderId, title: newTitle.trim() });
            if (hoveredListId) {
                const fetched = await ipcRenderer.invoke('get-folders-for-list', hoveredListId);
                setFolders(fetched || []);
            }
        }
        setFolderContextMenu(null);
    };



    // --- Custom Throttled Resize Logic ---
    const startResize = (e: React.MouseEvent, dir: string) => {
        e.preventDefault();
        e.stopPropagation();

        let rafId: number | null = null;
        let latestCoords = { x: e.screenX, y: e.screenY };
        let isProcessingIPC = false;

        const startState = {
            x: Math.round(e.screenX),
            y: Math.round(e.screenY),
            width: Math.round(window.outerWidth),
            height: Math.round(window.outerHeight),
            winX: Math.round(window.screenX),
            winY: Math.round(window.screenY),
            rightAnchor: Math.round(window.screenX + window.outerWidth),
            bottomAnchor: Math.round(window.screenY + window.outerHeight),
            dir
        };

        const handleMouseMove = (ev: MouseEvent) => {
            latestCoords = { x: ev.screenX, y: ev.screenY };
            if (rafId) return;
            rafId = requestAnimationFrame(async () => {
                if (isProcessingIPC) { rafId = null; return; }
                const dx = Math.round(latestCoords.x) - startState.x;
                const dy = Math.round(latestCoords.y) - startState.y;
                let newBounds = { x: startState.winX, y: startState.winY, width: startState.width, height: startState.height };
                const { dir, rightAnchor, bottomAnchor } = startState;
                const MIN_WIDTH = 300, MIN_HEIGHT = 200;
                if (dir.includes('e')) newBounds.width = Math.max(MIN_WIDTH, startState.width + dx);
                if (dir.includes('w')) { newBounds.width = Math.max(MIN_WIDTH, startState.width - dx); newBounds.x = rightAnchor - newBounds.width; }
                if (dir.includes('s')) newBounds.height = Math.max(MIN_HEIGHT, startState.height + dy);
                if (dir.includes('n')) { newBounds.height = Math.max(MIN_HEIGHT, startState.height - dy); newBounds.y = bottomAnchor - newBounds.height; }
                newBounds.x = Math.round(newBounds.x); newBounds.y = Math.round(newBounds.y);
                newBounds.width = Math.round(newBounds.width); newBounds.height = Math.round(newBounds.height);
                if (ipcRenderer) { isProcessingIPC = true; try { await ipcRenderer.invoke('resize-window', newBounds); } catch (err) { } finally { isProcessingIPC = false; } }
                rafId = null;
            });
        };
        const handleMouseUp = () => { if (rafId) cancelAnimationFrame(rafId); document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const ResizeHandle = ({ dir, cursor, style }: { dir: string, cursor: string, style: React.CSSProperties }) => (
        <div className="absolute z-50" style={{ ...style, cursor, WebkitAppRegion: 'no-drag' }} onMouseDown={(e) => startResize(e, dir)} />
    );

    // Animation styles
    const popupAnimation = `
        @keyframes slideInLeft {
            from { opacity: 0; transform: translateX(-20px); filter: blur(4px); }
            to { opacity: 1; transform: translateX(0); filter: blur(0); }
        }
        @keyframes slideInLeftSlow {
            from { opacity: 0; transform: translateX(-15px); filter: blur(3px); }
            to { opacity: 1; transform: translateX(0); filter: blur(0); }
        }
        @keyframes fadeInBlur {
            from { opacity: 0; filter: blur(8px); transform: translateY(5px); }
            to { opacity: 1; filter: blur(0); transform: translateY(0); }
        }
        div[contenteditable=true]:empty:before {
            content: attr(placeholder);
            color: inherit;
            opacity: 0.3;
            pointer-events: none;
            display: block;
            width: 100%;
            text-align: center;
            position: absolute;
            top: 0;
            left: 0;
            font-size: 1rem;
            font-weight: 400;
        }
    `;

    return (
        <React.Fragment>
            <style>{popupAnimation}</style>
            <div
                className={`h-screen w-full relative transition-opacity duration-200 ease-out ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onTransitionEnd={handleTransitionEnd}
            >
                <ResizeHandle dir="s" cursor="ns-resize" style={{ bottom: 0, left: 10, right: 10, height: 12 }} />
                <ResizeHandle dir="e" cursor="ew-resize" style={{ top: 10, bottom: 10, right: 0, width: 12 }} />
                <ResizeHandle dir="w" cursor="ew-resize" style={{ top: 10, bottom: 10, left: 0, width: 12 }} />
                <ResizeHandle dir="se" cursor="nwse-resize" style={{ bottom: 0, right: 0, width: 40, height: 40 }} />
                <ResizeHandle dir="sw" cursor="nesw-resize" style={{ bottom: 0, left: 0, width: 40, height: 40 }} />

                <div className={`absolute inset-0 flex flex-col ${themeClass} overflow-hidden rounded-3xl border border-yellow-600/10`} onClick={() => {
                    inputRef.current?.focus();
                    if (showListPopup) setShowListPopup(false);
                    setHoveredListId(null);
                }}>
                    {/* Header */}
                    <div className="h-9 w-full flex items-center justify-between px-4 bg-yellow-200/40 border-b border-yellow-300/30 cursor-move z-40" style={{ WebkitAppRegion: 'drag' } as any}>
                        <div className="flex gap-2 group">
                            <div className="w-3 h-3 rounded-full bg-red-400/50 hover:bg-red-500 transition-colors cursor-pointer" title="Close" style={{ WebkitAppRegion: 'no-drag' } as any} onClick={hideWindow} />
                            <div className="w-3 h-3 rounded-full bg-green-400/50 hover:bg-green-500 transition-colors cursor-pointer" title="Maximize" style={{ WebkitAppRegion: 'no-drag' } as any} onClick={() => {
                                if (ipcRenderer) {
                                    ipcRenderer.invoke('toggle-quick-note-size', !isMaximized);
                                    setIsMaximized(!isMaximized);
                                }
                            }} />
                        </div>
                        <span className="text-xs font-bold text-yellow-800/40 select-none">Quick Note</span>
                        <div className="w-6"></div>
                    </div>

                    <div className="absolute inset-4 top-12 bottom-4 flex flex-col z-0">
                        <div ref={inputRef} contentEditable={true}
                            onInput={handleInput}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            onCopy={handleCopy}
                            onCut={handleCut}
                            onClick={handleContentClick}
                            className="w-full h-full bg-transparent text-xl font-medium focus:outline-none resize-none leading-relaxed overflow-auto whitespace-pre-wrap outline-none pr-4 pl-4 custom-scrollbar"
                            style={{ fontFamily: 'Amiri', caretColor: '#333', direction: containerDir, textAlign: containerDir === 'rtl' ? 'right' : 'left' }}
                            dir={containerDir}
                            placeholder="اكتب ملاحظة" />
                    </div>

                    <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-yellow-600/20 pointer-events-none z-50" />

                    {/* List Popup */}
                    {showListPopup && (
                        <div className="absolute left-2 top-12 bottom-4 w-48 bg-white/90 backdrop-blur-md rounded-xl shadow-lg border border-gray-200/50 z-[60] overflow-hidden flex flex-col"
                            style={{ WebkitAppRegion: 'no-drag', animation: 'slideInLeft 0.25s ease-out forwards' } as any}
                            onClick={e => e.stopPropagation()}>
                            {/* Priority Selector */}
                            <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100">
                                <span className="text-xs font-bold text-gray-500">الأولوية</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setSelectedPriority(1)}
                                        className={`w-4 h-4 rounded-full transition-all duration-200 ${selectedPriority === 1 ? 'bg-red-500 ring-2 ring-red-200 scale-110' : 'bg-red-300 hover:bg-red-400 opacity-60 hover:opacity-100'}`}
                                        title="عالية"
                                    />
                                    <button
                                        onClick={() => setSelectedPriority(2)}
                                        className={`w-4 h-4 rounded-full transition-all duration-200 ${selectedPriority === 2 ? 'bg-indigo-500 ring-2 ring-indigo-200 scale-110' : 'bg-indigo-300 hover:bg-indigo-400 opacity-60 hover:opacity-100'}`}
                                        title="متوسطة"
                                    />
                                    <button
                                        onClick={() => setSelectedPriority(3)}
                                        className={`w-4 h-4 rounded-full transition-all duration-200 ${selectedPriority === 3 ? 'bg-gray-500 ring-2 ring-gray-300 scale-110' : 'bg-gray-300 hover:bg-gray-400 opacity-60 hover:opacity-100'}`}
                                        title="منخفضة"
                                    />
                                </div>
                            </div>

                            <div className="flex-1 overflow-auto">
                                {lists.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-gray-400 text-center">لا توجد قوائم</div>
                                ) : (
                                    lists.map((list, index) => (
                                        <div key={list.id}
                                            className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center justify-between ${index === selectedIndex ? 'bg-indigo-500 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                                            onClick={() => addTaskToList(list.id)}
                                            onMouseEnter={() => { setSelectedIndex(index); setHoveredListId(list.id); }}>
                                            <span>{list.icon && <span className="ml-2">{list.icon}</span>}{list.title}</span>
                                            {(list as any).taskCount > 0 && <span className={`text-xs ${index === selectedIndex ? 'text-white/50' : 'text-gray-400/40'}`} style={{ fontFamily: 'Acme, sans-serif' }}>{(list as any).taskCount}</span>}
                                        </div>
                                    ))
                                )}
                                <div className="sticky bottom-0 bg-white/50 backdrop-blur border-t border-gray-100 p-2">
                                    {isCreatingList ? (
                                        <form onSubmit={submitCreateList} className="flex gap-2">
                                            <input
                                                autoFocus
                                                type="text"
                                                className="w-full text-xs p-1 border rounded bg-white"
                                                placeholder="اسم القائمة..."
                                                value={newListName}
                                                onChange={e => setNewListName(e.target.value)}
                                                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setIsCreatingList(false); }}
                                                onBlur={() => setIsCreatingList(false)}
                                            />
                                        </form>
                                    ) : (
                                        <div className="text-center text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 cursor-pointer transition-colors opacity-30 hover:opacity-80 flex justify-center"
                                            onClick={startCreatingList} title="إنشاء قائمة جديدة">
                                            <Plus size={16} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Folder Sub-Popup */}
                    {showFolderPopup && sortedFolders.length > 0 && (
                        <div className="absolute left-52 top-12 bottom-4 w-52 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-gray-200/50 z-[70] overflow-hidden flex flex-col"
                            style={{ WebkitAppRegion: 'no-drag', animation: 'slideInLeftSlow 0.35s ease-out forwards' } as any}
                            onClick={e => e.stopPropagation()}
                            onMouseLeave={() => {
                                // Don't close parent tasks when mouse leaves folder popup
                                // Only close folder popup itself if needed
                            }}>
                            <div className="px-3 py-2 text-xs font-bold text-gray-500 border-b border-gray-100">📁 المجموعات</div>
                            <div className="flex-1 overflow-auto custom-scrollbar">
                                {/* Root option removed as requested */}
                                {sortedFolders.map((folder, index) => {
                                    const isExpanded = expandedFolderId === folder.id;
                                    const isSelected = selectedFolderIndex === index;
                                    // Show sub-tasks only if: this folder is the expanded one AND expansion data exists
                                    const hasParentTasks = isExpanded && parentTasks.length > 0;

                                    return (
                                        <div key={folder.id} className="flex flex-col">
                                            {/* Folder Item */}
                                            <div
                                                className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center justify-between ${isSelected && !isExpanded ? 'bg-indigo-500 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setFolderContextMenu({ x: e.clientX, y: e.clientY, folderId: folder.id });
                                                }}
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    
                                                    // Shift+Click creates a direct parent task with an empty subtask
                                                    if (e.shiftKey) {
                                                        addTaskToList(hoveredListId!, folder.id, null, "");
                                                        return;
                                                    }

                                                    // Double click detection
                                                    const now = Date.now();
                                                    if (now - lastClickRef.current.time < 300 && lastClickRef.current.folderId === folder.id) {
                                                        addTaskToList(hoveredListId!, folder.id);
                                                        return;
                                                    }
                                                    lastClickRef.current = { time: now, folderId: folder.id };

                                                    // Toggle expansion or Add
                                                    if (expandedFolderId === folder.id) {
                                                        // Second click on expanded folder: Add to folder
                                                        addTaskToList(hoveredListId!, folder.id);
                                                    } else {
                                                        // Before expanding, check if it has sub-tasks (parent tasks)
                                                        if (ipcRenderer) {
                                                            const fetched = await ipcRenderer.invoke('get-parent-tasks-for-folder', { 
                                                                listId: hoveredListId, 
                                                                folderId: folder.id 
                                                            });
                                                            if (fetched && fetched.length > 0) {
                                                                setExpandedFolderId(folder.id);
                                                            } else {
                                                                // No sub-tasks, add directly
                                                                addTaskToList(hoveredListId!, folder.id);
                                                            }
                                                        }
                                                    }
                                                }}
                                                onMouseEnter={() => { 
                                                    setSelectedFolderIndex(index); 
                                                    setHoveredFolderId(folder.id); 
                                                    setSelectedParentIndex(-1); 
                                                }}>
                                                <span>📁 {folder.title}</span>
                                                {(folder as any).taskCount > 0 && (
                                                    <span className={`text-xs ${isSelected ? 'text-white/50' : 'text-gray-400/40'}`} style={{ fontFamily: 'Acme, sans-serif' }}>{(folder as any).taskCount}</span>
                                                )}
                                            </div>

                                            {/* Inline Parent Tasks (Manual expand on click) */}
                                            {hasParentTasks && (
                                                <div className="bg-gray-50/80 border-y border-gray-100/50"
                                                    style={{ animation: 'fadeInBlur 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards' }}>
                                                    {parentTasks.map((task, pIndex) => (
                                                        <div key={task.id}
                                                            className={`pl-6 pr-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-2 ${selectedParentIndex === pIndex ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                                                            onClick={(e) => { e.stopPropagation(); addTaskToList(hoveredListId!, folder.id, task.id); }}
                                                            onMouseEnter={(e) => { e.stopPropagation(); setSelectedParentIndex(pIndex); }}>
                                                            <div className="w-1 h-1 rounded-full bg-current opacity-50" />
                                                            <span className="truncate">{task.title}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                <div className="sticky bottom-0 bg-white/50 backdrop-blur border-t border-gray-100 p-2 mt-auto">
                                    {isCreatingFolder ? (
                                        <form onSubmit={submitCreateGroup} className="flex gap-2">
                                            <input
                                                autoFocus
                                                type="text"
                                                className="w-full text-xs p-1 border rounded bg-white"
                                                placeholder="اسم المجموعة..."
                                                value={newFolderName}
                                                onChange={e => setNewFolderName(e.target.value)}
                                                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setIsCreatingFolder(false); }}
                                                onBlur={() => setIsCreatingFolder(false)}
                                            />
                                        </form>
                                    ) : (
                                        <div className="text-center text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 cursor-pointer transition-colors opacity-30 hover:opacity-80 flex justify-center"
                                            onClick={startCreatingGroup} title="إنشاء مجموعة جديدة">
                                            <Plus size={16} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}


                </div>

                {/* Folder Context Menu */}
                {folderContextMenu && (
                    <div 
                        className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[100] min-w-[140px]"
                        style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
                        onMouseLeave={() => setFolderContextMenu(null)}
                    >
                        <button 
                            className="w-full text-right px-3 py-1.5 text-[11px] text-gray-700 hover:bg-gray-50 flex items-center justify-between gap-3 transition-colors border-b border-gray-50"
                            onClick={() => {
                                const folder = folders.find(f => f.id === folderContextMenu.folderId);
                                if (folder) renameGroup(folderContextMenu.folderId, folder.title);
                            }}
                        >
                            <span>تعديل الاسم</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        </button>
                        <button 
                            className="w-full text-right px-3 py-1.5 text-[11px] text-red-600 hover:bg-red-50 flex items-center justify-between gap-3 transition-colors"
                            onClick={() => deleteGroup(folderContextMenu.folderId)}
                        >
                            <span>حذف المجموعة</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        </button>
                    </div>
                )}
            </div>
        </React.Fragment>
    );
};
