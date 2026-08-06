import { select } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { utilSanitizeHTML } from '../util/sanitize.ts';
import { utilSafeURL } from '../util/url.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * Identifies what documentation to show. Pass either a `key` (and optional `value`),
 * or a `qid` (a brand Wikidata id, e.g. `'Q37158'`).
 */
export interface UiTagReferenceWhat {
  key?: string;
  value?: string;
  qid?: string;
}


/**
 * `UiTagReference` shows documentation for a tag (from the OSM Wiki or Wikidata) inside a
 * collapsible body, toggled by an info button. Attach the parts via `.button` and `.body`.
 */
export class UiTagReference {
  public context: Context;

  // D3 selections
  public $button: D3Selection | null;
  public $body: D3Selection | null;

  protected _what: UiTagReferenceWhat;
  protected _wikibase: any;
  protected _loaded: boolean | undefined;
  protected _showing: boolean | undefined;


  /**
   * @param context - Global shared application context
   * @param what    - identifies the documentation to show
   */
  public constructor(context: Context, what: UiTagReferenceWhat) {
    this.context = context;
    this._what = what;
    this._wikibase = context.services[what.qid ? 'wikidata' : 'osmwikibase'] as any;

    // D3 selections
    this.$button = null;
    this.$body = null;

    this._loaded = undefined;
    this._showing = undefined;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.button = this.button.bind(this);
    this.body = this.body.bind(this);
    this._gotDocs = this._gotDocs.bind(this);
  }


  /**
   * Renders the info toggle button into the given selection.
   * @param $selection - A d3-selection to a HTMLElement to render the button into
   * @param klass      - optional extra class to add to the button
   * @param iconName   - optional icon name (defaults to `inspect`)
   */
  public button($selection: D3Selection, klass?: string, iconName?: string): void {
    const l10n = this.context.systems.l10n!;

    this.$button = $selection.selectAll('.tag-reference-button')
      .data([0]);

    this.$button = this.$button.enter()
      .append('button')
      .attr('class', 'tag-reference-button ' + (klass || ''))
      .call(uiIcon('#rapid-icon-' + (iconName || 'inspect')))
      .merge(this.$button);

    this.$button
      .attr('title', l10n.t('icons.information'))
      .on('click', (d3_event: any) => {
        d3_event.stopPropagation();
        d3_event.preventDefault();
        d3_event.currentTarget.blur();    // avoid keeping focus on the button - iD#4641
        if (this._showing) {
          this._hide();
        } else if (this._loaded) {
          this._done();
        } else {
          this._load();
        }
      });
  }


  /**
   * Renders the (initially collapsed) documentation body into the given selection.
   * @param $selection - A d3-selection to a HTMLElement to render the body into
   */
  public body($selection: D3Selection): void {
    const what = this._what;
    const itemID = what.qid || (what.key + '-' + (what.value || ''));
    this.$body = $selection.selectAll('.tag-reference-body')
      .data([itemID], d => d as string);

    this.$body.exit()
      .remove();

    this.$body = this.$body.enter()
      .append('div')
      .attr('class', 'tag-reference-body')
      .style('max-height', '0')
      .style('opacity', '0')
      .merge(this.$body);

    if (this._showing === false) {
      this._hide();
    }
  }


  /**
   * Gets or sets whether the documentation body is currently showing.
   * @param  val - when provided, sets the showing state
   * @return the current showing state (getter), or `this` (setter)
   */
  public showing(val?: boolean): any {
    if (!arguments.length) return this._showing;
    this._showing = val as boolean;
    return this;
  }


  /**
   * Begins loading the documentation from the wikibase service.
   */
  protected _load(): void {
    if (!this.$button || !this._wikibase) return;  // called too early?

    this.$button
      .classed('tag-reference-loading', true);

    this._wikibase.getDocs(this._what, this._gotDocs);
  }


  /**
   * Callback for when the wikibase docs have loaded; builds the body content.
   * @param err  - error, if the request failed
   * @param docs - the loaded documentation
   */
  protected _gotDocs(err: any, docs: any): void {
    if (!this.$body) return;  // called too early?

    const l10n = this.context.systems.l10n!;
    const what = this._what;

    this.$body.html('');

    if (!docs || !docs.title) {
      this.$body
        .append('p')
        .attr('class', 'tag-reference-description')
        .html(l10n.tHtml('inspector.no_documentation_key'));
      this._done();
      return;
    }

    if (docs.imageURL) {
      this.$body
        .append('img')
        .attr('class', 'tag-reference-wiki-image')
        .attr('src', utilSafeURL(docs.imageURL))
        .on('load', () => this._done())
        .on('error', (d3_event: any) => {
          select(d3_event.currentTarget).remove();
          this._done();
        });
    } else {
      this._done();
    }

    let docsHtml;
    if (docs.description) {
      docsHtml = utilSanitizeHTML(l10n.htmlForLocalizedText(docs.description, docs.descriptionLocaleCode));
    } else {
      docsHtml = l10n.tHtml('inspector.no_documentation_key');
    }

    this.$body
      .append('p')
      .attr('class', 'tag-reference-description')
      .html(docsHtml)
      .append('a')
      .attr('class', 'tag-reference-edit')
      .attr('target', '_blank')
      .attr('title', l10n.t('inspector.edit_reference'))
      .attr('href', utilSafeURL(docs.editURL))
      .call(uiIcon('#rapid-icon-edit', 'inline'));

    if (docs.wiki) {
      this.$body
        .append('a')
        .attr('class', 'tag-reference-link')
        .attr('target', '_blank')
        .attr('href', utilSafeURL(docs.wiki.url))
        .call(uiIcon('#rapid-icon-out-link', 'inline'))
        .append('span')
        .html(l10n.tHtml(docs.wiki.text));
    }

    // Add link to info about "good changeset comments" - iD#2923
    if (what.key === 'comment') {
      this.$body
        .append('a')
        .attr('class', 'tag-reference-comment-link')
        .attr('target', '_blank')
        .call(uiIcon('#rapid-icon-out-link', 'inline'))
        .attr('href', l10n.t('commit.about_changeset_comments_link'))
        .append('span')
        .html(l10n.tHtml('commit.about_changeset_comments'));
    }
  }


  /**
   * Reveals the documentation body (expand) and updates the info icon.
   */
  protected _done(): void {
    if (!this.$body || !this.$button) return;  // called too early?

    this._loaded = true;

    this.$button
      .classed('tag-reference-loading', false);

    this.$body
      .classed('expanded', true)
      .transition()
      .duration(200)
      .style('max-height', '200px')
      .style('opacity', '1');

    this._showing = true;

    this.$button.selectAll('svg.icon use')
      .each((d, i, nodes) => {
        const $iconUse = select(nodes[i]);
        if ($iconUse.attr('href') === '#rapid-icon-info') {
          $iconUse.attr('href', '#rapid-icon-info-filled');
        }
      });
  }


  /**
   * Collapses the documentation body and restores the info icon.
   */
  protected _hide(): void {
    if (!this.$body || !this.$button) return;  // called too early?

    this.$body
      .transition()
      .duration(200)
      .style('max-height', '0px')
      .style('opacity', '0')
      .on('end', () => {
        this.$body?.classed('expanded', false);
      });

    this._showing = false;

    this.$button.selectAll('svg.icon use')
      .each((d, i, nodes) => {
        const $iconUse = select(nodes[i]);
        if ($iconUse.attr('href') === '#rapid-icon-info-filled') {
          $iconUse.attr('href', '#rapid-icon-info');
        }
      });
  }
}
