import React from 'react';
import ReactDom from 'react-dom';
import ReactComponent from './ReactComponent';
import { uiSection } from '../section.js';


export function uiSectionReactContainer(context) {
  const imagery = context.systems.imagery;
  const map = context.systems.map;
  const scheduler = context.systems.scheduler;
  let reRenderCount = 0;

  const section = uiSection(context, 'react-container')
    .label('A React Component')
    .disclosureContent(renderContent);

  const chooseBackground = (source) => {
    imagery.baseLayerSource(source);
  };

  const renderContent = (selection) => {
    const sources = imagery
      .visibleSources()
      .filter(d => !d.overlay);

    selection
      .append('div')
      .attr('id', 'react-component');

    ReactDom.render(
      <ReactComponent reRenderCount={reRenderCount} sources={sources} selectSourceHandler={chooseBackground}/>,
      document.getElementById('react-component')
    );
  };


  map.on('draw', () => {
    scheduler?.debounce('ReactContainer-render', () => {
      reRenderCount++;
      if (scheduler) {
        scheduler.scheduleIdleTask(section.reRender)
          .catch(err => {
            if (err?.name === 'AbortError') return;   // expected cancellation
            console.error(err);  // eslint-disable-line no-console
          });
      } else {
        section.reRender();
      }
    }, { ms: 1000 });
  });

  return section;
}
