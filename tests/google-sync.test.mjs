import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { flattenTasks, markGoogleChanges, acknowledgeGoogleWrite, mergeGoogleTasks, uploadGoogleChanges } from '../google/sync.mjs';

const task = (extra = {}) => ({ id: 'local', title: 'New task', type: 'item', children: [], isCompleted: false, parentId: 'google_main_folder', ...extra });
const folder = children => task({ id: 'google_main_folder', title: 'مهام جوجل', type: 'folder', isGoogleSynced: true, parentId: null, children });
const remote = (extra = {}) => ({ id: 'remote', listId: 'second-list', title: 'Server title', status: 'needsAction', ...extra });
const local = (extra = {}) => task({ googleTaskId: 'remote', googleListId: 'second-list', isGoogleSynced: true, ...extra });
const find = (tasks, id = 'local') => flattenTasks(tasks).find(t => t.id === id);

test('new and legacy local children inherit Google linkage and the selected list', () => {
    const next = [folder([task()])];
    const result = markGoogleChanges(next, next, 'second-list');
    assert.equal(find(result).isGoogleSynced, true);
    assert.equal(find(result).googleSyncPending, true);
    assert.equal(find(result).googleListId, 'second-list');
});

test('empty pull preserves drafts, failed uploads, and their missing parents', () => {
    const parent = local({ children: [task({ id: 'draft', title: '', parentId: 'local' })] });
    const result = mergeGoogleTasks([folder([parent])], [], 'default');
    assert.equal(find(result, 'draft').title, '');
    assert.equal(find(result).children[0].id, 'draft');
});

test('pull merges remote edits without overwriting pending local edits or losing metadata', () => {
    const changed = local({ title: 'Unsaved text', googleSyncPending: true, color: 'pink' });
    const result = mergeGoogleTasks([folder([changed])], [remote()], 'default');
    assert.equal(find(result).title, 'Unsaved text');
    assert.equal(find(result).color, 'pink');
    const clean = mergeGoogleTasks([folder([local({ color: 'pink' })])], [remote()], 'default');
    assert.equal(find(clean).title, 'Server title');
    assert.equal(find(clean).color, 'pink');
});

test('late acknowledgement does not clear a newer edit, and IDs stay stable', () => {
    const sent = local({ googleSyncPending: true, googleSyncRevision: 1 });
    const current = [folder([{ ...sent, title: 'Typed during upload', googleSyncRevision: 2 }])];
    const result = acknowledgeGoogleWrite(current, sent, 'remote');
    assert.equal(find(result).googleSyncPending, true);
    assert.equal(find(result).title, 'Typed during upload');
    assert.equal(find(mergeGoogleTasks(result, [remote()], 'default')).id, 'local');
});

test('identical task IDs in different Google lists remain separate', () => {
    const result = mergeGoogleTasks([], [remote(), remote({ listId: 'other' })], 'default');
    const children = result[0].children;
    assert.equal(children.length, 2);
    assert.notEqual(children[0].id, children[1].id);
});

test('successful empty snapshot removes clean deleted tasks but preserves unrelated local data', () => {
    const other = task({ id: 'unrelated', parentId: null });
    const result = mergeGoogleTasks([other, folder([local()])], [], 'default');
    assert.equal(find(result), undefined);
    assert.equal(find(result, 'unrelated').title, other.title);
    assert.throws(() => mergeGoogleTasks(result, null, 'default'));
});

test('upload creates parents before children using their list and returned parent ID', async () => {
    let tasks = markGoogleChanges([], [folder([task({ children: [task({ id: 'child', parentId: 'local' })] })])], 'second-list');
    const calls = [];
    await uploadGoogleChanges({ getTasks: () => tasks, apply: fn => { tasks = fn(tasks); }, tokens: {}, isCurrent: () => true,
        invoke: async (name, data) => { calls.push({ name, ...data }); return calls.length === 1 ? 'parent-remote' : 'child-remote'; }
    });
    assert.equal(calls[0].listId, 'second-list');
    assert.equal(calls[1].parentId, 'parent-remote');
    assert.equal(find(tasks).googleSyncPending, false);
    assert.equal(find(tasks, 'child').googleTaskId, 'child-remote');
});

test('failed write remains persisted and retries as update against the correct list', async () => {
    let tasks = [folder([local({ googleSyncPending: true })])];
    const options = { getTasks: () => tasks, apply: fn => { tasks = fn(tasks); }, tokens: {}, isCurrent: () => true };
    await assert.rejects(uploadGoogleChanges({ ...options, invoke: async () => { throw new Error('offline'); } }), /offline/);
    tasks = JSON.parse(JSON.stringify(tasks));
    assert.equal(find(tasks).googleSyncPending, true);
    await uploadGoogleChanges({ ...options, invoke: async (name, data) => {
        assert.equal(name, 'google-tasks:update-task');
        assert.equal(data.listId, 'second-list');
        return true;
    } });
    assert.equal(find(tasks).googleSyncPending, false);
});

test('edit during create is preserved and retried as update rather than duplicate create', async () => {
    let tasks = markGoogleChanges([], [folder([task()])], 'second-list');
    const options = { getTasks: () => tasks, apply: fn => { tasks = fn(tasks); }, tokens: {}, isCurrent: () => true };
    await uploadGoogleChanges({ ...options, invoke: async () => {
        tasks = markGoogleChanges(tasks, [folder([{ ...find(tasks), title: 'Newer text' }])], 'second-list');
        return 'created-id';
    } });
    assert.equal(find(tasks).googleSyncPending, true);
    await uploadGoogleChanges({ ...options, invoke: async (name, data) => {
        assert.equal(name, 'google-tasks:update-task');
        assert.equal(data.title, 'Newer text');
        assert.equal(data.taskId, 'created-id');
        return true;
    } });
    assert.equal(find(tasks).googleSyncPending, false);
});

// Execute the actual Electron handlers with a fake API (no account/network access).
function handlers(api) {
    const source = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const start = source.indexOf("    ipcMain.handle('google-tasks:fetch-lists'");
    const end = source.indexOf("    ipcMain.handle('select-sync-file'", start);
    const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const registered = {};
    new Function('ipcMain', 'oauth2Client', 'google', 'console', js)(
        { handle: (name, fn) => { registered[name] = fn; } }, { setCredentials() {} }, { tasks: () => api }, { error() {} });
    return registered;
}

test('Electron follows all task and task-list pages, including tasks beyond 100', async () => {
    const api = {
        tasklists: { list: async ({ pageToken }) => ({ data: pageToken ? { items: [{ id: 'second-list' }] } : { items: [{ id: 'first-list' }], nextPageToken: 'next' } }) },
        tasks: { list: async ({ pageToken }) => ({ data: pageToken ? { items: [{ id: '101' }] } : { items: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), nextPageToken: 'next' } }) }
    };
    const ipc = handlers(api);
    assert.equal((await ipc['google-tasks:fetch-lists'](null, {})).length, 2);
    const result = await ipc['google-tasks:fetch'](null, { tokens: {}, listIds: ['second-list'] });
    assert.equal(result.tasks.length, 101);
    assert.equal(result.tasks[100].listId, 'second-list');
});

test('Electron rejects failed or partial downloads instead of returning an empty snapshot', async () => {
    const ipc = handlers({ tasks: { list: async ({ pageToken }) => {
        if (pageToken) throw new Error('offline');
        return { data: { items: [{ id: 'first' }], nextPageToken: 'next' } };
    } } });
    await assert.rejects(ipc['google-tasks:fetch'](null, { tokens: {}, listIds: ['list'] }));
});
