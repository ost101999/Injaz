import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { endNoteHighlight, handleNoteEditing, handleNoteFormatShortcut, removeNumberedNoteMarker, repairSavedNumbering, updateNumberedNoteLine } from './noteEditing';
import { useNoteFontSize } from './useNoteFontSize';
import './TaskNotes.css';

const highlight = '#fef08a';
const allowedNoteElements = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'OL', 'UL', 'LI', 'SPAN', 'MARK']);

function safeNotes(html: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const clean = document.createElement('div');
    function copy(node: Node, target: HTMLElement) {
        if (node.nodeType === Node.TEXT_NODE) {
            // Chromium can skip bare newlines when moving the caret vertically.
            (node.textContent || '').split('\n').forEach((line, index) => {
                if (index > 0) target.append(document.createElement('br'));
                if (line) target.append(document.createTextNode(line));
            });
            return;
        }
        if (!(node instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'IFRAME'].includes(node.tagName)) return;
        const element = allowedNoteElements.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : target;
        if (element !== target) {
            if (node.style.backgroundColor) element.style.backgroundColor = node.style.backgroundColor;
            if (node.style.fontWeight) element.style.fontWeight = node.style.fontWeight;
            if (node.style.fontStyle) element.style.fontStyle = node.style.fontStyle;
            if (node.style.textDecorationLine === 'underline') element.style.textDecorationLine = 'underline';
            if (node.style.opacity === '0.5') element.style.opacity = '0.5';
            if (node.style.fontSize === '0.85em') element.style.fontSize = '0.85em';
            if (node.tagName === 'SPAN' && node.hasAttribute('data-empty-rtl-number')) element.setAttribute('data-empty-rtl-number', '');
            target.append(element);
        }
        node.childNodes.forEach(child => copy(child, element));
    }
    template.content.childNodes.forEach(node => copy(node, clean));
    return clean.innerHTML;
}

function caretRect(range: Range) {
    const rect = range.getBoundingClientRect();
    if (rect.height) return rect;
    const next = range.startContainer.childNodes[range.startOffset];
    return next instanceof HTMLBRElement ? next.getBoundingClientRect() : null;
}

function moveCaretUp(editor: HTMLElement, event: React.KeyboardEvent, preferredX: number | null) {
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return null;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.focusNode)) return null;

    const current = caretRect(selection.getRangeAt(0));
    if (!current?.height) return null;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    const bounds = editor.getBoundingClientRect();
    const top = bounds.top + editor.clientTop;
    const left = bounds.left + editor.clientLeft;
    const x = preferredX ?? current.left;
    let y = current.top + current.height / 2 - lineHeight;
    const previousScroll = editor.scrollTop;
    if (y < top && previousScroll > 0) {
        editor.scrollTop -= top - y + lineHeight / 2;
        y += previousScroll - editor.scrollTop;
    }

    // Hit-test the actual preceding row so inline formatting cannot redirect the caret.
    const target = y >= top && y < top + editor.clientHeight
        ? document.caretRangeFromPoint(Math.min(Math.max(x, left + 1), left + editor.clientWidth - 1), y)
        : null;
    const destination = target && editor.contains(target.startContainer) ? caretRect(target) : null;
    if (!target || !destination?.height || Math.abs(destination.top + destination.height / 2 - y) >= lineHeight / 2) {
        if (editor.scrollTop !== previousScroll) editor.scrollTop = previousScroll;
        return null;
    }

    event.preventDefault();
    event.stopPropagation();
    selection.collapse(target.startContainer, target.startOffset);
    return x;
}

export function TaskNotes({ title, initial, save, close }: {
    title: string;
    initial: string;
    save: (html: string, title?: string) => boolean;
    close: () => void;
}) {
    const editor = useRef<HTMLDivElement>(null);
    const caretColumn = useRef<number | null>(null);
    const panel = useRef<HTMLElement>(null);
    const titleInput = useRef<HTMLInputElement>(null);
    const titleEdited = useRef(false);
    const [failed, setFailed] = useState(false);
    const [closing, setClosing] = useState(false);
    const { size, handleSizeShortcut } = useNoteFontSize();
    useLayoutEffect(() => {
        const node = editor.current!;
        node.innerHTML = safeNotes(initial);
        if (repairSavedNumbering(node)) persist();
        node.focus();
        const selection = window.getSelection();
        selection?.selectAllChildren(node);
        selection?.collapseToEnd();
    }, []);

    useLayoutEffect(() => {
        if (!titleEdited.current && titleInput.current!.value !== title) titleInput.current!.value = title;
    }, [title]);

    function persist() {
        const node = editor.current!;
        const input = titleInput.current!;
        const nextTitle = titleEdited.current ? input.value.trim() : title;
        const saved = save(node.textContent?.trim() ? safeNotes(node.innerHTML) : '', nextTitle && nextTitle !== title ? nextTitle : undefined);
        setFailed(!saved);
        if (saved && titleEdited.current) {
            titleEdited.current = false;
            input.value = nextTitle || title;
        }
        return saved;
    }

    useLayoutEffect(() => {
        if (closing) return;
        const dismiss = () => {
            if (!persist()) return;
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) close();
            else setClosing(true);
        };
        const outside = (event: PointerEvent) => {
            if (!event.composedPath().includes(panel.current!)) dismiss();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing ||
                event.ctrlKey || event.metaKey || event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            dismiss();
        };
        window.addEventListener('pointerdown', outside, true);
        window.addEventListener('keydown', escape, true);
        return () => {
            window.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('keydown', escape, true);
        };
    });

    const closeRef = useRef(close);
    useLayoutEffect(() => { closeRef.current = close; }, [close]);
    useEffect(() => {
        if (!closing) return;
        const timer = window.setTimeout(() => closeRef.current(), 220);
        return () => window.clearTimeout(timer);
    }, [closing]);

    const format = (command: string, value?: string) => {
        document.execCommand(command, false, value);
        persist();
    };

    return (
        <aside ref={panel} className="task-notes" data-task-notes data-closing={closing || undefined} inert={closing}
            dir="rtl" aria-label="ملاحظات المهمة" onAnimationEnd={event => {
                if (closing && event.target === event.currentTarget && event.animationName === 'task-notes-exit') close();
            }}>
            <header>
                <input ref={titleInput} type="text" dir="auto" defaultValue={title} aria-label="اسم المهمة"
                    onChange={() => { titleEdited.current = true; }}
                    onBlur={() => { if (titleEdited.current) persist(); }}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            if (persist()) editor.current?.focus();
                        }
                    }} />
            </header>
            <div ref={editor} className="task-notes-editor" style={{ fontSize: size }} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="الملاحظات" dir="rtl"
                onInput={event => {
                    const input = event.nativeEvent as InputEvent;
                    if (!input.isComposing && input.inputType !== 'historyUndo' && input.inputType !== 'historyRedo') {
                        updateNumberedNoteLine(event.currentTarget);
                    }
                    persist();
                }}
                onCompositionEnd={event => {
                    updateNumberedNoteLine(event.currentTarget);
                    persist();
                }}
                onPaste={event => {
                    event.preventDefault();
                    format('insertText', event.clipboardData.getData('text/plain'));
                }}
                onPointerDown={() => { caretColumn.current = null; }}
                onBlur={() => { caretColumn.current = null; }}
                onKeyDown={event => {
                    caretColumn.current = event.key === 'ArrowUp'
                        ? moveCaretUp(event.currentTarget, event, caretColumn.current)
                        : null;
                    if (event.defaultPrevented) return;
                    if (handleSizeShortcut(event)) return;
                    if (handleNoteFormatShortcut(event.currentTarget, event.nativeEvent) ||
                        removeNumberedNoteMarker(event.currentTarget, event.nativeEvent)) {
                        event.stopPropagation();
                        return;
                    }
                    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.nativeEvent.isComposing) {
                        const command = !event.shiftKey && event.code === 'KeyB' ? 'bold'
                            : event.shiftKey && event.code === 'KeyW' ? 'hiliteColor'
                            : event.shiftKey && event.code === 'Digit7' ? 'insertOrderedList'
                            : event.shiftKey && event.code === 'Digit8' ? 'insertUnorderedList'
                            : null;
                        if (command) {
                            event.preventDefault();
                            event.stopPropagation();
                            format(command, command === 'hiliteColor' ? highlight : undefined);
                            return;
                        }
                    }
                    if (endNoteHighlight(event.currentTarget, event.nativeEvent) ||
                        handleNoteEditing(event.currentTarget, event.nativeEvent)) event.stopPropagation();
                }} />
            {failed && <footer role="alert">تعذر الحفظ. <button type="button" onClick={persist}>إعادة المحاولة</button></footer>}
        </aside>
    );
}
