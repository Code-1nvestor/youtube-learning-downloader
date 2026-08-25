# Changelog

## 0.25.0 - 2026-08-25

- Public YouTube videos use anonymous `mweb` + PO Token when the local Provider is healthy.
- Cookies are an on-demand fallback for content that actually requires an account.
- Resolve, download and subtitle requests persist and reuse the same access profile.
- Video presets resolve to a concrete video format ID; download retries cannot silently choose a lower video stream.
- Playlist tasks load per-video formats before enqueueing, so each item receives its own locked format ID.
- 4K/8K WebM sources can be transcoded to MP4 without first selecting a lower MP4 stream.
- yt-dlp, EJS and the PO Token Provider have separate update boundaries. Provider preparation verifies a pinned Git commit and plugin SHA-256 before atomic activation.

## Withdrawn 0.24.x line

- `0.24.0` through `0.24.2` were Cookie/dedicated-login experiments and were withdrawn because the authenticated YouTube client could expose fewer formats, including loss of 4K choices.
- `0.24.3` was an unshipped source prototype for anonymous-first behavior; it was never promoted as a release.
- `0.23.2` remains the installed rollback baseline until 0.25.0 passes packaged real-download acceptance.
