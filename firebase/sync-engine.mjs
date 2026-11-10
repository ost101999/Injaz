import { mergeSnapshots } from './sync-merge.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The transport reads an opaque JSON snapshot and performs an ETag-guarded PUT.
// Local state is checked again after every network wait and before applying data.
export async function syncOnce({ transport, getLocal, getBaseline, applyLocal, saveBaseline, review }) {
    const local = getLocal();
    const baseline = getBaseline();
    const remote = await transport.read();
    if (!equal(local, getLocal())) return { status: 'retry' };
    const { merged, conflicts } = mergeSnapshots(baseline, local, remote.value);
    if (conflicts.length) {
        if (!review || review.etag !== remote.etag || !equal(review.local, local) || !equal(review.remote, remote.value)) {
            return { status: 'conflict', conflicts, local, remote: remote.value, etag: remote.etag };
        }
        for (const field of conflicts) {
            const choice = review.choices[field];
            if (choice !== 'local' && choice !== 'remote') return { status: 'conflict', conflicts, local, remote: remote.value, etag: remote.etag };
            if (choice === 'remote') {
                if (remote.value === null) throw new Error('The cloud copy is missing; restore a backup before choosing it');
                merged[field] = remote.value[field];
            }
        }
    }
    if (!equal(local, getLocal())) return { status: 'retry' };
    if (!equal(local, merged) && !applyLocal(local, merged)) return { status: 'retry' };
    if (!equal(remote.value, merged)) {
        try { await transport.write(merged, remote.etag); }
        catch (error) { if (error?.status === 412) return { status: 'retry' }; throw error; }
    }
    // This is the exact version acknowledged by Firebase, even if the user
    // made another local edit while the write was in flight.
    saveBaseline(merged);
    return { status: 'ok' };
}
