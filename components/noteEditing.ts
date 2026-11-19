const blocks = 'div, p, li, ol, ul, blockquote';
const numberPrefix = /^([\t \u00a0]*)([0-9\u0660-\u0669\u06f0-\u06f9]+)[\t \u00a0]*([.\-)])(?=[\t \u00a0]|$)/;

function lineText(node: Node): string {
    if (node instanceof Text) return node.data;
    if (node instanceof HTMLBRElement) return '\n';
    if (node instanceof HTMLImageElement) return '\ufffc';
    const text = Array.from(node.childNodes, lineText).join('');
    return node instanceof Element && node.matches(blocks) ? `\n${text}\n` : text;
}

function lineContext(editor: HTMLElement, node: Node, offset: number) {
    const element = node instanceof Element ? node : node.parentElement;
    const block = element?.closest(blocks);
    const line = block && editor.contains(block) ? block : editor;
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEnd(node, offset);
    const before = lineText(range.cloneContents()).split('\n').at(-1) || '';
    range.selectNodeContents(line);
    range.setStart(node, offset);
    const after = lineText(range.cloneContents()).split('\n')[0];
    return { before, after, line };
}

function textOffset(editor: HTMLElement, node: Node, offset: number) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(node, offset);
    return range.toString().length;
}

function textPosition(editor: HTMLElement, offset: number, atEnd: boolean): [Node, number] {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
        if (offset < node.length || (atEnd && offset === node.length)) return [node, offset];
        offset -= node.length;
        node = walker.nextNode() as Text | null;
    }
    return [editor, editor.childNodes.length];
}

function clonePosition(editor: HTMLElement, clone: HTMLElement, node: Node): Node {
    if (node === editor) return clone;
    const parent = node.parentNode!;
    const index = Array.prototype.indexOf.call(parent.childNodes, node);
    return clonePosition(editor, clone, parent).childNodes[index];
}

type TextSelection = { start: number; length: number; backward: boolean };
type SelectionEdit = { before: string; after: string; original: TextSelection; result: TextSelection };
const selectionEdits = new WeakMap<HTMLElement, SelectionEdit[]>();

function restoreSelection(editor: HTMLElement, selection: Selection, { start, length, backward }: TextSelection) {
    if (!length) {
        selection.collapse(...textPosition(editor, start, true));
        return;
    }
    const first = textPosition(editor, start, false);
    const last = textPosition(editor, start + length, true);
    selection.setBaseAndExtent(...(backward ? last : first), ...(backward ? first : last));
}

function trackSelectionEdit(editor: HTMLElement, edit: SelectionEdit) {
    let edits = selectionEdits.get(editor);
    if (!edits) {
        edits = [];
        selectionEdits.set(editor, edits);
        let previous = edit.after;
        editor.addEventListener('input', event => {
            const { inputType } = event as InputEvent;
            const current = editor.innerHTML;
            const undo = inputType === 'historyUndo';
            if (undo || inputType === 'historyRedo') {
                const edit = edits.find(entry => undo
                    ? entry.after === previous && entry.before === current
                    : entry.before === previous && entry.after === current);
                const selection = window.getSelection();
                if (edit && selection) restoreSelection(editor, selection, undo ? edit.original : edit.result);
            }
            previous = current;
        });
    }
    edits.unshift(edit);
    if (edits.length > 20) edits.pop();
}

function separateSelection(editor: HTMLElement, selection: Selection, range: Range, newLine: boolean) {
    const selected = range.toString();
    if (!selected) return;
    const { before, line: firstLine } = lineContext(editor, range.startContainer, range.startOffset);
    const { after, line: lastLine } = lineContext(editor, range.endContainer, range.endOffset);
    const needsLeft = newLine ? !!before.trim() : !!before && !/\s$/.test(before) && !/^\s/.test(selected);
    const needsRight = newLine ? !!after.trim() : !!after && !/^\s/.test(after) && !/\s$/.test(selected);
    if (!needsLeft && !needsRight) return;

    const beforeHtml = editor.innerHTML;
    const original = {
        start: textOffset(editor, range.startContainer, range.startOffset),
        length: selected.length,
        backward: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset
    };
    const separator = () => newLine ? document.createElement('br') : document.createTextNode(' ');
    let fragment: HTMLElement;
    if (firstLine === lastLine) {
        fragment = document.createElement('div');
        fragment.append(range.cloneContents());
        if (needsLeft) fragment.prepend(separator());
        if (needsRight) fragment.append(separator());
    } else {
        // Inserting a partial block selection makes Chromium add paragraph breaks of its own.
        // Edit both boundaries in a detached copy and submit the result as one native edit.
        fragment = editor.cloneNode(true) as HTMLElement;
        const copy = document.createRange();
        copy.setStart(clonePosition(editor, fragment, range.startContainer), range.startOffset);
        copy.setEnd(clonePosition(editor, fragment, range.endContainer), range.endOffset);
        if (needsRight) {
            const end = copy.cloneRange();
            end.collapse(false);
            end.insertNode(separator());
        }
        if (needsLeft) {
            copy.collapse(true);
            copy.insertNode(separator());
        }
        selection.selectAllChildren(editor);
    }
    // A single native edit keeps the original rich text and participates in the editor's history.
    if (!document.execCommand('insertHTML', false, fragment.innerHTML)) {
        restoreSelection(editor, selection, original);
        return;
    }
    const result = { ...original, start: original.start + Number(!newLine && needsLeft) };
    restoreSelection(editor, selection, result);
    trackSelectionEdit(editor, { before: beforeHtml, after: editor.innerHTML, original, result });
}

function nextNumber(digits: string) {
    const alphabet = /^\d/.test(digits) ? 0x30 : /^[\u0660-\u0669]/.test(digits) ? 0x660 : 0x6f0;
    const decimal = digits.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) & 0xf));
    return String(BigInt(decimal) + 1n).replace(/\d/g, digit => String.fromCharCode(alphabet + Number(digit)));
}

export function updateNumberedNoteLine(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0);
    const { before, after } = lineContext(editor, range.startContainer, range.startOffset);
    const text = before + after;
    const match = text.match(numberPrefix);
    const letter = text.slice(match?.[0].length || 0).match(/\p{Letter}/u)?.[0];
    if (!match || !letter) return;
    const arabic = /\p{Script=Arabic}/u.test(letter);
    if (arabic ? !/[0-9]/.test(match[2]) : !/[\u0660-\u0669\u06f0-\u06f9]/.test(match[2])) return;

    const lineStart = textOffset(editor, range.startContainer, range.startOffset) - before.length;
    const [node, offset] = textPosition(editor, lineStart + match[1].length, false);
    if (!(node instanceof Text) || !node.parentElement?.matches('span[style*="opacity"]')) return;
    const original = {
        start: textOffset(editor, range.startContainer, range.startOffset),
        length: range.toString().length,
        backward: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset
    };
    const digits = arabic
        ? match[2].replace(/[0-9]/g, digit => String.fromCharCode(0x660 + Number(digit)))
        : match[2].replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) & 0xf));
    node.replaceData(offset, match[2].length, digits);
    restoreSelection(editor, selection, original);
}

export function handleNoteEditing(editor: HTMLElement, event: KeyboardEvent): boolean {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
        (event.key !== ' ' && (event.key !== 'Enter' || event.shiftKey))) return false;

    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;
    if (!selection.isCollapsed) {
        event.preventDefault();
        separateSelection(editor, selection, range, event.key === 'Enter');
        return true;
    }

    const { before, after, line } = lineContext(editor, range.startContainer, range.startOffset);
    if (after.trim() || line.closest('li')) return false;
    const number = before.match(numberPrefix);
    const bullet = before.match(/^([\t \u00a0]*)•/);
    if (event.key === ' ' && number && before === number[0]) {
        event.preventDefault();
        const offset = textOffset(editor, range.startContainer, range.startOffset);
        range.setStart(...textPosition(editor, offset - before.length, false));
        const marker = document.createElement('span');
        marker.style.fontWeight = 'bold';
        marker.style.opacity = '0.5';
        marker.style.fontSize = '0.85em';
        marker.textContent = before;
        document.execCommand('insertHTML', false, `${marker.outerHTML}&nbsp;`);
        return true;
    }
    if (event.key === ' ' && /^[\t \u00a0]*[.-]$/.test(before)) {
        event.preventDefault();
        const offset = textOffset(editor, range.startContainer, range.startOffset);
        range.setStart(...textPosition(editor, offset - 1, false));
        document.execCommand('insertText', false, '• ');
        return true;
    }
    if (event.key !== 'Enter' || (!number && !bullet)) return false;
    event.preventDefault();

    const prefix = (number || bullet)![0];
    if (!before.slice(prefix.length).trim()) {
        const offset = textOffset(editor, range.startContainer, range.startOffset);
        range.setStart(...textPosition(editor, offset - before.length, false));
        document.execCommand('delete');
        return true;
    }

    const next = number ? nextNumber(number[2]) + number[3] : '•';
    const marker = document.createElement('span');
    marker.style.fontWeight = 'bold';
    marker.style.opacity = '0.5';
    marker.style.fontSize = '0.85em';
    marker.textContent = (number || bullet)![1] + next;
    document.execCommand('insertHTML', false, `<br>${marker.outerHTML}&nbsp;`);
    return true;
}

export function noteLineDirection(editor: HTMLElement, fallback: 'rtl' | 'ltr') {
    const selection = window.getSelection();
    if (!selection?.focusNode || !editor.contains(selection.focusNode)) return fallback;
    const { before, after } = lineContext(editor, selection.focusNode, selection.focusOffset);
    const letter = (before + after).match(/\p{Letter}/u)?.[0];
    return letter ? (/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(letter) ? 'rtl' : 'ltr') : fallback;
}

export function finishQuickNoteLine(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.focusNode || !editor.contains(selection.focusNode)) return;
    const { before, after } = lineContext(editor, selection.focusNode, selection.focusOffset);
    if ((before + after).includes('\ufffc')) return;
    const offset = textOffset(editor, selection.focusNode, selection.focusOffset);
    const end = offset + after.length;
    for (const match of (before + after).matchAll(/(?:https?:\/\/|www\.)[^\s\ufffc]+/g)) {
        const start = offset - before.length + match.index;
        const first = textPosition(editor, start, false);
        if (first[0].parentElement?.closest('a')) continue;
        selection.setBaseAndExtent(...first, ...textPosition(editor, start + match[0].length, true));
        document.execCommand('createLink', false, match[0].startsWith('www.') ? `http://${match[0]}` : match[0]);
    }
    if (after || before) selection.collapse(...textPosition(editor, end, true));
}
