import React from 'react';
import {Composition, Still} from 'remotion';
import {Demo, Thumbnail} from './Demo';

export const Root = () => (
  <>
    <Composition id="ContextLedgerDemo" component={Demo} width={1920} height={1080}
      fps={30} durationInFrames={2700} defaultProps={{narrationFile: 'demo-narration.wav', captions: true}} />
    <Still id="ContextLedgerThumbnail" component={Thumbnail} width={1920} height={1080} />
  </>
);
