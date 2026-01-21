import { select as d3_select } from 'd3-selection';

import { AbstractMode } from './AbstractMode.ts';
import { uiCommit } from '../ui/commit.js';
import { uiConfirm } from '../ui/confirm.js';
import { uiConflicts } from '../ui/conflicts.js';
import { uiLoading } from '../ui/loading.js';
import { uiSuccess } from '../ui/success.js';
import { utilKeybinding } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection, D3EnterSelection } from 'd3-selection';
import type { Keybinding } from '../util/keybinding.ts';

const DEBUG = false;


/**
 * `SaveMode`
 * In this mode, the user is ready to upload their changes
 */
export class SaveMode extends AbstractMode {
  /** Keybinding handler for this mode */
  private _keybinding: Keybinding;
  /** Current location string for success message */
  private _location: string | null;
  /** UI component for conflicts */
  private _uiConflicts: any;
  /** UI component for commit */
  private _uiCommit: any;
  /** UI component for success message */
  private _uiSuccess: any;
  /** UI component for save loading */
  private _saveLoading: any;
  /** Whether the save was successful */
  private _wasSuccessfulSave: boolean;

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'save';

    this._keybinding = utilKeybinding('SaveMode');

    // Make sure the event handlers have `this` bound correctly
    this._cancel = this._cancel.bind(this);
    this._hideLoading = this._hideLoading.bind(this);
    this._keybindingOff = this._keybindingOff.bind(this);
    this._keybindingOn = this._keybindingOn.bind(this);
    this._prepareForSuccess = this._prepareForSuccess.bind(this);
    this._progressChanged = this._progressChanged.bind(this);
    this._resultConflicts = this._resultConflicts.bind(this);
    this._resultErrors = this._resultErrors.bind(this);
    this._resultNoChanges = this._resultNoChanges.bind(this);
    this._resultSuccess = this._resultSuccess.bind(this);
    this._saveEnded = this._saveEnded.bind(this);
    this._saveStarted = this._saveStarted.bind(this);
    this._showLoading = this._showLoading.bind(this);

    this._location = null;
    this._uiConflicts = null;
    this._uiCommit = null;
    this._uiSuccess = null;
    this._saveLoading = null;
    this._wasSuccessfulSave = false;
  }


  /**
   * enter
   * Enters the mode.
   * @return  `true` if mode could be entered, `false` it not
   */
  enter(): boolean {
    const context = this.context;
    const osm = context.services.osm as any;
    const ui = context.systems.ui!;
    const uploader = context.systems.uploader!;
    const Sidebar = ui.Sidebar;

    if (!osm) return false;  // can't enter save mode

    if (DEBUG) {
      console.log('SaveMode: entering');  // eslint-disable-line no-console
    }

    // Show sidebar
    Sidebar.expand();

    this._active = true;
    this._wasSuccessfulSave = false;

    this._uiCommit = (uiCommit(context) as any)
      .on('cancel', this._cancel);

    if (osm.authenticated()) {
      Sidebar.show(this._uiCommit);
    } else {
      osm.authenticate((err: Error | null) => {
        if (err) {
          this._cancel();
        } else {
          Sidebar.show(this._uiCommit);
        }
      });
    }

    context.container().selectAll('.main-content')
      .classed('active', false)
      .classed('inactive', true);

    this._keybindingOn();
    context.enableBehaviors(['mapInteraction']);

    uploader
      .on('progressChanged', this._progressChanged)
      .on('resultConflicts', this._resultConflicts)
      .on('resultErrors', this._resultErrors)
      .on('resultNoChanges', this._resultNoChanges)
      .on('resultSuccess', this._resultSuccess)
      .on('saveEnded', this._saveEnded)
      .on('saveStarted', this._saveStarted)
      .on('willAttemptUpload', this._prepareForSuccess);

    return true;
  }


  /**
   * exit
   * Exits the mode, cleaning up event listeners and UI state.
   * If save was successful, leaves the success message in the sidebar.
   */
  exit(): void {
    if (!this._active) return;
    this._active = false;

    if (DEBUG) {
      console.log('SaveMode: exiting');  // eslint-disable-line no-console
    }

    const context = this.context;
    const ui = context.systems.ui!;
    const uploader = context.systems.uploader!;
    const Sidebar = ui.Sidebar;

    this._uiCommit.on('cancel', null);
    this._uiCommit = null;

    uploader
      .off('progressChanged', this._progressChanged)
      .off('resultConflicts', this._resultConflicts)
      .off('resultErrors', this._resultErrors)
      .off('resultNoChanges', this._resultNoChanges)
      .off('resultSuccess', this._resultSuccess)
      .off('saveEnded', this._saveEnded)
      .off('saveStarted', this._saveStarted)
      .off('willAttemptUpload', this._prepareForSuccess);

    this._keybindingOff();
    this._hideLoading();

    context.container().selectAll('.main-content')
      .classed('active', true)
      .classed('inactive', false);

    // After a successful save, we want to leave the "thanks" content in the sidebar
    if (!this._wasSuccessfulSave) {
      Sidebar.hide();
    }
  }


  /**
   * _cancel
   * Return to browse mode, canceling the save operation.
   */
  private _cancel(): void {
    this.context.enter('browse');
  }


  /**
   * _progressChanged
   * Handler called when upload progress changes.
   * Updates the loading modal to show conflict resolution progress.
   * @param  num - Number of conflicts resolved so far
   * @param  total - Total number of conflicts to resolve
   */
  private _progressChanged(num: number, total: number): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const $modal: D3Selection = context.container().select('.loading-modal .modal-section');
    const $progress: D3Selection = $modal.selectAll('.progress')
      .data([0]);

    // enter/update
    $progress.enter()
      .append('div')
      .attr('class', 'progress')
      .merge($progress)
      .text(l10n.t('save.conflict_progress', { num: num, total: total }));
  }


  /**
   * _resultConflicts
   * Handler called when upload results in conflicts with server data.
   * Displays the conflicts UI so the user can resolve them.
   * @param  conflicts - Array of conflict objects describing the conflicts
   * @param  origChanges - The original changeset that caused the conflicts
   */
  private _resultConflicts(conflicts: any[], origChanges: any): void {
    const context = this.context;
    const uploader = context.systems.uploader!;

    const $selection: D3Selection = context.container().select('.sidebar')
      .append('div')
      .attr('class','sidebar-component');

    const $mainContent: D3Selection = context.container().selectAll('.main-content');

    $mainContent
      .classed('active', true)
      .classed('inactive', false);

    this._uiConflicts = (uiConflicts(context) as any)
      .conflictList(conflicts)
      .origChanges(origChanges)
      .on('cancel', () => {
        $mainContent
          .classed('active', false)
          .classed('inactive', true);
        $selection.remove();
        this._keybindingOn();
        uploader.cancelConflictResolution();
      })
      .on('save', () => {
        $mainContent
          .classed('active', false)
          .classed('inactive', true);
        $selection.remove();
        uploader.processResolvedConflicts();
      });

    $selection.call(this._uiConflicts);
  }


  /**
   * _resultErrors
   * Handler called when upload results in errors.
   * Displays an error dialog to the user.
   * @param  errors - Array of error objects with msg and details properties
   */
  private _resultErrors(errors: any[]): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    this._keybindingOn();

    const $selection = uiConfirm(context, context.container());
    $selection
      .select('.modal-section.header')
      .append('h3')
      .text(l10n.t('save.error'));

    this._addErrors($selection, errors);
    $selection.okButton();
  }


  /**
   * _addErrors
   * Helper to render error messages into a D3 selection.
   * Creates expandable error items with details.
   * @param  $selection - The D3 selection to render errors into
   * @param  data - Array of error objects with msg and details properties
   */
  private _addErrors($selection: D3Selection, data: any[]): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const $message: D3Selection = $selection
      .select('.modal-section.message-text');

    const $items: D3Selection = $message
      .selectAll('.error-container')
      .data(data);

    const $$items: D3EnterSelection = $items.enter()
      .append('div')
      .attr('class', 'error-container');

    $$items
      .append('a')
      .attr('class', 'error-description')
      .attr('href', '#')
      .classed('hide-toggle', true)
      .text(d => d?.msg || l10n.t('save.unknown_error_details'))
      .on('click', function(this: Element, d3_event: Event) {
        d3_event.preventDefault();

        const $error: D3Selection = d3_select(this);
        const $detail: D3Selection = d3_select((this as HTMLElement).nextElementSibling);
        const exp = $error.classed('expanded');

        $detail.style('display', exp ? 'none' : 'block');
        $error.classed('expanded', !exp);
      });

    const $$details: D3EnterSelection = $$items
      .append('div')
      .attr('class', 'error-detail-container')
      .style('display', 'none');

    $$details
      .append('ul')
      .attr('class', 'error-detail-list')
      .selectAll('li')
      .data(d => d?.details || [])
      .enter()
      .append('li')
      .attr('class', 'error-detail-item')
      .text(d => d);

    $items.exit()
      .remove();
  }


  /**
   * _resultNoChanges
   * Handler called when there are no changes to upload.
   * Resets the editor and returns to browse mode.
   */
  private _resultNoChanges(): void {
    const context = this.context;
    context.resetAsync()
      .then(() => context.enter('browse'));
  }


  /**
   * _resultSuccess
   * Handler called when upload succeeds.
   * Shows the success screen and resets after a delay.
   * @param  changeset - The changeset object that was successfully uploaded
   */
  private _resultSuccess(changeset: any): void {
    const context = this.context;
    const ui = context.systems.ui!;
    const Sidebar = ui.Sidebar;

    const successContent = this._uiSuccess
      .changeset(changeset)
      .location(this._location)
      .on('cancel', () => Sidebar.hide());

    this._wasSuccessfulSave = true;
    Sidebar.show(successContent);

    // Add delay before resetting to allow for postgres replication iD#1646 iD#2678
    globalThis.setTimeout(() => {
      context.resetAsync()
        .then(() => context.enter('browse'));
    }, 2500);
  }


  /**
   * _saveStarted
   * Handler called when save operation begins.
   * At this point, a changeset is inflight and we need to block the UI
   * by disabling keybindings and showing a loading indicator.
   */
  private _saveStarted(): void {
    this._keybindingOff();
    this._showLoading();
  }


  /**
   * _saveEnded
   * Handler called when save operation ends (success or failure).
   * At this point, the changeset is no longer inflight and we can unblock the UI.
   * Note: This may occur after an error condition.
   */
  private _saveEnded(): void {
    this._keybindingOn();
    this._hideLoading();
  }


  /**
   * _showLoading
   * Block the UI by adding a spinner
   */
  private _showLoading(): void {
    if (this._saveLoading) return;

    const context = this.context;
    const l10n = context.systems.l10n!;

    const loading = uiLoading(context);
    loading.blocking(true);
    loading.message(l10n.t('save.uploading'));
    this._saveLoading = loading;
    context.container().call(this._saveLoading);  // block input during upload
  }


  /**
   * _hideLoading
   * Unlock the UI by removing the spinner
   */
  private _hideLoading(): void {
    if (!this._saveLoading) return;

    this._saveLoading.close();
    this._saveLoading = null;
  }


  /**
   * _keybindingOn
   * Enable keyboard shortcuts for the save mode (Escape to cancel).
   */
  private _keybindingOn(): void {
    d3_select(document).call(this._keybinding.on('⎋', this._cancel, true));
  }


  /**
   * _keybindingOff
   * Disable keyboard shortcuts for the save mode.
   */
  private _keybindingOff(): void {
    d3_select(document).call(this._keybinding.unbind);
  }


  /**
   * Reverse geocode current map location so we can display a message on
   * the success screen like "Thank you for editing around place, region."
   */
  private _prepareForSuccess(): void {
    this._uiSuccess = uiSuccess(this.context);
    this._location = null;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const loc = context.viewport.centerLoc();

    const nominatim = context.services.nominatim as any;
    if (!nominatim) return;

    nominatim.reverse(loc, (err: Error | null, result: any) => {
      if (err || !result || !result.address) return;

      const addr = result.address;
      const place = addr?.town ?? addr?.city ?? addr?.county ?? '';
      const region = addr?.state ?? addr?.country ?? '';
      const separator = (place && region) ? l10n.t('success.thank_you_where.separator') : '';

      this._location = l10n.t('success.thank_you_where.format',
        { place: place, separator: separator, region: region }
      );
    });
  }

}
