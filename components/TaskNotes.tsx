import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { handleNoteEditing, updateNumberedNoteLine } from './noteEditing';
import './TaskNotes.css';

const highlight = '#fef08a';
const allowedNoteElements = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'OL', 'UL', 'LI', 'SPAN', 'MARK']);

function safeNotes(html: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const clean = document.createElement('div');
    function copy(node: Node, target: HTMLElement) {
        if (node.nodeType === Node.TEXT_NODE) {
            target.append(document.createTextNode(node.textContent || ''));
            return;
        }
        if (!(node instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'IFRAME'].includes(node.tagName)) return;
        const element = allowedNoteElements.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : target;
        if (element !== target) {
            if (node.style.backgroundColor) element.style.backgroundColor = node.style.backgroundColor;
            if (node.style.fontWeight) element.style.fontWeight = node.style.fontWeight;
            if (node.style.opacity === '0.5') element.style.opacity = '0.5';
            target.append(element);
        }
        node.childNodes.forEach(child => copy(child, element));
    }
    template.content.childNodes.forEach(node => copy(node, clean));
    return clean.innerHTML;
}

export function TaskNotes({ title, initial, save, close }: {
    title: string;
    initial: string;
    save: (html: string, title?: string) => boolean;
    close: () => void;
}) {
    const editor = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLElement>(null);
    const titleInput = useRef<HTMLInputElement>(null);
    const titleEdited = useRef(false);
    const [failed, setFailed] = useState(false);
    const [closing, setClosing] = useState(false);
    useLayoutEffect(() => {
        const node = editor.current!;
        node.innerHTML = safeNotes(initial);
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
            <div ref={editor} className="task-notes-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="الملاحظات" dir="rtl"
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
                onKeyDown={event => {
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
                    if (handleNoteEditing(event.currentTarget, event.nativeEvent)) event.stopPropagation();
                }} />
            {failed && <footer role="alert">تعذر الحفظ. <button type="button" onClick={persist}>إعادة المحاولة</button></footer>}
        </aside>
    );
}
