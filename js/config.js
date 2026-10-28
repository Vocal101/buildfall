'use strict';
// Game constants, weapons, items, keybinds and settings.

const VERSION = '1.0.0';
const NET_VER = 1;
const S = 4;              // building grid cell size (meters)
const WALL_T = 0.3;       // build piece thickness
const CONE_H = 1.6;       // roof apex height
const BUILD_COST = 10;
const MAX_MATS = 999;
const MAX_AMMO = 999;
const BUILD_REACH = 2;    // cells
const WATER_Y = 0;

const MATS = [
  { id: 0, key: 'wood', name: 'Wood', hp: 200, time: 2.2, color: '#c58b4c' },
  { id: 1, key: 'brick', name: 'Brick', hp: 350, time: 4.0, color: '#b65a46' },
  { id: 2, key: 'metal', name: 'Metal', hp: 500, time: 6.0, color: '#9fb0be' },
];

const RARITY = [
  { name: 'Common', color: '#aab3bd', glow: 0xaab3bd },
  { name: 'Uncommon', color: '#4fd34a', glow: 0x4fd34a },
  { name: 'Rare', color: '#36a3ff', glow: 0x36a3ff },
  { name: 'Epic', color: '#c351ff', glow: 0xc351ff },
  { name: 'Legendary', color: '#ff8f1f', glow: 0xff8f1f },
  { name: 'Mythic', color: '#ffd23a', glow: 0xffd23a },
];
const R_DMG = [1, 1.05, 1.1, 1.16, 1.22, 1];
const R_RELOAD = [1, 0.94, 0.88, 0.82, 0.76, 1];

const AMMO = {
  light: { name: 'Light Bullets', color: '#7fd0ff', pickup: 36 },
  medium: { name: 'Medium Bullets', color: '#9cff7a', pickup: 30 },
  heavy: { name: 'Heavy Bullets', color: '#ff7a7a', pickup: 6 },
  shells: { name: 'Shells', color: '#ffcf5a', pickup: 8 },
  rockets: { name: 'Rockets', color: '#ff9a3c', pickup: 2 },
};

// spread: [hip, ads] radians.  falloff: [[distance, multiplier], ...]
const WEAPONS = {
  ar: { name: 'Assault Rifle', cls: 'ar', ammo: 'medium', dmg: 30, head: 1.5, rate: 5.5, mag: 30, reload: 2.6, spread: [0.042, 0.011], bloom: 0.006, bloomMax: 0.04, recoil: 0.008, range: 450, falloff: [[60, 1], [120, 0.85], [220, 0.7]], auto: true, zoom: 1.45, rar: [0, 1, 2, 3, 4], weight: 10, sound: 'rifle' },
  burst: { name: 'Burst Rifle', cls: 'ar', ammo: 'medium', dmg: 27, head: 1.5, rate: 2.1, burst: 3, burstGap: 0.075, mag: 30, reload: 2.7, spread: [0.045, 0.009], bloom: 0.004, bloomMax: 0.035, recoil: 0.007, range: 450, falloff: [[60, 1], [120, 0.85], [220, 0.7]], auto: false, zoom: 1.45, rar: [0, 1, 2, 3, 4], weight: 6, sound: 'rifle' },
  heavyar: { name: 'Heavy Assault Rifle', cls: 'ar', ammo: 'medium', dmg: 38, head: 1.5, rate: 3.8, mag: 25, reload: 2.9, spread: [0.05, 0.015], bloom: 0.009, bloomMax: 0.05, recoil: 0.02, range: 450, falloff: [[60, 1], [120, 0.85], [220, 0.7]], auto: true, zoom: 1.45, rar: [2, 3, 4], weight: 4, sound: 'heavy' },
  scoped: { name: 'Scoped Rifle', cls: 'ar', ammo: 'medium', dmg: 25, head: 1.6, rate: 3.5, mag: 20, reload: 2.3, spread: [0.06, 0.002], bloom: 0.002, bloomMax: 0.01, recoil: 0.01, range: 500, falloff: [[100, 1], [250, 0.85]], auto: true, zoom: 3.0, scope: true, rar: [2, 3, 4], weight: 3, sound: 'rifle' },
  pump: { name: 'Pump Shotgun', cls: 'shotgun', ammo: 'shells', dmg: 9.5, pellets: 10, head: 2.0, rate: 0.75, mag: 5, shellReload: 0.55, spread: [0.075, 0.06], recoil: 0.05, range: 45, falloff: [[6, 1], [12, 0.75], [22, 0.42], [40, 0.15]], auto: false, zoom: 1.15, rar: [1, 2, 3, 4], weight: 8, sound: 'shotgun' },
  tac: { name: 'Tactical Shotgun', cls: 'shotgun', ammo: 'shells', dmg: 7.5, pellets: 9, head: 2.0, rate: 1.5, mag: 8, shellReload: 0.45, spread: [0.085, 0.07], recoil: 0.04, range: 45, falloff: [[6, 1], [12, 0.75], [22, 0.42], [40, 0.15]], auto: false, zoom: 1.15, rar: [0, 1, 2, 3, 4], weight: 8, sound: 'shotgun' },
  drum: { name: 'Drum Shotgun', cls: 'shotgun', ammo: 'shells', dmg: 5.6, pellets: 8, head: 1.75, rate: 2.6, mag: 10, reload: 4.4, spread: [0.09, 0.075], recoil: 0.03, range: 40, falloff: [[6, 1], [12, 0.7], [22, 0.4], [40, 0.12]], auto: true, zoom: 1.15, rar: [1, 2, 3], weight: 5, sound: 'shotgun' },
  smg: { name: 'SMG', cls: 'smg', ammo: 'light', dmg: 17, head: 1.75, rate: 11, mag: 30, reload: 2.2, spread: [0.055, 0.035], bloom: 0.003, bloomMax: 0.03, recoil: 0.005, range: 200, falloff: [[20, 1], [40, 0.8], [80, 0.6]], auto: true, zoom: 1.25, rar: [0, 1, 2, 3, 4], weight: 8, sound: 'smg' },
  stinger: { name: 'Stinger SMG', cls: 'smg', ammo: 'light', dmg: 15, head: 1.75, rate: 14, mag: 25, reload: 2.0, spread: [0.06, 0.04], bloom: 0.003, bloomMax: 0.03, recoil: 0.004, range: 180, falloff: [[18, 1], [36, 0.8], [70, 0.55]], auto: true, zoom: 1.25, rar: [1, 2, 3, 4], weight: 6, sound: 'smg' },
  pistol: { name: 'Pistol', cls: 'pistol', ammo: 'light', dmg: 24, head: 2.0, rate: 6.5, mag: 16, reload: 1.5, spread: [0.03, 0.012], bloom: 0.008, bloomMax: 0.04, recoil: 0.012, range: 250, falloff: [[30, 1], [60, 0.8], [120, 0.6]], auto: false, zoom: 1.25, rar: [0, 1, 2, 3, 4], weight: 7, sound: 'pistol' },
  hcannon: { name: 'Hand Cannon', cls: 'pistol', ammo: 'heavy', dmg: 60, head: 2.0, rate: 0.9, mag: 7, reload: 2.1, spread: [0.025, 0.006], bloom: 0.02, bloomMax: 0.05, recoil: 0.05, range: 300, falloff: [[40, 1], [80, 0.8], [160, 0.6]], auto: false, zoom: 1.3, rar: [3, 4], weight: 3, sound: 'heavy' },
  hunting: { name: 'Hunting Rifle', cls: 'sniper', ammo: 'heavy', dmg: 86, head: 2.5, rate: 0.8, mag: 1, reload: 1.9, spread: [0.07, 0.0], recoil: 0.04, range: 600, auto: false, zoom: 2.2, proj: { speed: 380, grav: 9 }, rar: [1, 2, 3], weight: 4, sound: 'sniper' },
  bolt: { name: 'Bolt-Action Sniper', cls: 'sniper', ammo: 'heavy', dmg: 105, head: 2.5, rate: 0.35, mag: 1, reload: 2.9, spread: [0.12, 0.0], recoil: 0.06, range: 800, auto: false, zoom: 4.5, scope: true, proj: { speed: 430, grav: 9 }, rar: [1, 2, 3, 4], weight: 4, sound: 'sniper' },
  heavysniper: { name: 'Heavy Sniper', cls: 'sniper', ammo: 'heavy', dmg: 150, head: 2.5, rate: 0.33, mag: 1, reload: 4.2, struct: 1100, spread: [0.12, 0.0], recoil: 0.08, range: 900, auto: false, zoom: 4.5, scope: true, proj: { speed: 520, grav: 7 }, rar: [3, 4], weight: 2, sound: 'sniper' },
  rocket: { name: 'Rocket Launcher', cls: 'explosive', ammo: 'rockets', dmg: 110, head: 1, rate: 0.75, mag: 1, reload: 3.3, spread: [0.02, 0.005], recoil: 0.05, range: 600, auto: false, zoom: 1.3, proj: { speed: 58, grav: 0, radius: 4.5, struct: 420, life: 8 }, rar: [2, 3, 4], weight: 2, sound: 'rocket' },
  gl: { name: 'Grenade Launcher', cls: 'explosive', ammo: 'rockets', dmg: 100, head: 1, rate: 1.1, mag: 6, reload: 3.0, spread: [0.02, 0.01], recoil: 0.04, range: 300, auto: false, zoom: 1.3, proj: { speed: 40, grav: 24, radius: 4, struct: 300, bounce: true, fuse: 2.0, life: 3 }, rar: [2, 3, 4], weight: 2, sound: 'gl' },
  minigun: { name: 'Minigun', cls: 'smg', ammo: 'light', dmg: 18, head: 1.5, rate: 12, mag: 0, spin: 0.75, spread: [0.065, 0.05], bloom: 0.001, bloomMax: 0.02, recoil: 0.003, range: 250, falloff: [[30, 1], [60, 0.8], [120, 0.6]], auto: true, zoom: 1.2, rar: [3, 4], weight: 2, sound: 'smg' },
  // Mythics (fixed stats, rare chest drops)
  tempest: { name: 'Tempest Rifle', cls: 'ar', ammo: 'medium', dmg: 40, head: 1.6, rate: 6.4, mag: 35, reload: 2.0, spread: [0.035, 0.007], bloom: 0.004, bloomMax: 0.03, recoil: 0.007, range: 500, falloff: [[80, 1], [160, 0.85]], auto: true, zoom: 1.5, rar: [5], weight: 0, mythic: true, sound: 'rifle' },
  dragon: { name: 'Dragonbreath Pump', cls: 'shotgun', ammo: 'shells', dmg: 11.5, pellets: 10, head: 2.0, rate: 0.85, mag: 6, shellReload: 0.42, spread: [0.07, 0.055], recoil: 0.05, range: 45, falloff: [[7, 1], [14, 0.78], [24, 0.45], [40, 0.18]], auto: false, zoom: 1.15, rar: [5], weight: 0, mythic: true, sound: 'shotgun' },
  skybreaker: { name: 'Skybreaker', cls: 'sniper', ammo: 'heavy', dmg: 140, head: 2.5, rate: 0.6, mag: 4, reload: 2.5, spread: [0.1, 0.0], recoil: 0.06, range: 900, auto: false, zoom: 4.5, scope: true, proj: { speed: 620, grav: 6 }, rar: [5], weight: 0, mythic: true, sound: 'sniper' },
};
const PICKAXE = { name: 'Harvesting Tool', dmg: 20, struct: 50, rate: 1.55, range: 3.2 };

// Consumables (stack in inventory slots)
const ITEMS = {
  bandage: { name: 'Bandages', r: 1, stack: 15, time: 3.5, heal: 15, max: 75, icon: 'bandage' },
  medkit: { name: 'Med Kit', r: 1, stack: 3, time: 8, heal: 100, max: 100, icon: 'medkit' },
  mini: { name: 'Small Shield Potion', r: 1, stack: 6, time: 2, shield: 25, max: 50, icon: 'mini' },
  big: { name: 'Shield Potion', r: 2, stack: 3, time: 4.5, shield: 50, max: 100, icon: 'big' },
  fizz: { name: 'Fizz Juice', r: 3, stack: 2, time: 2, regen: 75, icon: 'fizz' },
  splash: { name: 'Mega Jug', r: 4, stack: 1, time: 12, full: true, icon: 'jug' },
  nade: { name: 'Grenade', r: 1, stack: 6, throw: true, dmg: 105, radius: 5, struct: 375, fuse: 2.6, icon: 'nade' },
  bounce: { name: 'Bounce Pad', r: 2, stack: 2, trap: true, icon: 'pad' },
};

const ITEM_WEIGHTS = { bandage: 8, medkit: 3, mini: 8, big: 4, fizz: 2.5, splash: 0.6, nade: 4, bounce: 2 };
const FLOOR_RARITY = [38, 33, 19, 8, 2, 0];
const CHEST_RARITY = [16, 32, 30, 15, 6, 1];
const VAULT_RARITY = [0, 0, 25, 40, 30, 5];

const POI_NAMES = ['Pinewood Hollow', 'Rustwater Docks', 'Sunspire Heights', 'Mossbrook Mills', 'Crater Yard', 'Driftwood Bay', 'Lumberjack Lot', 'Hilltop Keep', 'Copper Canyon', 'Breezy Acres', 'Fable Fields', 'Stormwatch Point'];

const SKINS = [
  { name: 'Ranger', suit: 0x2f6fd6, accent: 0xffc53d, skin: 0xf1c7a1, visor: 0x1b2b44, hair: 0x3a2618 },
  { name: 'Blaze', suit: 0xd8402f, accent: 0x2b2b30, skin: 0xd9a27b, visor: 0x2b1010, hair: 0x15110f },
  { name: 'Frostbyte', suit: 0x7fd3ff, accent: 0xffffff, skin: 0xffe0c4, visor: 0x1a4a66, hair: 0xe8f6ff },
  { name: 'Mossback', suit: 0x4f8f3a, accent: 0x8b5a2b, skin: 0xa8734f, visor: 0x203315, hair: 0x2a1a0a },
  { name: 'Nebula', suit: 0x7a4dff, accent: 0xff5ed2, skin: 0xf3c9b0, visor: 0x200a40, hair: 0xff8ad8 },
  { name: 'Sunny', suit: 0xffb020, accent: 0xff5a36, skin: 0x8d5a3b, visor: 0x3a1e00, hair: 0x1a0d05 },
  { name: 'Nightshade', suit: 0x22252e, accent: 0x40ffb0, skin: 0xc79377, visor: 0x00ffaa, hair: 0x0a0a0a },
  { name: 'Coral', suit: 0xff7a8a, accent: 0x24c2b8, skin: 0xf6d0b4, visor: 0x123f3c, hair: 0x7a2b1a },
  { name: 'Sterling', suit: 0xb9c2cc, accent: 0x2a6df0, skin: 0x6b4430, visor: 0x0e1f40, hair: 0x0f0b08 },
  { name: 'Ember', suit: 0x5a2a1a, accent: 0xff8a2a, skin: 0xe9b48e, visor: 0x3d1500, hair: 0xb8441c },
];

const BOT_NAMES = ['Pixel', 'Nova', 'Zipline', 'Bolt', 'Mango', 'Vortex', 'Echo', 'Juniper', 'Rook', 'Quasar', 'Tango', 'Wisp', 'Comet', 'Drift', 'Fable', 'Gizmo', 'Harbor', 'Indigo', 'Jet', 'Kestrel', 'Lumen', 'Maple', 'Nimbus', 'Onyx', 'Pepper', 'Quill', 'Rally', 'Sable', 'Tundra', 'Umbra', 'Vesper', 'Willow', 'Xeno', 'Yonder', 'Zephyr', 'Atlas', 'Birch', 'Cinder', 'Dune', 'Flint', 'Grove', 'Haze', 'Ivy', 'Koda', 'Lyric', 'Marble', 'Nyx', 'Orbit', 'Pike', 'Rumble', 'Sprocket', 'Tide', 'Valor', 'Whisk', 'Yeti', 'Ziggy', 'Brisk', 'Cobalt', 'Dash', 'Ember'];

// Keybindable actions. ctx: which modes they apply in (for conflict warnings).
const ACTIONS = [
  { id: 'forward', label: 'Move Forward', def: 'KeyW', ctx: 'move', group: 'Movement' },
  { id: 'back', label: 'Move Backward', def: 'KeyS', ctx: 'move', group: 'Movement' },
  { id: 'left', label: 'Move Left', def: 'KeyA', ctx: 'move', group: 'Movement' },
  { id: 'right', label: 'Move Right', def: 'KeyD', ctx: 'move', group: 'Movement' },
  { id: 'jump', label: 'Jump / Deploy Glider', def: 'Space', ctx: 'move', group: 'Movement' },
  { id: 'sprint', label: 'Sprint', def: 'ShiftLeft', ctx: 'move', group: 'Movement' },
  { id: 'fire', label: 'Fire', def: 'Mouse0', ctx: 'combat', group: 'Combat' },
  { id: 'aim', label: 'Aim Down Sights', def: 'Mouse2', ctx: 'combat', group: 'Combat' },
  { id: 'reload', label: 'Reload', def: 'KeyR', ctx: 'combat', group: 'Combat' },
  { id: 'interact', label: 'Interact / Pick Up', def: 'KeyE', ctx: 'move', group: 'Combat' },
  { id: 'pickaxe', label: 'Harvesting Tool', def: 'Digit1', ctx: 'move', group: 'Combat' },
  { id: 'slot1', label: 'Weapon Slot 1', def: 'Digit2', ctx: 'move', group: 'Combat' },
  { id: 'slot2', label: 'Weapon Slot 2', def: 'Digit3', ctx: 'move', group: 'Combat' },
  { id: 'slot3', label: 'Weapon Slot 3', def: 'Digit4', ctx: 'move', group: 'Combat' },
  { id: 'slot4', label: 'Weapon Slot 4', def: 'Digit5', ctx: 'move', group: 'Combat' },
  { id: 'slot5', label: 'Weapon Slot 5', def: 'Digit6', ctx: 'move', group: 'Combat' },
  { id: 'nextSlot', label: 'Next Slot', def: 'WheelDown', ctx: 'combat', group: 'Combat' },
  { id: 'prevSlot', label: 'Previous Slot', def: 'WheelUp', ctx: 'combat', group: 'Combat' },
  { id: 'drop', label: 'Drop Item', def: 'KeyT', ctx: 'combat', group: 'Combat' },
  { id: 'buildMode', label: 'Toggle Build Mode', def: 'KeyB', ctx: 'move', group: 'Building' },
  { id: 'wall', label: 'Build Wall', def: 'KeyQ', ctx: 'move', group: 'Building' },
  { id: 'floor', label: 'Build Floor', def: 'KeyZ', ctx: 'move', group: 'Building' },
  { id: 'ramp', label: 'Build Stairs', def: 'KeyC', ctx: 'move', group: 'Building' },
  { id: 'cone', label: 'Build Roof', def: 'KeyV', ctx: 'move', group: 'Building' },
  { id: 'place', label: 'Place Build', def: 'Mouse0', ctx: 'build', group: 'Building' },
  { id: 'changeMat', label: 'Change Material', def: 'Mouse2', ctx: 'build', group: 'Building' },
  { id: 'rotate', label: 'Rotate Build', def: 'KeyR', ctx: 'build', group: 'Building' },
  { id: 'edit', label: 'Edit (Start / Confirm)', def: 'KeyF', ctx: 'move', group: 'Editing' },
  { id: 'editSelect', label: 'Select Edit Tile', def: 'Mouse0', ctx: 'edit', group: 'Editing' },
  { id: 'resetEdit', label: 'Reset Edit', def: 'Mouse2', ctx: 'edit', group: 'Editing' },
  { id: 'map', label: 'Map', def: 'KeyM', ctx: 'move', group: 'Other' },
  { id: 'emote', label: 'Emote', def: 'KeyN', ctx: 'combat', group: 'Other' },
];

const DEFAULT_SETTINGS = {
  name: '',
  skin: 0,
  sens: 1.0, adsSens: 0.7, scopeSens: 0.45, buildSens: 1.0, editSens: 1.0, invertY: false,
  fov: 80,
  editOnRelease: true, turboBuild: true, autoMat: true, holdAim: true, toggleSprint: false, autoSprint: false,
  resetOnEditStart: false,
  quality: 'high', shadows: true, grass: true, renderScale: 1, showFps: false,
  volume: 0.7, sfx: 1, uiScale: 1,
  crosshair: '#ffffff',
  binds: {},
  br: { bots: 29, diff: 1 },
  duel: { rounds: 5, diff: 1, mats: 999 },
};

// Storm phases for battle royale: wait, shrink, resulting radius, damage per second
const STORM_PHASES = [
  { wait: 70, shrink: 50, r: 190, dps: 1 },
  { wait: 50, shrink: 45, r: 110, dps: 2 },
  { wait: 40, shrink: 40, r: 62, dps: 4 },
  { wait: 35, shrink: 35, r: 32, dps: 6 },
  { wait: 30, shrink: 30, r: 15, dps: 8 },
  { wait: 20, shrink: 30, r: 5, dps: 10 },
  { wait: 15, shrink: 30, r: 0, dps: 12 },
];

const WEAPON_IDS = Object.keys(WEAPONS);
const ITEM_IDS = Object.keys(ITEMS);
const isWeapon = it => it && it.w !== undefined;
const isItem = it => it && it.c !== undefined;

function weaponStats(w, r) {
  const b = WEAPONS[w];
  const fixed = b.mythic;
  const dm = fixed ? 1 : R_DMG[r];
  const rl = fixed ? 1 : R_RELOAD[r];
  return {
    ...b, id: w, r,
    dmg: b.dmg * dm,
    reload: (b.reload || 0) * rl,
    shellReload: b.shellReload ? b.shellReload * rl : 0,
    mag: b.mag,
  };
}
function itemName(it) {
  if (!it) return '';
  if (isWeapon(it)) return WEAPONS[it.w].name;
  if (isItem(it)) return ITEMS[it.c].name;
  return '';
}
function itemRarity(it) {
  if (!it) return 0;
  if (isWeapon(it)) return it.r;
  if (isItem(it)) return ITEMS[it.c].r;
  return 0;
}
