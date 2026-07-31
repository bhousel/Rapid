import type { D3Selection } from 'd3-selection';


/**
 * Renders an `<svg>` icon that references a symbol in the sprite sheet.
 *
 * @param href  - the sprite symbol reference, e.g. `'#rapid-icon-close'`
 * @param klass - optional extra class(es) to add to the `<svg>`
 * @param title - optional accessible title
 * @return a render function that appends the icon to a d3-selection
 */
export function uiIcon(href: string, klass = '', title = ''): ($selection: D3Selection) => void {
  const iconID = href.replace('#', '');
  const prefix = iconID.split('-')[0];

  return function render($selection: D3Selection): void {
    const classList = ['icon'];
    if (prefix) classList.push(`icon-${prefix}`);    // 'icon-fas', 'icon-rapid'
    if (iconID) classList.push(`icon-${iconID}`);    // 'icon-fas-triangle-exclamation', 'icon-rapid-icon-error'
    if (klass)  classList.push(klass);

    const $$svg = $selection.selectAll(`svg.icon-${iconID}`)
      .data([iconID], d => d)
      .enter()
      .append('svg')
      .attr('class', classList.join(' '))
      .attr('role', 'img')
      .attr('aria-labelledby', title);

    if (title) {
      $$svg
        .append('title')
        .text(title);
    }

    $$svg
      .append('use')
      .attr('xlink:href', href);
  };
}
