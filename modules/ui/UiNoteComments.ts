import { select, selection } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { utilSanitizeHTML } from '../util/sanitize.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmNote } from '../services/OsmService.ts';

interface NoteComment {
  uid?: string;
  user?: string;
  action?: string;
  date?: string;
  html?: string;
}


/**
 * `UiNoteComments` renders the comment thread for an OSM Note (with avatars).
 * Set the note to display via the public `datum` property, then call `.render($parent)`.
 */
export class UiNoteComments {
  public context: Context;
  public datum: OsmNote | null;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.datum = null;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._replaceAvatars = this._replaceAvatars.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
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

    if (!this.datum || this.datum.isNew) return;  // new notes won't have a comment section

    let $comments: D3Selection = $parent.selectAll('.comments-container')
      .data([0]);

    $comments = $comments.enter()
      .append('div')
      .attr('class', 'comments-container')
      .merge($comments);

    const $$comment = $comments.selectAll('.comment')
      .data(this.datum.props.comments ?? [])
      .enter()
      .append('div')
      .attr('class', 'comment');

    $$comment
      .append('div')
      .attr('class', (d: NoteComment) => `comment-avatar user-${d.uid}`)
      .call(uiIcon('#rapid-icon-avatar', 'comment-avatar-icon'));

    const $$main = $$comment
      .append('div')
      .attr('class', 'comment-main');

    const $$metadata = $$main
      .append('div')
      .attr('class', 'comment-metadata');

    $$metadata
      .append('div')
      .attr('class', 'comment-author')
      .each((d: NoteComment, i: number, nodes: ArrayLike<HTMLElement>) => {
        let $author: D3Selection = select(nodes[i]);
        const osm = context.services.osm;
        if (osm && d.user) {
          $author = $author
            .append('a')
            .attr('class', 'comment-author-link')
            .attr('href', osm.userURL(d.user))
            .attr('target', '_blank');
        }
        if (d.user) {
          $author.text(d.user);
        } else {
          $author.text(l10n.t('note.anonymous'));
        }
      });

    $$metadata
      .append('div')
      .attr('class', 'comment-date')
      .text((d: NoteComment) => l10n.t(`note.status.${d.action}`, { when: l10n.displayShortDate(d.date ?? '') }));

    $$main
      .append('div')
      .attr('class', 'comment-text')
      .html((d: NoteComment) => utilSanitizeHTML(d.html))
      .selectAll('a')
        .attr('rel', 'noopener nofollow')
        .attr('target', '_blank');

    $comments
      .call(this._replaceAvatars);
  }


  /** Swaps in third-party avatar images for comment authors (if enabled). */
  protected _replaceAvatars($selection: D3Selection): void {
    const context = this.context;
    const settings = context.systems.settings;
    const osm = context.services.osm;

    const showThirdPartyIcons = settings?.get('ui.privacy.thirdPartyIcons') ?? 'true';
    if (showThirdPartyIcons !== 'true' || !osm) return;

    const uids = new Set<string>();  // gather uids in the comment thread
    for (const d of (this.datum?.props.comments ?? [])) {
      if (d.uid) uids.add(d.uid);
    }

    for (const uid of uids) {
      osm.loadUserAsync(uid)
        .then((user: any) => {
          const href = user?.img?.href;
          if (!href) return;

          $selection.selectAll(`.comment-avatar.user-${uid}`)
            .html('')
            .append('img')
            .attr('class', 'icon comment-avatar-icon')
            .attr('src', href)
            .attr('alt', user.display_name);
        });
    }
  }
}
