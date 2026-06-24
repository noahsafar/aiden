import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Auto-hiding scrollbars: show the thumb only while actively scrolling, then
// fade it out after a short idle. Capture phase catches nested scroll containers
// (scroll events don't bubble).
if (typeof document !== 'undefined') {
  let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener(
    'scroll',
    () => {
      document.documentElement.classList.add('is-scrolling');
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => document.documentElement.classList.remove('is-scrolling'), 1100);
    },
    true,
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'red' }}>
          <strong>App crashed — copy this and report it:</strong>
          {'\n\n'}{err.message}{'\n\n'}{err.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);