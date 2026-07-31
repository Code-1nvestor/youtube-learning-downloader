# YouTube 学习资料下载器

> 仅用于个人学习。请只下载自己有权访问的内容，并遵守版权规则和 YouTube 服务条款。

这是一个面向课程和播放列表整理的本地下载工具。前端使用 React，后端使用
Express + yt-dlp，下载记录保存在 SQLite；当前正在补齐 Windows Electron
桌面版交付。

## 已实现

- 视频、播放列表、频道和搜索解析
- 单个或批量加入下载队列
- 下载进度、暂停、恢复、取消和失败重试
- 画质、容器、字幕和命名模板
- Cookie 文件或浏览器 Cookie 导入
- 字幕预览与单独下载
- SQLite 队列恢复和下载历史
- 下载目录、并发数和命名规则持久化设置
- PWA、亮色/暗色/跟随系统主题
- Windows 桌面启动、内置工具自检和安装包配置

## 环境要求

- Node.js 22.12 或更高版本
- 开发环境可使用系统 `yt-dlp` / `ffmpeg`
- 桌面发布需要把 `yt-dlp.exe`、`ffmpeg.exe`、`ffprobe.exe` 放入
  `resources/bin`

## 第一次运行

以下命令会从 npm 下载依赖并在项目目录创建 `node_modules`。如果网络使用代理，
需先保证 npm 能联网。

```powershell
# 1. 安装后端和桌面依赖
npm install

# 2. 安装前端依赖
npm --prefix client install

# 3. 启动后端
npm run dev

# 4. 另开一个 PowerShell 窗口，启动前端
npm --prefix client run dev
```

成功标志：

- 后端窗口显示 `后端已启动: http://localhost:3000`
- 浏览器打开 `http://localhost:5173`
- 设置页的运行环境区域能显示 `yt-dlp` 与 `ffmpeg` 状态

## 常用命令

```powershell
npm run typecheck     # 检查后端 TypeScript 类型
npm test              # 运行后端单元测试
npm run build         # 构建前端和后端
npm run verify        # 依次执行类型检查、测试和构建
npm run desktop:dev   # 构建后启动桌面版
npm run desktop:dist  # 生成 Windows 安装版和便携版
```

每条命令的成功标志都是进程退出码为 0，且终端没有红色错误。构建产物在 `dist`，
安装包在 `release`。

## 测试说明

`npm test` 会自动运行 `tests` 目录中的全部单元测试和本地 HTTP 集成测试。
这些测试使用临时目录和可控的模拟下载器，不访问 YouTube，也不会写入现有下载记录。

维护者还可以主动运行一次真实 YouTube 冒烟测试：

```powershell
$env:YLD_E2E_LIVE = '1'
npm run test:e2e
Remove-Item Env:YLD_E2E_LIVE
```

该命令只使用 yt-dlp 官方测试视频，并在系统临时目录中完成解析、下载、取消、历史
记录与重启恢复检查。成功标志是输出 `"ok": true`；如果返回 `RATE_LIMITED`，说明
当前网络被 YouTube 要求人机验证，应先在桌面版“设置 → Cookie 配置”中完成配置。
测试脚本不会自动读取浏览器 Cookie。

## 目录说明

```text
client/          React 前端
server/          Express API、下载队列和 SQLite
desktop/         Electron 桌面入口
resources/bin/   桌面版内置 yt-dlp / ffmpeg（不提交二进制）
scripts/         构建脚本
tests/           后端单元测试
dist/            构建产物（不提交）
release/         Windows 安装包（不提交）
```

## 配置

桌面版可在“设置 → 下载设置”中选择下载目录、并发数和命名规则，保存后立即用于
新加入的任务并写入 SQLite。降低并发数不会强行中断已经运行的下载。

开发环境也可复制 `.env.example` 为 `.env` 后按需修改默认值。该示例不包含 Cookie
或其他登录凭据。桌面版首次启动会
使用系统下载目录；如果已保存的目录暂时不可用（例如移动硬盘未连接），会安全
回退到默认目录，不影响应用启动。

更详细的产品设计和原开发计划位于：

- [`../docs/youtube-downloader-design.md`](../docs/youtube-downloader-design.md)
- [`../docs/development-plan.md`](../docs/development-plan.md)

这些设计文档是早期规划，实际源码与本 README 是当前实现的准确信息来源。
