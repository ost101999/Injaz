// Isolated browser profile and fake Electron IPC; never accesses a real Google account.
const puppeteer = require(process.env.PUPPETEER_PATH || 'C:/My App/Quran Classes Tracker/node_modules/puppeteer');
const assert = require('node:assert/strict');
(async () => {
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith('http://127.0.0.1:4012') || request.url().startsWith('data:') ? request.continue() : request.abort());
        await page.evaluateOnNewDocument(() => {
            const item = { id: 'local-draft', title: 'UI created task', type: 'item', children: [], isCompleted: false, parentId: 'google_main_folder', listId: 'default', priority: 2, color: '#4285F4', createdAt: 1 };
            if (!localStorage.getItem('fixture-seeded')) {
                localStorage.setItem('fixture-seeded', 'yes');
                localStorage.setItem('injaz_google_tokens', JSON.stringify({ access_token: 'fixture' }));
                localStorage.setItem('injaz_google_selected_lists', JSON.stringify(['second-list', 'other-list']));
                localStorage.setItem('injaz_tasks', JSON.stringify([{ ...item, id: 'google_main_folder', title: 'مهام جوجل', type: 'folder', parentId: null, isGoogleSynced: true, children: [item] }]));
            }
            window.fixture = { remote: [{ id: 'other-task', listId: 'other-list', title: 'Task in Out list', status: 'needsAction' }], calls: [], offline: false };
            const ipc = {
                on() {}, removeListener() {}, removeAllListeners() {}, send() {},
                async invoke(name, data) {
                    if (!name.startsWith('google-tasks:')) return null;
                    window.fixture.calls.push({ name, data });
                    if (window.fixture.offline) throw new Error('fixture offline');
                    if (name === 'google-tasks:fetch-lists') return [{ id: 'second-list', title: 'ToDo(Home)' }, { id: 'other-list', title: 'ToDo(Out)' }];
                    if (name === 'google-tasks:fetch') return { tasks: structuredClone(window.fixture.remote) };
                    if (name === 'google-tasks:create-task') {
                        window.fixture.remote.push({ id: 'created-remote', listId: data.listId, title: data.title, status: 'needsAction' });
                        return 'created-remote';
                    }
                    if (name === 'google-tasks:update-task') {
                        const task = window.fixture.remote.find(t => t.id === data.taskId);
                        if (!task) throw new Error('fixture missing task');
                        task.title = data.title; task.status = data.completed ? 'completed' : 'needsAction';
                        return true;
                    }
                }
            };
            window.require = () => ({ ipcRenderer: ipc });
        });
        await page.goto('http://127.0.0.1:4012/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('injaz_tasks'))[0]?.children[0]?.googleTaskId === 'created-remote');
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('injaz_tasks')).map(t => t.title)), ['ToDo(Home)', 'ToDo(Out)']);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('injaz_tasks'))[1].children[0].title), 'Task in Out list');
        await page.waitForSelector('svg[aria-label="Google Tasks"]');
        assert.equal(await page.$$eval('svg[aria-label="Google Tasks"]', elements => elements.length), 2);
        assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.name === 'google-tasks:create-task').length), 1);
        // Edit through the actual inline editor and commit by blurring it.
        await page.waitForFunction(() => document.body.textContent.includes('UI created task'));
        await page.evaluate(() => {
            const leaf = [...document.querySelectorAll('div,span')].find(e => e.textContent === 'UI created task' && e.children.length === 0);
            if (!leaf) throw new Error('Task title not rendered');
            leaf.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        });
        await page.waitForSelector('[contenteditable="true"][data-inline-edit]');
        await page.evaluate(() => { window.fixture.offline = true; });
        await page.click('[contenteditable="true"][data-inline-edit]');
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.keyboard.type('Offline edit survives');
        await page.click('[data-settings-trigger]');
        await page.waitForFunction(() => {
            const task = JSON.parse(localStorage.getItem('injaz_tasks'))[0]?.children[0];
            return task?.title === 'Offline edit survives' && task.googleSyncPending;
        });
        await page.waitForFunction(() => window.fixture.calls.some(c => c.name === 'google-tasks:update-task'));
        await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('injaz_tasks'))[0].children[0].title), 'Offline edit survives');
        await page.evaluate(() => { window.fixture.offline = false; window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => {
            const task = JSON.parse(localStorage.getItem('injaz_tasks'))[0]?.children[0];
            return task?.title === 'Offline edit survives' && !task.googleSyncPending;
        });
        assert.equal(await page.evaluate(() => window.fixture.remote.find(t => t.id === 'created-remote').title), 'Offline edit survives');
        assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.name === 'google-tasks:create-task').length), 1);
        assert.deepEqual(errors, []);
        console.log('Google Tasks UI passed: create, inline edit, offline preservation, retry, stable ID, no duplicate create.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
