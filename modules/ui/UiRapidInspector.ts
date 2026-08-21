import { select, selection } from 'd3-selection';
import { actionNoop, actionRapidAcceptFeature } from '../actions/index.ts';
import { uiIcon } from './icon.ts';
//import { uiRapidFirstEditDialog } from './rapid_first_edit_dialog.ts';
import { UiTooltip } from './UiTooltip.ts';
import { utilKeybinding } from '../util/keybinding.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity } from '../data/OsmEntity.ts';

const ACCEPT_FEATURES_LIMIT = 50;


/**
 * `UiRapidInspector` is a UI component for viewing/editing Rapid Entities in the sidebar.
 *
 * @example
 *  <div class='rapid-inspector'>
 *    <div class='header'>…</div>
 *    <div class='body'>
 *      <div class='feature-info'/>              // Dataset name, e.g. "Microsoft Buildings"
 *      <div class='tag-info'/>                  // List of tags on this feature
 *      <div class='rapid-inspector-choices'/>   // Accept/Ignore buttons
 *    </div>
 *  </div>
 */
export class UiRapidInspector {
  public context: Context;
  public datum: OsmEntity | null;
  protected _keys: string[] | null;
  protected _keybinding: any;

  // D3 selections
  public $parent: D3Selection | null;
  public $inspector: D3Selection | null;

  // Child components
  public AcceptTooltip: UiTooltip;
  public IgnoreTooltip: UiTooltip;

  // accept and enter one of these modes:
  public moveFeature: (e: any, d: any) => void;
  public rotateFeature: (e: any, d: any) => void;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this.datum = null;
    this._keys = null;
    // Need a "private" keybinding for this component because these keys conflict with
    // the main keys used by the operations when editing OSM. ('A','D','M','R')
    this._keybinding = utilKeybinding('UiRapidInspector');
    select(document).call(this._keybinding);

    // D3 selections
    this.$parent = null;
    this.$inspector = null;

    // Create child components
    this.AcceptTooltip = new UiTooltip(context).placement('bottom');
    this.IgnoreTooltip = new UiTooltip(context).placement('bottom');

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.renderFeatureInfo = this.renderFeatureInfo.bind(this);
    this.renderTagInfo = this.renderTagInfo.bind(this);
    this.renderChoices = this.renderChoices.bind(this);
    this.renderChoice = this.renderChoice.bind(this);
    this.acceptFeature = this.acceptFeature.bind(this);
    this.ignoreFeature = this.ignoreFeature.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // accept and enter one of these modes:
    this.moveFeature = (e, d) => this.acceptFeature(e, d, 'move');
    this.rotateFeature = (e, d) => this.acceptFeature(e, d, 'rotate');

    // Setup event handlers
    const l10n = context.systems.l10n!;
    l10n.on('localechange', this._setupKeybinding);
    this._setupKeybinding();
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders.)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;
    const rtl = l10n.isRTL ? '-rtl' : '';

    let $inspector: D3Selection = $parent.selectAll('.rapid-inspector')
      .data([0]);

    const $$inspector = $inspector.enter()
      .append('div')
      .attr('class', 'rapid-inspector');


    // add `.header`
    const $$header = $$inspector
      .append('div')
      .attr('class', 'header');

    $$header
      .append('h3')
      .append('svg')
      .attr('class', 'logo-rapid')
      .append('use');

    $$header
      .append('button')
      .attr('class', 'rapid-inspector-close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    // add `.body`
    $$inspector
      .append('div')
      .attr('class', 'body');

    // update
    this.$inspector = $inspector = $inspector.merge($$inspector) as D3Selection;

    // localize logo
    $inspector.selectAll('.logo-rapid > use')
      .attr('xlink:href', `#rapid-logo-rapid-wordmark${rtl}`);

    $inspector.selectAll('.body')
      .call(this.renderFeatureInfo)
      .call(this.renderTagInfo)
      .call(this.renderChoices);
  }


  /**
   * The "Add Feature" button is disabled if the user has already added more than the
   *  ACCEPT_FEATURES_LIMIT - unless they are working on a task, or in poweruser mode.
   * @return  `true` if Add Feature is disabled, `false` if enabled.
   */
  public isAcceptFeatureDisabled(): boolean {
    const context = this.context;
    const rapid = context.systems.rapid!;

    // If Rapid is working with on a task, "add roads" is always enabled
    if (rapid.taskExtent) return false;

    // Power users aren't limited by the max features limit
    if (rapid.isPoweruser()) return false;

    return rapid.acceptIDs.size >= ACCEPT_FEATURES_LIMIT;
  }


  /**
   * Called when the user presses Add Feature.
   * @param  [e] - the triggering event, if any
   * @param  [d] - object bound to the selection (i.e. the command) (not used)
   * @param  [nextMode] - optional next mode to enter after accepting ('move' or 'rotate')
   */
  public acceptFeature(e?: any, d?: any, nextMode?: string): void {
    const datum = this.datum;
    if (!datum) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;
    const scene = context.systems.gfx!.scene;
    const ui = context.systems.ui;

    if (this.isAcceptFeatureDisabled()) {
      ui?.Flash.show({
        duration: 5000,
        label: l10n.t(
          'rapid_inspector.option_accept.disabled_flash',
          { n: ACCEPT_FEATURES_LIMIT }
        )
      });
      return;
    }

    const serviceID = datum.props.serviceID as ServiceID;
    const service = context.services[serviceID] as any;
    const graph = service.graph(datum.props.datasetID);
    const datasetID = (datum.props.datasetID as DatasetID).replace('-conflated', '');
    const dataset = rapid.datasets.get(datasetID);

    const action = actionRapidAcceptFeature(datum.id, graph);
    editor.perform(action);
    const allIDs = [...action.getAllIDs()];

    // In place of a string annotation, this introduces an "object-style"
    // annotation, where "type" and "description" are standard keys,
    // and there may be additional properties. Note that this will be
    // serialized to JSON while saving undo/redo state in editor.save().
    const annotation = {
      type: 'rapid_accept_feature',
      description: l10n.t('rapid_inspector.option_accept.annotation'),
      entityID: datum.id,
      allIDs: allIDs,
      dataUsed: dataset?.dataUsed || [datasetID]
    };

    editor.commit({ annotation: annotation, selectedIDs: [datum.id] });

    // What next
    // - If we were in select mode, stay in select mode
    // - Or, if we are passed a `nextMode` do that.
    // - Or, if the feature was hovered, keep it hovered
    const currMode = context.mode?.id || '';
    if (!nextMode && /^select/.test(currMode)) {   // if it is selected, stay selected
      nextMode = 'select-osm';
    }

    if (nextMode) {   // should be one of 'select-osm', 'move', or 'rotate'
      context.enter(nextMode, { selection: { osm: [datum.id] }} );

    } else {  // if it was hovered, hover the newly added item (this is hacky):
      // 1. get the `lastMove` event, and make it appear to target the new entity on the 'osm' layer
      // 2. tell the hover behavior to emit a new 'hoverchange' event.
      const hover = context.behaviors.hover as any;
      const lastMove = hover.lastMove;
      const graph = editor.staging.graph;
      const entity = graph.entity(datum.id);  // get the newly accepted entity
      const layer = (scene as any).layers.get('osm');
      lastMove.target = {
        container: null,
        feature: null,
        featureID: null,
        layer: layer,
        layerID: layer.id,
        data: entity,
        dataID: entity.id
      };
      hover._doHover();
    }

    this.datum = null;

    if (context.inIntro) return;
    if (window.sessionStorage.getItem('acknowledgedLogin') === 'true') return;
    window.sessionStorage.setItem('acknowledgedLogin', 'true');

// This dialog box looks kind of old and could use a refresh
// It it to tell new users that they need to log into OSM.
//    const osm = context.services.osm;
//    if (!osm.authenticated()) {
//      context.container()
//        .call(uiRapidFirstEditDialog(context));
//    }
  }


  /**
   * Called when the user presses "Ignore Feature".
   * @param  [e] - the triggering event, if any
   * @param  [d] - object bound to the selection (i.e. the command) (not used)
   */
  public ignoreFeature(e?: Event): void {
    const datum = this.datum;
    if (!datum) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const annotation = {
      type: 'rapid_ignore_feature',
      description: l10n.t('rapid_inspector.option_ignore.annotation'),
      entityID: datum.id
    };
    editor.perform(actionNoop());
    editor.commit({ annotation: annotation });
    context.enter('browse');
    this.datum = null;
  }


  /**
   * This is used to get the brightness of the given hex color.
   * (We use this to know whether text written over this color should be light or dark).
   * https://www.w3.org/TR/AERT#color-contrast
   * https://stackoverflow.com/questions/49437263/contrast-between-label-and-background-determine-if-color-is-light-or-dark/49437644#49437644
   * @param  color - a hexstring like '#rgb', '#rgba', '#rrggbb', '#rrggbbaa'  (alpha values are ignored)
   * @return A number representing the perceived brightness
   */
  public getBrightness(color: string): number {
    const short = (color.length < 6);
    const r = parseInt(short ? color[1] + color[1] : color[1] + color[2], 16);
    const g = parseInt(short ? color[2] + color[2] : color[3] + color[4], 16);
    const b = parseInt(short ? color[3] + color[3] : color[5] + color[6], 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000;
  }


  /**
   * Renders the 'feature-info' section (the dataset name)
   * @param $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  public renderFeatureInfo($selection: D3Selection): void {
    const datum = this.datum;
    if (!datum) return;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const rapid = context.systems.rapid!;

    const datasetID = (datum.props.datasetID as DatasetID).replace('-conflated', '');
    const dataset = rapid.datasets.get(datasetID) as any;
    const color = dataset.color;

    let $featureInfo: D3Selection = $selection.selectAll('.feature-info')
      .data([0]);

    // enter
    const $$featureInfo = $featureInfo.enter()
      .append('div')
      .attr('class', 'feature-info');

    $$featureInfo
      .append('div')
      .attr('class', 'dataset-label');

    if (dataset.beta) {
      $$featureInfo
        .append('div')
        .attr('class', 'dataset-beta beta');
    }

    // update
    $featureInfo = $featureInfo.merge($$featureInfo);

    $featureInfo
      .style('background', color)
      .style('color', this.getBrightness(color) > 140.5 ? '#333' : '#fff');

    $featureInfo.selectAll('.dataset-label')
      .text(dataset.getLabel());

    $featureInfo.selectAll('.dataset-beta')
      .attr('title', l10n.t('rapid_poweruser.beta'));   // alt text
  }


  /**
   * Renders the 'tag-info' section
   * @param $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  public renderTagInfo($selection: D3Selection): void {
    const tags = this.datum?.tags;
    if (!tags) return;

    const context = this.context;
    const l10n = context.systems.l10n!;

    let $tagInfo: D3Selection = $selection.selectAll('.tag-info')
      .data([0]);

    // enter
    const $$tagInfo = $tagInfo.enter()
      .append('div')
      .attr('class', 'tag-info');

    const $$tagBag = $$tagInfo
      .append('div')
      .attr('class', 'tag-bag');

    $$tagBag
      .append('div')
      .attr('class', 'tag-heading');

    for (const [k, v] of Object.entries(tags) as [string, string][]) {
      const $$tagEntry = $$tagBag.append('div').attr('class', 'tag-entry');
      $$tagEntry.append('div').attr('class', 'tag-key').text(k);
      $$tagEntry.append('div').attr('class', 'tag-value').text(v);
    }

    // update
    $tagInfo = $tagInfo.merge($$tagInfo);

    $tagInfo.selectAll('.tag-heading')
      .text(l10n.t('text.tag'));
  }


  /**
   * Renders the 'rapid-inspector-choices' section
   * @param $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  public renderChoices($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const choiceData = [
      {
        key: 'accept',
        iconName: '#rapid-icon-rapid-plus-circle',
        labelStringID: 'rapid_inspector.option_accept.label',
        referenceStringID: 'rapid_inspector.option_accept.description',
        tooltip: this.AcceptTooltip,
        onClick: this.acceptFeature
      }, {
        key: 'ignore',
        iconName: '#rapid-icon-rapid-minus-circle',
        labelStringID: 'rapid_inspector.option_ignore.label',
        referenceStringID: 'rapid_inspector.option_ignore.description',
        tooltip: this.IgnoreTooltip,
        onClick: this.ignoreFeature
      }
    ];

    let $choices: D3Selection = $selection.selectAll('.rapid-inspector-choices')
      .data([0]);

    // enter
    const $$choices = $choices.enter()
      .append('div')
      .attr('class', 'rapid-inspector-choices');

    $$choices
      .append('p')
      .attr('class', 'rapid-inspector-prompt');

    $$choices.selectAll('.rapid-inspector-choice')
      .data(choiceData, (d: any) => d.key)
      .enter()
      .append('div')
      .attr('class', (d: any) => `rapid-inspector-choice rapid-inspector-choice-${d.key}`);

    // update
    $choices = $choices.merge($$choices);

    $choices.selectAll('.rapid-inspector-prompt')
      .text(l10n.t('rapid_inspector.prompt'));

    $choices.selectAll('.rapid-inspector-choice')
      .each(this.renderChoice);
  }



  /**
   * Renders a choice - This should be called within a d3-selection.each
   * @param  d - bound datum
   * @param  i - iterator
   * @param  nodes - the nodes in the selection
   */
  public renderChoice(d: any, i: number, nodes: any): void {
    const $choice = select(nodes[i]);

    const context = this.context;
    const l10n = context.systems.l10n!;

    const isDisabled = (d.key === 'accept' && this.isAcceptFeatureDisabled());

    // .choice-wrap
    let $choiceWrap: D3Selection = $choice.selectAll('.choice-wrap')
      .data([d]);

    // enter
    const $$choiceWrap = $choiceWrap.enter()
      .append('div')
      .attr('class', 'choice-wrap');

    // action button
    const $$choiceActionButton = $$choiceWrap
      .append('button')
      .attr('class', 'choice-button')
      .on('click', d.onClick)
      .call(d.tooltip.attach);

    $$choiceActionButton
      .append('svg')
      .attr('class', 'choice-icon icon')
      .append('use')
      .attr('xlink:href', d.iconName);

    $$choiceActionButton
      .append('div')
      .attr('class', 'choice-label');

    // reference button
    $$choiceWrap
      .append('button')
      .attr('class', 'tag-reference-button')
      .attr('tabindex', '-1')
      .on('click', (e) => {
        e.currentTarget.blur();
        const $tagReference = $choice.selectAll('.tag-reference-body');
        $tagReference.classed('expanded', !$tagReference.classed('expanded'));
      })
      .call(uiIcon('#rapid-icon-inspect'));


    // update
    $choiceWrap = $choiceWrap.merge($$choiceWrap);

    $choiceWrap.selectAll('button')
      .classed('secondary', isDisabled)
      .classed('disabled', isDisabled);

    $choiceWrap.selectAll('.choice-label')
      .text(l10n.t(d.labelStringID));

    $choiceWrap.selectAll('.tag-reference-button')
      .attr('title', l10n.t('icons.information'));  // localize alt text

    // localize tooltip
    let title: string | undefined, shortcut: string | undefined;
    if (d.key === 'accept') {
      if (isDisabled) {
        title = l10n.t('rapid_inspector.option_accept.disabled', { n: ACCEPT_FEATURES_LIMIT } );
        shortcut = '';
      } else {
        title = l10n.t('rapid_inspector.option_accept.tooltip');
        shortcut = l10n.t('shortcuts.command.accept_feature.key');
      }
    } else if (d.key === 'ignore') {
      title = l10n.t('rapid_inspector.option_ignore.tooltip');
      shortcut = l10n.t('shortcuts.command.ignore_feature.key');
    }

    d.tooltip.title(title).shortcut(shortcut);


    // .tag-reference-body
    let $tagReference: D3Selection = $choice.selectAll('.tag-reference-body')
      .data([d]);

    // enter
    const $$tagReference = $tagReference.enter()
      .append('div')
      .attr('class', 'tag-reference-body');

    // update
    $tagReference = $tagReference.merge($$tagReference);

    $tagReference
      .text(l10n.t(d.referenceStringID));
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = this._keybinding;
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    const acceptKey = l10n.t('shortcuts.command.accept_feature.key');
    const ignoreKey = l10n.t('shortcuts.command.ignore_feature.key');
    const moveKey = l10n.t('shortcuts.command.move.key');
    const rotateKey = l10n.t('shortcuts.command.rotate.key');
    this._keys = [acceptKey, ignoreKey, moveKey, rotateKey];

    keybinding.on(acceptKey, this.acceptFeature);
    keybinding.on(ignoreKey, this.ignoreFeature);
    keybinding.on(moveKey, this.moveFeature);
    keybinding.on(rotateKey, this.rotateFeature);
  }

}
