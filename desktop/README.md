# Windows desktop packaging preparation

The local-service pieces needed by a desktop shell are now in place:

- Production mode can serve `client/dist`.
- The API listens only on `127.0.0.1`.
- `resources/bin/yt-dlp.exe` and `resources/bin/ffmpeg.exe` are detected automatically.

An Electron or Tauri shell still needs to start the compiled backend, wait for
`/api/health`, open `http://127.0.0.1:3000`, and stop the backend and download
processes on exit. Electron dependencies and an installer are intentionally not
added until the desktop framework and dependency installation are approved.
