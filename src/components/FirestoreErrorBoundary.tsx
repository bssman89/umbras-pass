import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isDynamicImportError } from '../utils/lazyWithRetry';

interface FirestoreErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isModuleLoadError: boolean;
}

export class FirestoreErrorBoundary extends React.Component<
  { children: React.ReactNode },
  FirestoreErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      isModuleLoadError: false,
    };
  }

  static getDerivedStateFromError(error: unknown): FirestoreErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
      isModuleLoadError: isDynamicImportError(error),
    };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    console.error('Uncaught application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const { isModuleLoadError, errorMessage } = this.state;

      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-100 p-6">
          <div className="w-full max-w-lg rounded-xl border border-red-300 bg-white p-6 space-y-4 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-100 p-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-zinc-900">
                  {isModuleLoadError ? 'Module Load Error' : 'Workspace Sync Error'}
                </h2>
                <p className="text-xs text-zinc-600">
                  {isModuleLoadError
                    ? 'A view module failed to load, usually after an app update or brief connection interruption. Reloading will preserve your saved workspace.'
                    : 'An error occurred while syncing your private user deck data.'}
                </p>
              </div>
            </div>

            <pre className="max-h-48 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 whitespace-pre-wrap">
              {errorMessage}
            </pre>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!isModuleLoadError) {
                    try {
                      for (let i = window.localStorage.length - 1; i >= 0; i--) {
                        const k = window.localStorage.key(i);
                        if (k && k.includes('active_workspace')) {
                          window.localStorage.removeItem(k);
                        }
                      }
                      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
                        const k = window.sessionStorage.key(i);
                        if (k && k.includes('active_workspace')) {
                          window.sessionStorage.removeItem(k);
                        }
                      }
                    } catch {
                      // Ignore
                    }
                  }
                  this.setState({
                    hasError: false,
                    errorMessage: '',
                    isModuleLoadError: false,
                  });
                  window.location.reload();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {isModuleLoadError ? 'Reload App' : 'Reload Workspace'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
