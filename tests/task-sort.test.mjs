import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { hasNewSubtaskInProgress } from '../utils/taskSort.mjs';

test('a group stays in order while its task gets a new subtask', () => {
    const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('    const getSortedList = useCallback(');
    const end = source.indexOf('    const sortedActiveTasks =', start);
    assert.ok(start >= 0 && end > start);
    const js = ts.transpileModule(source.slice(start, end), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const effectiveCount = tasks => tasks.reduce((count, task) => {
        if (task.isCompleted) return count;
        const children = (task.children || []).filter(child => !child.isCompleted);
        return count + (children.length ? effectiveCount(children) : (task.title.trim() ? 1 : 0));
    }, 0);
    const sort = new Function('useCallback', 'sortBy', 'sortDirection', 'inlineEditingId', 'getEffectiveTaskCount', 'hasNewSubtaskInProgress',
        `${js}\nreturn getSortedList;`)(fn => fn, 'custom', 'asc', 'draft', effectiveCount, hasNewSubtaskInProgress);
    const draft = { id: 'draft', title: '', type: 'item', createdAt: Date.now() - 120000, children: [] };
    const parent = { id: 'parent', title: 'Task', type: 'item', children: [draft] };
    const group = { id: 'group', title: 'Group', type: 'folder', children: [parent] };
    const other = { id: 'other', title: 'Other', type: 'folder', children: [{ title: 'Task', children: [] }] };
    assert.deepEqual(sort([group, other]).map(task => task.id), ['group', 'other']);
    assert.equal(hasNewSubtaskInProgress(group, 'draft'), true);
    assert.equal(hasNewSubtaskInProgress(group, null), false);
});

test('a freshly added nested subtask keeps its group in place before editing starts', () => {
    const now = 100000;
    const group = { children: [{ children: [{ id: 'draft', title: '', createdAt: now }] }] };
    assert.equal(hasNewSubtaskInProgress(group, null, now), true);
    assert.equal(hasNewSubtaskInProgress(group, null, now + 1500), false);
});
