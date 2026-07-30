# Bundled external tools

For a Windows release, place these files in this directory:

- `yt-dlp.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

Development falls back to commands with the same names on `PATH` when these files
are not present. The repository intentionally does not include binary files.

Recommended sources:

- yt-dlp: `https://github.com/yt-dlp/yt-dlp/releases/latest`
- FFmpeg Win64 GPL build: `https://github.com/BtbN/FFmpeg-Builds/releases/latest`

Release preparation must verify each download against the checksum file published
with the corresponding release.
