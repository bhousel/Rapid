import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';

import { uiIcon } from './icon.js';
import { uiMapRouletteDetails } from './maproulette_details.js';
import { uiMapRouletteHeader } from './maproulette_header.js';
import { UiViewOn } from './UiViewOn.js';
import { utilNoAuto, utilRebind } from '../util/index.js';


export function uiMapRouletteEditor(context) {
  const l10n = context.systems.l10n;
  const maproulette = context.services.maproulette;
  const osm = context.services.osm;

  const dispatch = d3_dispatch('change');
  const mapRouletteDetails = uiMapRouletteDetails(context);
  const mapRouletteHeader = uiMapRouletteHeader(context);
  const ViewOn = new UiViewOn(context);

  let _marker;
  let _actionTaken;
  let _apikey;
  let _user;


  function render($selection) {
    if (!osm || !maproulette) return;

    const $header = $selection.selectAll('.header')
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
      .append('h3')
      .text(l10n.t('map_data.layers.maproulette.title', { n: 1 }));

    let $body = $selection.selectAll('.body')
      .data([0]);

    $body = $body.enter()
      .append('div')
      .attr('class', 'body')
      .merge($body);

    let $editor = $body.selectAll('.mr-editor')
      .data([0]);

    $editor.enter()
      .append('div')
      .attr('class', 'modal-section mr-editor')
      .merge($editor)
      .call(mapRouletteHeader.task(_marker))
      .call(mapRouletteDetails.task(_marker))
      .call(mapRouletteSaveSection)
      .call(commentSaveSection);


    ViewOn.stringID = 'inspector.view_on_maproulette';
    ViewOn.url = (maproulette && _marker) ? maproulette.itemURL(_marker) : '';

    const $footer = $selection.selectAll('.sidebar-footer')
      .data([0]);

    $footer.enter()
      .append('div')
      .attr('class', 'sidebar-footer')
      .merge($footer)
      .call(ViewOn.render);
  }


  function getMapRouletteApiKeyAsync() {
    return osm.getUserPreferencesAsync()
      .then(prefs => {
        _apikey = prefs.maproulette_apikey_v2;
        return _apikey;
      })
      .catch(err => {
        _apikey = null;
        console.error(err);  // eslint-disable-line no-console
      });
  }


  function mapRouletteSaveSection($selection) {
    const errID = _marker?.id;
    const isSelected = errID && context.selectedData().has(errID);
    const isShown = (_marker && isSelected);

    let $saveSection = $selection.selectAll('.mr-save')
      .data(isShown ? [_marker] : [], d => d.key);

    // exit
    $saveSection.exit()
      .remove();

    // enter
    const $$saveSection = $saveSection.enter()
      .append('div')
      .attr('class', 'mr-save save-section cf');

    // update
    $saveSection = $saveSection
      .merge($$saveSection)
      .call(userDetails)
      .call(mRSaveButtons);
  }


  /**
   * pick a color for the given action
   */
  function getActionColor(action) {
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
   * render the comment save section
   */
  function commentSaveSection($selection) {
    const errID = _marker?.id;
    const isSelected = errID && context.selectedData().has(errID);

    let $commentSave = $selection.selectAll('.note-save')
      .data(isSelected && _actionTaken ? [_marker] : [], d => d.key);

    // exit
    $commentSave.exit()
      .remove();

    // enter
    const $$commentSave = $commentSave.enter()
      .append('div')
      .attr('class', 'note-save save-section cf');

    $$commentSave
      .append('h4')
      .attr('class', 'note-save-header');

    $$commentSave
      .append('textarea')
      .attr('class', 'new-comment-input')
      .attr('placeholder', l10n.t('map_data.layers.maproulette.inputPlaceholder'))
      .attr('maxlength', 1000)
      .property('value', d => d.props.newComment)
      .call(utilNoAuto)
      .on('input.note-input', changeInput)
      .on('blur.note-input', changeInput)
      .style('resize', 'none');

    // update
    $commentSave = $commentSave
      .merge($$commentSave);

    $commentSave.select('.note-save-header')  // Corrected class name
      .html(l10n.t('map_data.layers.maproulette.comment') +
        ' <span style="color: ' + getActionColor(_actionTaken) + ';">' + _actionTaken + '</span>'
      );

    $commentSave
      .call(userDetails)
      .call(submitButtons);

    function changeInput() {
      const $input = d3_select(this);
      const val = $input.property('value').trim() || undefined;

      _marker.props.newComment = val;
      _marker.touch();
      if (maproulette) {
        maproulette.replaceTask(_marker);  // update note cache
      }

      $commentSave
        .call(mRSaveButtons);
    }
  }


  function userDetails($selection) {
    let $detailSection = $selection.selectAll('.detail-section')
      .data([0]);

    $detailSection = $detailSection.enter()
      .append('div')
      .attr('class', 'detail-section')
      .merge($detailSection);

    const $authWarning = $detailSection.selectAll('.auth-warning')
      .data([0]);

    updateAuthWarning($authWarning, 'map_data.layers.maproulette.login');

    getMapRouletteApiKeyAsync()
      .then(() => {
        updateAuthWarning($authWarning, 'map_data.layers.maproulette.loginMaproulette');
      });

    osm.getUserDetailsAsync()
      .then(user => {
        _user = user;
        let $userLink = d3_select(document.createElement('div'));

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
      .catch(err => {
        _user = null;
        console.error(err);  // eslint-disable-line no-console
      });


    function updateAuthWarning($selection, messageKey) {
      const isAuthenticated = (_user && _apikey);

      if (isAuthenticated) {
        $selection.exit()
          .transition()
          .duration(200)
          .style('opacity', 0)
          .remove();

      } else {
        const $$auth = $selection.enter()
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
            .on('click.note-login', d3_event => {
              d3_event.preventDefault();
              osm.authenticate();
            });
        }

        $$auth
          .transition()
          .duration(200)
          .style('opacity', 1);
      }
    }
  }


  /**
   *  Render the MapRoulette action buttons
   *  "I Fixed It", "Can't Complete", "Already Fixed", "Not an Issue"
   *  These buttons are available only after the user has completed authentication.
   */
  function mRSaveButtons($selection) {
    getMapRouletteApiKeyAsync()
      .then(apiKey => {
        const hasAuth = (_user && _apikey);
        const errID = _marker?.id;
        const isSelected = errID && context.selectedData().has(errID);

        const uiSystem = context.systems.ui;
        // Check if the MapRoulette menu is showing
        if (uiSystem._showsMapRouletteMenu) {
          $selection.selectAll('.mr-save .buttons').style('display', 'none');
          return;
        } else {
          $selection.selectAll('.mr-save .buttons').style('display', ''); // Ensure buttons are shown if menu is not open
        }

        let $buttons = $selection.selectAll('.buttons')
          .data(isSelected ? [_marker] : [], d => d.key);

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
          .on('change', nearbyTaskChanged);

        $$checkboxNearby
          .append('label')
          .attr('for', 'nearbyTaskCheckbox')
          .text(l10n.t('map_data.layers.maproulette.nearbyTask.title'));

        // update
        $buttons = $buttons
          .merge($$buttons);

        $buttons.select('.fixedIt-button')
          .attr('disabled', isSaveDisabled(_marker))
          .text(l10n.t('map_data.layers.maproulette.fixed'))
          .on('click.fixedIt', function(d3_event, d) {
            fixedIt(d3_event, d, $selection);
          });

        $buttons.select('.cantComplete-button')
          .attr('disabled', isSaveDisabled(_marker))
          .text(l10n.t('map_data.layers.maproulette.cantComplete'))
          .on('click.cantComplete', function(d3_event, d) {
            cantComplete(d3_event, d, $selection);
          });

        $buttons.select('.alreadyFixed-button')
          .attr('disabled', isSaveDisabled(_marker))
          .text(l10n.t('map_data.layers.maproulette.alreadyFixed'))
          .on('click.alreadyFixed', function(d3_event, d) {
            alreadyFixed(d3_event, d, $selection);
          });

        $buttons.select('.notAnIssue-button')
          .attr('disabled', isSaveDisabled(_marker))
          .text(l10n.t('map_data.layers.maproulette.notAnIssue'))
          .on('click.notAnIssue', function(d3_event, d) {
            notAnIssue(d3_event, d, $selection);
          });

        function isSaveDisabled(d) {
          return (d && hasAuth) ? null : true;
        }
      });
  }


  function nearbyTaskChanged(d3_event) {
    const isChecked = d3_event.target.checked;
    const mapRouletteService = context.services.maproulette;
    if (mapRouletteService) {
      mapRouletteService.nearbyTaskEnabled = isChecked;
    }
  }


  function setSaveButtonVisibility(isVisible) {
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
   */
  function submitButtons($selection) {
    const errID = _marker?.id;
    const isSelected = errID && context.selectedData().has(errID);
    let $buttons = $selection.selectAll('.buttons')
      .data(isSelected ? [_marker] : [], d => d.key);

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
      .on('click.cancel', function(d3_event, d) {
        clickCancel(d3_event, d, $selection);
      });

    $buttons.select('.submit-button')
      .text(l10n.t('map_data.layers.maproulette.submit'))
      .on('click.submit', function(d3_event, d) {
        clickSubmit(d3_event, d, $selection);
      });
  }


  function fixedIt(d3_event, d, $selection) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 1;
    _actionTaken = 'FIXED';
    setSaveButtonVisibility(true);
    $selection.call(commentSaveSection);
  }


  function cantComplete(d3_event, d, $selection) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 6;
    _actionTaken = `CAN'T COMPLETE`;
    setSaveButtonVisibility(true);
    $selection.call(commentSaveSection);
  }

  function alreadyFixed(d3_event, d, $selection) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 5;
    _actionTaken = 'ALREADY FIXED';
    setSaveButtonVisibility(true);
    $selection.call(commentSaveSection);
  }

  function notAnIssue(d3_event, d, $selection) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    d.props._status = 2;
    _actionTaken = 'NOT AN ISSUE';
    setSaveButtonVisibility(true);
    $selection.call(commentSaveSection);
  }

  function clickCancel(d3_event, d, $selection) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    _actionTaken = '';
    d.props._status = '';
    setSaveButtonVisibility(false);
    $selection.call(commentSaveSection);
  }

  function clickSubmit(d3_event, d) {
    this.blur();    // avoid keeping focus on the button - iD#4641
    const userID = osm._userDetails.id;

    d.props.taskStatus = d.props._status;
    d.props.mapRouletteApiKey = _apikey;
    d.props.comment = d3_select('.new-comment-input').property('value').trim();
    d.props.taskId = d.id;
    d.props.userId = userID;
    maproulette.postUpdate(d, (err, item) => {
      if (err) {
        console.error(err);  // eslint-disable-line no-console
        return;
      }
      dispatch.call('change', item);
      // Fly to a nearby task if the feature is enabled, after the update
      if (maproulette.nearbyTaskEnabled) {
        maproulette.flyToNearbyTask(d);
      }
    });
  }

  render.error = function(val) {
    if (!arguments.length) return _marker;
    _marker = val;
    _actionTaken = '';
    return render;
  };

  return utilRebind(render, dispatch, 'on');
}
