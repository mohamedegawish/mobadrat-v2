/** Sona'a El-Mostaqbal — the initiative's own frontend, mounted by the platform under #i/sona3/ (lazy chunk, scoped styles). */
import React from 'react';
import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { PlatformBar } from '../PlatformBar';
import './styles/globals.css';
import './styles/app.css';
import './styles/sona3.css';
import './styles/design.css';
import './styles/dashboards.css';

const Sona3Module: React.FC = () => (
  <div className="theme-sona3 module-root" data-initiative="sona3">
    <PlatformBar titleAr="صُنّاع المستقبل" titleEn="Future Makers" />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </div>
);

export default Sona3Module;
