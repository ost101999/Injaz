import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const isQuickAdd = window.location.hash === '#quick-add';
const ipc = (window as any).require?.('electron')?.ipcRenderer;
const saved = !isQuickAdd && ipc?.sendSync('dev-mode:restore');
if (saved) {
  localStorage.clear();
  Object.entries(saved as Record<string, string>).forEach(([key, value]) => localStorage.setItem(key, value));
}

if (ipc && !isQuickAdd) {
  const reportStorage = () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key !== null) data[key] = localStorage.getItem(key) ?? ''; }
    ipc.send('dev-mode:persist', data);
  };
  const proto = Storage.prototype;
  const set = proto.setItem, remove = proto.removeItem, clear = proto.clear;
  proto.setItem = function(key, value) { set.call(this, key, value); if (this === localStorage) reportStorage(); };
  proto.removeItem = function(key) { remove.call(this, key); if (this === localStorage) reportStorage(); };
  proto.clear = function() { clear.call(this); if (this === localStorage) reportStorage(); };
}

const root = ReactDOM.createRoot(rootElement);

if (!isQuickAdd) {
  for (const href of [
    'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap',
    'https://cdn.jsdelivr.net/gh/rastikerdar/neirizi-font@master/dist/font-face.css',
  ]) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }
}

const loadView = isQuickAdd
  ? import('./components/QuickAddWindow').then(module => module.QuickAddWindow)
  : import('./App').then(module => module.default);

void loadView.then(View => {
  root.render(<React.StrictMode><View /></React.StrictMode>);
}).catch(error => {
  console.error('Failed to load Injaz view', error);
  if (isQuickAdd) ipc?.send('quick-note-load-failed');
});