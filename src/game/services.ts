/** Everything the mayor places by hand other than roads: utilities and services. */
import { CLINIC, FIRE, PARK, PLANT, POLICE, SCHOOL, TOWER, WIND } from './city.ts';

export type ServiceSpec = {
  readonly name: string;
  readonly cost: number;
  /** Money per day. */
  readonly upkeep: number;
  /** Power and water supplied once finished. */
  readonly power: number;
  readonly water: number;
  /** Land value added at the service itself, falling to nothing at `radius` tiles. */
  readonly value: number;
  readonly radius: number;
  /** Pollution at the service itself, falling to nothing at `pollutionRadius` tiles. */
  readonly pollution: number;
  readonly pollutionRadius: number;
  /** Serves its surroundings only when a road reaches it. */
  readonly needsRoad: boolean;
  readonly blurb: string;
};

const spec = (
  name: string, cost: number, upkeep: number, power: number, water: number, value: number, radius: number,
  pollution: number, pollutionRadius: number, needsRoad: boolean, blurb: string,
): ServiceSpec => ({ name, cost, upkeep, power, water, value, radius, pollution, pollutionRadius, needsRoad, blurb });

const SERVICE: ServiceSpec[] = [];
SERVICE[WIND] = spec('Wind turbine', 600, 3, 220, 0, 0, 0, 0, 0, false, 'Clean power for a few streets.');
SERVICE[PLANT] = spec('Power station', 4000, 22, 2000, 0, 0, 0, 1.2, 7, false, 'A lot of power, and a lot of smoke.');
SERVICE[TOWER] = spec('Water tower', 800, 4, 0, 1500, 0, 0, 0, 0, false, 'Water for the whole neighbourhood.');
SERVICE[PARK] = spec('Park', 300, 2, 0, 0, 0.3, 6, 0, 0, false, 'Raises land value close by.');
SERVICE[SCHOOL] = spec('School', 1500, 12, 0, 0, 0.35, 10, 0, 0, true, 'Raises land value over a wide area.');
SERVICE[CLINIC] = spec('Clinic', 1800, 14, 0, 0, 0.3, 10, 0, 0, true, 'Raises land value over a wide area.');
SERVICE[POLICE] = spec('Police station', 1500, 12, 0, 0, 0.25, 12, 0, 0, true, 'Raises land value over a wide area.');
SERVICE[FIRE] = spec('Fire station', 1500, 12, 0, 0, 0.25, 12, 0, 0, true, 'Raises land value over a wide area.');
export const SERVICES: readonly (ServiceSpec | undefined)[] = SERVICE;

export function isService(structure: number) { return SERVICE[structure] !== undefined; }
