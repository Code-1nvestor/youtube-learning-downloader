/**
 * ErrorBoundary.tsx - React 错误边界
 *
 * 捕获子组件树中的未处理 JavaScript 错误，展示友好的降级 UI，
 * 避免整个应用白屏崩溃。
 *
 * 注意：Error Boundary 不捕获以下错误：
 * - 事件处理器中的错误（需 try/catch）
 * - 异步代码（setTimeout/Promise）
 * - 服务端渲染错误
 * - ErrorBoundary 自身抛出的错误
 *
 * 这些场景由 api.ts 中的统一错误处理和 Toast 通知覆盖。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 记录到控制台便于调试（生产环境可接入错误上报服务）
    console.error('[ErrorBoundary] 捕获未处理错误:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-md w-full card p-6 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h2 className="text-lg font-medium text-gray-800 dark:text-gray-100 mb-2">
              应用出现了问题
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              页面遇到了未预期的错误。可以尝试重试，或刷新页面。
            </p>
            {this.state.error && (
              <details className="text-left mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs text-gray-600 dark:text-gray-400">
                <summary className="cursor-pointer mb-1">错误详情</summary>
                <pre className="whitespace-pre-wrap break-all">
                  {this.state.error.message}
                  {'\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
