import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce } from '../firebase/sync-engine.mjs';

const snapshot = tasks => ({ lists: [], tasks, habits: [], preferences: {} });
const clone = value => structuredClone(value);
function fixture(local, baseline, remote) {
    let current = clone(local), saved = clone(baseline), server = clone(remote), etag = 'one', writes = 0;
    const options = {
        getLocal: () => clone(current), getBaseline: () => clone(saved),
        applyLocal: (expected, next) => { if (JSON.stringify(current) !== JSON.stringify(expected)) return false; current = clone(next); return true; },
        saveBaseline: value => { saved = clone(value); },
        transport: { read: async () => ({ value: clone(server), etag }), write: async (value, match) => {
            if (match !== etag) throw Object.assign(new Error('changed'), { status: 412 });
            server = clone(value); writes++; etag = 'two';
        } }
    };
    return { options, result: () => ({ current, saved, server, writes }), edit: value => { current = clone(value); }, changeRemote: value => { server = clone(value); etag = 'changed'; } };
}
test('first write is conditional and acknowledged as baseline', async () => {
    const f = fixture(snapshot(['a']), null, null);
    assert.equal((await syncOnce(f.options)).status, 'ok');
    assert.deepEqual(f.result().saved, snapshot(['a']));
    assert.equal(f.result().writes, 1);
});
test('concurrent edits require review and do not write', async () => {
    const f = fixture(snapshot(['local']), snapshot(['old']), snapshot(['remote']));
    const conflict = await syncOnce(f.options);
    assert.equal(conflict.status, 'conflict');
    assert.deepEqual(conflict.conflicts, ['tasks']);
    assert.equal(f.result().writes, 0);
    f.changeRemote(snapshot(['new remote']));
    const retry = await syncOnce({ ...f.options, review: { ...conflict, choices: { tasks: 'local' } } });
    assert.equal(retry.status, 'conflict');
    assert.equal(f.result().writes, 0);
});
test('the remote conflict policy keeps Firebase authoritative and archives the local copy', async () => {
    const f = fixture(snapshot(['local']), snapshot(['old']), snapshot(['remote']));
    const archives = [];
    const result = await syncOnce({
        ...f.options,
        conflictPolicy: 'remote',
        archiveConflict: archive => archives.push(archive)
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(f.result().current.tasks, ['remote']);
    assert.deepEqual(f.result().saved.tasks, ['remote']);
    assert.equal(f.result().writes, 0);
    assert.deepEqual(archives[0].conflicts, ['tasks']);
    assert.deepEqual(archives[0].local.tasks, ['local']);
});
test('a local edit during a read is not overwritten', async () => {
    const f = fixture(snapshot(['old']), snapshot(['old']), snapshot(['remote']));
    const read = f.options.transport.read;
    f.options.transport.read = async () => { const result = await read(); f.edit(snapshot(['new local'])); return result; };
    assert.equal((await syncOnce(f.options)).status, 'retry');
    assert.deepEqual(f.result().current.tasks, ['new local']);
});
test('a conditional write race is retried without acknowledging it', async () => {
    const f = fixture(snapshot(['local']), snapshot(['old']), snapshot(['old']));
    const write = f.options.transport.write;
    f.options.transport.write = async (...args) => { f.changeRemote(snapshot(['other'])); return write(...args); };
    assert.equal((await syncOnce(f.options)).status, 'retry');
    assert.deepEqual(f.result().saved, snapshot(['old']));
});
