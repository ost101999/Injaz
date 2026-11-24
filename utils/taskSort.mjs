// Keep an ancestor in place while a newly created descendant is being edited.
export function hasNewSubtaskInProgress(task, editingId, now = Date.now()) {
    return (task.children || []).some(child => {
        if (child.isCompleted) return false;
        const age = now - child.createdAt;
        return (child.id === editingId && (!child.title.trim() || age < 60000)) ||
            age < 1000 || hasNewSubtaskInProgress(child, editingId, now);
    });
}
