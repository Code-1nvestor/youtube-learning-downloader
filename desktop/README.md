# Windows 桌面版说明

桌面壳使用 Electron，启动时会：

1. 优先监听 `127.0.0.1:47831`，端口占用时自动选择空闲端口；
2. 启动 `dist/server/index.cjs`；
3. 等待 `/api/health` 就绪；
4. 在桌面窗口中打开 `dist/client`；
5. 退出应用时终止后端及其下载子进程。

## 开发运行

先在项目根目录执行：

```powershell
npm install
npm run desktop:dev
```

成功标志：出现“学习资料下载器”桌面窗口，设置页中的 `yt-dlp` 和
`ffmpeg` 均显示“可用”。

打包会复用 `npm install` 下载到 `node_modules/electron/dist` 的锁定版本，
避免每次构建重复从 GitHub 下载 Electron。

## 生成 Windows 安装包

确认 `resources/bin` 中存在以下文件：

- `yt-dlp.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

然后执行：

```powershell
npm run desktop:dist
```

成功标志：`release` 目录中生成 NSIS 安装程序和便携版。

Windows 图标由仓库现有的 `client/public/icon.svg` 设计生成。需要重建图标时执行：

```powershell
python scripts/generate-icons.py
```

成功标志：生成 `desktop/icon.ico`、`client/public/icon-192.png` 和
`client/public/icon-512.png`。生成脚本只依赖 Pillow。

二进制文件不会提交到 Git。发布前必须按
[`resources/bin/README.md`](../resources/bin/README.md) 的说明核对来源与校验值。
发版改版本号时，需要同时更新根目录和本目录的两个 `package.json`。

当前个人版已配置自定义应用与安装器图标，但不做 Windows 代码签名，因此安装时可能显示“未知发布者”或
SmartScreen 提示。正式对外分发前应配置可信代码签名证书，并移除
`win.signExecutable: false`。

## 数据位置

- 数据库、Cookie、日志：Electron 的用户数据目录
- 用户更新后的 yt-dlp：用户数据目录下的 `tools/yt-dlp.exe`（重启后优先使用）
- 下载文件：首次使用系统“下载”目录下的 `YouTube Learning Downloader`，之后可在设置页修改
- 后端日志：用户数据目录下的 `logs/backend.log`

设置页的“浏览…”按钮通过受限 Electron IPC 只打开目录选择器，不向网页开放
Node.js 或任意文件系统访问权限。

设置页更新 yt-dlp 时，会先复制内置版本到用户数据目录，再调用 yt-dlp 官方
Nightly 自更新流程。官方更新器完成校验且新文件能返回版本号后才替换旧的用户副本；
安装目录和内置兜底版本始终不改动。
