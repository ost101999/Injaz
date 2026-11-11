export const GOOGLE_FOLDER_ID = 'google_main_folder';
export const googleListFolderId = listId => `google_list_${encodeURIComponent(listId)}`;

export function flattenTasks(tasks) {
    return tasks.flatMap(task => [task, ...flattenTasks(task.children || [])]);
}

// Pure: React may replay state updaters. Network writes happen only in the worker.
export function markGoogleChanges(previous, next, defaultListId) {
    const before = new Map(flattenTasks(previous).map(t => [t.id, t]));
    function visit(task, parent) {
        const old = before.get(task.id);
        const linked = task.isGoogleSynced || parent?.isGoogleSynced || task.id === GOOGLE_FOLDER_ID;
        let result = linked ? { ...task, isGoogleSynced: true } : task;
        if (linked && task.type === 'item') {
            const changed = !old || old.title !== task.title || old.isCompleted !== task.isCompleted;
            result = {
                ...task, isGoogleSynced: true,
                googleTaskId: task.googleTaskId || old?.googleTaskId,
                googleListId: task.googleListId || old?.googleListId || parent?.googleListId || defaultListId,
                googleSyncPending: task.googleSyncPending || changed || !task.googleTaskId,
                googleSyncRevision: changed ? (old?.googleSyncRevision || 0) + 1 : task.googleSyncRevision
            };
        }
        return { ...result, children: (task.children || []).map(child => visit(child, result)) };
    }
    return next.map(task => visit(task, null));
}

// Moving a linked task outside every Google parent makes it a local task.
// Return remote IDs separately so the caller can persist their deletion before pulling.
export function detachGoogleTasksMovedOutside(previous, next) {
    const before = new Map(flattenTasks(previous).map(t => [t.id, t]));
    const deletions = [];
    function detach(task) {
        if (task.googleTaskId && task.googleListId) {
            deletions.push({ taskId: task.googleTaskId, listId: task.googleListId });
        }
        const { googleTaskId, googleListId, isGoogleSynced, isGoogleListFolder,
            googleSyncPending, googleSyncRevision, ...local } = task;
        return { ...local, children: (task.children || []).map(detach) };
    }
    function visit(task, parent) {
        const old = before.get(task.id);
        const insideGoogle = parent?.isGoogleSynced || parent?.id === GOOGLE_FOLDER_ID;
        const result = old?.type === 'item' && old.isGoogleSynced && !insideGoogle ? detach(task) : {
            ...task, children: (task.children || []).map(child => visit(child, task))
        };
        return result;
    }
    return { tasks: next.map(task => visit(task, null)), deletions };
}

export function acknowledgeGoogleWrite(tasks, sent, googleTaskId) {
    return tasks.map(task => task.id === sent.id ? {
        ...task, googleTaskId, googleListId: sent.googleListId,
        googleSyncPending: task.googleSyncRevision !== sent.googleSyncRevision ||
            task.title !== sent.title || task.isCompleted !== sent.isCompleted
    } : { ...task, children: acknowledgeGoogleWrite(task.children || [], sent, googleTaskId) });
}

const remoteKey = (listId, id) => JSON.stringify([listId, id]);

// Merge a complete, successful snapshot; never replace drafts or unacknowledged edits.
export function mergeGoogleTasks(previous, remote, targetListId, googleLists = []) {
    if (!Array.isArray(remote)) throw new Error('Invalid Google Tasks response');
    const allLocal = flattenTasks(previous);
    const localByRemote = new Map(allLocal.filter(t => t.googleTaskId).map(t => [remoteKey(t.googleListId, t.googleTaskId), t]));
    const remoteByKey = new Map(remote.map(t => [remoteKey(t.listId, t.id), t]));
    const idFor = (listId, id) => localByRemote.get(remoteKey(listId, id))?.id || `google_${listId}_${id}`;
    const defaultGoogleListId = googleLists[0]?.id || remote[0]?.listId ||
        allLocal.find(t => t.googleListId)?.googleListId || '@default';
    const listFolders = new Map();
    function ensureFolder(listId = defaultGoogleListId) {
        if (!listFolders.has(listId)) {
            const old = allLocal.find(t => t.isGoogleListFolder && t.googleListId === listId);
            const info = googleLists.find(list => list.id === listId);
            listFolders.set(listId, {
                priority: 2, color: '#4285F4', createdAt: Date.now(), ...old,
                id: googleListFolderId(listId), title: info?.title || old?.title || 'مهام جوجل',
                type: 'folder', parentId: null, listId: targetListId, googleListId: listId,
                isGoogleSynced: true, isGoogleListFolder: true, isCompleted: false,
                isArchived: false, children: []
            });
        }
        return listFolders.get(listId);
    }
    googleLists.forEach(list => ensureFolder(list.id));
    const nodes = new Map();
    for (const item of remote) {
        const local = localByRemote.get(remoteKey(item.listId, item.id));
        const node = {
            priority: 2, color: '#4285F4', createdAt: Date.now(), ...local,
            id: idFor(item.listId, item.id), type: 'item',
            googleTaskId: item.id, googleListId: item.listId, isGoogleSynced: true,
            listId: targetListId,
            parentId: item.parent && remoteByKey.has(remoteKey(item.listId, item.parent)) ? idFor(item.listId, item.parent) : googleListFolderId(item.listId),
            title: local?.googleSyncPending ? local.title : (item.title || ''),
            isCompleted: local?.googleSyncPending ? local.isCompleted : item.status === 'completed',
            completedAt: local?.googleSyncPending ? local.completedAt : item.completed ? Date.parse(item.completed) : undefined,
            dueDate: item.due ? item.due.split('T')[0] : undefined,
            children: []
        };
        nodes.set(node.id, node);
    }
    // Preserve local-only descendants, pending writes and their ancestors even if
    // a remote parent disappears or its list is temporarily deselected.
    function retain(task, insideGoogle = false, inheritedListId = defaultGoogleListId) {
        const inside = insideGoogle || task.isGoogleSynced || task.id === GOOGLE_FOLDER_ID;
        const googleListId = task.googleListId || inheritedListId;
        let retainedChild = false;
        for (const child of task.children || []) retainedChild = retain(child, inside, googleListId) || retainedChild;
        const keep = inside && (!task.googleTaskId || task.googleSyncPending || retainedChild);
        if (keep && task.id !== GOOGLE_FOLDER_ID && !task.isGoogleListFolder && !nodes.has(task.id)) {
            nodes.set(task.id, { ...task, googleListId, children: [] });
        }
        return keep || nodes.has(task.id);
    }
    previous.forEach(task => retain(task));
    for (const node of nodes.values()) {
        const parent = nodes.get(node.parentId);
        if (parent && parent !== node) parent.children.push(node);
        else {
            const folder = ensureFolder(node.googleListId);
            node.parentId = folder.id;
            folder.children.push(node);
        }
    }
    // Keep locally chosen sibling order; Google does not store Injaz's
    // group priorities or its custom ordering. New items follow existing ones.
    for (const parent of [...listFolders.values(), ...nodes.values()]) {
        const previousParent = allLocal.find(task => task.id === parent.id);
        const order = new Map((previousParent?.children || []).map((task, index) => [task.id, index]));
        parent.children.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    }
    function removeLinked(tasks) {
        return tasks.filter(t => t.id !== GOOGLE_FOLDER_ID && !t.isGoogleSynced)
            .map(t => ({ ...t, children: removeLinked(t.children || []) }));
    }
    const remainingLocal = new Map(removeLinked(previous).map(task => [task.id, task]));
    const remainingFolders = new Map(listFolders);
    const result = [];
    for (const task of previous) {
        if (task.isGoogleListFolder && remainingFolders.has(task.googleListId)) {
            result.push(remainingFolders.get(task.googleListId));
            remainingFolders.delete(task.googleListId);
        } else if (remainingLocal.has(task.id)) {
            result.push(remainingLocal.get(task.id));
            remainingLocal.delete(task.id);
        }
    }
    return [...result, ...remainingLocal.values(), ...remainingFolders.values()];
}

// Upload parents before children. Read the latest state after each acknowledgement
// so edits made while an earlier request was in flight are not lost.
export async function uploadGoogleChanges({ getTasks, apply, invoke, tokens, isCurrent,
    getDeletions = () => [], applyDeletions = () => {} }) {
    const activeRemote = new Set(flattenTasks(getTasks()).filter(t => t.isGoogleSynced && t.googleTaskId)
        .map(t => remoteKey(t.googleListId, t.googleTaskId)));
    for (const deletion of getDeletions()) {
        if (!isCurrent()) return;
        const key = remoteKey(deletion.listId, deletion.taskId);
        // Undo may have restored the task into Google before this queue was sent.
        if (!activeRemote.has(key)) {
            const ok = await invoke('google-tasks:delete-task', {
                tokens, listId: deletion.listId, taskId: deletion.taskId
            });
            if (!ok) throw new Error('لم يؤكد جوجل حذف المهمة');
        }
        if (!isCurrent()) return;
        applyDeletions(current => current.filter(item => remoteKey(item.listId, item.taskId) !== key));
    }
    const pending = flattenTasks(getTasks()).filter(t => t.type === 'item' && t.isGoogleSynced &&
        (t.googleSyncPending || !t.googleTaskId) && t.title.trim());
    for (const entry of pending) {
        if (!isCurrent()) return;
        const sent = flattenTasks(getTasks()).find(t => t.id === entry.id);
        if (!sent || !sent.title.trim()) continue;
        let id = sent.googleTaskId;
        if (!id) {
            const parent = flattenTasks(getTasks()).find(t => t.id === sent.parentId);
            if (parent?.type === 'item' && !parent.googleTaskId) throw new Error('احفظ المهمة الرئيسية أولاً');
            id = await invoke('google-tasks:create-task', {
                tokens, listId: sent.googleListId, title: sent.title,
                completed: sent.isCompleted, parentId: parent?.googleTaskId
            });
            if (!id) throw new Error('لم يؤكد جوجل حفظ المهمة');
        } else {
            const ok = await invoke('google-tasks:update-task', {
                tokens, listId: sent.googleListId, taskId: id,
                title: sent.title, completed: sent.isCompleted
            });
            if (!ok) throw new Error('لم يؤكد جوجل حفظ التعديل');
        }
        if (!isCurrent()) return;
        apply(tasks => acknowledgeGoogleWrite(tasks, sent, id));
    }
}
