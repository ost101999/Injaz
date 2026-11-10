// Reconcile complete fields against the last version acknowledged by both sides.
// A field is never silently overwritten when both sides changed it.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const SYNC_FIELDS = ['lists', 'tasks', 'habits', 'preferences'];

function validate(snapshot) {
    return snapshot && ['lists', 'tasks', 'habits'].every(field => Array.isArray(snapshot[field])) &&
        snapshot.preferences !== null && typeof snapshot.preferences === 'object' && !Array.isArray(snapshot.preferences);
}

export function mergeSnapshots(baseline, local, remote) {
    if (!validate(local) || (baseline !== null && !validate(baseline)) || (remote !== null && !validate(remote))) {
        throw new Error('Invalid sync snapshot');
    }
    const merged = {};
    const conflicts = [];
    for (const field of SYNC_FIELDS) {
        const l = local[field];
        const r = remote?.[field];
        const b = baseline?.[field];
        if (remote === null) {
            // A missing cloud after a previous sync may be a remote deletion.
            if (baseline !== null) conflicts.push(field);
            merged[field] = l;
        } else if (same(l, r)) {
            merged[field] = l;
        } else if (baseline === null) {
            conflicts.push(field);
            merged[field] = l;
        } else if (same(l, b)) {
            merged[field] = r;
        } else if (same(r, b)) {
            merged[field] = l;
        } else {
            conflicts.push(field);
            merged[field] = l;
        }
    }
    return { merged, conflicts };
}
