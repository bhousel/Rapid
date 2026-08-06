import { dispatch as d3_dispatch } from 'd3-dispatch';
import { uiIcon } from './icon.ts';
import { uiToggle } from './toggle.ts';
import { utilFunctor, utilRebind } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/** A functor: either a value, or a function returning that value. */
type Functor<T> = () => T;

/** A disclosure's content renderer. */
export type UiDisclosureContent = ($selection: D3Selection) => void;


/** A disclosure control (callable + fluent): a toggleable label over collapsible content. */
export interface UiDisclosure {
  ($selection: D3Selection): void;
  expanded(): boolean;
  expanded(val: boolean): UiDisclosure;
  checkPreference(): boolean;
  checkPreference(val: boolean): UiDisclosure;
  expandOverride(): boolean | undefined;
  expandOverride(val: boolean | undefined): UiDisclosure;
  label(): Functor<string>;
  label(val: string | Functor<string>): UiDisclosure;
  content(): UiDisclosureContent;
  content(val: UiDisclosureContent): UiDisclosure;
  on(...args: any[]): UiDisclosure;
}


// A Disclosure consists of a toggleable Label and Content
// Clicking on the label toggles the visibility of the content below it.
//
//   > Label     ⋁ Label
//                 Content
//
export function uiDisclosure(context: Context, key: string): UiDisclosure {
  const l10n = context.systems.l10n!;
  const settings = context.systems.settings;
  const dispatch = d3_dispatch('toggled');

  let _isExpanded = true;        // by default, disclosures start out expanded
  let _checkPreference = true;   // by default, consider user's preference for whether it should be expanded
  let _expandOverride: boolean | undefined;   // expand can be overrided (for example, raw tag editor when it really needs to be open)
  let _label: Functor<string> = utilFunctor('');
  let _content: UiDisclosureContent = function () {};


  const disclosure = function render($selection: D3Selection): void {
    if (_checkPreference) {   // does user's preference override _isExpanded
      const preferExpanded = settings?.get(`ui.disclosure.${key}.expanded`) || 'true';
      _isExpanded = (preferExpanded === 'true');
    }
    if (_expandOverride !== undefined) {
      _isExpanded = _expandOverride;
    }


    let $hideToggle: D3Selection = $selection.selectAll(`.hide-toggle-${key}`)
      .data([0]);

    // enter
    const $$hideToggle = $hideToggle.enter()
      .append('a')
      .attr('href', '#')
      .attr('class', `hide-toggle hide-toggle-${key}`)
      .call(uiIcon('', 'pre-text hide-toggle-icon'));

    $$hideToggle
      .append('span')
      .attr('class', 'hide-toggle-text');

    // update
    $hideToggle = $$hideToggle
      .merge($hideToggle);

    $hideToggle
      .on('click', _onClick)
      .classed('expanded', _isExpanded);

    $hideToggle.selectAll('.hide-toggle-text')
      .text(_label());

    const isRTL = l10n.isRTL;
    const icon = _isExpanded ? 'down' : isRTL ? 'backward' : 'forward';
    $hideToggle.selectAll('.hide-toggle-icon > use')
      .attr('xlink:href', `#rapid-icon-${icon}`);


    let $wrap: D3Selection = $selection.selectAll('.disclosure-wrap')
      .data([0]);

    // enter/update
    $wrap = $wrap.enter()
      .append('div')
      .attr('class', `disclosure-wrap disclosure-wrap-${key}`)
      .merge($wrap)
      .classed('hide', !_isExpanded);

    if (_isExpanded) {
      $wrap
        .call(_content);
    }


    function _onClick(this: any, d3_event: Event): void {
      d3_event.preventDefault();
      _isExpanded = !_isExpanded;

      // Only update the expanded preference if it's not been overrided
      if (_checkPreference && _expandOverride === undefined) {
        settings?.set(`ui.disclosure.${key}.expanded`, String(_isExpanded));
      }
      _expandOverride = undefined;  // reset this flag here, as the user has interacted with it

      $hideToggle
        .classed('expanded', _isExpanded);

      const icon = _isExpanded ? 'down' : isRTL ? 'backward' : 'forward';
      $hideToggle.selectAll('.hide-toggle-icon > use')
        .attr('xlink:href', `#rapid-icon-${icon}`);

      $wrap
        .call(uiToggle(_isExpanded));

      if (_isExpanded) {
        $wrap
          .call(_content);
      }

      dispatch.call('toggled', this, _isExpanded);
    }
  } as UiDisclosure;


  disclosure.expanded = function(val?: boolean): any {
    if (!arguments.length) return _isExpanded;
    _isExpanded = val as boolean;
    return disclosure;
  };


  disclosure.checkPreference = function(val?: boolean): any {
    if (!arguments.length) return _checkPreference;
    _checkPreference = val as boolean;
    return disclosure;
  };


  disclosure.expandOverride = function(val?: boolean): any {
    if (!arguments.length) return _expandOverride;
    _expandOverride = val;
    return disclosure;
  };


  disclosure.label = function(val?: string | Functor<string>): any {
    if (!arguments.length) return _label;
    _label = utilFunctor(val as string | Functor<string>);
    return disclosure;
  };


  disclosure.content = function(val?: UiDisclosureContent): any {
    if (!arguments.length) return _content;
    _content = val as UiDisclosureContent;
    return disclosure;
  };


  return utilRebind(disclosure as any, dispatch as any, 'on') as unknown as UiDisclosure;
}
