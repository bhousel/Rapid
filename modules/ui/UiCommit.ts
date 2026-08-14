import { EventEmitter } from 'tseep/lib/ee-safe';
import { select, selection } from 'd3-selection';
import { utilArrayGroupBy, utilUniqueString } from '@rapid-sdk/util';
import deepEqual from 'fast-deep-equal';

import { OsmChangeset } from '../data/OsmChangeset.ts';
import { uiIcon } from './icon.ts';
import { UiTooltip } from './UiTooltip.ts';
import { UiChangesetEditor } from './UiChangesetEditor.ts';
import { UiSectionChanges } from './sections/UiSectionChanges.ts';
import { UiCommitWarnings } from './UiCommitWarnings.ts';
import { UiSectionRawTagEditor } from './sections/UiSectionRawTagEditor.ts';
import { utilDetect } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmTags } from '../data/types.ts';
import type { ValidationIssue } from '../lib/ValidationIssue.ts';


const readOnlyTags = [
  /^closed:/,
  /^ideditor:/,
  /^rapid:/,
  /^resolved:/,
  /^warnings:/,
  /^changesets_count$/,
  /^created_by$/,
  /^(imagery|photos|data)_used$/,
  /^host$/,
  /^locale$/,
];

// Treat most punctuation (except -, _, +, &) as hashtag delimiters - iD#4398
// from https://stackoverflow.com/a/25575009
const hashtagRegex = /(#[^\u2000-\u206F\u2E00-\u2E7F\s\\'!"#$%()*,.\/:;<=>?@\[\]^`{|}~]+)/g;


/**
 * The `UiCommit` renders the commit/upload sidebar: changeset editor, warnings,
 * upload explanation, request-review checkbox, save/cancel buttons, raw tag
 * editor, and change summary. Call `.render($selection)` to draw it. Emits
 * `cancel` when the user cancels.
 */
export class UiCommit extends EventEmitter {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;

  protected _userDetails: any;

  protected _changesetEditor: UiChangesetEditor;
  protected _rawTagEditor: UiSectionRawTagEditor;
  protected _commitChanges: UiSectionChanges;
  protected _commitWarnings: UiCommitWarnings;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;
    this._userDetails = undefined;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._render = this._render.bind(this);
    this._changeTags = this._changeTags.bind(this);

    this._changesetEditor = new UiChangesetEditor(context)
      .on('change', this._changeTags);
    this._rawTagEditor = new UiSectionRawTagEditor(context, 'changeset-tag-editor')
      .on('change', this._changeTags)
      .readOnlyTags(readOnlyTags);
    this._commitChanges = new UiSectionChanges(context);
    this._commitWarnings = new UiCommitWarnings(context);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }
    const uploader = this.context.systems.uploader!;

    // Initialize changeset if one does not exist yet.
    if (!uploader.changeset) this._initChangeset();

    this._updateSessionChangesetTags();
    $parent.call(this._render);
  }


  /** Creates an initial changeset if one does not exist yet. */
  protected _initChangeset(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const uploader = context.systems.uploader!;

    const localeCode = l10n.localeCode;

    // The draft comment/source/hashtags are session state owned by UploaderSystem.
    // They are seeded from the urlhash at init time (see UploaderSystem.initAsync).
    const detected = utilDetect();
    const tags: OsmTags = {
      comment:     uploader.comment || '',
      created_by:  context.cleanTagValue('Rapid ' + context.version),
      host:        context.cleanTagValue(detected.host),
      locale:      context.cleanTagValue(localeCode)
    };

    // Call findHashtags initially - this will remove stored
    // hashtags if any hashtags are found in the comment - iD#4304
    this._findHashtags(tags, true);

    if (uploader.hashtags) {
      tags.hashtags = uploader.hashtags;
    }

    if (uploader.source) {
      tags.source = uploader.source;
    }

    uploader.changeset = new OsmChangeset(context, { tags: tags });
  }


  /** Calculates and updates the changeset tags based on the user's editing session. */
  protected _updateSessionChangesetTags(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const rapid = context.systems.rapid!;
    const uploader = context.systems.uploader!;
    const validator = context.systems.validator!;

    const tags: OsmTags = { ...uploader.changeset!.tags };   // shallow copy

    // Sync up the `rapid:poweruser` tag
    // Set to true if the user had poweruser on at any point during their editing
    if (rapid.hadPoweruser) {
      tags['rapid:poweruser'] = 'true';
    } else {
      delete tags['rapid:poweruser'];
    }

    // If the user has completed any MapRoulette tasks, we may have sources or comments to use.
    // (do this before we set sources below)
    const mrComments = new Set<string>();
    const mrSources = new Set<string>();
    let usedMapRoulette = false;
    const maproulette = context.services.maproulette;
    if (maproulette) {
      const mapRouletteClosed = maproulette.getClosed();
      const seen = new Set();
      for (const { challengeID } of mapRouletteClosed) {
        if (seen.has(challengeID)) continue;
        seen.add(challengeID);

        const challenge = maproulette.getChallenge(challengeID);
        if (!challenge) continue;

        if (challenge.checkinComment) {
          mrComments.add(challenge.checkinComment);
        }
        if (challenge.checkinSource) {
          mrSources.add(challenge.checkinSource);
        }
      }
      if (mapRouletteClosed.length) {
        usedMapRoulette = true;
      }
    }

    // Replace `comment` tag, if MapRoulette service has provided any...
    if (mrComments.size) {
      tags.comment = [...mrComments].join('\n');
    }

    // Include '#maproulette' `hashtag`, if Maproulette was used..
    if (usedMapRoulette) {
      const hashtags = new Set((tags.hashtags || '').split(';'));
      hashtags.add('#maproulette');
      tags.hashtags = context.cleanTagValue([...hashtags].join(';'));
    }

    // Update `source` tag,
    // also `imagery_used`, `photos_used`, `data_used`
    const used = editor.sourcesUsed();
    const sources = new Set((tags.source || '').split(';'));

    // Users may provide their own `source` values, but these are some values that we set below
    const toRemove = [
      'aerial imagery', 'streetlevel imagery',
      'mapillary', 'kartaview', 'streetside',
      'mapwithai', 'esri',
    ];
    for (const v of toRemove) {
      sources.delete(v);
    }

    // Include MapRoulette `sources`, if MapRoulette service has provided any...
    for (const v of mrSources) {
      sources.add(v);
    }

    // Aerial Imagery
    // Update `imagery_used` tag
    let setImageryUsed;
    if (used.imagery.size) {
      sources.add('aerial imagery');
      setImageryUsed = context.cleanTagValue(Array.from(used.imagery).filter(Boolean).join(';'));
    }
    if (setImageryUsed) {
      tags.imagery_used = setImageryUsed;
    } else {
      delete tags.imagery_used;
    }

    // Streetlevel Photos
    // Update `photos_used` tag
    let setPhotosUsed;
    if (used.photos.size) {
      sources.add('streetlevel imagery');
      for (const v of used.photos) {
        const match = v.match(/(mapillary|kartaview|streetside)/i);
        if (match !== null) {
          sources.add(match[1]);
        }
      }
      setPhotosUsed = context.cleanTagValue(Array.from(used.photos).filter(Boolean).join(';'));
    }
    if (setPhotosUsed) {
      tags.photos_used = setPhotosUsed;
    } else {
      delete tags.photos_used;
    }

    // Rapid, Esri, or Custom datasets
    // Update `data_used` tag
    let setDataUsed;
    if (used.data.size) {
      for (const v of used.data) {
        const match = v.match(/(mapwithai|esri)/i);
        if (match !== null) {
          sources.add(match[1]);
        }
      }
      setDataUsed = context.cleanTagValue(Array.from(used.data).filter(Boolean).join(';'));
    }
    if (setDataUsed) {
      tags.data_used = setDataUsed;
    } else {
      delete tags.data_used;
    }

    // Update `source` tag
    const setSource = context.cleanTagValue(Array.from(sources).filter(Boolean).join(';'));
    if (setSource) {
      tags.source = setSource;
    } else {
      delete tags.source;
    }


    // Clear existing issue counts
    for (const k of Object.keys(tags)) {
      if (/^(closed|warnings|resolved):/.test(k)) {
        delete tags[k];
      }
    }

    // Update tags for closed issues and notes
    const osm = context.services.osm;
    if (osm) {
      const osmClosed = osm.getClosedIDs();
      if (osmClosed.length) {
        tags['closed:note'] = context.cleanTagValue(osmClosed.join(';'));
      }
    }
    const keepright = context.services.keepright;
    if (keepright) {
      const krClosed = keepright.getClosedIDs();
      if (krClosed.length) {
        tags['closed:keepright'] = context.cleanTagValue(krClosed.join(';'));
      }
    }
    const osmose = context.services.osmose;
    if (osmose) {
      const osmoseClosed = osmose.getClosedCounts();
      for (const itemType in osmoseClosed) {
        tags[`closed:osmose:${itemType}`] = context.cleanTagValue(osmoseClosed[itemType].toString());
      }
    }

    // Add counts of warnings generated by the user's edits
    const warnings = validator
      .getIssuesBySeverity({ what: 'edited', where: 'all', includeIgnored: true, includeDisabledRules: true })
      .warning
      .filter(issue => issue.type !== 'help_request');    // exclude 'fixme' and similar - iD#8603

    _addIssueCounts(warnings, 'warnings');

    // add counts of issues resolved by the user's edits
    const resolvedIssues = validator.getResolvedIssues();
    _addIssueCounts(resolvedIssues, 'resolved');

    uploader.changeset = uploader.changeset!.update({ tags: tags });


    function _addIssueCounts(issues: ValidationIssue[], prefix: string): void {
      const issuesByType: Record<string, ValidationIssue[]> = utilArrayGroupBy(issues, 'type');
      for (const issueType in issuesByType) {
        const issuesOfType = issuesByType[issueType];
        if (issuesOfType[0].subtype) {
          const issuesBySubtype: Record<string, ValidationIssue[]> = utilArrayGroupBy(issuesOfType, 'subtype');
          for (const issueSubtype in issuesBySubtype) {
            const issuesOfSubtype = issuesBySubtype[issueSubtype];
            tags[prefix + ':' + issueType + ':' + issueSubtype] = context.cleanTagValue(issuesOfSubtype.length.toString());
          }
        } else {
          tags[prefix + ':' + issueType] = context.cleanTagValue(issuesOfType.length.toString());
        }
      }
    }
  }


  /**
   * Renders the commit sidebar content into the given selection.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  protected _render($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const uploader = context.systems.uploader!;

    const osm = context.services.osm;
    if (!osm) return;

    let header: D3Selection = $selection.selectAll('.header')
      .data([0]);

    const headerTitle = header.enter()
      .append('div')
      .attr('class', 'header fillL');

    headerTitle
      .append('div')
      .append('h3');

    headerTitle
      .append('button')
      .attr('class', 'close')
      .on('click', (d3_event: Event) => {
        this.emit('cancel');
      })
      .call(uiIcon('#rapid-icon-close'));

    // update
    header = header.merge(headerTitle);

    header.select('h3')
      .text(l10n.t('commit.title'));

    let body: D3Selection = $selection.selectAll('.body')
      .data([0]);

    body = body.enter()
      .append('div')
      .attr('class', 'body')
      .merge(body);


    // Changeset Section
    let changesetSection: D3Selection = body.selectAll('.changeset-editor')
      .data([0]);

    changesetSection = changesetSection.enter()
      .append('div')
      .attr('class', 'modal-section changeset-editor')
      .merge(changesetSection);

    changesetSection
      .call(this._changesetEditor
        .changesetID(uploader.changeset!.id)
        .tags(uploader.changeset!.tags)
        .render
      );


    // Warnings
    body.call(this._commitWarnings.render);


    // Upload Explanation
    let saveSection: D3Selection = body.selectAll('.save-section')
      .data([0]);

    saveSection = saveSection.enter()
      .append('div')
      .attr('class','modal-section save-section fillL')
      .merge(saveSection);

    let prose: D3Selection = saveSection.selectAll('.commit-info')
      .data([0]);

    if (prose.enter().size()) {   // first time, make sure to update user details in prose
      this._userDetails = null;
    }

    prose = prose.enter()
      .append('p')
      .attr('class', 'commit-info')
      .text(l10n.t('commit.upload_explanation'))
      .merge(prose);

    // Always check if this has changed, but only update prose.html()
    // if needed, because it can trigger a style recalculation
    osm.getUserDetailsAsync()
      .then((user: any) => {
        if (this._userDetails === user) return;  // no change
        this._userDetails = user;

        const userLink = select(document.createElement('div'));

        const href = user?.img?.href;
        if (href) {
          userLink
            .append('img')
            .attr('src', href)
            .attr('class', 'icon pre-text user-icon');
        }

        userLink
          .append('a')
          .attr('class', 'user-info')
          .text(user.display_name)
          .attr('href', osm.userURL(user.display_name))
          .attr('target', '_blank');

        prose
          .html(l10n.tHtml('commit.upload_explanation_with_user', { user: userLink.html() }));
      });


    // Request Review
    let requestReview: D3Selection = saveSection.selectAll('.request-review')
      .data([0]);

    // Enter
    const requestReviewEnter = requestReview.enter()
      .append('div')
      .attr('class', 'request-review');

    const requestReviewDomId = utilUniqueString('commit-input-request-review');

    const labelEnter = requestReviewEnter
      .append('label')
      .attr('for', requestReviewDomId);

    if (!labelEnter.empty()) {
      labelEnter
        .call(new UiTooltip(context).title(l10n.t('commit.request_review_info')).placement('top').attach);
    }

    labelEnter
      .append('input')
      .attr('type', 'checkbox')
      .attr('id', requestReviewDomId);

    labelEnter
      .append('span');

    // Update
    requestReview = requestReview
      .merge(requestReviewEnter);

    requestReview.selectAll('span')
      .text(l10n.t('commit.request_review'));

    const toggleRequestReview = (): void => {
      const rr = requestReviewInput.property('checked');
      this._updateChangeset({ review_requested: (rr ? 'yes' : undefined) });

      tagSection
        .call(this._rawTagEditor
          .tags({ ...uploader.changeset!.tags })   // shallow copy
          .render
        );
    };

    const requestReviewInput = requestReview.selectAll('input')
      .property('checked', this._isReviewRequested(uploader.changeset!.tags))
      .on('change', toggleRequestReview);


    // Buttons
    let buttonSection: D3Selection = saveSection.selectAll('.buttons')
      .data([0]);

    // enter
    const buttonEnter = buttonSection.enter()
      .append('div')
      .attr('class', 'buttons fillL');

    buttonEnter
      .append('button')
      .attr('class', 'secondary-action button cancel-button')
      .append('span')
      .attr('class', 'label');

    const uploadButton = buttonEnter
      .append('button')
      .attr('class', 'action button save-button');

    uploadButton.append('span')
      .attr('class', 'label');

    const uploadBlockerTooltipText = this._getUploadBlockerMessage();

    // update
    buttonSection = buttonSection
      .merge(buttonEnter);

    buttonSection.selectAll('.cancel-button .label')
      .text(l10n.t('text.cancel'));

    buttonSection.selectAll('.save-button .label')
      .text(l10n.t('text.upload'));

    buttonSection.selectAll('.cancel-button')
      .on('click.cancel', (d3_event: Event) => {
        this.emit('cancel');
      });

    buttonSection.selectAll('.save-button')
      .classed('disabled', uploadBlockerTooltipText !== null)
      .on('click.save', (d3_event: Event) => {
        const el = d3_event.currentTarget as HTMLElement;
        if (!select(el).classed('disabled')) {
          el.blur();    // avoid keeping focus on the button - iD#4641

          const tags = uploader.changeset!.tags;
          for (const [k, v] of Object.entries(tags)) {
            if (!k || !v) {    // remove any empty tags before upload
              delete tags[k];
            }
          }

          uploader.save();
        }
      });

    // remove any existing tooltip
    new UiTooltip(context).destroyAny(buttonSection.selectAll('.save-button'));

    if (uploadBlockerTooltipText) {
      buttonSection.selectAll('.save-button')
        .call(new UiTooltip(context).title(uploadBlockerTooltipText).placement('top').attach);
    }

    // Raw Tag Editor
    let tagSection: D3Selection = body.selectAll('.tag-section.raw-tag-editor')
      .data([0]);

    tagSection = tagSection.enter()
      .append('div')
      .attr('class', 'modal-section tag-section raw-tag-editor')
      .merge(tagSection);

    tagSection
      .call(this._rawTagEditor
        .tags({ ...uploader.changeset!.tags })   // shallow copy
        .render
      );

    let changesSection: D3Selection = body.selectAll('.commit-changes-section')
      .data([0]);

    changesSection = changesSection.enter()
      .append('div')
      .attr('class', 'modal-section commit-changes-section')
      .merge(changesSection);

    // Change summary
    changesSection.call(this._commitChanges.render);
  }


  /**
   * Returns a message explaining why upload is blocked, or `null` if upload is allowed.
   * @return The blocker message, or `null` if there is no blocker
   */
  protected _getUploadBlockerMessage(): string | null {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const uploader = context.systems.uploader!;
    const validator = context.systems.validator!;

    const errors = validator
      .getIssuesBySeverity({ what: 'edited', where: 'all' }).error;

    if (errors.length) {
      return l10n.t('commit.outstanding_errors_message', { count: errors.length });

    } else {
      const comment = uploader.changeset?.tags?.comment ?? '';
      if (!comment.trim().length) {
        return l10n.t('commit.comment_needed_message');
      }
    }
    return null;
  }


  /**
   * Handles a change from the changeset or raw tag editors, updating the changeset.
   * @param _ - the field that changed (unused)
   * @param changed - the changed tags
   * @param onInput - `true` if this is an in-progress input event
   */
  protected _changeTags(_: unknown, changed: Record<string, string | undefined>, onInput: boolean | undefined): void {
    const context = this.context;
    const uploader = context.systems.uploader!;

    if (changed.hasOwnProperty('comment')) {
      if (changed.comment === undefined) {
        changed.comment = '';
      }
      if (!onInput) {
        uploader.comment = changed.comment;
      }
    }
    if (changed.hasOwnProperty('source')) {
      if (changed.source === undefined) {
        uploader.source = '';
      } else if (!onInput) {
        uploader.source = changed.source;
      }
    }
    // no need to update `hashtags` here since it's done in `updateChangeset`

    this._updateChangeset(changed, onInput);

    if (this.$parent) {
      this.$parent.call(this._render);
    }
  }


  /**
   * Extracts a deduplicated list of hashtags from the changeset tags.
   * @param tags - the changeset tags to inspect
   * @param commentOnly - if `true`, only extract hashtags found in the comment
   * @return The list of unique hashtags
   */
  protected _findHashtags(tags: OsmTags, commentOnly: boolean): string[] {
    const context = this.context;
    const uploader = context.systems.uploader!;

    let detectedHashtags = commentHashtags();

    // always remove stored hashtags if there are hashtags in the comment - iD#4304
    if (detectedHashtags.length) {
      uploader.hashtags = '';
    }
    if (!detectedHashtags.length || !commentOnly) {
      detectedHashtags = detectedHashtags.concat(hashtagHashtags());
    }

    const allLowerCase = new Set();
    return detectedHashtags.filter((hashtag: string) => {
      // Compare tags as lowercase strings, but keep original case tags
      const lowerCase = hashtag.toLowerCase();
      if (!allLowerCase.has(lowerCase)) {
        allLowerCase.add(lowerCase);
        return true;
      }
      return false;
    });

    // Extract hashtags from `comment`
    function commentHashtags(): string[] {
      const matches = (tags.comment || '')
        .replace(/http\S*/g, '')  // drop anything that looks like a URL - iD#4289
        .match(hashtagRegex);

      return matches || [];
    }

    // Extract and clean hashtags from `hashtags`
    function hashtagHashtags(): string[] {
      const matches = (tags.hashtags || '')
        .split(/[,;\s]+/)
        .map(function (s: string) {
          if (s[0] !== '#') { s = '#' + s; }    // prepend '#'
          const matched = s.match(hashtagRegex);
          return matched && matched[0];
        }).filter(Boolean) as string[];         // exclude falsy

      return matches || [];
    }
  }


  /**
   * Tests whether the changeset tags request a review.
   * @param tags - the changeset tags to inspect
   * @return `true` if a review is requested
   */
  protected _isReviewRequested(tags: OsmTags): boolean {
    let rr = tags.review_requested;
    if (rr === undefined) return false;
    rr = rr.trim().toLowerCase();
    return !(rr === '' || rr === 'no');
  }


  /**
   * Applies the changed tags to the changeset.
   * @param changed - the changed tags to apply
   * @param onInput - `true` if this is an in-progress input event
   */
  protected _updateChangeset(changed: Record<string, string | undefined>, onInput?: boolean): void {
    const context = this.context;
    const settings = context.systems.settings;
    const uploader = context.systems.uploader!;

    const tags: OsmTags = { ...uploader.changeset!.tags };   // shallow copy

    Object.keys(changed).forEach(function(k) {
      const v = changed[k];
      k = context.cleanTagKey(k);
      if ((readOnlyTags as any[]).indexOf(k) !== -1) return;

      if (v === undefined) {
        delete tags[k];
      } else if (onInput) {
        tags[k] = v;
      } else {
        tags[k] = context.cleanTagValue(v);
      }
    });

    if (!onInput) {
      // when changing the comment, override hashtags with any found in comment.
      const commentOnly = changed.hasOwnProperty('comment') && (changed.comment !== '');
      const arr = this._findHashtags(tags, commentOnly);
      if (arr.length) {
        tags.hashtags = context.cleanTagValue(arr.join(';'));
        uploader.hashtags = tags.hashtags;
      } else {
        delete tags.hashtags;
        uploader.hashtags = '';
      }
    }

    // always update userdetails, just in case user reauthenticates as someone else
    if (this._userDetails?.changesets_count !== undefined) {
      const changesetsCount = this._userDetails.changesets_count + 1;  // iD#4283
      tags.changesets_count = String(changesetsCount);

      // first 100 edits - new user
      if (changesetsCount <= 100) {
        let s;
        s = settings?.get('ui.walkthrough.completed');
        if (s) {
          tags['ideditor:walkthrough_completed'] = s;
        }

        s = settings?.get('ui.walkthrough.progress');
        if (s) {
          tags['ideditor:walkthrough_progress'] = s;
        }

        s = settings?.get('ui.walkthrough.started');
        if (s) {
          tags['ideditor:walkthrough_started'] = s;
        }
      }
    } else {
      delete tags.changesets_count;
    }

    if (!deepEqual(uploader.changeset!.tags, tags)) {
      uploader.changeset = uploader.changeset!.update({ tags: tags });
    }
  }
}

