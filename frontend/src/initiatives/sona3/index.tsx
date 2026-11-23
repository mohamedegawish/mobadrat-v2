/** Sona'a El-Mostaqbal — the initiative's screens, shown inside the platform's page (its header, footer, account menu and language) under #i/sona3/ (lazy chunk, scoped styles). */
import React from 'react';
import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './styles/globals.css';
import './styles/app.css';
import './styles/sona3.css';
import './styles/design.css';
import './styles/dashboards.css';
import './styles/identity.css';

const Sona3Module: React.FC = () => (
  <div className="theme-sona3 module-root" data-initiative="sona3">
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </div>
);

export default Sona3Module;
