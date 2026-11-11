import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { detachGoogleTasksMovedOutside, flattenTasks, markGoogleChanges, acknowledgeGoogleWrite, mergeGoogleTasks, uploadGoogleChanges, googleListFolderId } from '../google/sync.mjs';

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
    const children = result.flatMap(folder => folder.children);
    assert.equal(children.length, 2);
    assert.notEqual(children[0].id, children[1].id);
});

test('Google lists become separate named groups with tasks and subtasks in the right list', () => {
    const lists = [{ id: 'home', title: 'ToDo(Home)' }, { id: 'out', title: 'ToDo(Out)' }];
    const result = mergeGoogleTasks([], [
        remote({ id: 'home-task', listId: 'home' }),
        remote({ id: 'home-subtask', listId: 'home', parent: 'home-task' }),
        remote({ id: 'out-task', listId: 'out' })
    ], 'default', lists);
    assert.deepEqual(result.map(t => t.title), ['ToDo(Home)', 'ToDo(Out)']);
    assert.ok(result.every(t => t.isGoogleListFolder));
    assert.equal(result[0].children[0].googleTaskId, 'home-task');
    assert.equal(result[0].children[0].children[0].googleTaskId, 'home-subtask');
    assert.equal(result[1].children[0].googleTaskId, 'out-task');
    const withDraft = markGoogleChanges(result, result.map(t => t.googleListId === 'out' ? {
        ...t, children: [...t.children, task({ id: 'out-draft', parentId: t.id })]
    } : t), 'home');
    assert.equal(find(withDraft, 'out-draft').googleListId, 'out');
});

test('Google refresh preserves local group positions, priorities and sibling order', () => {
    const lists = [{ id: 'home', title: 'Home' }, { id: 'out', title: 'Out' }];
    const remoteTasks = [remote({ id: 'a', listId: 'home' }), remote({ id: 'b', listId: 'home' }), remote({ id: 'c', listId: 'out' })];
    const initial = mergeGoogleTasks([], remoteTasks, 'default', lists);
    const home = { ...initial[0], priority: 1, children: [...initial[0].children].reverse() };
    const out = { ...initial[1], priority: 3 };
    const other = task({ id: 'other', parentId: null, isGoogleSynced: false });
    const reordered = [out, other, home];
    const refreshed = mergeGoogleTasks(reordered, [...remoteTasks, remote({ id: 'new', listId: 'home' })], 'default', lists);
    assert.deepEqual(refreshed.map(t => t.id), [out.id, other.id, home.id]);
    assert.equal(refreshed[0].priority, 3);
    assert.equal(refreshed[2].priority, 1);
    assert.deepEqual(refreshed[2].children.map(t => t.googleTaskId), ['b', 'a', 'new']);
    const again = mergeGoogleTasks(JSON.parse(JSON.stringify(refreshed)), remoteTasks, 'default', lists);
    assert.deepEqual(again.map(t => t.id), [out.id, other.id, home.id]);
    assert.equal(again[2].priority, 1);
    assert.deepEqual(again[2].children.map(t => t.googleTaskId), ['b', 'a']);
});

test('migrating the old combined folder preserves IDs, drafts and pending changes in their lists', () => {
    const previous = [folder([
        local({ googleListId: 'home', googleSyncPending: true, title: 'Pending edit' }),
        task({ id: 'draft', googleListId: 'out', googleSyncPending: true })
    ])];
    const lists = [{ id: 'home', title: 'Home' }, { id: 'out', title: 'Out' }];
    const result = mergeGoogleTasks(previous, [remote({ listId: 'home' })], 'default', lists);
    assert.equal(find(result).id, 'local');
    assert.equal(find(result).title, 'Pending edit');
    assert.equal(find(result).parentId, googleListFolderId('home'));
    assert.equal(find(result, 'draft').parentId, googleListFolderId('out'));
    assert.ok(!find(result, 'google_main_folder'));
    const renamed = mergeGoogleTasks(result, [remote({ listId: 'home' })], 'default', [{ id: 'home', title: 'Renamed Home' }, lists[1]]);
    assert.equal(renamed[0].id, result[0].id);
    assert.equal(renamed[0].title, 'Renamed Home');
    assert.equal(find(renamed, 'draft').googleListId, 'out');
    assert.equal(flattenTasks(renamed).filter(t => t.id === 'draft').length, 1);
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

test('moving out of Google detaches the local copy and queues the remote task and subtasks for deletion', () => {
    const child = local({ id: 'child', googleTaskId: 'child-remote', parentId: 'local' });
    const previous = [folder([local({ children: [child] })])];
    const localGroup = task({ id: 'local-group', type: 'folder', parentId: null, children: [] });
    const moved = { ...previous[0].children[0], parentId: 'local-group' };
    const { tasks, deletions } = detachGoogleTasksMovedOutside(previous, [{ ...localGroup, children: [moved] }]);
    assert.deepEqual(deletions, [
        { taskId: 'remote', listId: 'second-list' },
        { taskId: 'child-remote', listId: 'second-list' }
    ]);
    assert.equal(find(tasks).isGoogleSynced, undefined);
    assert.equal(find(tasks).googleTaskId, undefined);
    assert.equal(find(tasks, 'child').isGoogleSynced, undefined);
    const afterPull = mergeGoogleTasks(tasks, [], 'default');
    assert.equal(find(afterPull).title, 'New task');
});

test('moving between Google parents does not detach or delete the task', () => {
    const previous = [folder([local()])];
    const next = [folder([local({ parentId: 'another-google-parent' })])];
    const result = detachGoogleTasksMovedOutside(previous, next);
    assert.deepEqual(result.deletions, []);
    assert.equal(find(result.tasks).googleTaskId, 'remote');
});

test('queued move-out deletion survives offline and is acknowledged before the next pull', async () => {
    let deletions = [{ taskId: 'remote', listId: 'second-list' }];
    const tasks = [task({ id: 'local-copy', parentId: null })];
    const options = {
        getTasks: () => tasks, apply: () => {}, tokens: {}, isCurrent: () => true,
        getDeletions: () => deletions, applyDeletions: update => { deletions = update(deletions); }
    };
    await assert.rejects(uploadGoogleChanges({ ...options, invoke: async () => { throw new Error('offline'); } }), /offline/);
    assert.deepEqual(deletions, [{ taskId: 'remote', listId: 'second-list' }]);
    const calls = [];
    await uploadGoogleChanges({ ...options, invoke: async (name, data) => { calls.push({ name, ...data }); return true; } });
    assert.deepEqual(calls, [{ name: 'google-tasks:delete-task', tokens: {}, listId: 'second-list', taskId: 'remote' }]);
    assert.deepEqual(deletions, []);
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
