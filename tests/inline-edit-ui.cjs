const puppeteer = require(process.env.PUPPETEER_PATH || 'C:/My App/Quran Classes Tracker/node_modules/puppeteer');
const assert = require('node:assert/strict');

// Real contentEditable behavior with isolated storage and mocked Google IPC.
(async () => {
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith('http://127.0.0.1:4012') || request.url().startsWith('data:') ? request.continue() : request.abort());
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('injaz_google_tokens', JSON.stringify({ access_token: 'fixture' }));
            localStorage.setItem('injaz_google_selected_lists', JSON.stringify(['list']));
            window.fixtureCalls = 0;
            window.require = () => ({ ipcRenderer: {
                on() {}, removeListener() {}, removeAllListeners() {}, send() {},
                async invoke(name) {
                    if (name === 'google-tasks:fetch-lists') return [{ id: 'list', title: 'List' }];
                    if (name === 'google-tasks:fetch') {
                        window.fixtureCalls++;
                        return { tasks: [{ id: 'item', listId: 'list', title: 'Original title', status: 'needsAction' }] };
                    }
                    return null;
                }
            } });
        });
        await page.goto('http://127.0.0.1:4012/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.body.textContent.includes('Original title'));
        async function editTitle(title) {
            await page.evaluate(title => {
                const element = [...document.querySelectorAll('div,span')].find(e => e.textContent === title && e.children.length === 0);
                if (!element) throw new Error(`Missing title: ${title}`);
                element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            }, title);
            await page.waitForSelector('[contenteditable="true"][data-inline-edit]');
        }
        const editor = '[contenteditable="true"][data-inline-edit]';
        const text = () => page.$eval(editor, e => e.textContent);
        const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await editTitle('Original title');
        await page.click(editor);
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.keyboard.type('Still typing');
        await frame();
        assert.equal(await text(), 'Still typing');
        // Background sync toggles React state while the user is still in the editor.
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await frame();
        assert.equal(await text(), 'Still typing', 'background rerender must not reset the draft');
        await page.keyboard.type(' more');
        assert.equal(await text(), 'Still typing more');
        // Repeated pulls/window updates must also preserve the caret and selection.
        await page.evaluate(selector => {
            const e = document.querySelector(selector), range = document.createRange();
            range.setStart(e.firstChild, 6); range.collapse(true);
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
            window.dispatchEvent(new Event('focus'));
        }, editor);
        await frame();
        await page.keyboard.type('X');
        assert.equal(await text(), 'Still Xtyping more');

        // The empty editor for a freshly added task used to reset to an empty
        // string, which looks like Backspace being held down.
        await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
        await page.waitForFunction(() => document.querySelector('[data-inline-edit]')?.textContent === '');
        await page.keyboard.type('Fresh draft survives');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await frame();
        assert.equal(await text(), 'Fresh draft survives');

        // A newly created subtask has a separate editor and must keep its draft too.
        await page.keyboard.press('Tab');
        await page.waitForFunction(() => document.querySelector('[data-inline-edit]')?.textContent === '');
        await page.keyboard.type('Subtask draft survives');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await frame();
        assert.equal(await text(), 'Subtask draft survives');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-inline-edit]'));

        // Group titles update presentation state on each input. Literal '<...>'
        // must stay text, and editing in the middle must not jump to the end.
        await editTitle('مهام جوجل');
        await page.click(editor);
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.keyboard.type('Group <b> & text', { delay: 15 });
        await frame();
        assert.equal(await text(), 'Group <b> & text');
        await page.evaluate(selector => {
            const e = document.querySelector(selector), range = document.createRange();
            range.setStart(e.firstChild, 6); range.collapse(true);
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        }, editor);
        await page.keyboard.type('XY', { delay: 30 });
        await frame();
        assert.equal(await text(), 'Group XY<b> & text');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.body.textContent.includes('Group XY<b> & text'));
        assert.deepEqual(errors, []);
        console.log('Inline editor passed: background sync, draft retention, caret stability, literal text, and group rename.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
