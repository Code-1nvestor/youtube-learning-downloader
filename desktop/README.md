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

二进制文件不会提交到 Git。发布前必须按
[`resources/bin/README.md`](../resources/bin/README.md) 的说明核对来源与校验值。
发版改版本号时，需要同时更新根目录和本目录的两个 `package.json`。

当前个人版配置为不做 Windows 代码签名，因此安装时可能显示“未知发布者”或
SmartScreen 提示。正式对外分发前应配置可信代码签名证书，并移除
`win.signExecutable: false`。

## 数据位置

- 数据库、Cookie、日志：Electron 的用户数据目录
- 下载文件：系统“下载”目录下的 `YouTube Learning Downloader`
- 后端日志：用户数据目录下的 `logs/backend.log`
