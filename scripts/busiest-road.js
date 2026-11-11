/** Finds the road tile carrying the most trips, through the automation hook. Run with drive.py "run:scripts/busiest-road.js". */
(() => {
  const game = window.__blockcities, SIZE = 48;
  let most = -1, found = null;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const info = game.tile(x, z);
      if (!/^(Road|Avenue)/.test(info.title)) continue;
      const trips = parseInt(info.lines[0], 10);
      if (trips > most) { most = trips; found = { x, z, title: info.title, line: info.lines[0] }; }
    }
  }
  return found;
})()
