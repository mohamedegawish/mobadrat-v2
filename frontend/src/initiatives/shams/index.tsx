/** Shams El-Senaa — the initiative's own frontend, mounted by the platform under #i/shams/ (lazy chunk, scoped styles). */
import React from 'react';
import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { PlatformBar } from '../PlatformBar';
import './styles/globals.css';
import './styles/shams.css';

const ShamsModule: React.FC = () => (
  <div className="theme-shams module-root" data-initiative="shams">
    <PlatformBar titleAr="شمس الصناعة" titleEn="Shams El-Senaa" />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </div>
);

export default ShamsModule;
