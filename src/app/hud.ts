/** Everything on screen that is not the city: the readouts, the toolbar, the inspector and the budget. */
import { TOOLS, toolService, type Plan, type Tool } from '../game/actions.ts';
import { ZONE_C, ZONE_I, ZONE_R, type City } from '../game/city.ts';
import { advice, dateLabel, type TileInfo } from '../game/info.ts';
import { SERVICES } from '../game/services.ts';
import { BRIDGE_COST, BULLDOZE_COST, DAYS_PER_MONTH, MAX_TAX, MIN_TAX, ROAD_COST, SPEED_DAYS_PER_SECOND } from '../game/tuning.ts';

const TOAST_MILLISECONDS = 2600;
const PERCENT = 100;
/** A second click on "New city" within this long is the confirmation. */
const CONFIRM_MILLISECONDS = 4000;

type ToolLabel = { name: string; hint: string; group: 'look' | 'build' | 'zone' | 'utility' | 'service' };

const TOOL_LABELS: Record<Tool, ToolLabel> = {
  inspect: { name: 'Look', hint: 'Drag to move the view. Point at anything to see what it needs.', group: 'look' },
  road: { name: 'Road', hint: `Drag to lay road. $${ROAD_COST} a tile, $${BRIDGE_COST} over water.`, group: 'build' },
  homes: { name: 'Homes', hint: 'Drag to zone lots for homes. Free. Lots within two tiles of a road get built on.', group: 'zone' },
  shops: { name: 'Shops', hint: 'Drag to zone lots for shops and offices. Free.', group: 'zone' },
  industry: { name: 'Industry', hint: 'Drag to zone lots for industry. Free. It pollutes: keep it away from homes.', group: 'zone' },
  dezone: { name: 'Unzone', hint: 'Drag to remove zoning and whatever was built on it.', group: 'zone' },
  bulldoze: { name: 'Bulldoze', hint: `Drag to clear roads, buildings and trees. $${BULLDOZE_COST} a tile.`, group: 'build' },
  wind: { name: 'Turbine', hint: '', group: 'utility' },
  plant: { name: 'Power stn', hint: '', group: 'utility' },
  tower: { name: 'Water', hint: '', group: 'utility' },
  park: { name: 'Park', hint: '', group: 'service' },
  school: { name: 'School', hint: '', group: 'service' },
  clinic: { name: 'Clinic', hint: '', group: 'service' },
  police: { name: 'Police', hint: '', group: 'service' },
  fire: { name: 'Fire', hint: '', group: 'service' },
};

function hintFor(tool: Tool) {
  const service = SERVICES[toolService(tool) ?? -1];
  if (!service) return TOOL_LABELS[tool].hint;
  return `${service.name}: $${service.cost}, then $${service.upkeep} a day. ${service.blurb}`;
}

const money = (amount: number) => `${amount < 0 ? '−' : ''}$${Math.abs(Math.round(amount)).toLocaleString('en-GB')}`;

export function hudMarkup() {
  const digit = (tool: Tool) => { const n = TOOLS.indexOf(tool); return n >= 1 && n <= 9 ? `<kbd>${n}</kbd>` : ''; };
  const button = (tool: Tool) => `<button type="button" class="tool" data-tool="${tool}" data-group="${TOOL_LABELS[tool].group}" title="${hintFor(tool)}">`
    + `<span class="brick" aria-hidden="true"></span><span class="tool-name">${TOOL_LABELS[tool].name}</span>${digit(tool)}</button>`;
  const speeds = SPEED_DAYS_PER_SECOND.map((_, speed) => `<button type="button" data-speed="${speed}" aria-label="${speed === 0 ? 'Pause' : `Speed ${speed}`}">${speed === 0 ? '❙❙' : '▶'.repeat(speed)}</button>`).join('');
  const bar = (id: string, label: string) => `<div class="demand" title="Demand for ${label}"><span class="demand-track"><i id="demand-${id}"></i></span><label>${label[0].toUpperCase()}</label></div>`;
  const meter = (id: string, label: string) => `<div class="meter"><label>${label}</label><span class="meter-track"><i id="${id}-fill"></i></span><b id="${id}-text"></b></div>`;
  return `
  <header class="masthead">
    <h1>block<span>cities</span></h1>
    <div class="clock"><span id="date"></span><div class="speeds" role="group" aria-label="Game speed">${speeds}</div></div>
  </header>
  <aside class="readout" aria-label="City statistics">
    <div class="stat primary"><span id="money"></span><label id="net"></label></div>
    <div class="stat"><span id="population"></span><label>residents</label></div>
    <div class="stat"><span id="jobs"></span><label>jobs</label></div>
    <div class="demands" aria-label="Demand">${bar('r', 'homes')}${bar('c', 'shops')}${bar('i', 'industry')}</div>
    <div class="meters">${meter('power', 'Power')}${meter('water', 'Water')}</div>
    <button type="button" id="budget-toggle" aria-expanded="false" aria-controls="budget">Budget</button>
  </aside>
  <section id="budget" class="panel" hidden aria-label="Budget">
    <div class="row"><label for="tax">Tax</label><input id="tax" type="range" min="${MIN_TAX}" max="${MAX_TAX}" step="1"><b id="tax-text"></b></div>
    <div class="row"><span>Income</span><b id="income"></b></div>
    <div class="row"><span>Upkeep</span><b id="expenses"></b></div>
    <p class="note">Per ${DAYS_PER_MONTH}-day month. Higher tax earns more from each resident and job, and lowers demand.</p>
    <button type="button" id="new-city">New city</button>
  </section>
  <div id="advice" class="advice" role="status" aria-live="polite"></div>
  <aside id="inspector" class="panel inspector" aria-live="polite"><h2 id="inspect-title"></h2><div id="inspect-lines"></div></aside>
  <div id="tool-hint" class="tool-hint" role="status"></div>
  <nav id="toolbar" class="toolbar" aria-label="Tools">${TOOLS.map(button).join('')}</nav>
  <div id="toast" class="toast" role="alert"></div>
  <details class="help"><summary>Controls</summary>
    <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or middle-drag: move · <kbd>Q</kbd><kbd>E</kbd> or right-drag: turn · <kbd>R</kbd><kbd>F</kbd>: tilt · wheel or <kbd>Z</kbd><kbd>X</kbd>: zoom</p>
    <p><kbd>1</kbd>–<kbd>6</kbd>: tools · <kbd>Esc</kbd>: put the tool down · <kbd>Space</kbd>: pause</p>
  </details>`;
}

export type HudActions = {
  tool: (tool: Tool) => void;
  speed: (speed: number) => void;
  tax: (percent: number) => void;
  newCity: () => void;
};

export class Hud {
  private readonly cache = new Map<string, string>();
  private readonly elements = new Map<string, HTMLElement>();
  private toastTimer = 0;
  private confirmUntil = 0;
  private readonly abort = new AbortController();

  constructor(actions: HudActions) {
    const options = { signal: this.abort.signal };
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.addEventListener('click', () => actions.tool(button.dataset.tool as Tool), options);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      button.addEventListener('click', () => actions.speed(Number(button.dataset.speed)), options);
    }
    const tax = this.element('tax') as HTMLInputElement;
    tax.addEventListener('input', () => actions.tax(Number(tax.value)), options);
    const toggle = this.element('budget-toggle'), budget = this.element('budget');
    toggle.addEventListener('click', () => { budget.hidden = !budget.hidden; toggle.setAttribute('aria-expanded', String(!budget.hidden)); }, options);
    const fresh = this.element('new-city');
    fresh.addEventListener('click', () => {
      // Two clicks, not a dialog: a dialog would stop the game and cannot be driven by the automation hook.
      if (performance.now() < this.confirmUntil) { this.confirmUntil = 0; fresh.textContent = 'New city'; actions.newCity(); return; }
      this.confirmUntil = performance.now() + CONFIRM_MILLISECONDS; fresh.textContent = 'Click again to replace this city';
      window.setTimeout(() => { if (performance.now() >= this.confirmUntil) fresh.textContent = 'New city'; }, CONFIRM_MILLISECONDS);
    }, options);
  }

  private element(id: string) {
    let element = this.elements.get(id);
    if (!element) { element = document.getElementById(id)!; this.elements.set(id, element); }
    return element;
  }

  /** Writes text only when it differs from what is already there. */
  private text(id: string, value: string) {
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value); this.element(id).textContent = value;
  }

  private style(id: string, property: string, value: string) {
    const key = `${id}/${property}`;
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value); this.element(id).style.setProperty(property, value);
  }

  private flag(id: string, name: string, on: boolean) {
    const key = `${id}.${name}`, value = String(on);
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value); this.element(id).classList.toggle(name, on);
  }

  toast(message: string) {
    const toast = this.element('toast');
    toast.textContent = message; toast.classList.add('shown');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('shown'), TOAST_MILLISECONDS);
  }

  setTool(tool: Tool) {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const on = button.dataset.tool === tool;
      button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on));
    }
    this.text('tool-hint', hintFor(tool));
  }

  setSpeed(speed: number) {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      const on = Number(button.dataset.speed) === speed;
      button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on));
    }
  }

  update(city: City, info: TileInfo | null, plan: Plan | null, tool: Tool) {
    const { stats } = city, net = (stats.income - stats.expenses) * DAYS_PER_MONTH;
    this.text('money', money(city.money));
    this.flag('money', 'debt', city.money < 0);
    this.text('net', `${net >= 0 ? '+' : ''}${money(net)} a month`);
    this.text('population', Math.round(stats.population).toLocaleString('en-GB'));
    this.text('jobs', Math.round(stats.commercialJobs + stats.industrialJobs).toLocaleString('en-GB'));
    this.text('date', dateLabel(city.day));
    for (const [id, zone] of [['r', ZONE_R], ['c', ZONE_C], ['i', ZONE_I]] as const) {
      const demand = stats.demand[zone];
      // The bar grows up from the middle for positive demand and down for negative.
      this.style(`demand-${id}`, 'height', `${Math.abs(demand) * PERCENT / 2}%`);
      this.style(`demand-${id}`, demand >= 0 ? 'bottom' : 'top', '50%');
      this.style(`demand-${id}`, demand >= 0 ? 'top' : 'bottom', 'auto');
      this.flag(`demand-${id}`, 'negative', demand < 0);
    }
    for (const [id, use, supply] of [['power', stats.powerUse, stats.powerSupply], ['water', stats.waterUse, stats.waterSupply]] as const) {
      this.text(`${id}-text`, `${Math.round(use)} / ${Math.round(supply)}`);
      this.style(`${id}-fill`, 'width', `${supply > 0 ? Math.min(1, use / supply) * PERCENT : use > 0 ? PERCENT : 0}%`);
      this.flag(`${id}-fill`, 'short', use > supply);
    }
    this.text('income', money(stats.income * DAYS_PER_MONTH));
    this.text('expenses', money(stats.expenses * DAYS_PER_MONTH));
    this.text('tax-text', `${city.tax}%`);
    const slider = this.element('tax') as HTMLInputElement;
    if (document.activeElement !== slider && slider.value !== String(city.tax)) slider.value = String(city.tax);
    const tip = advice(city);
    this.text('advice', tip);
    this.flag('advice', 'shown', tip !== '');

    this.flag('inspector', 'shown', info !== null);
    if (info) {
      let title = info.title, lines = info.lines.join('\n');
      // With a tool in hand the inspector leads with what letting go would do.
      if (plan && tool !== 'inspect') {
        const changes = plan.changes.filter(Boolean).length;
        title = plan.ok ? `${TOOL_LABELS[tool].name}: ${changes} ${changes === 1 ? 'tile' : 'tiles'}${plan.cost ? ` · ${money(plan.cost)}` : ''}` : `${TOOL_LABELS[tool].name}: ${plan.reason}`;
        lines = `${info.title}${info.lines.length ? ` · ${info.lines[0]}` : ''}`;
      }
      this.text('inspect-title', title);
      this.text('inspect-lines', lines);
      this.flag('inspector', 'refused', plan !== null && tool !== 'inspect' && !plan.ok);
    }
  }

  dispose() { this.abort.abort(); window.clearTimeout(this.toastTimer); }
}
