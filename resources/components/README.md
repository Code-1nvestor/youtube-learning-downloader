# YouTube components

`youtube-components.json` is the pinned trust manifest for the PO Token Provider.
Run `npm run components:prepare` before a desktop package. The script:

1. clones only the pinned provider tag;
2. verifies the exact Git commit and release ZIP SHA-256;
3. installs dependencies from the upstream frozen lock file;
4. verifies the provider version;
5. activates the version with an atomic `active.json` pointer.

Generated `bgutil/` files are intentionally excluded from Git. They are packaged as
read-only resources and may be updated independently from the application source.
yt-dlp keeps its existing verified updater; EJS uses yt-dlp's official `ejs:npm`
remote-component fallback with the bundled Deno runtime.
