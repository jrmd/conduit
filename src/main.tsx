import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './light.css';
import './quiet-focus.css';
import './sidebar.css';
import './motion.css';

const Root = process.env.NODE_ENV !== 'production' && new URLSearchParams(location.search).has('picker-sketch')
  ? React.lazy(() => import('./ModelPicker.prototype.js').then(module => ({default: module.ModelPickerSketch})))
  : App;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={null}><Root /></React.Suspense>
  </React.StrictMode>,
);
