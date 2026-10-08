import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg)] px-6 text-center"
          role="alert"
        >
          <div className="text-4xl" aria-hidden>😵</div>
          <h1 className="text-lg font-bold text-[var(--text-1)]">页面出了点问题</h1>
          <p className="max-w-xs text-sm text-[var(--text-3)]">
            应用遇到意外错误，你的数据安全无恙。刷新页面即可继续使用。
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-lg bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-[var(--on-primary)] transition-opacity hover:opacity-90"
          >
            刷新页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
