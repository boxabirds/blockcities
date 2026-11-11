/**
 * The money numbers: what things cost, what they cost to keep, and what
 * residents and jobs pay. They live in balance.json rather than in tuning.ts
 * because they are the ones the headless tuner (sim/tune.ts) searches over and
 * rewrites. The simulation reads `BALANCE` each time it needs a number, so a
 * trial balance can be swapped in between runs with `setBalance`.
 */
import defaults from './balance.json' with { type: 'json' };

export type ServiceKey = 'wind' | 'plant' | 'tower' | 'park' | 'school' | 'clinic' | 'police' | 'fire';
export type ZoneKey = 'homes' | 'shops' | 'industry';

export type Balance = {
  startMoney: number;
  /** One tile of each, to build. An avenue laid over a road costs the difference. */
  roadCost: number; bridgeCost: number; avenueCost: number; avenueBridgeCost: number;
  bulldozeCost: number;
  /** One tile of each, per day. */
  roadUpkeep: number; bridgeUpkeep: number; avenueUpkeep: number; avenueBridgeUpkeep: number;
  /** Services need more staff as the city grows: their upkeep is multiplied by 1 + residents / this. */
  staffingPopulation: number;
  /** Money per day per resident (homes) or filled job (shops, industry) at the default tax rate. */
  taxPerUnit: Record<ZoneKey, number>;
  /** To build, and per day before staffing. */
  serviceCost: Record<ServiceKey, number>;
  serviceUpkeep: Record<ServiceKey, number>;
};

const copy = (balance: Balance): Balance => structuredClone(balance);

/** The balance the game ships with. */
export const DEFAULT_BALANCE: Balance = copy(defaults as Balance);
/** The balance in force. Read it at the moment of use; do not keep its numbers. */
export const BALANCE: Balance = copy(DEFAULT_BALANCE);

/** Puts a whole balance in force (a trial one from the tuner, or `DEFAULT_BALANCE` to put things back). */
export function setBalance(balance: Balance) {
  const next = copy(balance);
  Object.assign(BALANCE, next);
}
