/** Shams El-Senaa — the initiative's screens, shown inside the platform's page (its header, footer, account menu and language) under #i/shams/ (lazy chunk, scoped styles). */
import React from 'react';
import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './styles/globals.css';
import './styles/shams.css';

const ShamsModule: React.FC = () => (
  <div className="theme-shams module-root" data-initiative="shams">
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </div>
);

export default ShamsModule;
