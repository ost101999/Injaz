import test from 'node:test';
import assert from 'node:assert/strict';
import { availableMenuSide } from '../utils/contextMenu.mjs';

test('submenus open on a free side without covering other panels', () => {
    const main = { left: 650, right: 800 };
    const lists = { left: 440, right: 645 };
    assert.equal(availableMenuSide(lists, 224, [main, lists], 1000), 211);
    const leftLists = { left: 15, right: 220 };
    const rightMain = { left: 225, right: 375 };
    assert.equal(availableMenuSide(leftLists, 224, [leftLists, rightMain], 800), null);
    assert.equal(availableMenuSide({ left: 15, right: 220 }, 224, [{ left: 15, right: 220 }], 800), 225);
});

test('panel positioning respects screen margins and zoomed widths', () => {
    const panel = { left: 310, right: 510 };
    assert.equal(availableMenuSide(panel, 224 * 1.5, [panel], 800), null);
    assert.equal(availableMenuSide(panel, 224, [panel], 800), 81);
});
