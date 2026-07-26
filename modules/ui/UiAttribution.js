import { selection, select } from 'd3-selection';

import { utilSanitizeHTML } from '../util/sanitize.ts';


/**
 * The Attribution compnoent shows attribution for the imagery layers.
 */
export class UiAttribution {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    this.context = context;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument
    this.throttledRender = () => {
      this.context.systems.scheduler?.throttle('UiAttribution-render', () => this.rerender(), { ms: 400, leading: false });
    };

    context.systems.imagery.on('imagerychange', this.rerender);
    context.systems.map.on('draw', this.throttledRender);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param {d3-selection} $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  render($parent = this.$parent) {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const imagery = context.systems.imagery;
    const l10n = context.systems.l10n;
    const scene = context.systems.gfx.scene;
    const settings = context.systems.settings;
    const showThirdPartyIcons = (settings?.get('ui.privacy.thirdPartyIcons') ?? 'true') === 'true';
    const isRapidEnabled = scene.layers.get('rapid')?.enabled;

    // attribution wrapper
    let $wrap = $parent.selectAll('.attribution-wrap')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'attribution-wrap');

    $wrap = $wrap.merge($$wrap);


    // Gather imagery and data sources that we will provide attribution for
    const data = [
      { id: 'baselayer', sources: [] },
      { id: 'overlays', sources: [] }
    ];

    const baselayer = imagery.baseLayerSource();
    if (baselayer) {
      data[0].sources.push(baselayer);
    }

    const overlays = imagery.overlayLayerSources() || [];
    for (const overlay of overlays) {
      data[1].sources.push(overlay);
    }

    // Append a "source" for MapWithAI data attribution to the overlays section..
    if (isRapidEnabled) {
      data[1].sources.push({
        id: '__mapwithai',
        key: '__mapwithai',
        attribution: l10n.t('map_data.layers.rapid.license'),
        props: {
          overlay: true,
          terms_url: 'https://mapwith.ai/doc/license/MapWithAILicense.pdf'
        }
      });
    }

    // baselayer and overlays sections
    let $sections = $wrap.selectAll('.attribution-section')
      .data(data, d => d.id);

    const $$sections = $sections.enter()
      .append('div')
      .attr('class', d => `attribution-section ${d.id}`);

    $sections = $sections.merge($$sections);


    // attribution links
    let $attributions = $sections.selectAll('.attribution')
      .data(d => d.sources, d => d.key);

    $attributions.exit()
      .remove();

    const $$attributions = $attributions.enter()
      .append('a')
      .attr('class', 'attribution')
      .attr('target', '_blank')
      .attr('href', d => d.props.terms_url || null)
      .each((d, i, nodes) => {
        const $$link = select(nodes[i]);

        // Sanitize HTML from imagery provider metadata
        if (d.props.terms_html) {
          $$link.html(utilSanitizeHTML(d.props.terms_html));
          return;
        }

        if (d.props.icon && !d.props.overlay && showThirdPartyIcons) {
          $$link
            .append('img')
            .attr('class', 'attribution-image')
            .attr('src', d.props.icon);
        }

        $$link
          .append('span')
          .attr('class', 'attribution-text');
      });

    // update
    $attributions = $attributions.merge($$attributions);

    // note: we previously showed "terms_text" here, but most terms texts are too long and
    // not really an appropriate string for this use, so we just show the "name" instead.
    $attributions.selectAll('.attribution-text')
      .text(d => d.name);
  }
}
