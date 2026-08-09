# Bundled external tools

For a Windows release, place these files in this directory:

- `yt-dlp.exe`
- `deno.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

Development falls back to commands with the same names on `PATH` when these files
are not present. The repository intentionally does not include binary files.

Recommended sources:

- yt-dlp: `https://github.com/yt-dlp/yt-dlp/releases/latest`
- Deno: `https://github.com/denoland/deno/releases/latest`
- FFmpeg Win64 GPL build: `https://github.com/BtbN/FFmpeg-Builds/releases/latest`

Release preparation must verify each download against the checksum file published
with the corresponding release.

Current Deno release resource:

- Version: `2.9.5` (`x86_64-pc-windows-msvc`)
- Official archive SHA-256: `171EFAB55AC6B9881FD53EE4C20F8BF3BB1340FFC618483746909014DB12216A`
- Extracted `deno.exe` SHA-256: `98F8C2A2D470E4CCB04C935C86FF8050817D877762AEC5EAEEB9E409CCB3B9FD`

yt-dlp uses this runtime for YouTube EJS challenge solving. The official yt-dlp
executable already includes the EJS scripts, so the app does not enable remote
component downloads at runtime.
