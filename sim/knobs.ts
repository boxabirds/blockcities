/**
 * What the tuner is allowed to turn. Each knob multiplies a group of numbers in
 * the balance, so relative prices inside a group (a school against a park) stay
 * as designed and only the level of the group moves.
 */
import type { Balance, ServiceKey, ZoneKey } from '../src/game/balance.ts';

export const KNOBS = ['tax', 'serviceUpkeep', 'serviceCost', 'roads', 'startMoney', 'staffing'] as const;
export type Knob = (typeof KNOBS)[number];
export type Settings = Record<Knob, number>;

export const NEUTRAL: Settings = { tax: 1, serviceUpkeep: 1, serviceCost: 1, roads: 1, startMoney: 1, staffing: 1 };
/** No knob goes below or above these multiples of the balance it started from. */
export const MIN_SETTING = 0.3;
export const MAX_SETTING = 3;

const scaled = <K extends string>(record: Record<K, number>, by: number) =>
  Object.fromEntries(Object.entries<number>(record).map(([key, value]) => [key, value * by])) as Record<K, number>;

export function applySettings(base: Balance, settings: Settings): Balance {
  return {
    ...base,
    startMoney: base.startMoney * settings.startMoney,
    roadCost: base.roadCost * settings.roads, bridgeCost: base.bridgeCost * settings.roads,
    avenueCost: base.avenueCost * settings.roads, avenueBridgeCost: base.avenueBridgeCost * settings.roads,
    roadUpkeep: base.roadUpkeep * settings.roads, bridgeUpkeep: base.bridgeUpkeep * settings.roads,
    avenueUpkeep: base.avenueUpkeep * settings.roads, avenueBridgeUpkeep: base.avenueBridgeUpkeep * settings.roads,
    // A smaller staffing population means upkeep climbs faster, so this knob divides.
    staffingPopulation: base.staffingPopulation / settings.staffing,
    taxPerUnit: scaled<ZoneKey>(base.taxPerUnit, settings.tax),
    serviceCost: scaled<ServiceKey>(base.serviceCost, settings.serviceCost),
    serviceUpkeep: scaled<ServiceKey>(base.serviceUpkeep, settings.serviceUpkeep),
  };
}

const nearest = (value: number, step: number) => Math.max(step, Math.round(value / step) * step);
/** Rounds to a step and to a sane number of decimals, so 0.1 + 0.2 does not end up in a file. */
const tidyNumber = (value: number, step: number) => Number(nearest(value, step).toFixed(4));
const tidyRecord = <K extends string>(record: Record<K, number>, step: number) =>
  Object.fromEntries(Object.entries<number>(record).map(([key, value]) => [key, tidyNumber(value, step)])) as Record<K, number>;

/** Rounds a balance to prices a player can read: whole tens for costs, halves for daily upkeep. */
export function tidy(balance: Balance): Balance {
  return {
    startMoney: tidyNumber(balance.startMoney, 1000),
    roadCost: tidyNumber(balance.roadCost, 1), bridgeCost: tidyNumber(balance.bridgeCost, 5),
    avenueCost: tidyNumber(balance.avenueCost, 5), avenueBridgeCost: tidyNumber(balance.avenueBridgeCost, 10),
    bulldozeCost: balance.bulldozeCost,
    roadUpkeep: tidyNumber(balance.roadUpkeep, 0.01), bridgeUpkeep: tidyNumber(balance.bridgeUpkeep, 0.05),
    avenueUpkeep: tidyNumber(balance.avenueUpkeep, 0.01), avenueBridgeUpkeep: tidyNumber(balance.avenueBridgeUpkeep, 0.05),
    staffingPopulation: tidyNumber(balance.staffingPopulation, 250),
    taxPerUnit: tidyRecord(balance.taxPerUnit, 0.005),
    serviceCost: tidyRecord(balance.serviceCost, 50),
    serviceUpkeep: tidyRecord(balance.serviceUpkeep, 0.5),
  };
}
