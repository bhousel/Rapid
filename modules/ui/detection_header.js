import { uiIcon } from './icon.js';


export function uiDetectionHeader(context) {
  const l10n = context.systems.l10n;
  const presets = context.systems.presets;
  let _marker;


  function getTitle(d) {
    if (d.props.object_type === 'traffic_sign') {
      return l10n.t('mapillary_signs.traffic_sign');
    } else {
      const stringID = d.props.value.replace(/--/g, '.');
      return l10n.t(`mapillary_detections.${stringID}`, { default: l10n.t('inspector.unknown') });
    }
  }

  function addIcon($selection) {
    const d = $selection.datum();
    if (!d) return;

    let iconName;
    if (d.props.object_type === 'traffic_sign') {
      iconName = d.props.value;
    } else {
      const service = context.services[d.props.serviceID];
      const presetID = service && service.getDetectionPresetID(d.props.value);
      const preset = presetID && presets.item(presetID);
      iconName = preset?.icon || 'fas-question';
    }

    // Some values we don't have icons for, check first - Rapid#1518
    const hasIcon = context.container().selectAll(`#rapid-defs #${iconName}`).size();

    $selection
      .call(uiIcon(hasIcon ? `#${iconName}` : '#fas-question'));
  }


  function render(selection) {
    const $header = selection.selectAll('.qa-header')
      .data(_marker ? [_marker] : [], d => d.key);

    $header.exit()
      .remove();

    const $$header = $header.enter()
      .append('div')
      .attr('class', 'qa-header');

    $$header
      .append('div')
      .attr('class', 'qa-header-icon')
      .append('div')
      .attr('class', d => `qaItem ${d.props.serviceID}`)
      .call(addIcon);

    $$header
      .append('div')
      .attr('class', 'qa-header-label')
      .text(getTitle);
  }


  render.datum = function(val) {
    if (!arguments.length) return _marker;
    _marker = val;
    return render;
  };

  return render;
}
