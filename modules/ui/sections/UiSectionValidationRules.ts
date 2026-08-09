import { select } from 'd3-selection';
import { UiTooltip } from '../UiTooltip.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';

const MINSQUARE = 0;
const MAXSQUARE = 20;
const DEFAULTSQUARE = 5;  // see also `validators/unsquare_way.ts`


export class UiSectionValidationRules extends AbstractUiSection {
  protected _validatorIDs: string[];


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'issues-rules');

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawListItems = this._drawListItems.bind(this);
    this._changeSquare = this._changeSquare.bind(this);
    this._isValidatorEnabled = this._isValidatorEnabled.bind(this);
    this._toggleValidator = this._toggleValidator.bind(this);
    this._renderWhenIdle = this._renderWhenIdle.bind(this);

    const l10n = context.systems.l10n!;
    const validator = context.systems.validator!;

    this._validatorIDs = validator.getValidatorIDs()
      .sort((key1: string, key2: string) => {
        // alphabetize by localized title
        return l10n.t(`issues.${key1}.title`) < l10n.t(`issues.${key2}.title`) ? -1 : 1;
      });

    validator.on('validated', this._renderWhenIdle);
  }


  /**
   * The disclosure heading label — "Rules".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('issues.rules');
  }


  /**
   * Renders the rule list container and the enable/disable-all links.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const l10n = this.context.systems.l10n!;
    const validator = this.context.systems.validator!;

    let $container: D3Selection = $selection.selectAll('.issues-rulelist-container')
      .data([0]);

    const $$container = $container.enter()
      .append('div')
      .attr('class', 'issues-rulelist-container');

    $$container
      .append('ul')
      .attr('class', 'layer-list issue-rules-list');

    const $$ruleLinks = $$container
      .append('div')
      .attr('class', 'issue-rules-links section-footer');

    $$ruleLinks
      .append('a')
      .attr('class', 'issue-rules-link')
      .attr('href', '#')
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        validator.disableValidators(this._validatorIDs);
      });

    $$ruleLinks
      .append('a')
      .attr('class', 'issue-rules-link')
      .attr('href', '#')
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        validator.disableValidators([]);
      });

    // Update
    $container = $container
      .merge($$container);

    // set localized link text on the update selection so it re-localizes on language change
    $container.selectAll('.issue-rules-link')
      .text((d, i) => i === 0 ? l10n.t('issues.disable_all') : l10n.t('issues.enable_all'));

    $container.selectAll('.issue-rules-list')
      .call(this._drawListItems);
  }


  /**
   * Draws the per-validator rule checkboxes (and the unsquare degree input).
   * @param $selection - A d3-selection to the rule list element
   */
  protected _drawListItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;

    let $items: D3Selection = $selection.selectAll('li')
      .data(this._validatorIDs);

    // Exit
    $items.exit()
      .remove();

    // Enter
    const $$items = $items.enter()
      .append('li')
      .call(new UiTooltip(context)
        .title((d: ValidatorID) => l10n.t(`issues.${d}.tip`))
        .placement('top')
        .attach
      );

    const $$label = $$items
      .append('label');

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .attr('name', 'rule')
      .on('change', this._toggleValidator);

    $$label
      .append('span')
      .html((d: ValidatorID) => {
        const params: Record<string, string> = {};
        if (d === 'unsquare_way') {
          params.val = '<span class="square-degrees"></span>';
        }
        return l10n.tHtml(`issues.${d}.title`, params);
      });

    // Update
    $items = $items
      .merge($$items);

    $items
      .classed('active', this._isValidatorEnabled)
      .selectAll('input')
      .property('checked', this._isValidatorEnabled)
      .property('indeterminate', false);


    // user-configurable square threshold
    const degStr = settings?.get('validator.squareDegrees') ?? DEFAULTSQUARE.toString();

    const $span = $items.selectAll('.square-degrees');
    const $input: D3Selection = $span.selectAll('.square-degrees-input')
      .data([0]);

    // enter / update
    $input.enter()
      .append('input')
      .attr('type', 'number')
      .attr('min', MINSQUARE.toString())
      .attr('max', MAXSQUARE.toString())
      .attr('step', '0.5')
      .attr('class', 'square-degrees-input')
      .call(utilNoAuto)
      .on('click', function (this: HTMLInputElement, d3_event: Event) {
        d3_event.preventDefault();
        d3_event.stopPropagation();
        this.select();
      })
      .on('keyup', function (this: HTMLInputElement, d3_event: KeyboardEvent) {
        if (d3_event.keyCode === 13) { // ↩ Return
          this.blur();
          this.select();
        }
      })
      .on('blur', this._changeSquare)
      .merge($input)
      .property('value', degStr);
  }


  /**
   * Handles editing the unsquare-way degree threshold (clamps and persists it).
   * @param d3_event - the triggering blur event
   */
  protected _changeSquare(d3_event: Event): void {
    const settings = this.context.systems.settings;
    const validator = this.context.systems.validator!;

    const $input = select(d3_event.currentTarget as HTMLElement);
    let degStr = (utilGetSetValue($input) as string).trim();
    let degNum = parseFloat(degStr);

    if (!isFinite(degNum)) {
      degNum = DEFAULTSQUARE;
    } else if (degNum > MAXSQUARE) {
      degNum = MAXSQUARE;
    } else if (degNum < MINSQUARE) {
      degNum = MINSQUARE;
    }

    degNum = Math.round(degNum * 10 ) / 10;   // round to 1 decimal
    degStr = degNum.toString();

    $input
      .property('value', degStr);

    settings?.set('validator.squareDegrees', degStr);
    validator.revalidateUnsquare();
  }


  /**
   * Whether the given validator is currently enabled.
   * @param d - the validator id
   * @return `true` if the validator is enabled
   */
  protected _isValidatorEnabled(d: ValidatorID): boolean {
    const validator = this.context.systems.validator!;
    return validator.isValidatorEnabled(d);
  }


  /**
   * Toggles the given validator on/off.
   * @param d3_event - the triggering change event
   * @param d - the validator id
   */
  protected _toggleValidator(d3_event: Event, d: ValidatorID): void {
    const validator = this.context.systems.validator!;
    validator.toggleValidator(d);
  }


  /**
   * Re-renders, waiting for an idle moment (falls back to immediate if no scheduler).
   */
  protected _renderWhenIdle(): void {
    const scheduler = this.context.systems.scheduler;
    if (scheduler) {
      scheduler.scheduleIdleTask(this.renderInner)
        .catch((err: unknown) => {
          if ((err as any)?.name === 'AbortError') return;   // expected cancellation
          console.error(err);  // eslint-disable-line no-console
        });
    } else {
      this.renderInner();
    }
  }
}
