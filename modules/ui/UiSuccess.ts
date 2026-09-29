import { select, selection } from 'd3-selection';
import { resolveStrings } from 'osm-community-index';
import { uiIcon } from './icon.ts';
import { UiDisclosure } from '../ui/UiDisclosure.ts';
import { utilSanitizeHTML } from '../util/sanitize.ts';
import { utilSafeURL } from '../util/url.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { OsmChangeset } from '../data/OsmChangeset.ts';
import type { OciDefaults, OciEvent, OciResource } from 'osm-community-index';
import type { HasLocationSetID } from '@rapideditor/location-conflation';

const MAXEVENTS = 2;

type OciResourceWithLocation = OciResource & HasLocationSetID;
type OciEventWithDate = OciEvent & { date?: Date };

interface Oci {
  resources: OciResourceWithLocation[];
  defaults: OciDefaults;
}

interface CommunityData {
  resource: OciResourceWithLocation;
  area: number;
  order: number;
}
interface CommunityDisclosures {
  more?: UiDisclosure;
  event?: UiDisclosure;
}

let _oci: Oci | null = null;



/**
 * `UiSuccess` renders the "just edited" success screen shown after a save,
 * including a changeset summary and OSM community links. Set the changeset via the
 * public `changeset()` setter (and optionally `location()`), then call `.render($selection)`.
 */
export class UiSuccess {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;

  protected _changeset: OsmChangeset | null;
  protected _location: string | null;
  protected _ociPromise: Promise<Oci> | null;
  protected _communityData: CommunityData[];
  protected _communityDisclosures: Map<string, CommunityDisclosures>;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._changeset = null;
    this._location = null;
    this._ociPromise = null;
    this._communityData = [];
    this._communityDisclosures = new Map<string, CommunityDisclosures>();

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._renderCommunityData = this._renderCommunityData.bind(this);
    this._renderCommunityDetail = this._renderCommunityDetail.bind(this);

    this._getCommunityIndexAsync();   // start fetching the data
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * Note: This is expected to be called by `Sidebar.show(fn)`.
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
    const locations = context.systems.locations;
    const map = context.systems.map;
    const osm = context.services.osm;
    const ui = context.systems.ui;

    // Render `.heading` section..
    let $heading: D3Selection = $parent.selectAll('.heading')
      .data([0]);

    // enter
    const $$heading: D3EnterSelection = $heading.enter()
      .append('div')
      .attr('class', 'heading fillL');

    $$heading
      .append('button')
      .attr('class', 'close')
      .on('click', () => ui?.Sidebar?.hide())
      .call(uiIcon('#rapid-icon-close'));

    $$heading
      .append('h3');

    // update
    $heading = $heading.merge($$heading);
    $heading.selectAll('h3')
      .text(l10n.t('success.just_edited'));


    // Render `.body` section..
    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    // enter
    const $$body: D3EnterSelection = $body.enter()
      .append('div')
      .attr('class', 'body save-success fillL');

    const $$summary: D3EnterSelection = $$body
      .append('div')
      .attr('class', 'save-summary');

    $$summary
      .append('h3')
      .attr('class', 'save-thank-you');

    const $$message: D3EnterSelection = $$summary
      .append('p');

    $$message
      .append('span')
      .attr('class', 'save-message');

    const $$link: D3EnterSelection = $$message
      .append('a')
      .attr('class', 'link-out')
      .attr('target', '_blank')
      .attr('href', '');

    $$link
      .call(uiIcon('#rapid-icon-out-link', 'inline'));
    $$link
      .append('span')
      .attr('class', 'save-link-text');


    // Render "View Changes on OSM" and changeset ID details.
    const changesetURL = osm?.changesetURL(this._changeset!.id);
    if (changesetURL) {
      const $$table: D3EnterSelection = $$summary
        .append('table')
        .attr('class', 'summary-table');

      const $$row: D3EnterSelection = $$table
        .append('tr')
        .attr('class', 'summary-row');

      $$row
        .append('td')
        .attr('class', 'cell-icon summary-icon')
        .append('a')
        .attr('target', '_blank')
        .attr('href', changesetURL)
        .append('svg')
        .attr('class', 'logo-small')
        .append('use')
        .attr('xlink:href', '#rapid-logo-osm');

      const $$summaryDetail: D3EnterSelection = $$row
        .append('td')
        .attr('class', 'cell-detail summary-detail');

      $$summaryDetail
        .append('a')
        .attr('class', 'cell-detail summary-view-on-osm')
        .attr('target', '_blank')
        .attr('href', changesetURL);

      const $$detailChangesetID = $$summaryDetail
        .append('div');

      $$detailChangesetID
        .append('span')
        .attr('class', 'summary-changeset-id');

      $$detailChangesetID
        .append('a')
        .attr('target', '_blank')
        .attr('href', changesetURL)
        .text(this._changeset!.id);
    }


    // update
    $body = $body
      .merge($$body);

    $body.selectAll('.save-thank-you')
      .text(l10n.t('success.thank_you' + (this._location ? '_location' : ''), { where: this._location ?? undefined }));
    $body.selectAll('.save-message')
      .text(l10n.t('success.your_changes'));  // "Your changes should appear in a few minutes..."
    $body.selectAll('.save-message a.link-out')
      .attr('href', l10n.t('success.help_link_url'));
    $body.selectAll('.save-link-text')
      .text(l10n.t('text.detail', { n: 100 }));  // force plural, i.e. "details"
    $body.selectAll('.summary-view-on-osm')
      .text(l10n.t('success.view_on_osm'));
    $body.selectAll('.summary-changeset-id')
      .text(l10n.t('success.your_changeset_id'));   // "Your changeset #:"


    // Gather OSM community resources intersecting the map, then render..
    this._getCommunityIndexAsync()
      .then(oci => {
        const loc = map?.center();
        const validHere = Array.isArray(loc) ? locations?.locationSetsAt(loc) : null;
        if (!validHere) return;

        // Gather the communities that are valid here
        this._communityData = [];
        for (const resource of oci.resources) {
          const area = validHere.get(resource.locationSetID);
          if (!area) continue;

          this._communityData.push({
            resource: resource,
            area: area,
            order: resource.order || 0
          });
        }

        // sort communities by feature area ascending, community order descending
        this._communityData.sort((a, b) => a.area - b.area || b.order - a.order);

        $body
          .call(this._renderCommunityData);
      });
  }


  /**
   * Loads and caches the OSM community index data (features, resources, defaults).
   * @return A promise that resolves to the cached community index object
   */
  protected _getCommunityIndexAsync(): Promise<Oci> {
    if (this._ociPromise) return this._ociPromise;

    const context = this.context;
    const assets = context.systems.assets!;
    const locations = context.systems.locations;

    this._ociPromise = Promise.all([
      assets.loadAssetAsync('oci_features'),
      assets.loadAssetAsync('oci_resources'),
      assets.loadAssetAsync('oci_defaults')
    ])
    .then((vals: any) => {
      if (_oci) return _oci;

      // Merge Custom Features
      if (locations && vals[0] && Array.isArray(vals[0].features)) {
        locations.mergeCustomGeoJSON(vals[0]);
      }

      const ociResources: OciResource[] = Object.values(vals[1].resources);
      if (locations && ociResources.length) {
        // Resolve all locationSet features.
        return locations.mergeLocationSets(ociResources)
          .then((resolvedResources) => {
            _oci = {
              resources: resolvedResources,
              defaults: vals[2].defaults
            };
            return _oci;
          });
      } else {
        _oci = {
          resources: [],   // no resources?
          defaults:  vals[2].defaults
        };
        return _oci;
      }
    });

    return this._ociPromise;
  }


  /**
   * Parses a community event date string into a local-timezone `Date`.
   * @param when - the raw date string to parse
   * @return The parsed `Date`, or `undefined` if the input was empty
   */
  protected _parseEventDate(when: string | undefined): Date | undefined {
    if (!when) return;

    let raw = when.trim();
    if (!raw) return;

    if (!/Z$/.test(raw)) {   // if no trailing 'Z', add one
      raw += 'Z';            // this forces date to be parsed as a UTC date
    }

    const parsed = new Date(raw);
    return new Date(parsed.toUTCString().slice(0, 25));  // convert to local timezone
  }


  /**
   * Renders the "connect with the community" links section.
   * These are pulled from the OSM Community Index project.
   * @see https://github.com/osmlab/osm-community-index
   * @param $selection - A d3-selection to the HTMLElement this section renders into
   */
  protected _renderCommunityData($selection: D3Selection): void {
    if (!_oci) return;  // called too soon?

    const context = this.context;
    const l10n = context.systems.l10n!;

    // At this time we should resolve the resource strings - we are about to display them.
    const resources = this._communityData.map((d: CommunityData) => d.resource);
    const localize = (stringID: StringID): string => l10n.t(`_community.${stringID}`);
    for (const resource of resources) {
      resource.resolved = resolveStrings(resource as any, _oci.defaults as any, localize);
    }


    // Render `.save-communityLinks` section..
    let $communityLinks: D3Selection = $selection.selectAll('.save-communityLinks')
      .data([0]);

    // enter
    const $$communityLinks: D3EnterSelection = $communityLinks.enter()
      .append('div')
      .attr('class', 'save-communityLinks');

    $$communityLinks
      .append('h3')
      .attr('class', 'community-heading');

    $$communityLinks
      .append('table')
      .attr('class', 'community-table');

    const $$missingMessage: D3EnterSelection = $$communityLinks
      .append('div')
      .attr('class', 'community-missing');

    $$missingMessage
      .append('span')
      .attr('class', 'community-missing-message');

    const $$missingLink: D3EnterSelection = $$missingMessage
      .append('a')
      .attr('class', 'link-out')
      .attr('target', '_blank')
      .attr('href', 'https://github.com/osmlab/osm-community-index/issues');

    $$missingLink
      .call(uiIcon('#rapid-icon-out-link', 'inline'));
    $$missingLink
      .append('span')
      .attr('class', 'community-missing-link-text');


    // update
    $communityLinks = $communityLinks
      .merge($$communityLinks);

    $communityLinks.selectAll('.community-heading')
      .text(l10n.t('success.like_osm'));  // Like OpenStreetMap? Connect with others:
    $communityLinks.selectAll('.community-missing-message')
      .text(l10n.t('success.missing'));   // Is something missing from this list?
    $communityLinks.selectAll('.community-missing-link-text')
      .text(l10n.t('success.tell_us'));   // Tell us!


    // Render the contents of the table
    const $table = $communityLinks.selectAll('.community-table');
    let $rows: D3Selection = $table.selectAll('.community-row')
      .data(resources, (d: OciResourceWithLocation) => d.id);

    // exit
    $rows.exit()
      .remove();

    // enter
    const $$rows: D3EnterSelection = $rows.enter()
      .append('tr')
      .attr('class', 'community-row');

    $$rows
      .append('td')
      .attr('class', 'cell-icon community-icon')
      .append('a')
      .attr('target', '_blank')
      .attr('href', (d: OciResourceWithLocation) => utilSafeURL(d.resolved!.url))
      .append('svg')
      .attr('class', 'logo-small')
      .append('use')
      .attr('xlink:href', (d: OciResourceWithLocation) => `#community-${d.type}`);

    $$rows
      .append('td')
      .attr('class', 'cell-detail community-detail');

    // update
    $rows = $rows.merge($$rows);

    $rows.selectAll('.community-detail')
      .each(this._renderCommunityDetail);
  }


  /**
   * Renders the details (name, description, events) for a single community resource.
   * @param d - the bound community datum
   * @param i - the index within the selection
   * @param nodes - the nodes in the selection
   */
  protected _renderCommunityDetail(d: OciResourceWithLocation, i: number, nodes: ArrayLike<HTMLElement>): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const $td = select(nodes[i]);   // the 'td' element for this community resource
    const communityID = d.id;

    // child controls
    let disclosures = this._communityDisclosures.get(communityID);
    if (!disclosures) {
      disclosures = {};
      this._communityDisclosures.set(communityID, disclosures);
    }

    // Note that at this point the "resolved" localized strings are expected to exist,
    // because we took care of this early in `_renderCommunityLinks()`.
    const strings = d.resolved!;

    // create/update '.community-name'
    let $name: D3Selection = $td.selectAll('.community-name')
      .data([d]);

    $name = $name.enter()
      .append('div')
      .attr('class', 'community-name')
      .merge($name);

    $name
      .html(utilSanitizeHTML(strings.nameHTML));

    // create/update '.community-description'
    let $description: D3Selection = $td.selectAll('.community-description')
      .data([d]);

    $description = $description.enter()
      .append('div')
      .attr('class', 'community-description')
      .merge($description);

    $description
      .html(utilSanitizeHTML(strings.descriptionHTML));

    // Show '.community-more' if either of these are present..
    const hasMore = (strings.extendedDescriptionHTML || d.languageCodes?.length);
    if (hasMore) {
      disclosures.more ??= new UiDisclosure(context, `community-more-${d.id}`)
        .expanded(false)
        .checkPreference(false)
        .label(() => l10n.t('text.more'))
        .content(showMore);

      $td
        .call(disclosures.more.render);
    }

    // Show '.community-events' if there are any
    const nextEvents: OciEventWithDate[] = (d.events || [])
      .map((event: OciEvent): OciEventWithDate => {
        (event as OciEventWithDate).date = this._parseEventDate(event.when);
        return event;
      })
      .filter((event: OciEventWithDate) => {      // date is valid and future (or today)
        const t = event.date?.getTime();
        const now = (new Date()).setHours(0,0,0,0);
        return t !== undefined && !isNaN(t) && t >= now;
      })
      .sort((a: OciEventWithDate, b: OciEventWithDate) => {       // sort by date ascending
        return a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0;
      })
      .slice(0, MAXEVENTS);   // limit number of events shown

    if (nextEvents.length) {
      disclosures.event ??= new UiDisclosure(context, `community-events-${d.id}`)
        .expanded(false)
        .checkPreference(false)
        .label(() => l10n.t('success.events'))
        .content(showNextEvents);

      $td
        .call(disclosures.event.render);

      const $hidetoggle: D3Selection = $td.select(`.hide-toggle-community-events-${d.id}`);
      let $badge: D3Selection = $hidetoggle.selectAll('.badge-text')
        .data([0]);

      $badge = $badge.enter()
        .append('span')
        .attr('class', 'badge-text')
        .merge($badge);

      $badge
        .text(nextEvents.length);
    }


    /**
     * Renders the inner content for the 'more' disclosure
     * @param $wrap - Parent D3 selection to render content into,
     *   in this case it will be the UiDisclosure `$wrap` selection
     */
    function showMore($wrap: D3Selection): void {
      let $content: D3Selection = $wrap.selectAll('.community-more')
        .data([0]);

      // enter
      const $$content: D3EnterSelection = $content
        .enter()
        .append('div')
        .attr('class', 'community-more');

      $$content
        .append('div')
        .attr('class', 'community-extended-description');

      $$content
        .append('div')
        .attr('class', 'community-languages');

      // update
      $content = $content
        .merge($$content);

      $content.selectAll('.community-extended-description')
        .html(utilSanitizeHTML(strings.extendedDescriptionHTML));

      const languages = (d.languageCodes || [])
        .map((code: LanguageCode) => l10n.languageName(code))
        .join(', ');

      $content.selectAll('.community-languages')
        .text(languages ? l10n.t('success.languages', { languages: languages }) : null);
    }


    /**
     * Renders the inner content for the 'events' disclosure
     * @param $wrap - Parent D3 selection to render content into,
     *   in this case it will be the UiDisclosure `$wrap` selection
     */
    function showNextEvents($wrap: D3Selection): void {
      let $content: D3Selection = $wrap.selectAll('.community-events')
        .data([0]);

      // enter/update
      $content = $content.enter()
        .append('div')
        .attr('class', 'community-events')
        .merge($content);

      let $items = $content.selectAll('.community-event')
        .data(nextEvents);

      $items.exit()
        .remove();

      const $$items: D3EnterSelection = $items.enter()
        .append('div')
        .attr('class', 'community-event');

      $$items
        .append('div')
        .attr('class', 'community-event-name')
        .append('a')
        .attr('class', 'community-event-link')
        .attr('target', '_blank')
        .attr('href', (d: OciEventWithDate) => utilSafeURL(d.url));

      $$items
        .append('div')
        .attr('class', 'community-event-when');

      $$items
        .append('div')
        .attr('class', 'community-event-where');

      $$items
        .append('div')
        .attr('class', 'community-event-description');

      // update
      $items = $items.merge($$items);

      $items.selectAll('.community-event-link')
        .text((d: OciEvent) => {
          let name = d.name;
          if (d.i18n && d.id) {
            name = l10n.t(`_community.${communityID}.events.${d.id}.name`, { default: name });
          }
          return name;
        });

      $items.selectAll('.community-event-when')
        .text((d: OciEventWithDate) => {
          const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
          if (d.date!.getHours() || d.date!.getMinutes()) {   // include time if it has one
            options.hour = 'numeric';
            options.minute = 'numeric';
          }
          const localeCode = l10n.localeCode;
          return d.date!.toLocaleString(localeCode, options);
        });

      $items.selectAll('.community-event-where')
        .text((d: OciEventWithDate) => {
          let where = d.where;
          if (d.i18n && d.id) {
            where = l10n.t(`_community.${communityID}.events.${d.id}.where`, { default: where });
          }
          return where ?? '';
        });

      $items.selectAll('.community-event-description')
        .text((d: OciEventWithDate) => {
          let description = d.description;
          if (d.i18n && d.id) {
            description = l10n.t(`_community.${communityID}.events.${d.id}.description`, { default: description });
          }
          return description ?? '';
        });
    }
  }


  /** Gets or sets the changeset to summarize. */
  public changeset(val?: OsmChangeset): any {
    if (val === undefined) return this._changeset;
    this._changeset = val;
    return this;
  }


  /** Gets or sets the edit location. */
  public location(val?: string): any {
    if (val === undefined) return this._location;
    this._location = val;
    return this;
  }
}
