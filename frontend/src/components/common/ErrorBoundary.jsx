import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[HostelGuard Fault Isolation] Error caught by boundary:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleHardReload = () => {
    window.location.reload();
  };

  handleSignOut = () => {
    try {
      localStorage.removeItem('hg_token');
      localStorage.removeItem('hg_refresh_token');
      localStorage.removeItem('hg_user');
      window.location.href = '/';
    } catch (_) {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="container py-5 my-auto" style={{ maxWidth: '640px' }}>
          <div className="card shadow-lg border-0 rounded-4 overflow-hidden text-center">
            <div className="card-header bg-danger text-white py-4 border-0">
              <div className="d-inline-flex p-3 rounded-circle bg-white bg-opacity-25 mb-2">
                <AlertTriangle size={36} className="text-white" />
              </div>
              <h4 className="fw-bold mb-1">Module Encountered an Issue</h4>
              <p className="small mb-0 text-white-50">
                HostelGuard shielded the application from crashing. Your data is safe.
              </p>
            </div>
            <div className="card-body p-4 text-start">
              <div className="alert alert-light border rounded-3 p-3 mb-4 small text-secondary">
                <div className="fw-semibold text-dark mb-1">What happened?</div>
                <div>
                  A temporary runtime exception occurred while rendering this module. You can attempt to reload the module or return to the sign-in screen.
                </div>
                {this.state.error?.message && (
                  <div className="mt-2 font-monospace text-danger small text-break">
                    <code>{this.state.error.message}</code>
                  </div>
                )}
              </div>

              <div className="d-flex flex-wrap gap-2 justify-content-center">
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center gap-2 px-3 py-2 shadow-sm rounded-3"
                  onClick={this.handleReset}
                >
                  <RefreshCw size={16} /> Reload Module
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary d-inline-flex align-items-center gap-2 px-3 py-2 rounded-3"
                  onClick={this.handleHardReload}
                >
                  Refresh Page
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger d-inline-flex align-items-center gap-2 px-3 py-2 rounded-3"
                  onClick={this.handleSignOut}
                >
                  <Home size={16} /> Return to Sign In
                </button>
              </div>

              <div className="text-center mt-3">
                <button
                  type="button"
                  className="btn btn-link btn-sm text-muted text-decoration-none"
                  style={{ fontSize: '11px' }}
                  onClick={() => this.setState({ showDetails: !this.state.showDetails })}
                >
                  {this.state.showDetails ? 'Hide Technical Details' : 'Show Technical Details'}
                </button>
              </div>

              {this.state.showDetails && (
                <div className="mt-3 p-3 bg-dark text-white rounded-3 small font-monospace" style={{ fontSize: '11px', maxHeight: '180px', overflowY: 'auto' }}>
                  <div className="fw-bold text-warning mb-1">Stack Trace:</div>
                  <pre className="mb-0 text-break" style={{ whiteSpace: 'pre-wrap' }}>
                    {this.state.error?.stack || 'No stack trace available'}
                  </pre>
                </div>
              )}
            </div>
            <div className="card-footer bg-light py-2 text-center text-muted border-top" style={{ fontSize: '11px' }}>
              HostelGuard Fault Isolation Architecture &bull; Auto-Recovery
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
