import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

import { QuickAddWindow } from './components/QuickAddWindow';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const isQuickAdd = window.location.hash === '#quick-add';

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {isQuickAdd ? <QuickAddWindow /> : <App />}
  </React.StrictMode>
);