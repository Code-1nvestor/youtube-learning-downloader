/**
 * Settings.tsx - 设置页
 *
 * 当前功能：Cookie 配置（解除 YouTube 机器人验证）
 * Phase 5 将增加：下载路径、命名规则、并发数等持久化设置
 */

import { useState, useEffect } from 'react';
import { api, ApiError, type CookieStatus } from '../api';
import { useStore } from '../store';

export function Settings() {
  const { cookieStatus, setCookieStatus, notify } = useStore();
  const [loading, setLoading] = useState(false);

  // 初始加载 Cookie 状态
  useEffect(() => {
    api.getCookieStatus().then(setCookieStatus).catch(() => {});
  }, [setCookieStatus]);

  const refreshStatus = async () => {
    try {
      const status = await api.getCookieStatus();
      setCookieStatus(status);
    } catch {
      // 忽略
    }
  };

  const handleBrowserConfig = async (browser: string) => {
    setLoading(true);
    try {
      const status = await api.setCookieBrowser(browser);
      setCookieStatus(status);
      notify('Cookie 已配置为从浏览器读取');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '配置失败';
      notify(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    try {
      const status = await api.clearCookie();
      setCookieStatus(status);
      notify('Cookie 已清除');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '清除失败';
      notify(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cookie 配置 */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-medium text-gray-800 mb-1">Cookie 配置</h2>
        <p className="text-xs text-gray-400 mb-4">
          配置浏览器 Cookie 后可绕过 YouTube 机器人验证，访问私有/受限内容
        </p>

        {/* 当前状态 */}
        <div className="bg-gray-50 rounded-lg p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={cookieStatus} />
            {cookieStatus?.source === 'browser' && (
              <span className="text-sm text-gray-600">浏览器: {cookieStatus.browser}</span>
            )}
            {cookieStatus?.source === 'file' && (
              <span className="text-sm text-gray-600">文件: {cookieStatus.fileName}</span>
            )}
            {cookieStatus?.updatedAt && (
              <span className="text-xs text-gray-400">
                更新于 {new Date(cookieStatus.updatedAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
          <button
            onClick={refreshStatus}
            className="text-xs text-primary-600 hover:underline"
          >
            刷新
          </button>
        </div>

        {/* 浏览器配置 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            方式一：从浏览器自动读取
          </label>
          <div className="flex gap-2">
            {['chrome', 'edge', 'firefox', 'brave'].map((b) => (
              <button
                key={b}
                onClick={() => handleBrowserConfig(b)}
                disabled={loading}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40 capitalize"
              >
                {b}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            yt-dlp 会直接读取浏览器本地存储的 Cookie（需关闭浏览器）
          </p>
        </div>

        {/* 文件配置 */}
        <FileUpload onUploaded={setCookieStatus} disabled={loading} />

        {/* 清除 */}
        {cookieStatus?.configured && (
          <button
            onClick={handleClear}
            disabled={loading}
            className="mt-4 px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-40"
          >
            清除 Cookie 配置
          </button>
        )}
      </section>

      {/* 下载设置（占位，Phase 5 实现） */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-medium text-gray-800 mb-1">下载设置</h2>
        <p className="text-xs text-gray-400">
          下载路径、命名规则、并发数等设置将在后续版本提供持久化配置
        </p>
        <p className="text-xs text-gray-400 mt-2">
          当前可通过 <code className="text-xs bg-gray-100 px-1 rounded">.env</code> 文件配置
        </p>
      </section>
    </div>
  );
}

/** Cookie 文件上传组件 */
function FileUpload({
  onUploaded,
  disabled,
}: {
  onUploaded: (status: CookieStatus) => void;
  disabled: boolean;
}) {
  const { notify } = useStore();
  const [content, setContent] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!content.trim()) {
      notify('请粘贴 Cookie 文件内容');
      return;
    }
    setUploading(true);
    try {
      const status = await api.setCookieFile(content);
      onUploaded(status);
      notify('Cookie 文件已上传');
      setContent('');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '上传失败';
      notify(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        方式二：粘贴 Netscape Cookie 文件内容
      </label>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	9999999999	SID	..."
        rows={4}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-400">
          使用浏览器扩展 "Get cookies.txt LOCALLY" 导出
        </p>
        <button
          onClick={handleUpload}
          disabled={disabled || uploading || !content.trim()}
          className="px-4 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-40"
        >
          {uploading ? '上传中...' : '上传'}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CookieStatus | null }) {
  if (!status || !status.configured) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
        未配置
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600">
      已配置
    </span>
  );
}
