# Buildfall

A 3D battle royale and build-fight game that runs in the browser. Drop from the Battle Blimp, loot weapons, harvest materials, build and edit forts, and outlast everyone, or go head-to-head in 1v1 build fights. You can play against CPU bots or online with friends using a room code. Everything is original: the characters, the island, the weapons, the art (all made in code) and the sounds.

## Play online
**https://vocal101.github.io/buildfall/** runs in the browser with nothing to install. Chrome or Edge is recommended.

## Download and play
1. At the top of this page, click the green **Code** button, then **Download ZIP**.
2. Unzip it: right-click the file and choose **Extract All** on Windows, or double-click it on a Mac.
3. Open the unzipped folder and double-click `index.html`.

If you use git, run `git clone https://github.com/Vocal101/buildfall.git` and open `index.html` the same way. Solo modes work without internet. Online play needs an internet connection.

## Modes

- **Battle Royale.** Up to 60 players (you plus bots). Ride the Battle Blimp across the island and jump whenever you like. Free fall from 245 m (hold forward to dive faster), open your glider when you choose, or let it open by itself 45 m above the ground, and land in one of ten towns. Falls of more than two storeys on foot cause damage. Open chests and ammo boxes, pick up floor loot, and harvest trees, rocks, cars and houses for materials. The storm closes in over seven phases, and the last player standing wins.
- **1v1 Build Fight.** You and an opponent start with full health and shields, a Legendary Assault Rifle, Pump Shotgun and SMG, grenades, shield potions and a stack of materials. Win a round by eliminating the other player. The zone closes after 40 seconds. Play first to 3, 5 or 7.
- **Play Online.** One player hosts a room and shares the 5-letter code, and friends type it in to join. Hosts can run Battle Royale with up to 16 people (plus bots to fill the lobby) or a 1v1 build fight. Connections are peer-to-peer through WebRTC, and the host's computer runs the match.

## Building and editing

- Four pieces: **walls, floors, stairs and roofs**, in **wood, brick or metal**. Wood goes up fastest, metal is strongest, and each piece costs 10 materials.
- Every piece snaps to a 4 m grid. Each grid slot holds exactly one piece, so builds never overlap or clip into each other. Stairs and roofs share a cell's slot.
- A piece has to touch the ground or another build. When a supporting piece is destroyed, everything that was resting on it collapses.
- Placement follows where you look. Facing forward while standing on stairs puts the next flight one level up, so ramp rushing and "wall + stairs" climbs work naturally. Look up to build above you or down to build below you. Turbo building places pieces continuously while you hold the button.
- **Editing.** Aim at your build and press the edit key. Click or drag across tiles to cut doors, windows, arches and half walls. Floors and roofs have 4 tiles, walls have 9. On stairs, drag across tiles to change their direction. Edits confirm when you release (this can be changed in Settings), and the reset key restores the piece. Prebuilt houses can be edited too.
- Pieces start weak and gain health while they finish building. Their health shows when you aim at them.

## Weapons and items

Twenty weapons across **six rarities**: Common, Uncommon, Rare, Epic, Legendary and Mythic. Each step up adds damage and speeds up reloads.

| Class | Weapons |
| --- | --- |
| Assault rifles | Assault Rifle, Burst Rifle, Heavy Assault Rifle, Scoped Rifle |
| Shotguns | Pump Shotgun, Tactical Shotgun, Drum Shotgun |
| SMGs | SMG, Stinger SMG, Minigun |
| Pistols | Pistol, Hand Cannon |
| Snipers | Hunting Rifle, Bolt-Action Sniper, Heavy Sniper (very strong against builds) |
| Explosives | Rocket Launcher, Grenade Launcher |
| Mythic (rare chest drops) | Tempest Rifle, Dragonbreath Pump, Skybreaker |

Every shot draws a tracer streak that flies from the muzzle, guns throw spent casings, and snipers fire bullets that travel and drop over distance. Shotguns reload one shell at a time, and you can fire again mid-reload. Headshots do extra damage, bloom grows while you spray, and the first shot is accurate if you're standing still and aiming.

Items: Bandages, Med Kit, Small Shield Potion, Shield Potion, Fizz Juice (heals over time), Mega Jug (full health and shields), Grenades and Bounce Pads.

## Characters and graphics

Sixteen outfits, each with its own hairstyle or helmet, clothing and back bling. Six of them wear masks: Reaper (a skull with glowing eyes, a hood and a scythe), Oni (a horned demon mask and crossed swords), Slasher (a hockey mask), Toxin (a hazmat suit and glowing gas mask), Kitsune (a fox mask with ears) and Glitch (a black visor with LED eyes). The hotbar draws every weapon with its own icon, and the materials panel names each material and how strong it is. Characters are skinned and animated in code: they run, strafe, sprint, jump, swim, skydive, glide and dance, and their hands grip each weapon through inverse kinematics. The renderer uses HDR with bloom, filmic tone mapping, colour grading and sky reflections, plus clouds you fall through, animated water, grass and soft shadows. Lower the Quality setting in Settings → Video if your computer struggles.

## Default controls

Every key can be changed in **Settings → Keybinds**, including mouse side buttons and the scroll wheel.

| Action | Key |
| --- | --- |
| Move / Jump / Sprint | W A S D / Space / Left Shift |
| Fire / Aim | Left mouse / Right mouse |
| Reload / Interact | R / E |
| Harvesting tool | F |
| Slots 1–5 | 1–5 (or scroll wheel) |
| Wall / Floor / Stairs / Roof | Q / Z / C / V |
| Place build / Change material / Rotate stairs | Left mouse / Right mouse / R |
| Toggle build mode | B |
| Edit (start / confirm) | G |
| Select edit tile / Reset edit | Left mouse / Right mouse |
| Drop item / Emote / Map | T / N / M |
| Menu | Esc |

Settings also cover separate sensitivities for hip fire, aiming, scopes, building and editing; field of view; graphics quality, shadows, grass and resolution scale; crosshair color; and volume.

## For developers

No build step. The code is plain JavaScript files in `js/`, and three.js and PeerJS are bundled in `lib/`.

- `python scripts/devserver.py` serves the game at http://localhost:8775 with caching turned off.
- `node tests/sim.test.js` runs headless checks: world generation, the building rules (slots, support, collapse, edits), movement on ramps and walls, and full bot-only Battle Royale and 1v1 matches.
- Open `index.html?dev` to get the `T` test harness in the browser console (`T.startBR()`, `T.startDuel()`, `T.build()`, `T.frames()`, `T.snap()` and more).

Libraries: [three.js](https://threejs.org) (MIT), [PeerJS](https://peerjs.com) (MIT). Fonts: Lilita One and Rubik (SIL Open Font License).
