import { EventEmitter } from 'tseep/lib/ee-safe';
import { select as d3_select } from 'd3-selection';
import { resolveStrings } from 'osm-community-index';
import { uiIcon } from './icon.ts';
import { uiDisclosure } from '../ui/disclosure.ts';
import { utilSanitizeHTML } from '../util/sanitize.ts';
import { utilSafeURL } from '../util/url.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmChangeset } from '../data/OsmChangeset.ts';
import type { Vec2 } from '@rapid-sdk/math';


let _oci: Oci | null = null;


interface OciEvent {
  when?: string;
  name?: string;
  where?: string;
  description?: string;
  url?: string;
  i18n?: boolean;
  id?: string;
  date?: Date;
}

interface OciResource {
  id?: string;
  type?: string;
  locationSetID?: string;
  order?: number;
  events?: OciEvent[];
  languageCodes?: string[];
  resolved?: {
    url?: string;
    nameHTML?: string;
    descriptionHTML?: string;
    extendedDescriptionHTML?: string;
  };
}

interface Oci {
  resources: OciResource[];
  defaults: Record<string, unknown>;
}

const MAXEVENTS = 2;


/**
 * The `UiSuccess` renders the "just edited" success screen shown after a save,
 * including a changeset summary and OSM community links. Set the changeset via the
 * public `changeset()` setter (and optionally `location()`), then call `.render($selection)`.
 * Emits `cancel` when the user closes the screen.
 */
export class UiSuccess extends EventEmitter {
  public context: Context;

  protected _changeset: OsmChangeset | null;
  protected _location: string | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;
    this._changeset = null;
    this._location = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._showCommunityLinks = this._showCommunityLinks.bind(this);

    this._getCommunityIndexAsync();   // start fetching the data
  }


  /**
   * Loads and caches the OSM community index data (features, resources, defaults).
   * @return A promise that resolves to the cached community index object
   */
  protected _getCommunityIndexAsync(): Promise<Oci> {
    const context = this.context;
    const assets = context.systems.assets!;
    const locations = context.systems.locations;  // optional

    return Promise.all([
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
            .then(() => {
              _oci = {
                resources: ociResources,
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
  }


  // string-to-date parsing in JavaScript is weird
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
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent (the save flow /
   *  `UiCommit`) on each render, so it renders into `$selection` directly rather than
   *  capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const locations = context.systems.locations;  // optional
    const map = context.systems.map!;

    const $header = $selection
      .append('div')
      .attr('class', 'header fillL');

    $header
      .append('h3')
      .text(l10n.t('success.just_edited'));

    $header
      .append('button')
      .attr('class', 'close')
      .on('click', () => this.emit('cancel'))
      .call(uiIcon('#rapid-icon-close'));

    const $body = $selection
      .append('div')
      .attr('class', 'body save-success fillL');

    const $summary = $body
      .append('div')
      .attr('class', 'save-summary');

    $summary
      .append('h3')
      .text(l10n.t('success.thank_you' + (this._location ? '_location' : ''), { where: this._location ?? undefined }));

    $summary
      .append('p')
      .text(l10n.t('success.your_changes'))  // "Your changes should appear in a few minutes..."
      .append('a')
      .attr('class', 'link-out')
      .attr('target', '_blank')
      .attr('href', l10n.t('success.help_link_url'))
      .call(uiIcon('#rapid-icon-out-link', 'inline'))
      .append('span')
      .text(l10n.t('success.help_link_text'));

    const osm = context.services.osm;
    if (!osm) return;

    const changesetURL = osm.changesetURL(this._changeset!.id);

    const $table = $summary
      .append('table')
      .attr('class', 'summary-table');

    const $row = $table
      .append('tr')
      .attr('class', 'summary-row');

    $row
      .append('td')
      .attr('class', 'cell-icon summary-icon')
      .append('a')
      .attr('target', '_blank')
      .attr('href', changesetURL)
      .append('svg')
      .attr('class', 'logo-small')
      .append('use')
      .attr('xlink:href', '#rapid-logo-osm');

    const $summaryDetail = $row
      .append('td')
      .attr('class', 'cell-detail summary-detail');

    $summaryDetail
      .append('a')
      .attr('class', 'cell-detail summary-view-on-osm')
      .attr('target', '_blank')
      .attr('href', changesetURL)
      .text(l10n.t('success.view_on_osm'));

    $summaryDetail
      .append('div')
      .text(l10n.t('success.your_changeset_id'))   // "Your changeset #:"
      .append('a')
      .attr('target', '_blank')
      .attr('href', changesetURL)
      .text(this._changeset!.id);

    // Get OSM community index features intersecting the map..
    this._getCommunityIndexAsync()
      .then(oci => {
        if (!locations) return;   // community links need the `locations` system

        const loc = map.center();
        if (!loc) return;
        const validHere = locations.locationSetsAt(loc as Vec2);

        // Gather the communities
        const communities: { area: number; order: number; resource: OciResource }[] = [];
        oci.resources.forEach((resource: OciResource) => {
          const area = validHere.get(resource.locationSetID!);
          if (!area) return;

          // Resolve strings
          const localize = (stringID: string) => l10n.t(`_community.${stringID}`);
          resource.resolved = resolveStrings(resource as any, oci.defaults as any, localize);

          communities.push({
            area: area,
            order: resource.order || 0,
            resource: resource
          });
        });

        // sort communities by feature area ascending, community order descending
        communities.sort((a, b) => a.area - b.area || b.order - a.order);

        $body
          .call(this._showCommunityLinks, communities.map(c => c.resource));
      });
  }


  /**
   * Renders the "connect with the community" links section.
   * @param $selection - A d3-selection to the HTMLElement this section renders into
   * @param resources - the community resources to list
   */
  protected _showCommunityLinks($selection: D3Selection, resources: OciResource[]): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const $communityLinks = $selection
      .append('div')
      .attr('class', 'save-communityLinks');

    $communityLinks
      .append('h3')
      .text(l10n.t('success.like_osm'));  // "Like OpenStreetMap? Connect with others:"

    const $table = $communityLinks
      .append('table')
      .attr('class', 'community-table');

    const $row = $table.selectAll('.community-row')
      .data(resources);

    const $$row = $row.enter()
      .append('tr')
      .attr('class', 'community-row');

    $$row
      .append('td')
      .attr('class', 'cell-icon community-icon')
      .append('a')
      .attr('target', '_blank')
      .attr('href', (d: OciResource) => utilSafeURL(d.resolved?.url))
      .append('svg')
      .attr('class', 'logo-small')
      .append('use')
      .attr('xlink:href', (d: OciResource) => `#community-${d.type}`);

    const $communityDetail = $$row
      .append('td')
      .attr('class', 'cell-detail community-detail');

    $communityDetail
      .each((d, i, nodes) => this._showCommunityDetails(d, i, nodes));

    $communityLinks
      .append('div')
      .attr('class', 'community-missing')
      .text(l10n.t('success.missing'))
      .append('a')
      .attr('class', 'link-out')
      .attr('target', '_blank')
      .call(uiIcon('#rapid-icon-out-link', 'inline'))
      .attr('href', 'https://github.com/osmlab/osm-community-index/issues')
      .append('span')
      .text(l10n.t('success.tell_us'));
  }


  /**
   * Renders the details (name, description, events) for a single community.
   * @param d - the bound community datum
   * @param i - the index within the selection
   * @param nodes - the nodes in the selection
   */
  protected _showCommunityDetails(d: OciResource, i: number, nodes: ArrayLike<HTMLElement>): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const $selection = d3_select(nodes[i]);
    const communityID = d.id;

    $selection
      .append('div')
      .attr('class', 'community-name')
      .html(utilSanitizeHTML(d.resolved!.nameHTML));

    $selection
      .append('div')
      .attr('class', 'community-description')
      .html(utilSanitizeHTML(d.resolved!.descriptionHTML));

    // Create an expanding section if any of these are present..
    if (d.resolved!.extendedDescriptionHTML || (d.languageCodes && d.languageCodes.length)) {
      $selection
        .append('div')
        .call(uiDisclosure(context, `community-more-${d.id}`)
          .expanded(false)
          .checkPreference(false)
          .label(l10n.t('success.more'))
          .content(showMore)
        );
    }

    const nextEvents = (d.events || [])
      .map((event: OciEvent) => {
        event.date = this._parseEventDate(event.when);
        return event;
      })
      .filter((event: OciEvent) => {      // date is valid and future (or today)
        const t = event.date?.getTime();
        const now = (new Date()).setHours(0,0,0,0);
        return t !== undefined && !isNaN(t) && t >= now;
      })
      .sort((a: OciEvent, b: OciEvent) => {       // sort by date ascending
        return a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0;
      })
      .slice(0, MAXEVENTS);   // limit number of events shown

    if (nextEvents.length) {
      $selection
        .append('div')
        .call(uiDisclosure(context, `community-events-${d.id}`)
          .expanded(false)
          .checkPreference(false)
          .label(l10n.t('success.events'))
          .content(showNextEvents)
        )
        .select('.hide-toggle')
        .append('span')
        .attr('class', 'badge-text')
        .text(nextEvents.length);
    }


    function showMore($selection: D3Selection): void {
      const $more = $selection.selectAll('.community-more')
        .data([0]);

      const $$more = $more.enter()
        .append('div')
        .attr('class', 'community-more');

      if (d.resolved!.extendedDescriptionHTML) {
        $$more
          .append('div')
          .attr('class', 'community-extended-description')
          .html(utilSanitizeHTML(d.resolved!.extendedDescriptionHTML));
      }

      if (d.languageCodes && d.languageCodes.length) {
        const languageList = d.languageCodes
          .map((code: string) => l10n.languageName(code))
          .join(', ');

        $$more
          .append('div')
          .attr('class', 'community-languages')
          .text(l10n.t('success.languages', { languages: languageList }));
      }
    }


    function showNextEvents($selection: D3Selection): void {
      const $events = $selection
        .append('div')
        .attr('class', 'community-events');

      const $item = $events.selectAll('.community-event')
        .data(nextEvents);

      const $$item = $item.enter()
        .append('div')
        .attr('class', 'community-event');

      $$item
        .append('div')
        .attr('class', 'community-event-name')
        .append('a')
        .attr('target', '_blank')
        .attr('href', (d: OciEvent) => utilSafeURL(d.url))
        .text((d: OciEvent) => {
          let name = d.name;
          if (d.i18n && d.id) {
            name = l10n.t(`_community.${communityID}.events.${d.id}.name`, { default: name });
          }
          return name;
        });

      $$item
        .append('div')
        .attr('class', 'community-event-when')
        .text((d: OciEvent) => {
          const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
          if (d.date!.getHours() || d.date!.getMinutes()) {   // include time if it has one
            options.hour = 'numeric';
            options.minute = 'numeric';
          }
          const localeCode = l10n.localeCode;
          return d.date!.toLocaleString(localeCode, options);
        });

      $$item
        .append('div')
        .attr('class', 'community-event-where')
        .text((d: OciEvent) => {
          let where = d.where;
          if (d.i18n && d.id) {
            where = l10n.t(`_community.${communityID}.events.${d.id}.where`, { default: where });
          }
          return where ?? '';
        });

      $$item
        .append('div')
        .attr('class', 'community-event-description')
        .text((d: OciEvent) => {
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
