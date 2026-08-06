import { select as d3_select } from 'd3-selection';
import { uiDisclosure } from '../disclosure.ts';
import { utilFunctor } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { UiDisclosure } from '../disclosure.ts';


/** A functor: either a value, or a function returning that value. */
type Functor<T> = () => T;

/** A section's content renderer. */
export type UiSectionContent = ($selection: D3Selection) => void;


/** A section: a box of content, optionally wrapped in a toggleable disclosure. */
export interface UiSection {
  id: string;
  selection(): D3Selection;
  classes(): Functor<string>;
  classes(val: string | Functor<string>): UiSection;
  label(): Functor<string> | undefined;
  label(val: string | Functor<string>): UiSection;
  shouldDisplay(): Functor<boolean> | undefined;
  shouldDisplay(val: boolean | Functor<boolean>): UiSection;
  content(): UiSectionContent | undefined;
  content(val: UiSectionContent): UiSection;
  disclosureContent(): UiSectionContent | undefined;
  disclosureContent(val: UiSectionContent): UiSection;
  disclosureExpandOverride(): boolean | undefined;
  disclosureExpandOverride(val: boolean | undefined): UiSection;
  render($selection: D3Selection): void;
  reRender(): void;
}


/**
 * A section factory's return value: a `UiSection` augmented with component-specific
 * methods (e.g. `entityIDs`, `presets`, `on`). The `Record` part keeps this permissive.
 */
export type UiSectionComponent = UiSection & Record<string, any>;


// A Section is a box of content.
//
// Use .content() to render the content by itself
// or  .disclosureContent() to render the content inside a Disclosure (toggle with heading)
//
export function uiSection(context: Context, sectionID: string): UiSection {
  let _classes: Functor<string> = utilFunctor('');
  let $container: D3Selection = d3_select(null);

  let _shouldDisplay: Functor<boolean> | undefined;
  let _content: UiSectionContent | undefined;
  let _disclosure: UiDisclosure | undefined;
  let _label: Functor<string> | undefined;
  let _disclosureContent: UiSectionContent | undefined;
  let _disclosureExpandOverride: boolean | undefined;

  const section = {
    id: sectionID
  } as UiSection;

  section.selection = function() {
    return $container;
  };

  section.classes = function(val?: string | Functor<string>): any {
    if (!arguments.length) return _classes;
    _classes = utilFunctor(val as string | Functor<string>);
    return section;
  };

  section.label = function(val?: string | Functor<string>): any {
    if (!arguments.length) return _label;
    _label = utilFunctor(val as string | Functor<string>);
    return section;
  };

  section.shouldDisplay = function(val?: boolean | Functor<boolean>): any {
    if (!arguments.length) return _shouldDisplay;
    _shouldDisplay = utilFunctor(val as boolean | Functor<boolean>);
    return section;
  };

  section.content = function(val?: UiSectionContent): any {
    if (!arguments.length) return _content;
    _content = val;
    return section;
  };

  section.disclosureContent = function(val?: UiSectionContent): any {
    if (!arguments.length) return _disclosureContent;
    _disclosureContent = val;
    return section;
  };

  section.disclosureExpandOverride = function(val?: boolean): any {
    if (!arguments.length) return _disclosureExpandOverride;
    _disclosureExpandOverride = val;
    return section;
  };


  section.render = function render($selection: D3Selection): void {
    $container = $selection
      .selectAll(`.section-${sectionID}`)
      .data([0]);

    const $$container = $container
      .enter()
      .append('div')
      .attr('class', `section section-${sectionID} ` + (_classes && _classes() || ''));

    $container = $$container
      .merge($container);

    $container
      .call(renderContent);
  };


  section.reRender = function() {
    $container
      .call(renderContent);
  };



  function renderContent($selection: D3Selection): void {
    // The section may be hidden completely if it isn't needed.
    // If there is a _shouldDisplay() function, we call it to determine this.
    if (typeof _shouldDisplay === 'function') {
      const shouldDisplay = _shouldDisplay();
      $selection.classed('hide', !shouldDisplay);
      if (!shouldDisplay) {
        $selection.html('');
        return;
      }
    }

    // Render the content inside a Disclosure
    if (_disclosureContent) {
      if (!_disclosure) {   // create if needed
        _disclosure = uiDisclosure(context, sectionID.replace(/-/g, '_'))
          .label(_label || '')
          .content(_disclosureContent);
      }

      _disclosure
        .expandOverride(_disclosureExpandOverride);

      $selection
        .call(_disclosure);

    // Render the content on its own
    } else if (_content) {
      $selection
        .call(_content);
    }
  }

  return section;
}
