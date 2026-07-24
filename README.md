# YouTube 学习资料下载工具（后端核心模块）

> 个人学习用途 · 非商业 · 尊重版权与 YouTube ToS

本目录是从零实现的最小可用功能单元（MVP 切片）：**URL 解析管线**。
它是整个应用的入口基础模块，后续所有功能（下载、队列、字幕、批量）都建立在其上。

## 模块地图

```
server/
├── index.ts                  # 入口：配置 → 自检 → 启动 → 优雅退出
├── app.ts                    # Express 装配：路由 + 404 + 统一错误中间件
├── config.ts                 # 零依赖 .env 加载（Node 20.12+ 内置）
├── types/
│   ├── errors.ts             # 错误码枚举 + AppError（全局唯一错误定义源）
│   ├── result.ts             # ApiResponse<T> 统一响应契约
│   └── video.ts              # 领域模型（VideoInfo/VideoFormat/SubtitleInfo...）
├── core/
│   ├── process.ts            # 通用子进程执行器（超时/输出上限/ENOENT）
│   ├── url-classifier.ts     # 查询分类：播放列表→视频→频道→搜索
│   └── yt-dlp.service.ts     # ★ 核心：yt-dlp 封装（唯一接触原始 JSON 的地方）
└── routes/
    └── resolve.ts            # GET /api/resolve
```

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 安装 yt-dlp（任选其一）
pip install -U yt-dlp          # 需要 Python
# 或从 https://github.com/yt-dlp/yt-dlp/releases 下载 yt-dlp.exe 放入 PATH

# 3. 启动
npm run dev

# 4. 验证
curl "http://localhost:3000/api/health"
curl "http://localhost:3000/api/resolve?url=https://www.youtube.com/watch?v=jNQXAC9IVRw"
curl "http://localhost:3000/api/resolve?url=https://www.youtube.com/playlist?list=PLxxxx"
```

## 协作约定（AI 同事必读）

1. **错误处理**：只 throw `AppError`（见 `types/errors.ts`），新增场景先加错误码。
2. **原始 JSON 隔离**：yt-dlp 输出只能在 `yt-dlp.service.ts` 中解析，领域模型映射集中在该文件底部的 `mapXxx` 函数。
3. **API 响应**：所有路由返回 `ApiResponse<T>`（`ok()` / `fail()`），HTTP 状态码仅作辅助。
4. **新增能力的标准姿势**（以下载为例）：
   - `buildDownloadArgs()` 构造参数 → `runProcess()` 执行 → `mapXxx()` 清洗 → 返回领域模型
   - 在 `app.ts` 的扩展位注册新路由
5. **类型检查**：提交前运行 `npm run typecheck` 必须通过。

## 架构文档

- 设计方案: `../docs/youtube-downloader-design.md`
- 开发计划: `../docs/development-plan.md`
