/**
 * Builds a large city through the automation hook, for screenshots and frame-time checks.
 * Run with: scripts/drive.py <url> <out> "new:7;run:scripts/demo-city.js;..."
 * It plays fair on rules but not on time or money: it advances the calendar between phases
 * and waits for taxes to pay for the next one.
 */
(() => {
  const game = window.__blockcities, WEST = 3, EAST = 30, NORTH = 3, SOUTH = 27, BLOCK = 5, MONTH = 30;
  const act = (tool, x0, z0, x1, z1) => game.apply(tool, x0, z0, x1, z1);
  /** Advances month by month until the city can afford `cost`, or a year has passed. */
  const afford = cost => { for (let month = 0; month < 12 && game.snapshot().money < cost; month++) game.advance(MONTH); };
  // A grid of streets with blocks of four lots between them.
  for (let z = NORTH; z <= SOUTH; z += BLOCK) act('road', WEST, z, EAST, z);
  for (let x = WEST; x <= EAST; x += BLOCK + 4) act('road', x, NORTH, x, SOUTH);
  // Homes to the north, shops in the south-west, industry in the south-east.
  act('homes', WEST, NORTH, EAST, 17);
  act('shops', WEST, 18, 20, SOUTH);
  act('industry', 21, 18, EAST, SOUTH);
  act('wind', 0, 0, 1, 4); act('wind', 0, 0, 1, 6); act('tower', 0, 0, 1, 8);
  game.advance(4 * MONTH);
  const phases = [
    ['plant', 31, 29], ['tower', 1, 10], ['park', 8, 9], ['park', 17, 9], ['park', 26, 9], ['school', 8, 4], ['tower', 1, 12],
    ['clinic', 17, 4], ['police', 26, 4], ['fire', 8, 14], ['park', 8, 19], ['park', 17, 19], ['park', 26, 19], ['plant', 32, 29],
    ['tower', 1, 14], ['tower', 1, 16], ['school', 17, 14], ['clinic', 26, 14], ['police', 8, 24], ['fire', 17, 24], ['plant', 33, 30],
    ['tower', 1, 18], ['tower', 1, 20], ['plant', 32, 30], ['tower', 1, 22], ['tower', 1, 24], ['plant', 33, 29], ['tower', 1, 26],
  ];
  const refused = [];
  for (const [tool, x, z] of phases) {
    afford(4500);
    const plan = act(tool, x, z, x, z);
    if (!plan.ok) refused.push(`${tool} at ${x},${z}: ${plan.reason}`);
    game.advance(3 * MONTH);
  }
  game.advance(24 * MONTH);
  // A second row of power stations, then time for the centre to grow tall.
  for (let x = 30; x <= 33; x++) act('plant', x, 31, x, 31);
  // Every service down two columns of the west side, so land value there reaches the top.
  const kit = ['park', 'school', 'clinic', 'police', 'fire'];
  for (let z = NORTH + 1; z < SOUTH; z += BLOCK) {
    if ((z - NORTH) % (2 * BLOCK) === 1) kit.forEach((tool, n) => act(tool, WEST + 2 + n, z + 1, WEST + 2 + n, z + 1));
    else kit.forEach((tool, n) => act(tool, WEST + 11 + n, z + 1, WEST + 11 + n, z + 1));
  }
  // Widen the busiest streets.
  for (let z = NORTH; z <= SOUTH; z += BLOCK) { afford(5000); act('avenue', WEST, z, EAST, z); }
  game.advance(96 * MONTH);
  return { refused, stats: game.snapshot().stats, money: Math.round(game.snapshot().money), day: game.snapshot().day };
})()
