const assert = require('node:assert/strict');
const puppeteer = require(process.env.PUPPETEER_PATH || 'C:/My App/Quran Classes Tracker/node_modules/puppeteer');

const origin = process.env.INJAZ_TEST_URL || 'http://127.0.0.1:4027';

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true
    });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => {
            errors.push(error.message);
            console.error(error);
        });
        page.setDefaultTimeout(6000);
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : request.abort());
        await page.evaluateOnNewDocument(() => {
            if (!localStorage.getItem('injaz_tasks')) {
                localStorage.setItem('injaz_tasks', JSON.stringify([{
                    id: 'fixture', title: 'Sample task', type: 'item', children: [], listId: 'default',
                    isCompleted: false, parentId: null, priority: 2, createdAt: Date.now()
                }]));
            }
        });

        const openNotes = async () => {
            const row = '[data-notes-task="fixture"]';
            await page.waitForSelector(row);
            await page.$eval(row, element => {
                element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true }));
            });
            await page.waitForSelector('[data-task-notes]');
            await page.$eval(row, element => {
                element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, isPrimary: true, bubbles: true }));
            });
        };
        const shortcut = async key => {
            await page.keyboard.down('Control');
            await page.keyboard.press(key);
            await page.keyboard.up('Control');
        };
        const text = editor => page.$eval(editor, element => element.innerText.replace(/\u00a0/g, ' ').trimEnd());
        const selection = () => page.evaluate(() => getSelection().toString());
        const setMarkup = (editor, html, from, to = from, backward = false) => page.$eval(editor, (element, html, from, to, backward) => {
            element.innerHTML = html;
            element.focus();
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let start, end;
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (!start && from <= node.length) start = [node, from];
                if (to <= node.length) { end = [node, to]; break; }
                from -= node.length;
                to -= node.length;
            }
            if (!start || !end) throw new Error('Invalid selection');
            getSelection().setBaseAndExtent(...(backward ? end : start), ...(backward ? start : end));
        }, html, from, to, backward);
        const exerciseEditor = async editor => {
            await setMarkup(editor, '<div><span style="font-weight:bold;opacity:0.5">١-</span> أول</div><div><span style="font-weight:bold;opacity:0.5">٢-</span> ثاني</div><div><span style="font-weight:bold;opacity:0.5">٣-</span> ثالث</div>', 1);
            await page.keyboard.press('Backspace');
            assert.equal(await text(editor), ' أول\n١- ثاني\n٢- ثالث');
            await shortcut('KeyZ');
            assert.equal(await text(editor), '١- أول\n٢- ثاني\n٣- ثالث');
            await shortcut('KeyY');
            assert.equal(await text(editor), ' أول\n١- ثاني\n٢- ثالث');
            await setMarkup(editor, '<div><span style="font-weight:bold;opacity:0.5">1-</span> one</div><div><span style="font-weight:bold;opacity:0.5">2-</span> two</div><div><span style="font-weight:bold;opacity:0.5">3-</span> three</div>', 6, 12);
            await page.keyboard.press('Backspace');
            assert.match(await text(editor), /2- three/);
            await shortcut('KeyZ');
            assert.match(await text(editor), /2- two/);
            await setMarkup(editor, '<div><span style="font-weight:bold;opacity:0.5">1-</span> one</div><div><span style="font-weight:bold;opacity:0.5">2-</span> two</div><div><span style="font-weight:bold;opacity:0.5">3-</span> three</div>', 8);
            await page.keyboard.press('Backspace');
            assert.equal(await text(editor), '1- one\n two\n2- three');
            await shortcut('KeyZ');
            assert.equal(await text(editor), '1- one\n2- two\n3- three');
            for (const spaces of [0, 1, 2]) {
                await setMarkup(editor, '<div>word</div>', 0, 4);
                await page.keyboard.down('Shift');
                await shortcut('KeyW');
                await page.keyboard.up('Shift');
                if (spaces === 0) await page.keyboard.press('Enter');
                for (let i = 0; i < spaces; i++) await page.keyboard.press('Space');
                await page.keyboard.type('next');
                assert.equal(await text(editor), spaces === 0 ? 'word\nnext' : 'word' + ' '.repeat(spaces) + 'next');
                assert.equal(await page.$eval(editor, element => element.querySelector('[style*="background-color"]').textContent.trim()), spaces === 1 ? 'word next' : 'word');
            }
            await setMarkup(editor, '<div><b><i><u><span style="background-color:yellow">source</span></u></i></b> target</div>', 0, 6);
            await page.keyboard.down('Shift');
            await shortcut('KeyC');
            await page.keyboard.up('Shift');
            await setMarkup(editor, '<div>target</div>', 0, 6);
            await page.keyboard.down('Shift');
            await shortcut('KeyV');
            await page.keyboard.up('Shift');
            assert.equal(await text(editor), 'target');
            assert.deepEqual(await page.$eval(editor, element => {
                const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
                const style = getComputedStyle(node.parentElement);
                return [
                    Number(style.fontWeight) >= 600,
                    style.fontStyle === 'italic',
                    !!element.querySelector('u, [style*="underline"]'),
                    !!element.querySelector('[style*="background-color"]')
                ];
            }), [true, true, true, true]);
            if (process.env.RENUMBER_ONLY) return;
            await setMarkup(editor, 'left<b>MID</b>right', 4, 7, true);
            await page.keyboard.press('Space');
            assert.equal(await text(editor), 'left MID right');
            assert.equal(await selection(), 'MID');
            assert.equal(await page.$eval(editor, element => element.querySelector('b').textContent.trim()), 'MID');
            await page.keyboard.press('Space');
            assert.equal(await text(editor), 'left MID right');
            await shortcut('KeyZ');
            assert.equal(await text(editor), 'leftMIDright');
            assert.equal(await selection(), 'MID');
            await shortcut('KeyY');
            assert.equal(await text(editor), 'left MID right');
            assert.equal(await selection(), 'MID');

            await setMarkup(editor, '<div>left<b>MID</b>right</div>', 4, 7);
            await page.keyboard.press('Enter');
            assert.equal(await text(editor), 'left\nMID\nright');
            assert.equal(await selection(), 'MID');
            await page.keyboard.press('Enter');
            assert.equal(await text(editor), 'left\nMID\nright');
            await shortcut('KeyZ');
            assert.equal(await text(editor), 'leftMIDright');
            await shortcut('KeyY');
            assert.equal(await text(editor), 'left\nMID\nright');

            await setMarkup(editor, '<div>left<b>FIRST</b></div><div><i>SECOND</i>right</div>', 4, 15);
            await page.keyboard.press('Enter');
            assert.equal(await text(editor), 'left\nFIRST\nSECOND\nright', await page.$eval(editor, element => element.innerHTML));
            assert.equal((await selection()).replace(/\n+/g, ' '), 'FIRST SECOND');
            await shortcut('KeyZ');
            assert.equal(await text(editor), 'leftFIRST\nSECONDright');
            assert.equal((await selection()).replace(/\n+/g, ' '), 'FIRST SECOND');
            await shortcut('KeyY');
            assert.equal(await text(editor), 'left\nFIRST\nSECOND\nright');
            assert.equal((await selection()).replace(/\n+/g, ' '), 'FIRST SECOND');

            await setMarkup(editor, '<div>left <b>MID</b> right</div>', 5, 8);
            await page.keyboard.press('Space');
            assert.equal(await text(editor), 'left MID right');
            assert.equal(await selection(), 'MID');

            for (const separator of ['.', '-']) {
                await setMarkup(editor, `1${separator}`, 2);
                await page.keyboard.press('Space');
                assert.equal(await page.$eval(editor, element => element.querySelector('span')?.style.opacity), '0.5');
                await page.keyboard.type('test');
                assert.equal(await text(editor), `1${separator} test`);
                await page.keyboard.press('Enter');
                assert.equal(await text(editor), `1${separator} test\n2${separator}`);
                const line = `١${separator} test`;
                await setMarkup(editor, line, line.length);
                await page.keyboard.press('Enter');
                assert.equal(await text(editor), `${line}\n٢${separator}`);
                await page.keyboard.type('next');
                await page.keyboard.press('Enter');
                assert.equal(await text(editor), `${line}\n٢${separator} next\n٣${separator}`);
                await page.keyboard.press('Enter');
                assert.equal(await text(editor), `${line}\n٢${separator} next`);
            }

            await setMarkup(editor, 'word', 0, 4);
            await shortcut('KeyB');
            assert.ok(await page.$eval(editor, element => element.querySelector('b, [style*="font-weight"]')));

            await setMarkup(editor, 'highlight', 0, 9);
            await page.keyboard.down('Control');
            await page.keyboard.down('Shift');
            await page.keyboard.press('KeyW');
            await page.keyboard.up('Shift');
            await page.keyboard.up('Control');
            assert.ok(await page.$eval(editor, element => element.querySelector('[style*="background-color"]')));
        };

        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await openNotes();
        const notes = '.task-notes-editor';
        await page.focus(notes);
        await page.keyboard.type('... ');
        assert.ok(await page.$(notes + ' hr'), 'Typing three dots and a space inserts a divider');
        await page.keyboard.press('Escape');
        await page.waitForSelector('[data-task-notes]', { hidden: true });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openNotes();
        assert.ok(await page.$(notes + ' hr'), 'A divider-only note survives saving and reopening');
        assert.ok(await page.$eval(notes + ' hr', el => parseFloat(getComputedStyle(el).borderTopWidth) > 0));
        await setMarkup(notes, '1-', 2);
        await page.keyboard.press('Space');
        await page.keyboard.type('one');
        await page.keyboard.press('Enter');
        await page.keyboard.type('two');
        await page.keyboard.press('Enter');
        await page.keyboard.type('three');
        await page.$eval(notes, element => {
            const marker = [...element.querySelectorAll('span')].find(span => span.textContent === '2-');
            getSelection().collapse(marker.nextSibling, 1);
        });
        await shortcut('Backspace');
        assert.equal(await text(notes), '1- one\ntwo\n2- three');
        await shortcut('KeyZ');
        assert.equal(await text(notes), '1- one\n2- two\n3- three');
        await setMarkup(notes, '<span style="opacity:0.5">1-</span> one<br>two<br><span style="opacity:0.5">3-</span> three', 0);
        await page.keyboard.press('Escape');
        await page.waitForSelector('[data-task-notes]', { hidden: true });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openNotes();
        assert.equal(await text(notes), '1- one\ntwo\n2- three');
        assert.equal(await page.$('[data-task-notes] [role="toolbar"]'), null);
        assert.match(await page.$eval(notes, element => getComputedStyle(element).fontFamily), /Amiri/);
        await setMarkup(notes, '1-', 2);
        await page.keyboard.press('Space');
        await page.keyboard.sendCharacter('عربي');
        assert.equal(await text(notes), '١- عربي');
        await page.keyboard.press('Enter');
        assert.equal(await text(notes), '١- عربي\n٢-', await page.$eval(notes, e => e.innerHTML));
        assert.equal(await page.$eval(notes, editor => {
            const marker = editor.querySelector('[data-empty-rtl-number]');
            return !!marker && editor.getBoundingClientRect().right - marker.getBoundingClientRect().right < 40;
        }), true, 'The next Arabic number appears on the right before typing');
        await page.keyboard.sendCharacter('نص');
        await page.keyboard.press('Enter');
        assert.equal(await text(notes), '١- عربي\n٢- نص\n٣-');
        await exerciseEditor(notes);
        // Measure rendered glyphs on a BR-separated mixed-direction line pair.
        const mixed = '١٢ ! عربي English<br>١٢ ! English عربي';
        await setMarkup(notes, mixed, 14);
        const alignment = () => page.$eval(notes, element => {
            const range = document.createRange();
            const right = element.getBoundingClientRect().right;
            const left = element.getBoundingClientRect().left;
            return [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => {
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();
                return right - rect.right < rect.left - left ? 'right' : 'left';
            });
        });
        await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running'));
        assert.deepEqual(await alignment(), ['right', 'left']);
        const title = '[data-task-notes] input';
        await page.focus(title);
        await shortcut('KeyA');
        await page.keyboard.type('Renamed task');
        assert.ok(await page.$('[data-task-notes]:not([data-closing])'));
        await page.mouse.click(5, 5);
        assert.ok(await page.$('[data-task-notes][data-closing]'));
        await page.waitForSelector('[data-task-notes]', { hidden: true });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openNotes();
        assert.equal(await page.$eval(title, element => element.value), 'Renamed task');
        assert.deepEqual(await alignment(), ['right', 'left']);
        await page.keyboard.press('Escape');
        await page.waitForSelector('[data-task-notes]', { hidden: true });

        await page.goto(origin + '/#quick-add', { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        const quick = '[contenteditable="true"]';
        await page.waitForSelector(quick);
        assert.match(await page.$eval(quick, element => getComputedStyle(element).fontFamily), /Amiri/);
        await page.focus(quick);
        await page.keyboard.type('English');
        for (const char of 'English') await page.keyboard.press('Backspace');
        for (const char of 'عربي') await page.keyboard.sendCharacter(char);
        assert.equal(await text(quick), 'عربي');
        assert.deepEqual(await page.$eval(quick, element => {
            const selection = getSelection();
            const caret = selection.getRangeAt(0).getBoundingClientRect();
            const line = document.createRange();
            line.selectNodeContents(selection.focusNode);
            return {
                direction: getComputedStyle(selection.focusNode.parentElement).direction,
                atEnd: selection.focusOffset === selection.focusNode.length,
                atLeftEdge: Math.abs(caret.left - line.getBoundingClientRect().left) < 2
            };
        }), { direction: 'rtl', atEnd: true, atLeftEdge: true });
        await exerciseEditor(quick);
        if (process.env.RENUMBER_ONLY) {
            assert.deepEqual(errors, []);
            console.log('Numbered list deletion checks passed in both editors.');
            return;
        }
        await setMarkup(quick, 'https://example.test', 20);
        await page.keyboard.press('Enter');
        assert.equal(await page.$eval(quick + ' a', link => link.origin), 'https://example.test');
        assert.deepEqual(errors, []);
        console.log('Notes editing checks passed in both editors.');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
