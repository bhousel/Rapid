import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { SessionRecord } from '../core/EditSystem.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * `UiRestore` is a Modal component that lists the user's restorable edit sessions from previous
 * visits and lets them restore or delete each one (or skip and start fresh).
 *
 * It is a one-shot modal creator: `render()` takes no argument and renders into the modal's
 * `$content` selection (owned by `UiModal`). The session list is loaded asynchronously and each
 * row's location is reverse-geocoded best-effort via the `nominatim` service.
 */
export class UiRestore {
  public context: Context;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Renders the restore modal and kicks off an async load of the session list.
   */
  public render(): void {
    const context = this.context;
    const database = context.systems.database;   // optional
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    if (!editor.canRestoreBackup) return;

    const Modal = new UiModal(context, true).show();
    Modal.$modal!.attr('class', 'modal fillL restore-modal');

    const $content = Modal.$content!;

    $content
      .append('div')
      .attr('class', 'modal-section')
      .append('h3')
      .text(l10n.t('restore.heading_multi'));

    $content
      .append('div')
      .attr('class', 'modal-section')
      .append('p')
      .text(l10n.t('restore.description_multi'));

    // Warn if there is no durable storage (incognito / locked-down) — restores won't persist.
    if (!database?.isAvailable) {
      $content
        .append('div')
        .attr('class', 'modal-section restore-no-storage')
        .append('p')
        .text(l10n.t('restore.no_storage'));
    }

    const $listSection = $content
      .append('div')
      .attr('class', 'modal-section restore-list');

    const $actions = $content
      .append('div')
      .attr('class', 'modal-actions');

    $actions
      .append('button')
      .attr('class', 'restore-skip')
      .on('click', () => {
        editor.dismissRestore();
        Modal.close();
      })
      .append('div')
      .text(l10n.t('restore.skip'));

    // Load the sessions asynchronously, then render the rows.
    editor.listRestorableSessionsAsync()
      .then(sessions => {
        if (!Modal.isShown) return;   // user already dismissed
        this._renderSessions(Modal, $listSection, sessions);
      });
  }


  /**
   * Renders the session rows into the list section.
   * @param Modal - The owning modal (so rows can close it on restore / skip)
   * @param $section - The list section selection to render into
   * @param sessions - The restorable sessions to display
   */
  protected _renderSessions(Modal: UiModal, $section: D3Selection, sessions: SessionRecord[]): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    $section.selectAll('*').remove();

    // Nothing to restore (e.g. the sessions were cleared in another tab) — dismiss.
    if (!sessions.length) {
      editor.dismissRestore();
      Modal.close();
      return;
    }

    const $table = $section
      .append('table')
      .attr('class', 'restore-sessions');

    const $head = $table.append('thead').append('tr');
    $head.append('th').text(l10n.t('restore.column_date'));
    $head.append('th').text(l10n.t('restore.column_location'));
    $head.append('th').text(l10n.t('restore.column_summary'));
    $head.append('th').attr('class', 'restore-actions-col');

    const $body = $table.append('tbody');

    for (const session of sessions) {
      const $row = $body.append('tr');

      // Date
      $row
        .append('td')
        .attr('class', 'restore-date')
        .text(session.updatedAt
          ? l10n.displayShortDate(session.updatedAt)
          : l10n.t('restore.unknown_date'));

      // Location (reverse-geocoded asynchronously)
      const $location = $row
        .append('td')
        .attr('class', 'restore-location');
      this._fillLocation($location, session.bbox);

      // Summary — edit count plus the most common feature tags
      const parts = [ l10n.t('restore.edits', { n: session.editCount }) ];
      if (session.summary.length) {
        parts.push(`(${session.summary.join(', ')})`);
      }
      $row
        .append('td')
        .attr('class', 'restore-summary')
        .text(parts.join('  '));

      // Actions
      const $rowActions = $row
        .append('td')
        .attr('class', 'restore-actions');

      $rowActions
        .append('button')
        .attr('class', 'restore-session')
        .text(l10n.t('restore.restore_session'))
        .on('click', () => {
          Modal.close();
          editor.restoreSessionAsync(session.id);
        });

      $rowActions
        .append('button')
        .attr('class', 'delete-session')
        .text(l10n.t('restore.delete_session'))
        .on('click', () => {
          editor.deleteSessionAsync(session.id);
          $row.remove();
          if ($body.selectAll('tr').empty()) {   // deleted the last one
            editor.dismissRestore();
            Modal.close();
          }
        });
    }
  }


  /**
   * Fills a location cell with a reverse-geocoded place name for the session's bbox center.
   * Falls back to coordinates (or "unknown") when geocoding is unavailable.
   * @param $cell - The location cell selection to fill
   * @param bbox - The session's bounding box, if any
   */
  protected _fillLocation($cell: D3Selection, bbox: SessionRecord['bbox']): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const nominatim = context.services.nominatim;   // optional service

    if (!bbox) {
      $cell.text(l10n.t('restore.unknown_location'));
      return;
    }

    const center: Vec2 = [ (bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2 ];
    const coordText = `${center[1].toFixed(4)}, ${center[0].toFixed(4)}`;

    if (!nominatim) {
      $cell.text(coordText);
      return;
    }

    $cell.text('…');
    nominatim.reverse(center, (err: unknown, result: { display_name?: string; address?: Record<string, string> }) => {
      if (err || !result) {
        $cell.text(coordText);
      } else {
        $cell.text(this._shortPlaceName(result) || coordText);
      }
    });
  }


  /**
   * Builds a short place name from a Nominatim reverse-geocode result (e.g. "Warren, New Jersey").
   * @param result - The Nominatim result, with an optional `address` breakdown
   * @return A short "place, region" string, or the full display name as a fallback
   */
  protected _shortPlaceName(result: { display_name?: string; address?: Record<string, string> }): string {
    const a = result.address ?? {};
    const place = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.county;
    const region = a.state ?? a.region ?? a.country;

    if (place && region) return `${place}, ${region}`;
    return place ?? region ?? result.display_name ?? '';
  }
}
