# ContextLedger demo video

This editable Remotion project uses screen footage captured from the real ContextLedger browser interface and published n8n canvases. Northstar Labs, its source feeds, and identities are synthetic. The footage shows actual workflow executions and browser interactions. The export has English captions and AI-generated narration.

- [90-second MP4](https://github.com/lmrnc/contextledger/releases/download/v1.0.0/ContextLedger_Demo_90s.mp4)
- [English SRT](ContextLedger_Demo_90s.srt) and [timed narration script](NARRATION.md)
- [Editable narration track](public/demo-narration.wav)
- [1920 × 1080 thumbnail](ContextLedger_Thumbnail.png)
- [Application sharing description](SHARE.md) and [capture responses](CAPTURE-EVIDENCE.json)
- [Export verification](VERIFICATION.json) and [browser playback check](PLAYBACK.json)

Production used the official [Remotion Agent Skills](https://github.com/remotion-dev/skills/tree/a2824c67f8b4585c294a8101db9f0ad3c643f8) and Remotion 4.0.541.

The final MP4 decodes all 2,700 frames, plays to 90.000 seconds in Edge, and retains the original encoded video frames. Its AAC track has speech in all 18 caption intervals, and the SRT matches the burned-in caption timeline. [Browser playback check](PLAYBACK.json) · [Export verification](VERIFICATION.json)

The English narration was generated locally using the built-in `af_heart` voice. The included WAV makes the narration editable and removes the need for a speech model or API key when rendering. [Kokoro-82M v1.0 model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)

## Edit and render

Use Node.js 24. Run the commands below from this folder.

```powershell
npm.cmd ci
npm.cmd run studio
npm.cmd run render
npm.cmd run thumbnail
```

Each shot has its own named sequence in `src/Demo.tsx`. The linked captions in `src/captions.json` use scene-relative timings. After editing captions, run `npm.cmd run captions` to regenerate both the SRT and narration script. The footage in `public/footage/` is included, so editing and rendering do not require starting ContextLedger.

If the Remotion browser mirror times out, run `npm.cmd run render:google` to export both deliverables. It uses Remotion's renderer and the same tested Chromium version from Google's official CDN. This route produced the supplied MP4 and thumbnail.

Run `npm.cmd run verify` after rendering. To verify the release asset, download it as `ContextLedger_Demo_90s.mp4` into this directory.

## Add your voice

Mute the MP4 and record your voice with the [timed script](NARRATION.md). Export a WAV starting at 00:00 and save it as `public/narration.wav`. Create `voice-props.json` in the video folder using the content below.

```json
{"narrationFile":"narration.wav","captions":true}
```

Render the voiced version to a separate file.

```powershell
npm.cmd run render:google -- --props=voice-props.json
```

Play back the voiced render and adjust scene-relative caption times if the reading pace differs from the guide. To upload soft captions on a video platform, render with `"captions":false` and upload the SRT separately. The closing line is part of the visual end card.

## Re-record live footage

Start ContextLedger in a fresh run directory with a fresh n8n editor profile. The recording script seeds the synthetic dataset, creates a local editor account, and performs the browser approvals and queries. It starts each screen capture after sign-in, so the recording contains no token entry. It requires Playwright available in the ContextLedger dependency directory and Edge on Windows. On other systems, set `CONTEXTLEDGER_BROWSER` to a Chromium browser executable.

Run these commands in the first terminal from the ContextLedger root.

```powershell
$env:CONTEXTLEDGER_RUN_DIR = '.runtime/video-take-2'
$env:CONTEXTLEDGER_N8N_PORT = '5722'
$env:CONTEXTLEDGER_UI_PORT = '5724'
npm.cmd start
```

Once **ContextLedger ready** appears, set the same environment variables in a second terminal at the root and run `node video/scripts/record.mjs`. The script writes new footage and capture responses. To update the thumbnail’s source after a new take, run `npm.cmd run thumbnail-source` from the video folder, then render the thumbnail again.
