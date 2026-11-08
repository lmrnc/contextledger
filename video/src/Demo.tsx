import React from 'react';
import {Audio, Video} from '@remotion/media';
import {AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import cues from './captions.json';

const ink = '#14131b';
const paper = '#f7f4ef';
const accent = '#ff896f';
const muted = '#c1bcc9';
const font = '"Segoe UI", Arial, sans-serif';
const mono = '"Cascadia Code", Consolas, monospace';
const attribution = 'Personal portfolio prototype · Built with n8n · Synthetic demonstration data';
const frameBounds = {position: 'absolute', left: 96, top: 89, width: 1728, height: 864} as const;
type ShotName = keyof typeof cues;
type ShotProps = {name: ShotName; duration: number; section: string; title: string; captions: boolean;
  crop?: {x: number; y: number; width: number};
  zoom?: number; origin?: string; highlight?: {left: number; top: number; width: number; height: number; at: number}};

function CaptionRail({name}: {name: ShotName}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ms = frame / fps * 1000;
  const cue = cues[name].find(item => item.startMs <= ms && ms < item.endMs);
  return cue ? (
    <div style={{position: 'absolute', left: 160, right: 160, top: 960, height: 104, display: 'flex',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center', whiteSpace: 'pre-line',
      fontSize: 34, lineHeight: 1.22, fontWeight: 590, letterSpacing: -0.4}}>
      {cue.text}
    </div>
  ) : null;
}

function Shot({name, duration, section, title, captions, crop = {x: 0, y: 0, width: 1600},
  zoom = 1.025, origin = '50% 50%', highlight}: ShotProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const closing = name === 'quality-report' && frame >= 6 * fps;
  const magnification = (frameBounds.width - 2) / crop.width;
  return (
    <AbsoluteFill style={{backgroundColor: ink, color: paper, fontFamily: font}}>
      <header style={{position: 'absolute', left: 96, right: 96, top: 24, height: 46, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', fontSize: 26}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
          <span style={{width: 9, height: 31, borderRadius: 5, backgroundColor: accent}} />
          <strong style={{fontSize: 28, letterSpacing: -0.9}}>ContextLedger</strong>
          <span style={{color: muted, fontSize: 23}}>{title}</span>
        </div>
        <span style={{fontSize: 19, fontFamily: mono, color: accent, letterSpacing: 1.8}}>{section}</span>
      </header>
      <div style={{...frameBounds, overflow: 'hidden', backgroundColor: '#f8f5ee', border: '1px solid #413943',
        borderRadius: 16, boxShadow: '0 14px 38px #0d0b114d', boxSizing: 'border-box'}}>
        <div style={{position: 'relative', width: '100%', height: '100%', transformOrigin: origin,
          scale: interpolate(frame, [0, Math.max(1, fps * duration - 1)], [1, zoom], {
            extrapolateRight: 'clamp', easing: Easing.bezier(0.25, 0.1, 0.4, 1)
          })}}>
          <div style={{position: 'absolute', width: 1600, height: 800, left: -crop.x * magnification, top: -crop.y * magnification,
            scale: magnification, transformOrigin: 'top left'}}>
            <Video src={staticFile('footage/' + name + '.mp4')} muted style={{width: '100%', height: '100%', objectFit: 'fill'}} />
            {highlight && <div style={{position: 'absolute', left: highlight.left, top: highlight.top,
              width: highlight.width, height: highlight.height, boxSizing: 'border-box', borderRadius: 9,
              boxShadow: '0 0 0 2px #dc624d', opacity: interpolate(frame,
                [highlight.at * fps, highlight.at * fps + 10], [0, 0.72],
                {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}} />}
          </div>
        </div>
      </div>
      {captions && !closing && <CaptionRail name={name} />}
      {closing && <Closing />}
    </AbsoluteFill>
  );
}

function Closing() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: 'linear-gradient(90deg, #14131b 38%, #14131bf5 60%, #14131b8f 100%)',
      justifyContent: 'center', paddingLeft: 120, opacity: interpolate(frame, [6 * fps, 6 * fps + 8], [0.72, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp'
      })}}>
      <div style={{width: 66, height: 8, borderRadius: 4, backgroundColor: accent, marginBottom: 36}} />
      <div style={{fontSize: 108, letterSpacing: -6, fontWeight: 720}}>ContextLedger</div>
      <div style={{fontSize: 45, marginTop: 17, maxWidth: 960, fontWeight: 570, lineHeight: 1.18}}>
        Reliable context, governed by people,<br />accessible to AI.
      </div>
      <div style={{fontSize: 22, letterSpacing: 0.55, marginTop: 62, color: muted}}>{attribution}</div>
    </AbsoluteFill>
  );
}

type DemoProps = {narrationFile: string; captions: boolean};
export function Demo({narrationFile, captions}: DemoProps) {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: ink}}>
      <Sequence name="01 · Three sources, one escalation policy" from={0} durationInFrames={12 * fps} premountFor={fps}>
        <Shot name="problem" duration={12} section="01 / THE PROBLEM" title="One policy. Three conflicting sources."
          captions={captions} crop={{x: 205, y: 76, width: 1190}} zoom={1.01} origin="57% 50%"
          highlight={{left: 499, top: 357, width: 857, height: 116, at: 5.9}} />
      </Sequence>
      <Sequence name="02a · Ingestion canvas" from={12 * fps} durationInFrames={5 * fps} premountFor={fps}>
        <Shot name="ingestion" duration={5} section="02 / ARCHITECTURE" title="Validate source metadata" captions={captions} />
      </Sequence>
      <Sequence name="02b · Governance canvas" from={17 * fps} durationInFrames={8 * fps} premountFor={fps}>
        <Shot name="governance" duration={8} section="02 / ARCHITECTURE" title="Bind review to evidence and ownership" captions={captions} />
      </Sequence>
      <Sequence name="03 · Support owner reviews and approves" from={25 * fps} durationInFrames={20 * fps} premountFor={fps}>
        <Shot name="escalation-review" duration={20} section="03 / HUMAN REVIEW" title="Review the 24 h → 48 h change"
          captions={captions} crop={{x: 108, y: 24, width: 1384}} zoom={1.015} origin="55% 85%" />
      </Sequence>
      <Sequence name="04 · Support submits weekend coverage" from={45 * fps} durationInFrames={16 * fps} premountFor={fps}>
        <Shot name="contribution" duration={16} section="04 / CONTRIBUTOR EXPERIENCE" title="Propose a new procedure"
          captions={captions} crop={{x: 156, y: 83, width: 1288}} zoom={1.014} origin="53% 90%"
          highlight={{left: 1018, top: 420, width: 343, height: 166, at: 12.4}} />
      </Sequence>
      <Sequence name="05a · Employee query before approval" from={61 * fps} durationInFrames={5 * fps} premountFor={fps}>
        <Shot name="pending-retrieval" duration={5} section="05 / TRUSTED RETRIEVAL" title="Before approval"
          captions={captions} crop={{x: 210, y: 207, width: 1180}} zoom={1.012} origin="50% 52%" />
      </Sequence>
      <Sequence name="05b · Separate steward approves" from={66 * fps} durationInFrames={5 * fps} premountFor={fps}>
        <Shot name="steward-approval" duration={5} section="05 / TRUSTED RETRIEVAL" title="Independent steward approval"
          captions={captions} zoom={1.037} origin="55% 35%" />
      </Sequence>
      <Sequence name="05c · Same employee query after approval" from={71 * fps} durationInFrames={5 * fps} premountFor={fps}>
        <Shot name="approved-retrieval" duration={5} section="05 / TRUSTED RETRIEVAL" title="After approval"
          captions={captions} crop={{x: 210, y: 207, width: 1180}} zoom={1.012} origin="50% 52%"
          highlight={{left: 230, top: 552, width: 728, height: 81, at: 0.9}} />
      </Sequence>
      <Sequence name="05d · Restricted security query" from={76 * fps} durationInFrames={4 * fps} premountFor={fps}>
        <Shot name="restricted-retrieval" duration={4} section="05 / TRUSTED RETRIEVAL" title="Restricted knowledge"
          captions={captions} crop={{x: 210, y: 207, width: 1180}} zoom={1.012} origin="50% 52%" />
      </Sequence>
      <Sequence name="06 · Quality worklist and closing" from={80 * fps} durationInFrames={10 * fps} premountFor={fps}>
        <Shot name="quality-report" duration={10} section="06 / KNOWLEDGE HEALTH" title="Assign the follow-up work"
          captions={captions} zoom={1.023} origin="55% 55%" />
      </Sequence>
      <Sequence name="Narration · replaceable voiceover" from={0} durationInFrames={90 * fps}>
        <Audio src={staticFile(narrationFile)} />
      </Sequence>
    </AbsoluteFill>
  );
}

export const Thumbnail = () => (
  <AbsoluteFill style={{backgroundColor: ink, color: paper, fontFamily: font}}>
    <div style={{position: 'absolute', left: 104, top: 161, width: 700}}>
      <div style={{color: accent, letterSpacing: 3.1, fontFamily: mono, fontSize: 23}}>PERSONAL PORTFOLIO PROTOTYPE</div>
      <div style={{fontSize: 90, fontWeight: 750, lineHeight: 1, letterSpacing: -5, marginTop: 30}}>ContextLedger</div>
      <div style={{fontSize: 62, fontWeight: 650, lineHeight: 1.08, letterSpacing: -2.4, marginTop: 54}}>
        Which policy<br />can an AI agent<br />trust?
      </div>
      <div style={{fontSize: 23, color: muted, marginTop: 58}}>Built with n8n · Synthetic demonstration data</div>
    </div>
    <div style={{position: 'absolute', left: 845, top: 154, width: 980, height: 660, overflow: 'hidden',
      backgroundColor: paper, border: '2px solid #534553', borderRadius: 22, boxShadow: '0 28px 72px #0006'}}>
      <Img src={staticFile('thumbnail-source.png')} style={{position: 'absolute', left: -500, top: -166, width: 1720}} />
    </div>
    <div style={{position: 'absolute', left: 905, top: 864, display: 'flex', gap: 30, fontSize: 27, fontWeight: 650}}>
      <span>24 h · approved policy</span><span style={{color: accent}}>48 h · newer Slack decision</span>
    </div>
  </AbsoluteFill>
);
