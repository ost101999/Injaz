// Browser smoke test: all Firebase traffic is intercepted and uses fixture data.
const puppeteer = require(process.env.PUPPETEER_PATH || 'C:/My App/Quran Classes Tracker/node_modules/puppeteer');
const assert = require('node:assert/strict');
(async () => {
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
    let cloud = null, version = 1, writes = 0;
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
        await page.evaluateOnNewDocument(() => {
            let saved = null;
            const ipc = {
                on() {}, removeListener() {}, removeAllListeners() {}, send() {},
                async invoke(name, data) {
                    if (name === 'firebase-session:read') return saved;
                    if (name === 'firebase-session:write') { saved = data; return; }
                    if (name === 'firebase-session:clear') { saved = null; return; }
                    return null;
                }
            };
            window.require = name => name === 'electron' ? { ipcRenderer: ipc } : null;
        });
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'ETag', 'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS', 'Content-Type': 'application/json' };
            if (url.startsWith('http://127.0.0.1:4179/')) return request.continue();
            if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
            if (url.startsWith('https://identitytoolkit.googleapis.com/')) return request.respond({ status: 200, headers, body: JSON.stringify({ localId: 'idyOzbfKCBUQjnlVImyB9DVwlBI2', email: 'fixture@example.test', refreshToken: 'fixture', idToken: 'fixture', expiresIn: '3600' }) });
            if (url.startsWith('https://enjaz-9957d-default-rtdb.europe-west1.firebasedatabase.app/')) {
                if (request.method() === 'GET') return request.respond({ status: 200, headers: { ...headers, ETag: `"${version}"` }, body: JSON.stringify(cloud) });
                if (request.method() === 'PUT') {
                    if (request.headers()['if-match'] !== `"${version}"`) return request.respond({ status: 412, headers, body: '{}' });
                    cloud = JSON.parse(request.postData()); version++; writes++;
                    return request.respond({ status: 200, headers, body: JSON.stringify(cloud) });
                }
            }
            return request.abort();
        });
        await page.goto('http://127.0.0.1:4179/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-settings-trigger]');
        await page.click('[data-settings-trigger]');
        await page.evaluate(() => document.querySelectorAll('[data-settings-panel] > div:first-child button')[5].click());
        await page.waitForSelector('input[type="email"]');
        await page.type('input[type="email"]', 'fixture@example.test');
        await page.type('input[type="password"]', 'fixture-password');
        await page.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('تسجيل الدخول وتفعيل المزامنة')).click());
        await page.waitForFunction(() => document.body.textContent.includes('تمت المزامنة'), { timeout: 20000 });
        assert.equal(writes, 1);
        const saved = JSON.parse(cloud.payload);
        assert.ok(Array.isArray(saved.tasks));
        assert.ok(Array.isArray(saved.habits));
        const task = title => ({ id: title, title, type: 'item', color: '#000', priority: 1, parentId: null, children: [], isCompleted: false, createdAt: 1, listId: 'default' });
        const remote = JSON.parse(cloud.payload);
        remote.tasks = [task('remote fixture')]; cloud = { version: 1, payload: JSON.stringify(remote) }; version++;
        await page.evaluate(value => {
            const raw = JSON.stringify(value);
            localStorage.setItem('injaz_tasks', raw);
            window.dispatchEvent(new StorageEvent('storage', { key: 'injaz_tasks', newValue: raw }));
        }, [task('local fixture')]);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('injaz_tasks') || '[]')[0]?.title === 'local fixture');
        await page.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('مزامنة الآن')).click());
        await page.waitForSelector('input[name="firebase-tasks"]', { timeout: 20000 });
        assert.equal(writes, 1, 'conflict must not upload without a choice');
        await page.click('input[name="firebase-tasks"]');
        await page.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('حفظ الاختيارات')).click());
        await page.waitForFunction(() => document.body.textContent.includes('تمت المزامنة'), { timeout: 20000 });
        assert.equal(JSON.parse(cloud.payload).tasks[0].title, 'local fixture');
        assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('injaz_firebase_conflict_archive_v1') || '[]').length > 0));
        assert.deepEqual(errors, []);
        console.log('Firebase UI smoke test passed; all network data was mocked.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
