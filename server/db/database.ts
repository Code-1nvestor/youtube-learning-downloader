/**
 * db/database.ts - SQLite 数据库连接与 Schema 管理
 *
 * 使用 Node 22 内置的 node:sqlite（零原生依赖，无需 node-gyp 编译）。
 * 仅需在启动时加 --experimental-sqlite 标志。
 *
 * 设计要点：
 * - WAL 模式：并发读不阻塞写，适合"下载进度写 + 前端轮询读"场景
 * - 单例：整个进程共享一个 DatabaseSync 实例（同步 API，线程安全由 SQLite 保证）
 * - 预编译语句：在 init 时 prepare，避免每次查询重复解析 SQL
 * - Schema 版本化：用 PRAGMA user_version 跟踪迁移进度
 *
 * 表结构：
 * - download_tasks：所有下载任务的完整快照（包括历史）
 * - app_settings：键值对存储应用设置（Phase 6 扩展使用）
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** 当前 Schema 版本 */
const SCHEMA_VERSION = 1;

/** 预编译语句句柄（init 后填充） */
export interface PreparedStatements {
  upsertTask: ReturnType<DatabaseSync['prepare']>;
  getTaskById: ReturnType<DatabaseSync['prepare']>;
  getActiveTasks: ReturnType<DatabaseSync['prepare']>;
  getHistory: ReturnType<DatabaseSync['prepare']>;
  deleteTask: ReturnType<DatabaseSync['prepare']>;
  clearHistory: ReturnType<DatabaseSync['prepare']>;
  getHistoryCount: ReturnType<DatabaseSync['prepare']>;
}

/** 数据库上下文：连接 + 预编译语句 */
export interface DbContext {
  db: DatabaseSync;
  stmts: PreparedStatements;
  /** 关闭数据库（优雅退出时调用） */
  close: () => void;
}

/**
 * 初始化数据库：创建目录、打开连接、建表、预编译语句。
 *
 * @param dbPath 数据库文件绝对路径
 * @returns DbContext 上下文
 */
export function initDatabase(dbPath: string): DbContext {
  // 确保目录存在
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // 开启 WAL：写不阻塞读，崩溃恢复更可靠
  db.exec('PRAGMA journal_mode = WAL');
  // NORMAL 模式：性能与可靠性平衡（WAL 下不会损坏，最多丢失最后一次未提交事务）
  db.exec('PRAGMA synchronous = NORMAL');
  // 外键约束
  db.exec('PRAGMA foreign_keys = ON');

  // Schema 迁移
  migrate(db);

  // 预编译语句（命名参数用 $ 前缀，positional 用 ?）
  const stmts: PreparedStatements = {
    upsertTask: db.prepare(`
      INSERT INTO download_tasks (
        id, video_id, title, playlist_title, playlist_index,
        format_id, container, output_path,
        subtitle_langs, subtitle_mode, auto_subtitle,
        status, progress, speed, eta,
        downloaded_bytes, total_bytes, error,
        created_at, completed_at, updated_at
      ) VALUES (
        $id, $video_id, $title, $playlist_title, $playlist_index,
        $format_id, $container, $output_path,
        $subtitle_langs, $subtitle_mode, $auto_subtitle,
        $status, $progress, $speed, $eta,
        $downloaded_bytes, $total_bytes, $error,
        $created_at, $completed_at, $updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = $status,
        progress = $progress,
        speed = $speed,
        eta = $eta,
        downloaded_bytes = $downloaded_bytes,
        total_bytes = $total_bytes,
        error = $error,
        completed_at = $completed_at,
        updated_at = $updated_at
    `),

    getTaskById: db.prepare('SELECT * FROM download_tasks WHERE id = ?'),

    getActiveTasks: db.prepare(`
      SELECT * FROM download_tasks
      WHERE status IN ('queued', 'downloading', 'paused')
      ORDER BY created_at ASC
    `),

    getHistory: db.prepare(`
      SELECT * FROM download_tasks
      WHERE status IN ('completed', 'failed', 'cancelled')
      ORDER BY completed_at DESC, created_at DESC
      LIMIT ? OFFSET ?
    `),

    deleteTask: db.prepare('DELETE FROM download_tasks WHERE id = ?'),

    clearHistory: db.prepare(`
      DELETE FROM download_tasks
      WHERE status IN ('completed', 'failed', 'cancelled')
    `),

    getHistoryCount: db.prepare(`
      SELECT COUNT(*) as count FROM download_tasks
      WHERE status IN ('completed', 'failed', 'cancelled')
    `),
  };

  return {
    db,
    stmts,
    close: () => {
      try {
        db.close();
      } catch {
        // 忽略关闭错误（可能已关闭）
      }
    },
  };
}

// ------------------------------------------
// Schema 迁移
// ------------------------------------------

function migrate(db: DatabaseSync): void {
  const current = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const version = current?.user_version ?? 0;

  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS download_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        playlist_title TEXT,
        playlist_index INTEGER,
        format_id TEXT NOT NULL,
        container TEXT NOT NULL,
        output_path TEXT NOT NULL,
        subtitle_langs TEXT NOT NULL DEFAULT '[]',
        subtitle_mode TEXT NOT NULL DEFAULT 'none',
        auto_subtitle INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        speed TEXT NOT NULL DEFAULT '',
        eta TEXT NOT NULL DEFAULT '',
        downloaded_bytes INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );

      -- 常用查询索引
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON download_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON download_tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_completed ON download_tasks(completed_at);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  // 未来迁移在此追加 if (version < 2) { ... }

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
