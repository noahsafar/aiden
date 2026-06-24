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
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{ maxWidth: 440, textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2937', marginBottom: 8 }}>
              Something went wrong
            </div>
            <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5, marginBottom: 20 }}>
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 10,
                padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reload Aiden
            </button>
            <details style={{ marginTop: 20, textAlign: 'left' }}>
              <summary style={{ fontSize: 12, color: '#9ca3af', cursor: 'pointer' }}>Technical details</summary>
              <pre style={{ marginTop: 8, fontSize: 11, color: '#9ca3af', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                {err.message}{'\n\n'}{err.stack}
              </pre>
            </details>
          </div>
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