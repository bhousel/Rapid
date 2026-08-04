import { EventEmitter } from 'tseep/lib/ee-safe';
import { select as d3_select, selection } from 'd3-selection';

import { uiIcon } from './icon.js';
import { UiMapRouletteDetails } from './UiMapRouletteDetails.js';
import { UiMapRouletteHeader } from './UiMapRouletteHeader.js';
import { UiViewOn } from './UiViewOn.js';
import { utilNoAuto } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * pick a color for the given action
 * @param action - the action taken (e.g. 'FIXED', 'NOT AN ISSUE')
 */
function getActionColor(action: string): string {
  switch (action) {
    case 'FIXED':
      return '#62c9d3';
    case `CAN'T COMPLETE`:
      return '#fe5e63';
    case 'ALREADY FIXED':
      return '#ccb185';
    case 'NOT AN ISSUE':
      return '#f7ba59';
    default:
      return 'black';
  }
}


/**
 * The `UiMapRouletteEditor` renders the sidebar editor for a MapRoulette task
 * (header, details, action buttons, comment + submit). Set the task via the public
 * `datum` property, then call `.render($parent)`. Emits `change` when the task is updated.
 */
export class UiMapRouletteEditor extends EventEmitter {
  public context: Context;
  public datum: any;

  protected _header: UiMapRouletteHeader;
  protected _details: UiMapRouletteDetails;
  protected _viewOn: UiViewOn;
  protected _actionTaken: string;
  protected _apikey: string | null;
  protected _user: any;

  // D3 selections
  public $parent: D3Selection | null;

  public constructor(context: Context) {
    super();
    this.context = context;
    this.datum = null;
    this._actionTaken = '';
    this._apikey = null;
    this._user = null;

    this._header = new UiMapRouletteHeader(context);
    this._details = new UiMapRouletteDetails(context);
    this._viewOn = new UiViewOn(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this._saveSection = this._saveSection.bind(this);
    this._commentSaveSection = this._commentSaveSection.bind(this);
    this._userDetails = this._userDetails.bind(this);
    this._saveButtons = this._saveButtons.bind(this);
    this._submitButtons = this._submitButtons.bind(this);
    this._nearbyTaskChanged = this._nearbyTaskChanged.bind(this);
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
    const maproulette = context.services.maproulette as any;
    const osm = context.services.osm as any;

    if (!osm || !maproulette) return;

    const $header: D3Selection = $parent.selectAll('.header')
      .data([0]);

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'header fillL');

    $$header
      .append('button')
      .attr('class', 'close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    $$header
      .append('h3');

    // update
    $header.merge($$header)
      .select('h3')
      .text(l10n.t('map_data.layers.maproulette.title', { n: 1 }));

    let $body: D3Selection = $parent.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    const $editor: D3Selection = $body.selectAll('.mr-editor')
      .data([0]);

    this._header.datum = this.datum;
    this._details.datum = this.datum;

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section mr-editor')
      .merge($editor)
      .call(this._header.render)
      .call(this._details.render)
      .call(this._saveSection)
      .call(this._commentSaveSection);


    this._viewOn.stringID = 'inspector.view_on_maproulette';
    this._viewOn.url = (maproulette && this.datum) ? maproulette.itemURL(this.datum) : '';

    const $footer: D3Selection = $parent.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(this._viewOn.render);
  }


  /** Fetch the user's MapRoulette API key from their OSM preferences. */
  protected _getApiKeyAsync(): Promise<any> {
    const osm = this.context.services.osm as any;
    return osm.getUserPreferencesAsync()
      .then((prefs: any) => {
        this._apikey = prefs.maproulette_apikey_v2;
        return this._apikey;
      })
      .catch((err: any) => {
        this._apikey = null;
        console.error(err);  // eslint-disable-line no-console
      });
  }


  /**
   * Render the save section (user details + action buttons).
   * @param $selection - A d3-selection to the HTMLElement this section renders into
   */
  protected _saveSection($selection: D3Selection): void {
    const errID = this.datum?.id;
    const isSelected = errID && this.context.selectedData().has(errID);
    const isShown = (this.datum && isSelected);

    let $saveSection: D3Selection = $selection.selectAll('.mr-save')
      .data(isShown ? [this.datum] : [], (d: any) => d.key);

    // exit
    $saveSection.exit()
      .remove();

    // enter
    const $$saveSection = $saveSection.enter()
      .append('div')
      .attr('class', 'mr-save save-section');

    // update
    $saveSection = $saveSection
      .merge($$saveSection)
      .call(this._userDetails)
      .call(this._saveButtons);
  }


  /**
   * render the comment save section
   * @param $selection - A d3-selection to the HTMLElement this section renders into
   */
  protected _commentSaveSection($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const maproulette = context.services.maproulette as any;

    const errID = this.datum?.id;
    const isSelected = errID && context.selectedData().has(errID);

    let $commentSave: D3Selection = $selection.selectAll('.note-save')
      .data(isSelected && this._actionTaken ? [this.datum] : [], (d: any) => d.key);

    const changeInput = (d3_event: Event): void => {
      const $input = d3_select(d3_event.currentTarget as any);
      const val = ($input.property('value') as string).trim() || undefined;

      this.datum.props.newComment = val;
      this.datum.touch();
      if (maproulette) {
        maproulette.replaceTask(this.datum);  // update note cache
      }

      $commentSave
        .call(this._saveButtons);
    };

    // exit
    $commentSave.exit()
      .remove();

    // enter
    const $$commentSave = $commentSave.enter()
      .append('div')
      .attr('class', 'note-save save-section');

    $$commentSave
      .append('h4')
      .attr('class', 'note-save-header');

    $$commentSave
      .append('textarea')
      .attr('class', 'new-comment-input')
      .attr('maxlength', 1000)
      .property('value', (d: any) => d.props.newComment)
      .call(utilNoAuto)
      .on('input.note-input', changeInput)
      .on('blur.note-input', changeInput)
      .style('resize', 'none');

    // update
    $commentSave = $commentSave
      .merge($$commentSave);

    $commentSave.select('.new-comment-input')
      .attr('placeholder', l10n.t('map_data.layers.maproulette.inputPlaceholder'));

    $commentSave.select('.note-save-header')  // Corrected class name
      .html(l10n.t('map_data.layers.maproulette.comment') +
        ' <span style="color: ' + getActionColor(this._actionTaken) + ';">' + this._actionTaken + '</span>'
      );

    $commentSave
      .call(this._userDetails)
      .call(this._submitButtons);
  }


  /**
   * Render the user details and authentication warning section.
   * @param $selection - A d3-selection to the HTMLElement this section renders into
   */
  protected _userDetails($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const osm = context.services.osm as any;

    let $detailSection: D3Selection = $selection.selectAll('.detail-section')
      .data([0]);

    $detailSection = $detailSection.enter()
      .append('div')
      .attr('class', 'detail-section')
      .merge($detailSection);

    const $authWarning = $detailSection.selectAll('.auth-warning')
      .data([0]);

    const updateAuthWarning = ($sel: D3Selection, messageKey: string): void => {
      const isAuthenticated = (this._user && this._apikey);

      if (isAuthenticated) {
        $sel.exit()
          .transition()
          .duration(200)
          .style('opacity', 0)
          .remove();

      } else {
        const $$auth = $sel.enter()
          .insert('div', '.tag-reference-body')
          .attr('class', 'field-warning auth-warning')
          .style('opacity', 0);

        $$auth
          .call(uiIcon('#rapid-icon-alert', 'inline'));

        $$auth
          .append('span')
          .text(l10n.t(messageKey));

        if (messageKey === 'map_data.layers.maproulette.loginMaproulette') {
          // If the message is for MapRoulette login, change the link destination
          $$auth
            .append('a')
            .attr('target', '_blank')
            .attr('href', 'https://maproulette.org/dashboard')
            .call(uiIcon('#rapid-icon-out-link', 'inline'))
            .append('span')
            .text(l10n.t('login'));
        } else {
          $$auth
            .append('a')
            .attr('target', '_blank')
            .call(uiIcon('#rapid-icon-out-link', 'inline'))
            .append('span')
            .text(l10n.t('login'))
            .on('click.note-login', (d3_event: Event) => {
              d3_event.preventDefault();
              osm.authenticate();
            });
        }

        $$auth
          .transition()
          .duration(200)
          .style('opacity', 1);
      }
    };

    updateAuthWarning($authWarning, 'map_data.layers.maproulette.login');

    this._getApiKeyAsync()
      .then(() => {
        updateAuthWarning($authWarning, 'map_data.layers.maproulette.loginMaproulette');
      });

    osm.getUserDetailsAsync()
      .then((user: any) => {
        this._user = user;
        const $userLink = d3_select(document.createElement('div'));

        const href = user?.img?.href;
        if (href) {
          $userLink
            .append('img')
            .attr('src', href)
            .attr('class', 'icon pre-text user-icon');
        }

        $userLink
          .append('a')
          .attr('class', 'user-info')
          .text(user.display_name)
          .attr('href', osm.userURL(user.display_name))
          .attr('target', '_blank');
      })
      .catch((err: any) => {
        this._user = null;
        console.error(err);  // eslint-disable-line no-console
      });
  }


  /**
   *  Render the MapRoulette action buttons
   *  "I Fixed It", "Can't Complete", "Already Fixed", "Not an Issue"
   *  These buttons are available only after the user has completed authentication.
   *  @param $selection - A d3-selection to the HTMLElement this section renders into
   */
  protected _saveButtons($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const maproulette = context.services.maproulette as any;
    const ui = context.systems.ui as any;  // optional

    this._getApiKeyAsync()
      .then(() => {
        const hasAuth = (this._user && this._apikey);
        const errID = this.datum?.id;
        const isSelected = errID && context.selectedData().has(errID);

        // Check if the MapRoulette menu is showing
        if (ui?._showsMapRouletteMenu) {
          $selection.selectAll('.mr-save .buttons').style('display', 'none');
          return;
        } else {
          $selection.selectAll('.mr-save .buttons').style('display', ''); // Ensure buttons are shown if menu is not open
        }

        const isSaveDisabled = (d: any): true | null => {
          return (d && hasAuth) ? null : true;
        };

        let $buttons: D3Selection = $selection.selectAll('.buttons')
          .data(isSelected ? [this.datum] : [], (d: any) => d.key);

        // exit
        $buttons.exit()
          .remove();

        // enter
        const $$buttons = $buttons.enter()
          .append('div')
          .attr('class', 'buttons');

        $$buttons
          .append('button')
          .attr('class', 'button fixedIt-button action');

        $$buttons
          .append('button')
          .attr('class', 'button cantComplete-button action');

        $$buttons
          .append('button')
          .attr('class', 'button alreadyFixed-button action');

        $$buttons
          .append('button')
          .attr('class', 'button notAnIssue-button action');

        const $$checkboxNearby = $$buttons.append('div')
          .attr('class', 'checkbox-section');

        $$checkboxNearby
          .append('input')
          .attr('type', 'checkbox')
          .attr('id', 'nearbyTaskCheckbox')
          .property('checked', maproulette.nearbyTaskEnabled)
          .on('change', this._nearbyTaskChanged);

        $$checkboxNearby
          .append('label')
          .attr('class', 'nearby-task-label')
          .attr('for', 'nearbyTaskCheckbox');

        // update
        $buttons = $buttons
          .merge($$buttons);

        $buttons.select('.nearby-task-label')
          .text(l10n.t('map_data.layers.maproulette.nearbyTask.title'));

        $buttons.select('.fixedIt-button')
          .attr('disabled', isSaveDisabled(this.datum))
          .text(l10n.t('map_data.layers.maproulette.fixed'))
          .on('click.fixedIt', (d3_event: Event, d: any) => this._fixedIt(d3_event, d, $selection));

        $buttons.select('.cantComplete-button')
          .attr('disabled', isSaveDisabled(this.datum))
          .text(l10n.t('map_data.layers.maproulette.cantComplete'))
          .on('click.cantComplete', (d3_event: Event, d: any) => this._cantComplete(d3_event, d, $selection));

        $buttons.select('.alreadyFixed-button')
          .attr('disabled', isSaveDisabled(this.datum))
          .text(l10n.t('map_data.layers.maproulette.alreadyFixed'))
          .on('click.alreadyFixed', (d3_event: Event, d: any) => this._alreadyFixed(d3_event, d, $selection));

        $buttons.select('.notAnIssue-button')
          .attr('disabled', isSaveDisabled(this.datum))
          .text(l10n.t('map_data.layers.maproulette.notAnIssue'))
          .on('click.notAnIssue', (d3_event: Event, d: any) => this._notAnIssue(d3_event, d, $selection));
      });
  }


  /**
   * Handle toggling the "fly to nearby task" checkbox.
   * @param d3_event - the triggering change event
   */
  protected _nearbyTaskChanged(d3_event: Event): void {
    const isChecked = (d3_event.target as HTMLInputElement).checked;
    const maproulette = this.context.services.maproulette as any;
    if (maproulette) {
      maproulette.nearbyTaskEnabled = isChecked;
    }
  }


  /**
   * Toggle between showing the comment/submit section and the action buttons.
   * @param isVisible - `true` to show the comment/submit section, `false` to show the action buttons
   */
  protected _setSaveButtonVisibility(isVisible: boolean): void {
    if (isVisible) {
      d3_select('.note-save').style('display', 'block');   // Show the commentSaveSection
      d3_select('.mr-save .buttons').style('display', 'none');  // Hide the buttons
    } else {
      d3_select('.note-save').style('display', 'none');  // Hide the commentSaveSection
      d3_select('.mr-save .buttons').style('display', '');  // Show the buttons
    }
  }


  /**
   *  Render the MapRoulette submit buttons
   *  "Cancel" "Save"
   *  These buttons are available only after the user has clicked an action button
   *  @param $selection - A d3-selection to the HTMLElement this section renders into
   */
  protected _submitButtons($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const errID = this.datum?.id;
    const isSelected = errID && context.selectedData().has(errID);
    let $buttons: D3Selection = $selection.selectAll('.buttons')
      .data(isSelected ? [this.datum] : [], (d: any) => d.key);

    // exit
    $buttons.exit()
      .remove();

    // enter
    const $$buttons = $buttons.enter()
      .append('div')
      .attr('class', 'buttons');

    $$buttons
      .append('button')
      .attr('class', 'button cancel-button action');

    $$buttons
      .append('button')
      .attr('class', 'button submit-button action');

    // update
    $buttons = $buttons
      .merge($$buttons);

    $buttons.select('.cancel-button')
      .text(l10n.t('map_data.layers.maproulette.cancel'))
      .on('click.cancel', (d3_event: Event, d: any) => this._clickCancel(d3_event, d, $selection));

    $buttons.select('.submit-button')
      .text(l10n.t('map_data.layers.maproulette.submit'))
      .on('click.submit', (d3_event: Event, d: any) => this._clickSubmit(d3_event, d));
  }


  /**
   * Handle the "I Fixed It" action.
   * @param d3_event - the triggering click event
   * @param d - the bound task datum
   * @param $selection - the save section selection to re-render
   */
  protected _fixedIt(d3_event: Event, d: any, $selection: D3Selection): void {
    (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 1;
    this._actionTaken = 'FIXED';
    this._setSaveButtonVisibility(true);
    $selection.call(this._commentSaveSection);
  }


  /**
   * Handle the "Can't Complete" action.
   * @param d3_event - the triggering click event
   * @param d - the bound task datum
   * @param $selection - the save section selection to re-render
   */
  protected _cantComplete(d3_event: Event, d: any, $selection: D3Selection): void {
    (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 6;
    this._actionTaken = `CAN'T COMPLETE`;
    this._setSaveButtonVisibility(true);
    $selection.call(this._commentSaveSection);
  }

  /**
   * Handle the "Already Fixed" action.
   * @param d3_event - the triggering click event
   * @param d - the bound task datum
   * @param $selection - the save section selection to re-render
   */
  protected _alreadyFixed(d3_event: Event, d: any, $selection: D3Selection): void {
    (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 5;
    this._actionTaken = 'ALREADY FIXED';
    this._setSaveButtonVisibility(true);
    $selection.call(this._commentSaveSection);
  }

  /**
   * Handle the "Not an Issue" action.
   * @param d3_event - the triggering click event
   * @param d - the bound task datum
   * @param $selection - the save section selection to re-render
   */
  protected _notAnIssue(d3_event: Event, d: any, $selection: D3Selection): void {
    (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 2;
    this._actionTaken = 'NOT AN ISSUE';
    this._setSaveButtonVisibility(true);
    $selection.call(this._commentSaveSection);
  }

  /**
   * Handle the "Cancel" button - reset the pending action.
   * @param d3_event - the triggering click event
   * @param d - the bound task datum
   * @param $selection - the save section selection to re-render
   */
  protected _clickCancel(d3_event: Event, d: any, $selection: D3Selection): void {
    (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
    this._actionTaken = '';
    d.props._status = '';
    this._setSaveButtonVisibility(false);
    $selection.call(this._commentSaveSection);
  }

  /**
   * Handle the "Submit" button - post the task update to MapRoulette.
   * @param d3_event - the triggering click event
   * @param d - the bound task datum
   */
  protected _clickSubmit(d3_event: Event, d: any): void {
    const context = this.context;
    const maproulette = context.services.maproulette as any;
    const osm = context.services.osm as any;

    (d3_event.currentTarget as HTMLElement).blur();    // avoid keeping focus on the button - iD#4641
    const userID = osm._userDetails.id;

    d.props.taskStatus = d.props._status;
    d.props.mapRouletteApiKey = this._apikey;
    d.props.comment = d3_select('.new-comment-input').property('value').trim();
    d.props.taskId = d.id;
    d.props.userId = userID;
    maproulette.postUpdate(d, (err: any, item: any) => {
      if (err) {
        console.error(err);  // eslint-disable-line no-console
        return;
      }
      this.emit('change', item);
      // Fly to a nearby task if the feature is enabled, after the update
      if (maproulette.nearbyTaskEnabled) {
        maproulette.flyToNearbyTask(d);
      }
    });
  }
}
