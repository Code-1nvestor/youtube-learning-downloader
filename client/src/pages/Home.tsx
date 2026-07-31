/**
 * Home.tsx - 首页
 *
 * 用户流程：输入 URL → 解析 → 选择视频 → 配置下载 → 提交
 *
 * 三种解析结果：
 * - 单视频：直接显示下载配置
 * - 播放列表/频道：显示视频列表 + 多选 + 批量下载配置
 * - 搜索：同播放列表
 */

import { useState, useCallback } from 'react';
import {
  api,
  ApiError,
  type ResolveResult,
  type CreateDownloadTaskInput,
  type SubtitlePreview,
} from '../api';
import { useStore } from '../store';
import { buildActualFormatChoices, buildPresetFormatSelector } from '../utils/formats';
import { buildSubtitleFileName, parseSubtitleLanguages } from '../utils/subtitles';
import { getErrorGuidance } from '../utils/error-actions';

export function Home() {
  const { resolveResult, resolving, error, setResolving, setResolveResult, setError, setView, openSettings, notify } =
    useStore();
  const [url, setUrl] = useState('');

  const handleResolve = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setResolving(true);
    setError(null);
    try {
      const result = await api.resolve(trimmed);
      setResolveResult(result);
    } catch (e) {
      setError(e instanceof ApiError
        ? { code: e.code, message: e.message }
        : { code: 'UNKNOWN', message: '解析失败，请检查网络或 URL' });
      setResolveResult(null);
    }
  }, [url, setResolving, setError, setResolveResult]);

  return (
    <div className="space-y-6">
      {/* URL 输入 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          YouTube 链接或搜索关键词
        </label>
        <div className="flex gap-3">
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴视频/播放列表 URL，或输入搜索关键词..."
            rows={2}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleResolve();
              }
            }}
          />
          <button
            onClick={handleResolve}
            disabled={resolving || !url.trim()}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {resolving ? '解析中...' : '解析'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          支持：视频 URL / 播放列表 URL / 频道 URL / 关键词搜索
        </p>
      </div>

      {/* 错误提示 */}
      {error && (
        <ActionableError
          code={error.code}
          message={error.message}
          onOpenSettings={(target) => openSettings(target)}
        />
      )}

      {/* 解析结果 */}
      {resolveResult && <ResolveResultView result={resolveResult} onDownloaded={() => {
        notify('已加入下载队列');
        setView('queue');
      }} />}
    </div>
  );
}

function ActionableError({
  code,
  message,
  onOpenSettings,
}: {
  code: string;
  message: string;
  onOpenSettings: (target: NonNullable<ReturnType<typeof getErrorGuidance>['settingsTarget']>) => void;
}) {
  const action = getErrorGuidance(code);

  return (
    <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-400">
      <p className="font-medium">{message}</p>
      <p className="mt-1 text-xs">{action.guidance}</p>
      {action.settingsLabel && (
        <button
          type="button"
          onClick={() => action.settingsTarget && onOpenSettings(action.settingsTarget)}
          className="mt-3 px-3 py-1.5 rounded-md bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800 text-xs hover:bg-red-100 dark:hover:bg-red-950"
        >
          {action.settingsLabel}
        </button>
      )}
    </div>
  );
}

function ResolveResultView({
  result,
  onDownloaded,
}: {
  result: ResolveResult;
  onDownloaded: () => void;
}) {
  if (result.kind === 'video' && result.videos.length === 1) {
    return <SingleVideoDownload key={result.videos[0].id} video={result.videos[0]} onDownloaded={onDownloaded} />;
  }
  return <MultiVideoDownload title={result.title} videos={result.videos} onDownloaded={onDownloaded} />;
}

/** 单视频下载配置 */
function SingleVideoDownload({
  video,
  onDownloaded,
}: {
  video: ResolveResult['videos'][number];
  onDownloaded: () => void;
}) {
  const [container, setContainer] = useState('mp4');
  const [quality, setQuality] = useState('720p');
  const actualFormatChoices = buildActualFormatChoices(video.formats);
  const [formatMode, setFormatMode] = useState<'preset' | 'actual'>('preset');
  const [actualFormatId, setActualFormatId] = useState(actualFormatChoices[0]?.formatId ?? '');
  const [subtitleMode, setSubtitleMode] = useState<'none' | 'embed' | 'separate'>('none');
  const [subtitleLangs, setSubtitleLangs] = useState('zh-Hans,en');
  const [autoSubtitle, setAutoSubtitle] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { notify } = useStore();
  const selectedActualFormat = actualFormatChoices.find((choice) => choice.formatId === actualFormatId);

  const handleDownload = async () => {
    if (formatMode === 'actual' && !selectedActualFormat) {
      notify('当前视频没有可用的实际格式，请改用预设模式');
      return;
    }
    setSubmitting(true);
    try {
      const outputContainer = formatMode === 'actual'
        ? selectedActualFormat!.outputContainer
        : container;
      const formatId = formatMode === 'actual'
        ? selectedActualFormat!.selector
        : buildPresetFormatSelector(quality, container);
      const task: CreateDownloadTaskInput = {
        videoId: video.id,
        title: video.title,
        ...(video.playlistTitle ? { playlistTitle: video.playlistTitle } : {}),
        ...(video.playlistIndex ? { playlistIndex: video.playlistIndex } : {}),
        container: outputContainer,
        formatId,
        ...(selectedActualFormat?.format.filesize
          ? { estimatedBytes: selectedActualFormat.format.filesize }
          : {}),
        subtitleLangs: parseSubtitleLanguages(subtitleMode, subtitleLangs),
        subtitleMode,
        autoSubtitle: subtitleMode !== 'none' && autoSubtitle,
      };
      await api.createDownload([task]);
      onDownloaded();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '创建下载任务失败';
      notify(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
      <VideoCard video={video} />

      <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-gray-800">
        <div className="grid grid-cols-2 gap-4">
          <Field label="格式选择方式">
            <select
              value={formatMode}
              onChange={(e) => setFormatMode(e.target.value as 'preset' | 'actual')}
              className="select"
            >
              <option value="preset">推荐预设</option>
              <option value="actual" disabled={actualFormatChoices.length === 0}>
                实际可用格式 ({actualFormatChoices.length})
              </option>
            </select>
          </Field>
          {formatMode === 'preset' ? (
            <Field label="输出格式">
              <select value={container} onChange={(e) => setContainer(e.target.value)} className="select">
                <option value="mp4">MP4 视频</option>
                <option value="webm">WebM 视频</option>
                <option value="mp3">MP3 音频</option>
                <option value="m4a">M4A 音频</option>
              </select>
            </Field>
          ) : (
            <Field label="自动输出容器">
              <input
                className="input bg-gray-50 dark:bg-gray-700"
                value={selectedActualFormat?.outputContainer.toUpperCase() ?? '不可用'}
                readOnly
              />
            </Field>
          )}
        </div>

        {formatMode === 'preset' ? (
          container === 'mp3' || container === 'm4a' ? (
            <Field label="音质预设">
              <input className="input bg-gray-50 dark:bg-gray-700" value="最佳可用音频" readOnly />
            </Field>
          ) : (
            <Field label="画质预设">
              <select value={quality} onChange={(e) => setQuality(e.target.value)} className="select">
                <option value="highest">最高</option>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>
            </Field>
          )
        ) : (
          <Field label="实际可用格式">
            <select
              value={actualFormatId}
              onChange={(e) => setActualFormatId(e.target.value)}
              className="select"
            >
              {actualFormatChoices.map((choice) => (
                <option key={choice.formatId} value={choice.formatId}>{choice.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              “视频 + 自动配音频”表示所选画面轨道没有声音，下载时会自动合并最佳音频。
            </p>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
        <Field label="字幕模式">
          <select
            value={subtitleMode}
            onChange={(e) => setSubtitleMode(e.target.value as 'none' | 'embed' | 'separate')}
            className="select"
          >
            <option value="none">不下载字幕</option>
            <option value="embed">嵌入视频</option>
            <option value="separate">外挂 SRT</option>
          </select>
        </Field>
        <Field label="字幕语言">
          <input
            type="text"
            value={subtitleLangs}
            onChange={(e) => setSubtitleLangs(e.target.value)}
            disabled={subtitleMode === 'none'}
            placeholder="zh-Hans,en"
            className="input disabled:bg-gray-100 dark:disabled:bg-gray-700 dark:bg-gray-700"
          />
        </Field>
        </div>
        {subtitleMode !== 'none' && (
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={autoSubtitle}
              onChange={(e) => setAutoSubtitle(e.target.checked)}
              className="accent-primary-600"
            />
            没有人工字幕时，也尝试下载自动生成字幕
          </label>
        )}
      </div>

      <button
        onClick={handleDownload}
        disabled={submitting}
        className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-40"
      >
        {submitting ? '提交中...' : '下载'}
      </button>

      <SubtitleTools key={video.id} video={video} />
    </div>
  );
}

function SubtitleTools({ video }: { video: ResolveResult['videos'][number] }) {
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0);
  const [preview, setPreview] = useState<SubtitlePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { notify } = useStore();
  const track = video.subtitles[selectedTrackIndex];
  const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

  const handlePreview = async () => {
    if (!track) return;
    setPreviewing(true);
    try {
      setPreview(await api.previewSubtitle(
        videoUrl,
        track.language,
        track.isAutoGenerated,
        8,
      ));
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '字幕预览失败');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubtitleDownload = async () => {
    if (!track) return;
    setDownloading(true);
    try {
      const result = await api.downloadSubtitle(
        videoUrl,
        track.language,
        track.isAutoGenerated,
      );
      if (!result.content) throw new Error('后端没有返回字幕内容');
      triggerTextDownload(
        result.content,
        buildSubtitleFileName(video.title, track.language),
      );
      notify(`字幕已生成，共 ${result.cueCount} 条`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '字幕下载失败');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">字幕工具</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          可先预览字幕内容，也可只下载 SRT，不必下载视频。
        </p>
      </div>

      {!track ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
          当前视频没有可用字幕轨道。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-end">
            <Field label={`字幕轨道 (${video.subtitles.length})`}>
              <select
                value={selectedTrackIndex}
                onChange={(event) => {
                  setSelectedTrackIndex(Number(event.target.value));
                  setPreview(null);
                }}
                className="select"
              >
                {video.subtitles.map((subtitle, index) => (
                  <option
                    key={`${subtitle.language}-${subtitle.isAutoGenerated ? 'auto' : 'manual'}`}
                    value={index}
                  >
                    {subtitle.name} ({subtitle.language}) · {subtitle.isAutoGenerated ? '自动生成' : '人工字幕'}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || downloading}
              className="px-4 py-2 border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 rounded-lg text-sm hover:bg-primary-50 dark:hover:bg-primary-950/30 disabled:opacity-40"
            >
              {previewing ? '预览中...' : '预览'}
            </button>
            <button
              type="button"
              onClick={handleSubtitleDownload}
              disabled={previewing || downloading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-40"
            >
              {downloading ? '生成中...' : '下载 SRT'}
            </button>
          </div>

          {preview && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                {preview.languageName} · 共 {preview.totalCount} 条
                {preview.truncated && ` · 当前显示前 ${preview.cues.length} 条`}
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-800 max-h-64 overflow-y-auto">
                {preview.cues.map((cue) => (
                  <div key={`${cue.index}-${cue.start}`} className="px-3 py-2 flex gap-3 text-sm">
                    <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0 pt-0.5">
                      {cue.startTimestamp}
                    </span>
                    <span className="text-gray-700 dark:text-gray-200 whitespace-pre-line">{cue.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 批量视频下载（播放列表/频道/搜索） */
function MultiVideoDownload({
  title,
  videos,
  onDownloaded,
}: {
  title: string;
  videos: ResolveResult['videos'];
  onDownloaded: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(videos.map((_, i) => i)));
  const [container, setContainer] = useState('mp4');
  const [quality, setQuality] = useState('720p');
  const [subtitleMode, setSubtitleMode] = useState<'none' | 'embed' | 'separate'>('none');
  const [subtitleLangs, setSubtitleLangs] = useState('zh-Hans,en');
  const [autoSubtitle, setAutoSubtitle] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { notify } = useStore();

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === videos.length ? new Set() : new Set(videos.map((_, i) => i))));
  };

  const handleBatchDownload = async () => {
    const tasks: CreateDownloadTaskInput[] = Array.from(selected)
      .sort((a, b) => a - b)
      .map((i) => {
        const v = videos[i]!;
        return {
          videoId: v.id,
          title: v.title,
          ...(v.playlistTitle ? { playlistTitle: v.playlistTitle } : {}),
          ...(v.playlistIndex ? { playlistIndex: v.playlistIndex } : {}),
          container,
          formatId: buildPresetFormatSelector(quality, container),
          subtitleLangs: parseSubtitleLanguages(subtitleMode, subtitleLangs),
          subtitleMode,
          autoSubtitle: subtitleMode !== 'none' && autoSubtitle,
        };
      });

    if (tasks.length === 0) return;

    setSubmitting(true);
    try {
      await api.createDownload(tasks);
      onDownloaded();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '批量下载失败';
      notify(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-gray-800 dark:text-gray-100">{title}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">共 {videos.length} 个视频</p>
        </div>
        <button
          onClick={toggleAll}
          className="text-sm text-primary-600 hover:underline"
        >
          {selected.size === videos.length ? '全部取消' : '全部选中'}
        </button>
      </div>

      {/* 视频列表 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 max-h-96 overflow-y-auto">
        {videos.map((v, i) => (
          <label
            key={v.id}
            className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900"
          >
            <input
              type="checkbox"
              checked={selected.has(i)}
              onChange={() => toggle(i)}
              className="mt-1 accent-primary-600"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                {v.playlistIndex && (
                  <span className="text-gray-400 dark:text-gray-500 mr-1">
                    {String(v.playlistIndex).padStart(2, '0')}.
                  </span>
                )}
                {v.title}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {v.channelTitle && <span>{v.channelTitle}</span>}
                {v.duration && <span> · {formatDuration(v.duration)}</span>}
              </p>
            </div>
          </label>
        ))}
      </div>

      {/* 批量配置 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="格式">
            <select value={container} onChange={(e) => setContainer(e.target.value)} className="select">
              <option value="mp4">MP4</option>
              <option value="webm">WebM</option>
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
            </select>
          </Field>
          {container === 'mp3' || container === 'm4a' ? (
            <Field label="音质">
              <input className="input bg-gray-50 dark:bg-gray-700" value="最佳可用音频" readOnly />
            </Field>
          ) : (
            <Field label="画质">
              <select value={quality} onChange={(e) => setQuality(e.target.value)} className="select">
                <option value="highest">最高</option>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>
            </Field>
          )}
          <Field label="字幕">
            <select
              value={subtitleMode}
              onChange={(e) => setSubtitleMode(e.target.value as 'none' | 'embed' | 'separate')}
              className="select"
            >
              <option value="none">不下载</option>
              <option value="embed">嵌入</option>
              <option value="separate">外挂</option>
            </select>
          </Field>
          <Field label="字幕语言">
            <input
              type="text"
              value={subtitleLangs}
              onChange={(e) => setSubtitleLangs(e.target.value)}
              disabled={subtitleMode === 'none'}
              placeholder="zh-Hans,en"
              className="input disabled:bg-gray-100 dark:disabled:bg-gray-700 dark:bg-gray-700"
            />
          </Field>
        </div>
        {subtitleMode !== 'none' && (
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={autoSubtitle}
              onChange={(event) => setAutoSubtitle(event.target.checked)}
              className="accent-primary-600"
            />
            没有人工字幕时，也尝试下载自动生成字幕
          </label>
        )}
        <button
          onClick={handleBatchDownload}
          disabled={submitting || selected.size === 0}
          className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-40"
        >
          {submitting ? '提交中...' : `下载选中 (${selected.size})`}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 通用组件
// ==========================================

function VideoCard({ video }: { video: ResolveResult['videos'][number] }) {
  const thumb = video.thumbnails.find((t) => t.width && t.width >= 320) ?? video.thumbnails[0];
  return (
    <div className="flex gap-4">
      {thumb && (
        <img
          src={thumb.url}
          alt={video.title}
          className="w-32 h-20 object-cover rounded-lg flex-shrink-0 bg-gray-100 dark:bg-gray-700"
        />
      )}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100 line-clamp-2">{video.title}</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {video.channelTitle && <span>{video.channelTitle}</span>}
          {video.duration && <span> · {formatDuration(video.duration)}</span>}
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ==========================================
// 工具
// ==========================================

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function triggerTextDownload(content: string, fileName: string): void {
  const objectUrl = URL.createObjectURL(new Blob([`\uFEFF${content}`], {
    type: 'application/x-subrip;charset=utf-8',
  }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
