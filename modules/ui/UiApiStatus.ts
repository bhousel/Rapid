import { select, selection } from 'd3-selection';
import { uiIcon } from './icon.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { DatabaseStatus } from '../core/DatabaseSystem.ts';


/** A message in the status bar. */
interface StatusMessage {
  /** Identifies the message, so it keeps its row while it stays up. */
  id: string;
  /** The message text. */
  text: string;
  /** An optional link after the text, such as "Dismiss" or "Retry". */
  link?: StatusLink;
}

/** A link after a status message's text. */
interface StatusLink {
  /** The link text. */
  text: string;
  /** An optional icon before the link text, e.g. `'#rapid-icon-out-link'`. */
  icon?: string;
  /** Called when the user clicks the link. */
  onClick: () => void;
}


/**
 * `UiApiStatus` displays status messages in a bar across the bottom of the map,
 * for example when the OSM API is unavailable, or when edits can't be backed up.
 * Each problem gets its own message, stacked one above the other.
 */
export class UiApiStatus {
  public context: Context;

  protected _apiStatus: string | null;
  protected _backupStatus: string | null;
  protected _gfxStatus: string | null;
  /** The storage problem the user dismissed, so its message stays hidden until there's a new one. */
  protected _dismissedDatabaseStatus: DatabaseStatus | null;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    const database = context.systems.database;    // optional
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const scheduler = context.systems.scheduler;  // optional

    this._apiStatus = null;
    this._backupStatus = null;
    this._gfxStatus = null;
    this._dismissedDatabaseStatus = null;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this._onApiStatusChange = this._onApiStatusChange.bind(this);
    this._onBackupStatusChange = this._onBackupStatusChange.bind(this);
    this._onDatabaseStatusChange = this._onDatabaseStatusChange.bind(this);
    this._onGfxStatusChange = this._onGfxStatusChange.bind(this);

    // Setup event listeners
    database?.on('statuschange', this._onDatabaseStatusChange);
    editor.on('backupstatuschange', this._onBackupStatusChange);
    gfx.on('statuschange', this._onGfxStatusChange);

    // Note that it's possible to run in an environment without OSM.
    const osm = context.services.osm;
    if (osm) {
      // Count down once per second if we're under a rate limit..
      scheduler?.setInterval('ui-check-rate-limit', () => {
        if (this._apiStatus === 'ratelimit') {
          this.render();
        }
      }, { ms: 1000 });

      // Refresh status periodically regardless of other factors..
      scheduler?.setInterval('ui-check-api-status', () => {
        osm.reloadApiStatus();
      }, { ms: 90000 });

      osm.on('apistatuschange', this._onApiStatusChange);
    }
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

    // Create .api-status wrapper, if necessary
    let $apiStatus: D3Selection = $parent.selectAll('.api-status')
      .data([0]);

    // enter/update
    $apiStatus = $apiStatus.enter()
      .append('div')
      .attr('class', 'api-status')
      .merge($apiStatus);

    // One row per message
    let $messages: D3Selection = $apiStatus.selectAll('.api-status-message')
      .data(this._getMessages(), (d: StatusMessage) => d.id);

    // exit
    $messages.exit()
      .remove();

    // enter/update
    $messages = $messages.enter()
      .append('div')
      .attr('class', 'api-status-message')
      .merge($messages);

    // Empty out each row's content and rebuild it from scratch..
    $messages.each((d: StatusMessage, i: number, nodes: HTMLElement[]) => {
      const $message = select(nodes[i]);
      $message.html('');

      $message
        .append('span')
        .text(d.text);

      const link = d.link;
      if (link) {
        const $link = $message
          .append('a')
          .attr('href', '#')
          .on('click', (e: PointerEvent) => {
            e.preventDefault();
            link.onClick();
          });

        if (link.icon) {
          $link.call(uiIcon(link.icon, 'inline'));
        }

        $link
          .append('span')
          .text(link.text);
      }
    });
  }


  /**
   * Gathers the messages to show, one for each problem, most important first.
   * @return The messages to show, or an empty array if everything is fine
   */
  protected _getMessages(): StatusMessage[] {
    const context = this.context;
    const database = context.systems.database;   // optional
    const l10n = context.systems.l10n!;
    const osm = context.services.osm;            // optional

    const messages: StatusMessage[] = [];

    if (this._gfxStatus === 'contextlost') {
      messages.push({
        id: 'contextlost',
        text: l10n.t('status.message.contextlost'),
        link: {
          text: l10n.t('status.dismiss'),
          onClick: () => {
            this._gfxStatus = null;
            this.render();
          }
        }
      });
    }

    // When the rate limit has expired, this will return `null`
    const rateLimit = osm?.getRateLimit();

    if (this._apiStatus === 'readonly') {
      messages.push({ id: 'readonly', text: l10n.t('status.message.readonly') });

    } else if (this._apiStatus === 'offline') {
      messages.push({ id: 'offline', text: l10n.t('status.message.offline') });

    } else if (this._apiStatus === 'ratelimit' && rateLimit) {
      const message: StatusMessage = {
        id: 'ratelimit',
        text: l10n.t('status.message.ratelimit', { seconds: rateLimit.remaining })
      };

      if (osm && !osm.authenticated()) {   // Tell the user to log in..
        message.link = {
          text: l10n.t('login'),
          icon: '#rapid-icon-out-link',
          onClick: () => {
            osm.authenticate();
            this._apiStatus = 'online';
          }
        };
      }
      messages.push(message);

    } else if (this._apiStatus === 'error') {   // Some other problem, "check your network connection"..
      const message: StatusMessage = {
        id: 'error',
        text: l10n.t('status.message.error')
      };

      if (osm) {   // Let the user manually retry their connection
        message.link = {
          text: l10n.t('status.retry'),
          onClick: () => osm.deferredReloadApiStatus()
        };
      }
      messages.push(message);
    }

    // Browser storage isn't working, so edits aren't backed up..
    const databaseStatus = database?.status;
    if (databaseStatus && databaseStatus !== 'ok' && databaseStatus !== this._dismissedDatabaseStatus) {
      messages.push({
        id: `storage_${databaseStatus}`,
        text: l10n.t(`status.message.storage_${databaseStatus}`),
        link: {
          text: l10n.t('status.dismiss'),
          onClick: () => {
            this._dismissedDatabaseStatus = databaseStatus;
            this.render();
          }
        }
      });
    }

    // Storage is working, but a backup failed (e.g. it's full)..
    if (this._backupStatus === 'error') {
      messages.push({
        id: 'backup_failed',
        text: l10n.t('status.message.backup_failed'),
        link: {
          text: l10n.t('status.dismiss'),
          onClick: () => {
            this._backupStatus = null;
            this.render();
          }
        }
      });
    }

    return messages;
  }


  /**
   * Callback function called on any API status change by the OSM service.
   * @param  apiStatus - probably 'online', 'readonly', or 'offline'
   */
  protected _onApiStatusChange(apiStatus: string): void {
    this._apiStatus = apiStatus ?? 'error';
    this.render();
  }


  /**
   * Callback function called on any backup status change by the EditSystem
   * @param  wasSuccessful - `true` if backups are successful, `false` if not
   */
  protected _onBackupStatusChange(wasSuccessful: boolean): void {
    this._backupStatus = wasSuccessful ? 'ok' : 'error';
    this.render();
  }


  /**
   * Callback function called when the DatabaseSystem's storage stops (or starts) working.
   * The message reads the status from the DatabaseSystem, so this just redraws.
   */
  protected _onDatabaseStatusChange(): void {
    this.render();
  }


  /**
   * Callback function called when the GraphicsSystem loses context
   * @param  status - one of 'contextlost' or 'contextrestored'
   */
  protected _onGfxStatusChange(status: string): void {
    if (status === 'contextlost') {  // notify the user about this
      this._gfxStatus = status;
      this.render();
    }
  }
}
