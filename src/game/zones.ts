/** What each zone's buildings hold, use and pay, by level. */
import { ZONE_C, ZONE_I, ZONE_R } from './city.ts';

export type ZoneSpec = {
  readonly name: string;
  /** What a finished building of each level is called. */
  readonly buildings: readonly string[];
  /** Residents (homes) or jobs (shops, industry) in a finished building of each level; index 0 is the empty lot. */
  readonly capacity: readonly number[];
  /** Power and water used per resident or job. */
  readonly powerPerUnit: number;
  readonly waterPerUnit: number;
  /** Money per day per resident or filled job at the default tax rate. */
  readonly taxPerUnit: number;
};

const ZONES: ZoneSpec[] = [];
ZONES[ZONE_R] = {
  name: 'Homes', buildings: ['Empty lot', 'Cottage', 'House', 'Town house', 'Flats', 'Tower block'],
  capacity: [0, 4, 10, 24, 60, 140], powerPerUnit: 1, waterPerUnit: 1, taxPerUnit: 0.1,
};
ZONES[ZONE_C] = {
  name: 'Shops', buildings: ['Empty lot', 'Corner shop', 'High street shop', 'Offices', 'Glass offices', 'Skyscraper'],
  capacity: [0, 4, 10, 24, 50, 110], powerPerUnit: 1.5, waterPerUnit: 0.8, taxPerUnit: 0.14,
};
ZONES[ZONE_I] = {
  name: 'Industry', buildings: ['Empty lot', 'Workshop', 'Factory', 'Works'],
  capacity: [0, 10, 25, 60], powerPerUnit: 2.5, waterPerUnit: 1.5, taxPerUnit: 0.12,
};
export const ZONE_SPECS: readonly ZoneSpec[] = ZONES;

export function maxLevel(zone: number) { return ZONE_SPECS[zone].capacity.length - 1; }
