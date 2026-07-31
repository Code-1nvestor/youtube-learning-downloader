/**
 * Settings.tsx - 设置页
 *
 * 功能：
 * - 主题切换（亮色/暗色/跟随系统）
 * - Cookie 配置（解除 YouTube 机器人验证）
 * - 下载设置（环境变量配置说明）
 */

import { useState, useEffect } from 'react';
import {
  api,
  ApiError,
  type AppSettingsStatus,
  type CookieStatus,
  type HealthStatus,
} from '../api';
import { useStore } from '../store';
import { useTheme, type ThemeMode } from '../hooks/useTheme';

export function Settings() {
  const { cookieStatus, setCookieStatus, notify } = useStore();
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  // 初始加载 Cookie 状态
  useEffect(() => {
    api.getCookieStatus().then(setCookieStatus).catch(() => {});
    api.getHealth().then(setHealth).catch(() => {});
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
      {/* 主题设置 */}
      <ThemeSection />

      <DownloadSettingsSection />

      <RuntimeSection health={health} />

      {/* Cookie 配置 */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-base font-medium text-gray-800 dark:text-gray-100 mb-1">Cookie 配置</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
          配置浏览器 Cookie 后可绕过 YouTube 机器人验证，访问私有/受限内容
        </p>

        {/* 当前状态 */}
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={cookieStatus} />
            {cookieStatus?.source === 'browser' && (
              <span className="text-sm text-gray-600 dark:text-gray-400">浏览器: {cookieStatus.browser}</span>
            )}
            {cookieStatus?.source === 'file' && (
              <span className="text-sm text-gray-600 dark:text-gray-400">文件: {cookieStatus.fileName}</span>
            )}
            {cookieStatus?.updatedAt && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
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
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            方式一：从浏览器自动读取
          </label>
          <div className="flex gap-2">
            {['chrome', 'edge', 'firefox', 'brave'].map((b) => (
              <button
                key={b}
                onClick={() => handleBrowserConfig(b)}
                disabled={loading}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 disabled:opacity-40 capitalize"
              >
                {b}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
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
            className="mt-4 px-4 py-2 border border-red-300 text-red-600 dark:text-red-400 rounded-lg text-sm hover:bg-red-50 dark:bg-red-950/40 dark:hover:bg-red-950/40 disabled:opacity-40"
          >
            清除 Cookie 配置
          </button>
        )}
      </section>

    </div>
  );
}

function DownloadSettingsSection() {
  const { notify } = useStore();
  const [settings, setSettings] = useState<AppSettingsStatus | null>(null);
  const [downloadPath, setDownloadPath] = useState('');
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [namingTemplate, setNamingTemplate] = useState('{course}/{date}_{num}_{title}.{ext}');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setDownloadPath(value.downloadPath);
        setMaxConcurrent(value.maxConcurrent);
        setNamingTemplate(value.namingTemplate);
      })
      .catch((error) => {
        if (!cancelled) notify(error instanceof ApiError ? error.message : '读取下载设置失败');
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const chooseDirectory = async () => {
    const selected = await window.desktop?.selectDirectory();
    if (selected) setDownloadPath(selected);
  };

  const save = async () => {
    setSaving(true);
    try {
      const value = await api.updateSettings({
        downloadPath: downloadPath.trim(),
        maxConcurrent,
        namingTemplate: namingTemplate.trim(),
      });
      setSettings(value);
      setDownloadPath(value.downloadPath);
      setMaxConcurrent(value.maxConcurrent);
      setNamingTemplate(value.namingTemplate);
      notify(value.persistent ? '下载设置已保存' : '设置已应用，但数据库不可用，重启后会恢复默认值');
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '下载设置保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-medium text-gray-800 dark:text-gray-100 mb-1">下载设置</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            保存后立即用于新加入的任务，正在下载的任务不会被中断。
          </p>
        </div>
        {settings && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            settings.persistent
              ? 'bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
          }`}>
            {settings.persistent ? '已持久化' : '仅本次运行'}
          </span>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            下载目录
          </label>
          <div className="flex gap-2">
            <input
              value={downloadPath}
              onChange={(event) => setDownloadPath(event.target.value)}
              placeholder="例如：D:\\学习资料"
              className="min-w-0 flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {window.desktop && (
              <button
                type="button"
                onClick={chooseDirectory}
                className="shrink-0 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                浏览…
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">目录不存在时会自动创建。</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              同时下载数量
            </label>
            <select
              value={maxConcurrent}
              onChange={(event) => setMaxConcurrent(Number(event.target.value))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              文件命名规则
            </label>
            <input
              value={namingTemplate}
              onChange={(event) => setNamingTemplate(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              可用变量：{'{course}'} {'{date}'} {'{num}'} {'{title}'} {'{quality}'} {'{ext}'}；必须包含 {'{title}'} 和 {'{ext}'}。
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving || !settings || !downloadPath.trim() || !namingTemplate.trim()}
            className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存下载设置'}
          </button>
        </div>
      </div>
    </section>
  );
}

function RuntimeSection({ health }: { health: HealthStatus | null }) {
  const tools = [
    { name: 'yt-dlp', status: health?.runtime.ytDlp },
    { name: 'ffmpeg', status: health?.runtime.ffmpeg },
  ];

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-base font-medium text-gray-800 dark:text-gray-100 mb-1">运行环境</h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        下载器启动时会自动检查必要工具。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tools.map(({ name, status }) => (
          <div
            key={name}
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{name}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  status?.available
                    ? 'bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400'
                    : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                }`}
              >
                {status?.available ? '可用' : health ? '不可用' : '检查中'}
              </span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 break-all">
              {status?.version ?? status?.message ?? '正在读取状态…'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 主题设置区域 */
function ThemeSection() {
  const { mode, setThemeMode } = useTheme();

  const options: { value: ThemeMode; label: string; icon: string; desc: string }[] = [
    { value: 'light', label: '亮色', icon: '☀️', desc: '始终使用亮色主题' },
    { value: 'dark', label: '暗色', icon: '🌙', desc: '始终使用暗色主题' },
    { value: 'system', label: '跟随系统', icon: '🖥️', desc: '根据系统设置自动切换' },
  ];

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-base font-medium text-gray-800 dark:text-gray-100 mb-1">主题外观</h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        选择应用的主题外观，设置会自动保存
      </p>
      <div className="grid grid-cols-3 gap-3">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setThemeMode(opt.value)}
            className={`p-4 rounded-lg border text-center transition-colors ${
              mode === opt.value
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-600/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div className="text-2xl mb-1">{opt.icon}</div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{opt.label}</div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{opt.desc}</div>
          </button>
        ))}
      </div>
    </section>
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
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        方式二：粘贴 Netscape Cookie 文件内容
      </label>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	9999999999	SID	..."
        rows={4}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-400 dark:text-gray-500">
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
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
        未配置
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400">
      已配置
    </span>
  );
}
