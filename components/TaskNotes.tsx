import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { endNoteHighlight, handleBlueBullet, handleNoteEditing, handleNoteFormatShortcut, prepareNoteArrowSelection, removeNumberedNoteMarker, repairSavedNumbering, toggleNoteHighlight, updateNumberedNoteLine } from './noteEditing';
import { useNoteFontSize } from './useNoteFontSize';
import './TaskNotes.css';

const highlight = '#fef08a';
const allowedNoteElements = new Set(['DIV', 'P', 'BR', 'HR', 'B', 'STRONG', 'I', 'EM', 'U', 'OL', 'UL', 'LI', 'SPAN', 'MARK']);

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
            if (node.style.textDecorationLine.includes('underline') || node.style.textDecoration.includes('underline')) element.style.textDecorationLine = 'underline';
            if (node.style.color) element.style.color = node.style.color;
            if (node.style.fontFamily) element.style.fontFamily = node.style.fontFamily;
            if (node.style.fontSize) element.style.fontSize = node.style.fontSize;
            if (node.style.opacity === '0.5') element.style.opacity = '0.5';
            if (node.tagName === 'SPAN' && node.hasAttribute('data-empty-rtl-number')) element.setAttribute('data-empty-rtl-number', '');
            target.append(element);
        }
        node.childNodes.forEach(child => copy(child, element));
    }
    template.content.childNodes.forEach(node => copy(node, clean));
    return clean.innerHTML;
}

function loadNoteContent(element: HTMLElement, html: string) {
    element.innerHTML = safeNotes(html);
    return repairSavedNumbering(element);
}

export function MapNotePreview({ html, description, save, saveBeforeSwitch }: {
    html?: string;
    description?: string;
    save: (html: string) => boolean;
    saveBeforeSwitch: React.RefObject<(() => boolean) | null>;
}) {
    const editor = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);
    const { size, handleSizeShortcut } = useNoteFontSize();

    useLayoutEffect(() => {
        if (editor.current && loadNoteContent(editor.current, html || '')) persist();
    }, []);

    useLayoutEffect(() => {
        const node = editor.current;
        if (!node || node.contains(document.activeElement)) return;
        const safeHtml = safeNotes(html || '');
        if (safeNotes(node.innerHTML) !== safeHtml) loadNoteContent(node, safeHtml);
    }, [html]);

    function persist() {
        const node = editor.current;
        if (!node) return true;
        const saved = save(node.textContent?.trim() || node.querySelector('hr') ? safeNotes(node.innerHTML) : '');
        setFailed(!saved);
        return saved;
    }

    useLayoutEffect(() => {
        saveBeforeSwitch.current = persist;
        return () => { saveBeforeSwitch.current = null; };
    });

    return (
        <section className="mindmap-note-card" aria-label="معلومات المهمة" dir="rtl"
            style={{ fontSize: size }} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
            {description && <div className="note-content" dir="auto">{description}</div>}
            <NoteBody editor={editor} persist={persist} handleSizeShortcut={handleSizeShortcut}
                className="mindmap-note-editor note-content" />
            {failed && <div className="mindmap-note-save-error" role="alert">تعذر الحفظ. <button type="button" onClick={persist}>إعادة المحاولة</button></div>}
        </section>
    );
}

function preparePastedNotes(html: string, plainText: string) {
    const documentFragment = new DOMParser().parseFromString(html, 'text/html');
    const walker = documentFragment.createTreeWalker(documentFragment.body, NodeFilter.SHOW_TEXT);
    const indentation: Node[] = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (/^\s*[\r\n]\s*$/.test(node.textContent || '') &&
            !node.parentElement?.closest('pre') &&
            (node.previousSibling instanceof Element || node.nextSibling instanceof Element)) indentation.push(node);
    }
    indentation.forEach(node => node.remove());
    const container = document.createElement('div');
    container.innerHTML = safeNotes(documentFragment.body.innerHTML);
    // Copying a complete line often includes its terminating newline. It is a
    // clipboard boundary, not an extra empty line to insert at the caret.
    const completeSingleLine = /^[^\r\n]+\r?\n$/.test(plainText);
    if (completeSingleLine) {
        const last = container.lastElementChild;
        if (last && /^(DIV|P)$/.test(last.tagName) && !last.textContent?.trim() &&
            !last.querySelector('img, ol, ul')) last.remove();
        const trailingBreak = container.querySelector('br:last-child');
        if (trailingBreak && !trailingBreak.nextSibling &&
            (trailingBreak.parentElement === container ||
                trailingBreak.parentElement === container.lastElementChild)) trailingBreak.remove();
    }
    if (!/^[\r\n]/.test(plainText)) {
        while (container.firstChild instanceof HTMLBRElement) container.firstChild.remove();
    }
    if (completeSingleLine || !/[\r\n]$/.test(plainText)) {
        while (container.lastChild instanceof HTMLBRElement) container.lastChild.remove();
    }
    const only = container.firstElementChild;
    if (container.childNodes.length === 1 && only && /^(DIV|P)$/.test(only.tagName) &&
        !only.querySelector('div, p, br, ol, ul')) {
        const inline = document.createElement('span');
        inline.style.cssText = (only as HTMLElement).style.cssText;
        inline.append(...Array.from(only.childNodes));
        only.replaceWith(inline);
    }
    return container.innerHTML;
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
    const bounds = editor.getBoundingClientRect();
    // The app's zoom scales viewport coordinates, but scroll and client sizes use CSS pixels.
    const scale = bounds.height / editor.offsetHeight;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) * scale;
    const top = bounds.top + editor.clientTop * scale;
    const left = bounds.left + editor.clientLeft * scale;
    const x = preferredX ?? current.left;
    let y = current.top + current.height / 2 - lineHeight;
    const previousScroll = editor.scrollTop;
    if (y < top && previousScroll > 0) {
        editor.scrollTop -= (top - y + lineHeight / 2) / scale;
        y += (previousScroll - editor.scrollTop) * scale;
    }

    // Hit-test the actual preceding row so inline formatting cannot redirect the caret.
    const target = y >= top && y < top + editor.clientHeight * scale
        ? document.caretRangeFromPoint(Math.min(Math.max(x, left + 1), left + editor.clientWidth * scale - 1), y)
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

function NoteBody({ editor, persist, handleSizeShortcut, className, style }: {
    editor: React.RefObject<HTMLDivElement | null>;
    persist: () => boolean;
    handleSizeShortcut: (event: React.KeyboardEvent) => boolean;
    className: string;
    style?: React.CSSProperties;
}) {
    const caretColumn = useRef<number | null>(null);
    const format = (command: string, value?: string) => {
        document.execCommand(command, false, value);
        persist();
    };

    return (
            <div ref={editor} className={className} style={style} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="الملاحظات" dir="rtl"
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
                    const html = event.clipboardData.getData('text/html');
                    if (html) {
                        const cleaned = preparePastedNotes(html, event.clipboardData.getData('text/plain'));
                        if (cleaned) {
                            format('insertHTML', cleaned);
                            return;
                        }
                    }
                    const plainText = event.clipboardData.getData('text/plain');
                    format('insertText', /^[^\r\n]+\r?\n$/.test(plainText) ? plainText.replace(/\r?\n$/, '') : plainText);
                }}
                onPointerDown={() => { caretColumn.current = null; }}
                onBlur={() => { caretColumn.current = null; }}
                onKeyDown={event => {
                    prepareNoteArrowSelection(event.currentTarget, event.nativeEvent);
                    if (handleBlueBullet(event.currentTarget, event.nativeEvent)) return;
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
                            if (command === 'hiliteColor') {
                                toggleNoteHighlight(event.currentTarget, highlight);
                                persist();
                            } else format(command);
                            return;
                        }
                    }
                    if (endNoteHighlight(event.currentTarget, event.nativeEvent) ||
                        handleNoteEditing(event.currentTarget, event.nativeEvent)) event.stopPropagation();
                }} />
    );
}

export function TaskNotes({ title, initial, save, close, saveBeforeSwitch }: {
    title: string;
    initial: string;
    save: (html: string, title?: string) => boolean;
    close: () => void;
    saveBeforeSwitch: React.RefObject<(() => boolean) | null>;
}) {
    const editor = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLElement>(null);
    const titleInput = useRef<HTMLInputElement>(null);
    const titleEdited = useRef(false);
    const [failed, setFailed] = useState(false);
    const [closing, setClosing] = useState(false);
    const { size, handleSizeShortcut } = useNoteFontSize();
    useLayoutEffect(() => {
        const node = editor.current!;
        if (loadNoteContent(node, initial)) persist();
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
        const saved = save(node.textContent?.trim() || node.querySelector('hr') ? safeNotes(node.innerHTML) : '', nextTitle && nextTitle !== title ? nextTitle : undefined);
        setFailed(!saved);
        if (saved && titleEdited.current) {
            titleEdited.current = false;
            input.value = nextTitle || title;
        }
        return saved;
    }

    useLayoutEffect(() => {
        saveBeforeSwitch.current = persist;
        return () => { saveBeforeSwitch.current = null; };
    });

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
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('keydown', escape, true);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
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
            <NoteBody editor={editor} persist={persist} handleSizeShortcut={handleSizeShortcut}
                className="task-notes-editor note-content" style={{ fontSize: size }} />
            {failed && <footer role="alert">تعذر الحفظ. <button type="button" onClick={persist}>إعادة المحاولة</button></footer>}
        </aside>
    );
}
