# Notice

Block Cities is licensed under the GNU General Public License v3.0 only (see `LICENSE`).

Its renderer comes from the owner's **Jellyland**, which is itself a derivative of
**Jelly Baby** by Scott Sun, https://github.com/scottstts/Jelly-Baby (GPL-3.0-only).
That makes Block Cities a derivative work of Jelly Baby too. These files are copied
or adapted; each carries a header saying what changed:

| Here | From Jellyland | Originally from Jelly Baby |
| --- | --- | --- |
| `src/render/renderer.ts` | `src/render/renderer.ts` | `src/graphics/scene/renderer.ts` |
| `src/render/composite.ts` | `src/render/composite.ts` | `src/graphics/scene/composite.ts` |
| `src/render/environment.ts` | `src/render/environment.ts` | `src/graphics/scene/environment.ts` |
| `src/render/studio-environment.generated.ts` | same | `src/graphics/scene/studio-environment.generated.ts` |
| `src/assets/bg_room_studio.rgba16f` | same | `src/assets/bg_room_studio.rgba16f` |

Written for Block Cities, following Jellyland's patterns: `src/world/sky.ts` (its
sky gradient, fog and "meadow" air, plus a shadow map it does not have),
`src/render/brick-materials.ts` (the glass uses the same physical transmission as
its jelly material), and the boot and failure handling in `src/main.ts` and
`src/app/runtime.ts`.

Not carried over: the soft body, the jelly material and looks, the local
reflection probe, the terrain, and the sound.

Everything else (the simulation, the brick blueprints, the instanced brick
drawing, camera, input and interface) is new.

The bricks are generic studded toy bricks. Block Cities is not affiliated with or
endorsed by the LEGO Group or by any city-building game.

If you distribute Block Cities or a modified version, GPLv3 requires you to make
the corresponding source available under the same licence.
