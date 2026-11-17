import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

import { QuickAddWindow } from './components/QuickAddWindow';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const ipc = (window as any).require?.('electron')?.ipcRenderer;
const saved = ipc?.sendSync('dev-mode:restore');
if (saved) {
  localStorage.clear();
  Object.entries(saved as Record<string, string>).forEach(([key, value]) => localStorage.setItem(key, value));
}

if (ipc) {
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

const isQuickAdd = window.location.hash === '#quick-add';

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {isQuickAdd ? <QuickAddWindow /> : <App />}
  </React.StrictMode>
);