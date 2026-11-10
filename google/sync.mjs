export const GOOGLE_FOLDER_ID = 'google_main_folder';

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

export function acknowledgeGoogleWrite(tasks, sent, googleTaskId) {
    return tasks.map(task => task.id === sent.id ? {
        ...task, googleTaskId, googleListId: sent.googleListId,
        googleSyncPending: task.googleSyncRevision !== sent.googleSyncRevision ||
            task.title !== sent.title || task.isCompleted !== sent.isCompleted
    } : { ...task, children: acknowledgeGoogleWrite(task.children || [], sent, googleTaskId) });
}

const remoteKey = (listId, id) => JSON.stringify([listId, id]);

// Merge a complete, successful snapshot; never replace drafts or unacknowledged edits.
export function mergeGoogleTasks(previous, remote, targetListId) {
    if (!Array.isArray(remote)) throw new Error('Invalid Google Tasks response');
    const allLocal = flattenTasks(previous);
    const localByRemote = new Map(allLocal.filter(t => t.googleTaskId).map(t => [remoteKey(t.googleListId, t.googleTaskId), t]));
    const remoteByKey = new Map(remote.map(t => [remoteKey(t.listId, t.id), t]));
    const idFor = (listId, id) => localByRemote.get(remoteKey(listId, id))?.id || `google_${listId}_${id}`;
    const nodes = new Map();
    for (const item of remote) {
        const local = localByRemote.get(remoteKey(item.listId, item.id));
        const node = {
            priority: 2, color: '#4285F4', createdAt: Date.now(), ...local,
            id: idFor(item.listId, item.id), type: 'item',
            googleTaskId: item.id, googleListId: item.listId, isGoogleSynced: true,
            listId: targetListId,
            parentId: item.parent && remoteByKey.has(remoteKey(item.listId, item.parent)) ? idFor(item.listId, item.parent) : GOOGLE_FOLDER_ID,
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
    function retain(task, insideGoogle = false) {
        const inside = insideGoogle || task.isGoogleSynced || task.id === GOOGLE_FOLDER_ID;
        let retainedChild = false;
        for (const child of task.children || []) retainedChild = retain(child, inside) || retainedChild;
        const keep = inside && (!task.googleTaskId || task.googleSyncPending || retainedChild);
        if (keep && task.id !== GOOGLE_FOLDER_ID && !nodes.has(task.id)) nodes.set(task.id, { ...task, children: [] });
        return keep || nodes.has(task.id);
    }
    previous.forEach(task => retain(task));
    const oldFolder = allLocal.find(t => t.id === GOOGLE_FOLDER_ID);
    const folder = {
        id: GOOGLE_FOLDER_ID, title: 'مهام جوجل', type: 'folder', color: '#4285F4',
        priority: 2, createdAt: Date.now(), ...oldFolder, parentId: null,
        listId: targetListId, isGoogleSynced: true, isCompleted: false, children: []
    };
    for (const node of nodes.values()) {
        const parent = nodes.get(node.parentId);
        if (parent && parent !== node) parent.children.push(node);
        else { node.parentId = GOOGLE_FOLDER_ID; folder.children.push(node); }
    }
    function removeLinked(tasks) {
        return tasks.filter(t => t.id !== GOOGLE_FOLDER_ID && !t.isGoogleSynced)
            .map(t => ({ ...t, children: removeLinked(t.children || []) }));
    }
    return [...removeLinked(previous), folder];
}

// Upload parents before children. Read the latest state after each acknowledgement
// so edits made while an earlier request was in flight are not lost.
export async function uploadGoogleChanges({ getTasks, apply, invoke, tokens, isCurrent }) {
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
