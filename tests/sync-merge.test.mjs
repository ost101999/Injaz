import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots } from '../firebase/sync-merge.mjs';

const base = { lists: ['a'], tasks: ['a'], habits: ['a'], preferences: { zoom: 1 } };
const changed = (field, value) => ({ ...base, [field]: value });

test('independent changes are merged without losing either side', () => {
    const result = mergeSnapshots(base, changed('tasks', ['local']), changed('habits', ['remote']));
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.merged.tasks, ['local']);
    assert.deepEqual(result.merged.habits, ['remote']);
});

test('different changes to the same field require review', () => {
    const result = mergeSnapshots(base, changed('tasks', ['local']), changed('tasks', ['remote']));
    assert.deepEqual(result.conflicts, ['tasks']);
});

test('a first connection does not silently replace different existing data', () => {
    const result = mergeSnapshots(null, base, changed('tasks', ['remote']));
    assert.deepEqual(result.conflicts, ['tasks']);
});

test('a missing cloud copy after prior sync requires review', () => {
    const result = mergeSnapshots(base, base, null);
    assert.deepEqual(result.conflicts, ['lists', 'tasks', 'habits', 'preferences']);
});

test('a new empty cloud accepts the local copy', () => {
    const result = mergeSnapshots(null, base, null);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.merged, base);
});

test('an incomplete cloud response cannot erase local fields', () => {
    assert.throws(() => mergeSnapshots(base, base, { tasks: [] }), /Invalid sync snapshot/);
});
