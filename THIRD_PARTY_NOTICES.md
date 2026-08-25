# Third-party components

The desktop package uses independently versioned open-source components:

- **yt-dlp** — upstream license and source: <https://github.com/yt-dlp/yt-dlp>
- **yt-dlp-ejs** — loaded through yt-dlp's official remote-component mechanism:
  <https://github.com/yt-dlp/ejs>
- **bgutil-ytdlp-pot-provider** — GPL-3.0-only, source and license:
  <https://github.com/Brainicism/bgutil-ytdlp-pot-provider>
- **Deno** — sandboxed runtime used for YouTube EJS:
  <https://github.com/denoland/deno>
- **FFmpeg** — media merge/transcode runtime: <https://ffmpeg.org/>

The exact Provider version, source commit and plugin SHA-256 included in a build
are recorded in `resources/components/youtube-components.json`.
