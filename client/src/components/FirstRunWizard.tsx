import { useEffect, useState } from 'react';
import {
  api,
  type AppSettingsStatus,
  type ConnectivityStatus,
  type CookieStatus,
  type HealthStatus,
} from '../api';
import type { SettingsTarget } from '../store';
import { connectivitySettingsTarget } from '../utils/readiness';

interface ReadinessData {
  health: HealthStatus;
  settings: AppSettingsStatus;
  cookie: CookieStatus;
}

export function FirstRunWizard({
  open,
  onClose,
  onGoSettings,
}: {
  open: boolean;
  onClose: () => void;
  onGoSettings: (target?: SettingsTarget) => void;
}) {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityStatus | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [health, settings, cookie] = await Promise.all([
        api.getHealth(),
        api.getSettings(),
        api.getCookieStatus(),
      ]);
      setData({ health, settings, cookie });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '准备检查失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setConnectivity(null);
      void load();
    }
  }, [open]);

  if (!open) return null;

  const localReady = Boolean(
    data?.settings.downloadPath &&
    data.health.runtime.ytDlp.available &&
    data.health.runtime.ffmpeg.available,
  );
  const requiredReady = localReady && connectivity?.ok === true;

  const testConnection = async () => {
    setTestingConnection(true);
    setLoadError(null);
    try {
      setConnectivity(await api.testConnectivity());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'YouTube 连接测试失败');
    } finally {
      setTestingConnection(false);
    }
  };

  const finish = () => {
    localStorage.setItem('yld:first-run-complete:v1', '1');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
      <section className="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-primary-600 dark:text-primary-400">首次使用准备</p>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">开始第一次下载前，先检查 5 项</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              本机项目正常后，再主动测试一次 YouTube；测试只解析官方测试视频，不会下载文件。
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="关闭准备向导">✕</button>
        </div>

        {loading && <p className="py-8 text-center text-sm text-gray-500">正在检查本机环境…</p>}
        {loadError && (
          <div className="mt-5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-600 dark:text-red-400">
            {loadError}
          </div>
        )}
        {data && !loading && (
          <div className="mt-5 space-y-2">
            <ReadinessRow ready={Boolean(data.settings.downloadPath)} title="下载目录" detail={data.settings.downloadPath} />
            <ReadinessRow ready={data.health.runtime.ytDlp.available} title="yt-dlp 下载核心" detail={data.health.runtime.ytDlp.version ?? data.health.runtime.ytDlp.message ?? '不可用'} />
            <ReadinessRow ready={data.health.runtime.ffmpeg.available} title="ffmpeg 音视频处理" detail={data.health.runtime.ffmpeg.version ?? data.health.runtime.ffmpeg.message ?? '不可用'} />
            <ReadinessRow
              ready={connectivity?.ok === true}
              pending={!connectivity}
              title="YouTube 连接"
              detail={connectivity
                ? `${connectivity.message}${connectivity.recommendation ? `；${connectivity.recommendation}` : ''}`
                : '尚未测试；点击下方按钮后只做解析，不下载媒体'}
            />
            <ReadinessRow
              ready={data.cookie.configured}
              optional={connectivity?.code !== 'RATE_LIMITED'}
              title="YouTube Cookie"
              detail={data.cookie.configured
                ? '已配置；若测试仍失败，可能需要重新导入或关闭对应浏览器'
                : connectivity?.code === 'RATE_LIMITED'
                  ? '当前网络必须配置 Cookie 才能通过 YouTube 验证'
                  : '暂未配置；仅在 YouTube 要求人机验证时需要'}
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">稍后再说</button>
          <button type="button" onClick={() => void load()} disabled={loading} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40">重新检查</button>
          {!localReady && (
            <button type="button" onClick={() => onGoSettings('runtime')} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">前往设置</button>
          )}
          {localReady && !connectivity && (
            <button type="button" onClick={() => void testConnection()} disabled={testingConnection} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40">
              {testingConnection ? '正在测试…' : '测试 YouTube 连接'}
            </button>
          )}
          {localReady && connectivity && !connectivity.ok && (
            <>
              <button type="button" onClick={() => void testConnection()} disabled={testingConnection} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40">
                {testingConnection ? '正在测试…' : '重新测试连接'}
              </button>
              <button type="button" onClick={() => onGoSettings(connectivitySettingsTarget(connectivity.code))} disabled={testingConnection} className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40">
                按建议处理
              </button>
            </>
          )}
          {requiredReady && (
            <button type="button" onClick={finish} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">准备好了，开始使用</button>
          )}
        </div>
      </section>
    </div>
  );
}

function ReadinessRow({
  ready,
  optional = false,
  pending = false,
  title,
  detail,
}: {
  ready: boolean;
  optional?: boolean;
  pending?: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 flex items-start gap-3">
      <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs ${ready ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400' : pending ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300' : optional ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400'}`}>
        {ready ? '✓' : pending ? '…' : optional ? '!' : '×'}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{title}</p>
          {optional && !pending && <span className="text-[11px] text-gray-400">按需配置</span>}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">{detail}</p>
      </div>
    </div>
  );
}
