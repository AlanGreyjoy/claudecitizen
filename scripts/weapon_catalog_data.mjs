/**
 * Authoring table for the Synty SciFiWorlds weapon packs.
 *
 * One row per weapon: the GLB it wraps, the invented name, and its stats.
 * Consumed by generate_weapon_prefabs.mjs (prefab JSON), bake_weapon_icons.mjs
 * (512px icons) and seed_weapon_catalog.mjs (ItemDefinition/WeaponDefinition
 * rows). Edit here, re-run all three, and the three stay consistent.
 *
 * Backend accepts only rifle | handgun | sword for weaponSlotType, so every
 * long gun rides the rifle slot and all melee rides the sword slot.
 *
 * Excluded on purpose:
 *   SM_Wep_Shotgun_01_Shell_01  – 7cm shell casing prop, not a weapon
 *   SM_Wep_Missile_01           – 1.9m missile projectile, not carryable
 *   Scopes/*                    – attachments; no loadout slot exists for them
 */

const WEAPONS_DIR = 'Synty/SciFiWorlds/Weapons';

/** Ammunition the new weapon families need; 5.56 and 9mm already exist. */
export const AMMO = [
  {
    id: 'ammo-smg-45',
    name: '.45 Caseless Block',
    description: 'Stacked caseless pistol-calibre rounds for compact automatics.',
    subType: 'smg-45',
    costArc: 2,
    stackMax: 240,
  },
  {
    id: 'ammo-shotgun-12g',
    name: '12g Flechette Shell',
    description: 'Wide-spread flechette payload for close-quarters breaching.',
    subType: 'shotgun-12g',
    costArc: 4,
    stackMax: 120,
  },
  {
    id: 'ammo-heavy-762',
    name: '7.62 Linked Belt',
    description: 'Belt-fed rifle rounds for sustained suppressive fire.',
    subType: 'heavy-762',
    costArc: 3,
    stackMax: 400,
  },
  {
    id: 'ammo-sniper-338',
    name: '.338 Match Round',
    description: 'Hand-loaded long-range match ammunition.',
    subType: 'sniper-338',
    costArc: 9,
    stackMax: 80,
  },
  {
    id: 'ammo-energy-cell',
    name: 'Xenoplasma Cell',
    description: 'Recovered alien charge cell. Unstable, and worth a fortune.',
    subType: 'energy-cell',
    costArc: 18,
    stackMax: 60,
  },
  {
    id: 'ammo-rocket-80mm',
    name: '80mm Shaped Rocket',
    description: 'Fin-stabilised anti-armour rocket.',
    subType: 'rocket-80mm',
    costArc: 45,
    stackMax: 24,
  },
];

/**
 * Per-family defaults. Individual weapons override what makes them distinct;
 * everything else inherits, which keeps 60+ rows readable and internally
 * consistent instead of 60 independently hand-tuned stat blocks.
 */
const FAMILIES = {
  pistol: {
    slot: 'handgun',
    subType: 'handgun',
    ammo: 'ammo-handgun-9mm',
    magazineSize: 15,
    fireModes: ['single'],
    roundsPerMinute: 420,
    muzzleVelocityMps: 380,
    bulletGravityMps2: 9.81,
    maxRangeMeters: 500,
    damage: 18,
    costArc: 2200,
    rarity: 'uncommon',
  },
  smg: {
    slot: 'rifle',
    subType: 'smg',
    ammo: 'ammo-smg-45',
    magazineSize: 32,
    fireModes: ['single', 'auto'],
    roundsPerMinute: 900,
    muzzleVelocityMps: 400,
    bulletGravityMps2: 9.81,
    maxRangeMeters: 600,
    damage: 15,
    costArc: 3400,
    rarity: 'uncommon',
  },
  assault: {
    slot: 'rifle',
    subType: 'assault',
    ammo: 'ammo-rifle-556',
    magazineSize: 30,
    fireModes: ['single', 'burst3', 'auto'],
    roundsPerMinute: 720,
    muzzleVelocityMps: 880,
    bulletGravityMps2: 9.81,
    maxRangeMeters: 1200,
    damage: 24,
    costArc: 4800,
    rarity: 'uncommon',
  },
  shotgun: {
    slot: 'rifle',
    subType: 'shotgun',
    ammo: 'ammo-shotgun-12g',
    magazineSize: 8,
    fireModes: ['single'],
    roundsPerMinute: 90,
    muzzleVelocityMps: 420,
    bulletGravityMps2: 9.81,
    maxRangeMeters: 220,
    damage: 62,
    costArc: 4100,
    rarity: 'uncommon',
  },
  heavy: {
    slot: 'rifle',
    subType: 'heavy',
    ammo: 'ammo-heavy-762',
    magazineSize: 100,
    fireModes: ['auto'],
    roundsPerMinute: 640,
    muzzleVelocityMps: 840,
    bulletGravityMps2: 9.81,
    maxRangeMeters: 1400,
    damage: 30,
    costArc: 9600,
    rarity: 'rare',
  },
  sniper: {
    slot: 'rifle',
    subType: 'sniper',
    ammo: 'ammo-sniper-338',
    magazineSize: 5,
    fireModes: ['bolt'],
    roundsPerMinute: 48,
    muzzleVelocityMps: 940,
    bulletGravityMps2: 9.81,
    maxRangeMeters: 2400,
    damage: 110,
    costArc: 11_500,
    rarity: 'rare',
  },
  launcher: {
    slot: 'rifle',
    subType: 'launcher',
    ammo: 'ammo-rocket-80mm',
    magazineSize: 4,
    fireModes: ['single'],
    roundsPerMinute: 40,
    muzzleVelocityMps: 120,
    bulletGravityMps2: 9.81,
    maxRangeMeters: 900,
    damage: 190,
    costArc: 16_000,
    rarity: 'epic',
  },
  alien: {
    slot: 'rifle',
    subType: 'alien',
    ammo: 'ammo-energy-cell',
    magazineSize: 24,
    fireModes: ['single', 'auto'],
    roundsPerMinute: 480,
    // Charged bolts fly flat and fast — near-zero drop is the family's hook.
    muzzleVelocityMps: 1400,
    bulletGravityMps2: 0,
    maxRangeMeters: 1800,
    damage: 42,
    costArc: 24_000,
    rarity: 'legendary',
  },
  /**
   * Melee still has to satisfy the WeaponDefinition columns, so the ballistics
   * fields are reused with melee meanings: roundsPerMinute = swings/min,
   * maxRangeMeters = reach, muzzleVelocityMps = swing speed. The client never
   * reads them — resolveActiveFirearm excludes weaponSlotType 'sword'.
   */
  melee: {
    slot: 'sword',
    subType: 'melee',
    ammo: null,
    magazineSize: 1,
    fireModes: ['single'],
    roundsPerMinute: 70,
    muzzleVelocityMps: 12,
    bulletGravityMps2: 0,
    maxRangeMeters: 2.2,
    damage: 45,
    costArc: 1800,
    rarity: 'common',
  },
};

/** [glb, id, name, family, description, overrides?] */
const ROWS = [
  // ---- Hand-authored, listed for icon baking only -------------------------
  // These two predate the generator. They appear here so bake_weapon_icons
  // covers the whole catalog; EXISTING_WEAPON_IDS keeps the prefab writer and
  // the stat columns of the seeder off them. Their stats below are a mirror of
  // what is already in the database, never a source of truth for it.
  ['SM_Wep_Assault_01.glb', 'assault-01', 'Asteron Rifle', 'assault',
    'Standard-issue Asteron service rifle.'],
  ['SM_Wep_Pistol_04.glb', 'twin-horned-pistol', 'Twin Horned Pistol', 'pistol',
    'Twin-barrelled sidearm with a distinctive horned foresight.'],

  // ---- Sidearms -----------------------------------------------------------
  ['SM_Wep_Pistol_01.glb', 'mag-sidearm', 'Mag Sidearm', 'pistol',
    'Standard-issue magnetic sidearm. Unremarkable, and never jams.',
    { costArc: 1400, rarity: 'common', damage: 16 }],
  ['SM_Wep_Pistol_02.glb', 'drifter-compact', 'Drifter Compact', 'pistol',
    'Snub-frame holdout favoured by belt haulers who cannot afford attention.',
    { costArc: 1650, rarity: 'common', magazineSize: 10, damage: 15, maxRangeMeters: 380 }],
  ['SM_Wep_Pistol_03.glb', 'widow-snub', 'Widow Snub', 'pistol',
    'Squat charge pistol built around an exposed cell. Few shots, no argument.',
    { costArc: 3100, magazineSize: 6, roundsPerMinute: 200, damage: 44 }],
  ['SM_Wep_Pistol_05.glb', 'nova-repeater', 'Nova Repeater', 'pistol',
    'Burst-capable machine pistol with a tendency to climb.',
    { costArc: 3600, magazineSize: 20, fireModes: ['single', 'burst3'], roundsPerMinute: 700, damage: 14 }],
  ['SM_Wep_Pistol_06.glb', 'warden-magnum', 'Warden Magnum', 'pistol',
    'Station-security hand cannon. Overpenetrates bulkheads and paperwork alike.',
    { costArc: 5200, rarity: 'rare', magazineSize: 8, roundsPerMinute: 260, damage: 52, muzzleVelocityMps: 470 }],

  // ---- Submachine guns ----------------------------------------------------
  ['SM_Wep_SMG_01.glb', 'ripper-smg', 'Ripper SMG', 'smg',
    'Cheap, loud, and utterly reliable at knife-fight range.'],
  ['SM_Wep_SMG_02.glb', 'hornet-pdw', 'Hornet PDW', 'smg',
    'Personal defence weapon issued to void-dock crews.',
    { magazineSize: 40, roundsPerMinute: 1050, damage: 13, costArc: 3900 }],
  ['SM_Wep_SMG_03.glb', 'static-whisper', 'Static Whisper', 'smg',
    'Integrally suppressed. Sounds like a dropped wrench two rooms away.',
    { rarity: 'rare', roundsPerMinute: 780, damage: 18, costArc: 6400 }],

  // ---- Assault rifles -----------------------------------------------------
  ['SM_Wep_Assault_02.glb', 'vanguard-ar2', 'Vanguard AR-2', 'assault',
    'Marine-pattern rifle built around a longer barrel and a worse trigger.',
    { damage: 26, maxRangeMeters: 1400, costArc: 5400 }],
  ['SM_Wep_Assault_03.glb', 'bulwark-carbine', 'Bulwark Carbine', 'assault',
    'Shortened carbine for boarding actions. Trades reach for handling.',
    { magazineSize: 25, roundsPerMinute: 800, damage: 22, maxRangeMeters: 900, costArc: 4400 }],

  // ---- Shotguns -----------------------------------------------------------
  ['SM_Wep_Shotgun_01.glb', 'breachmaw', 'Breachmaw', 'shotgun',
    'Door-opener. The door rarely survives the introduction.'],
  ['SM_Wep_Shotgun_02.glb', 'scattergun-sg2', 'Scattergun SG-2', 'shotgun',
    'Twin-tube pump gun with a brutally short effective range.',
    { magazineSize: 6, roundsPerMinute: 70, damage: 74, maxRangeMeters: 160 }],
  ['SM_Wep_Shotgun_03.glb', 'thunderclap', 'Thunderclap', 'shotgun',
    'Automatic combat shotgun. Empties itself faster than you can regret it.',
    { rarity: 'rare', magazineSize: 12, fireModes: ['single', 'auto'], roundsPerMinute: 240, damage: 48, costArc: 7200 }],

  // ---- Heavy weapons ------------------------------------------------------
  ['SM_Wep_Heavy_01.glb', 'siegebreaker-lmg', 'Siegebreaker LMG', 'heavy',
    'Belt-fed support gun. Bring a tripod, or bring regrets.'],
  ['SM_Wep_Heavy_02.glb', 'ironhound-repeater', 'Ironhound Repeater', 'heavy',
    'Rotary repeater with a spin-up you will learn to anticipate.',
    { magazineSize: 150, roundsPerMinute: 1200, damage: 24, costArc: 13_000 }],
  ['SM_Wep_Heavy_03.glb', 'havoc-suppressor', 'Havoc Suppressor', 'heavy',
    'Squad suppression platform. Accuracy is not among its virtues.',
    { magazineSize: 80, roundsPerMinute: 540, damage: 36, maxRangeMeters: 1100 }],

  // ---- Precision rifles ---------------------------------------------------
  ['SM_Wep_Sniper_01.glb', 'longshot-dmr', 'Longshot DMR', 'sniper',
    'Semi-automatic marksman rifle. Forgiving, by sniper standards.',
    { fireModes: ['single'], magazineSize: 10, roundsPerMinute: 180, damage: 72, maxRangeMeters: 1800, costArc: 9200 }],
  ['SM_Wep_Sniper_02.glb', 'silent-meridian', 'Silent Meridian', 'sniper',
    'Suppressed bolt-action. Patient work for patient people.'],
  ['SM_Wep_Sniper_03.glb', 'void-piercer', 'Void Piercer', 'sniper',
    'Anti-materiel rifle. Rated for hull plate; unrated for shoulders.',
    { rarity: 'epic', magazineSize: 3, roundsPerMinute: 32, damage: 180, muzzleVelocityMps: 1100, maxRangeMeters: 3200, costArc: 21_000 }],

  // ---- Launchers ----------------------------------------------------------
  ['SM_Wep_Launcher_01.glb', 'fracture-tube', 'Fracture Tube', 'launcher',
    'Single-tube rocket launcher. Check your backblast.',
    { magazineSize: 1, roundsPerMinute: 20, damage: 240 }],
  ['SM_Wep_Launcher_02.glb', 'kestrel-launcher', 'Kestrel Launcher', 'launcher',
    'Revolver-fed grenade launcher with a lazy, arcing trajectory.',
    { magazineSize: 6, roundsPerMinute: 70, muzzleVelocityMps: 85, damage: 130, maxRangeMeters: 600 }],
  ['SM_Wep_Launcher_03.glb', 'cinderfall-mortar', 'Cinderfall Mortar', 'launcher',
    'Shoulder-fired siege mortar. Indirect fire, direct consequences.',
    { rarity: 'legendary', magazineSize: 2, roundsPerMinute: 15, muzzleVelocityMps: 70, damage: 320, costArc: 28_000 }],

  // ---- Recovered alien tech ----------------------------------------------
  ['SM_Wep_Alien_01.glb', 'kthari-pulse-lance', 'Kthari Pulse Lance', 'alien',
    'Recovered xeno lance. The grip was not shaped for human hands.'],
  ['SM_Wep_Alien_02.glb', 'vorn-splitter', 'Vorn Splitter', 'alien',
    'Fires paired charge bolts that arrive together and leave separately.',
    { magazineSize: 16, roundsPerMinute: 300, damage: 60 }],
  ['SM_Wep_Alien_03.glb', 'hive-caster', 'Hive Caster', 'alien',
    'Organic casting weapon. It is warm, and it should not be.',
    { magazineSize: 40, fireModes: ['auto'], roundsPerMinute: 900, damage: 22, costArc: 26_000 }],
  ['SM_Wep_Alien_04.glb', 'xel-resonator', 'Xel Resonator', 'alien',
    'Resonance emitter salvaged from a derelict. Nobody agrees how it works.',
    { magazineSize: 8, fireModes: ['single'], roundsPerMinute: 120, damage: 145, maxRangeMeters: 2200, costArc: 34_000 }],

  // ---- Melee: arc blades --------------------------------------------------
  // The whole Synty melee set is energy-bladed, not steel: a plasma edge on a
  // machined handle. Names and copy follow the art, not sword-and-sorcery.
  ['Melee/SM_Wep_Sword_01a.glb', 'ashline-blade', 'Ashline Blade', 'melee',
    'Service arc blade. Ignites on grip contact and holds a steady edge.'],
  ['Melee/SM_Wep_Sword_02.glb', 'quarrel-edge', 'Quarrel Edge', 'melee',
    'Duelling emitter tuned for a narrow, fast-cycling blade.',
    { damage: 40, roundsPerMinute: 90 }],
  ['Melee/SM_Wep_Sword_03.glb', 'mourncut', 'Mourncut', 'melee',
    'Officer-pattern arc blade issued to Kestrel Line command crews.',
    { rarity: 'uncommon', damage: 52, costArc: 3200 }],
  ['Melee/SM_Wep_Sword_04.glb', 'severance', 'Severance', 'melee',
    'Overdriven emitter. Slow to swing, and it never needs a second pass.',
    { rarity: 'rare', damage: 88, roundsPerMinute: 40, maxRangeMeters: 2.6, costArc: 6800 }],
  ['Melee/SM_Wep_Sword_05.glb', 'tidewrack-arc', 'Tidewrack Arc', 'melee',
    'Salvage-yard blade with a handle worn smooth by other people.',
    { damage: 48, roundsPerMinute: 84 }],
  ['Melee/SM_Wep_Sword_06.glb', 'gravecant', 'Gravecant', 'melee',
    'Recovered from a sealed hab, still lit. The previous owner was not.',
    { rarity: 'rare', damage: 76, costArc: 7400 }],
  ['Melee/SM_Wep_Sword_07.glb', 'lumen-fang', 'Lumen Fang', 'melee',
    'High-output emitter. The blade hums louder the harder you press.',
    { rarity: 'epic', damage: 104, roundsPerMinute: 76, costArc: 14_000 }],
  ['Melee/SM_Wep_Sword_08.glb', 'oathkeeper', 'Oathkeeper', 'melee',
    'Presentation arc blade. Ceremonial, and fully charged.',
    { rarity: 'epic', damage: 96, roundsPerMinute: 44, maxRangeMeters: 2.8, costArc: 15_500 }],

  // ---- Melee: short arc blades --------------------------------------------
  ['Melee/SM_Wep_Dagger_01.glb', 'shivpoint', 'Shivpoint', 'melee',
    'Cut-down emitter on a scrap grip. Cheap enough to leave behind.',
    { damage: 24, roundsPerMinute: 140, maxRangeMeters: 1.4, costArc: 400, rarity: 'common' }],
  ['Melee/SM_Wep_Dagger_02.glb', 'cutter-mk2', 'Cutter Mk II', 'melee',
    'Utility arc knife rated for webbing, cable, and worse.',
    { damage: 27, roundsPerMinute: 132, maxRangeMeters: 1.4, costArc: 650 }],
  ['Melee/SM_Wep_Dagger_03.glb', 'silt-tooth', 'Silt Tooth', 'melee',
    'Short blade that runs hot and leaves a scorched draw-cut.',
    { damage: 32, roundsPerMinute: 126, maxRangeMeters: 1.5, costArc: 1100 }],
  ['Melee/SM_Wep_Dagger_04.glb', 'quiet-argument', 'Quiet Argument', 'melee',
    'Low-glow emitter sized for a sleeve. Ends discussions.',
    { rarity: 'uncommon', damage: 36, roundsPerMinute: 150, maxRangeMeters: 1.2, costArc: 2400 }],
  ['Melee/SM_Wep_Dagger_05.glb', 'hollowpin', 'Hollowpin', 'melee',
    'Needle-profile blade that slips between plate seams.',
    { rarity: 'uncommon', damage: 42, roundsPerMinute: 120, maxRangeMeters: 1.4, costArc: 2900 }],
  ['Melee/SM_Wep_Dagger_06.glb', 'ashfall-edge', 'Ashfall Edge', 'melee',
    'Unstable emitter of uncertain provenance and certain sharpness.',
    { rarity: 'rare', damage: 54, roundsPerMinute: 112, maxRangeMeters: 1.5, costArc: 5100 }],
  ['Melee/SM_Wep_Dagger_07.glb', 'nightglass-fang', 'Nightglass Fang', 'melee',
    'Collimated edge one molecule wide. Does not dull, does not forgive.',
    { rarity: 'epic', damage: 68, roundsPerMinute: 144, maxRangeMeters: 1.4, costArc: 11_000 }],

  // ---- Melee: arc axes ----------------------------------------------------
  ['Melee/SM_Wep_SmallAxe_01.glb', 'deckhand-arcaxe', 'Deckhand Arcaxe', 'melee',
    'Ship-issue cutting axe. Hull breach tool first, weapon second.',
    { damage: 38, roundsPerMinute: 96, maxRangeMeters: 1.7, costArc: 900, rarity: 'common' }],
  ['Melee/SM_Wep_SmallAxe_02.glb', 'boarding-axe', 'Boarding Axe', 'melee',
    'Hooked arc axe made for hatches and the people behind them.',
    { damage: 44, roundsPerMinute: 92, maxRangeMeters: 1.8, costArc: 1500 }],
  ['Melee/SM_Wep_SmallAxe_03.glb', 'splitgrin', 'Splitgrin', 'melee',
    'Broad-bit emitter with an unpleasant sense of humour.',
    { rarity: 'uncommon', damage: 50, roundsPerMinute: 88, maxRangeMeters: 1.8, costArc: 2800 }],
  ['Melee/SM_Wep_SmallAxe_04.glb', 'tarn-cleaver', 'Tarn Cleaver', 'melee',
    'Heavy-draw axe assembled in the Tarn foundries.',
    { rarity: 'uncommon', damage: 56, roundsPerMinute: 80, maxRangeMeters: 1.9, costArc: 3400 }],
  ['Melee/SM_Wep_SmallAxe_05.glb', 'emberbite', 'Emberbite', 'melee',
    'Runs hot enough to cauterise as it cuts. Field medics hate it.',
    { rarity: 'rare', damage: 66, roundsPerMinute: 84, maxRangeMeters: 1.8, costArc: 7600 }],

  // ---- Melee: arc polearms ------------------------------------------------
  ['Melee/SM_Wep_BigAxe_01.glb', 'rendmaw', 'Rendmaw Greataxe', 'melee',
    'Two-handed arc polearm with more reach than manners.',
    { damage: 92, roundsPerMinute: 42, maxRangeMeters: 2.6, costArc: 5200, rarity: 'uncommon' }],
  ['Melee/SM_Wep_BigAxe_02.glb', 'holdfast-breaker', 'Holdfast Breaker', 'melee',
    'Breaching polearm built to remove hinges, doors, and objections.',
    { damage: 98, roundsPerMinute: 38, maxRangeMeters: 2.7, costArc: 6100, rarity: 'uncommon' }],
  ['Melee/SM_Wep_BigAxe_03.glb', 'wrathspar', 'Wrathspar', 'melee',
    'Long-hafted emitter that rewards commitment and punishes hesitation.',
    { rarity: 'rare', damage: 108, roundsPerMinute: 36, maxRangeMeters: 2.9, costArc: 8900 }],
  ['Melee/SM_Wep_BigAxe_04.glb', 'grave-tithe', 'Grave Tithe', 'melee',
    'Executioner pattern, twin-lit. Collects what it is owed.',
    { rarity: 'rare', damage: 116, roundsPerMinute: 33, maxRangeMeters: 2.8, costArc: 9800 }],
  ['Melee/SM_Wep_BigAxe_05.glb', 'iron-liturgy', 'Iron Liturgy', 'melee',
    'Ritual polearm carried by the Foundry Wardens on high watch.',
    { rarity: 'epic', damage: 128, roundsPerMinute: 34, maxRangeMeters: 2.8, costArc: 16_500 }],
  ['Melee/SM_Wep_BigAxe_06.glb', 'starfell-cleaver', 'Starfell Cleaver', 'melee',
    'Emitter housing cut from recovered hull plate. Still faintly warm.',
    { rarity: 'epic', damage: 134, roundsPerMinute: 32, maxRangeMeters: 3, costArc: 18_400 }],
  ['Melee/SM_Wep_BigAxe_07.glb', 'the-long-argument', 'The Long Argument', 'melee',
    'Nobody remembers who won it. Everyone remembers the reach.',
    { rarity: 'legendary', damage: 156, roundsPerMinute: 30, maxRangeMeters: 3, costArc: 32_000 }],

  // ---- Melee: mauls -------------------------------------------------------
  // The only genuinely blunt, unpowered melee in the pack.
  ['Melee/SM_Wep_Hammer_01.glb', 'bulkhead-maul', 'Bulkhead Maul', 'melee',
    'Maintenance maul repurposed with minimal imagination.',
    { damage: 84, roundsPerMinute: 44, maxRangeMeters: 2.4, costArc: 4200, rarity: 'uncommon' }],
  ['Melee/SM_Wep_Hammer_02.glb', 'anvil-verdict', 'Anvil Verdict', 'melee',
    'Slab-headed warhammer. Delivers one opinion, very thoroughly.',
    { rarity: 'rare', damage: 112, roundsPerMinute: 38, maxRangeMeters: 2.5, costArc: 9400 }],
  ['Melee/SM_Wep_Hammer_03.glb', 'tectonic', 'Tectonic', 'melee',
    'Powered sledge with a charged striking face. The deck complains first.',
    { rarity: 'legendary', damage: 168, roundsPerMinute: 28, maxRangeMeters: 2.7, costArc: 30_000 }],

  // ---- Melee: barrier shields ---------------------------------------------
  // Projected barriers on a hand boss, not plate. They ride the sword slot
  // because it is the only melee slot the backend accepts, so they are priced
  // and statted as protection with a weak bash rather than as weapons.
  ['Melee/SM_Wep_Shield_01.glb', 'deckplate-buckler', 'Deckplate Buckler', 'melee',
    'Salvaged emitter boss throwing a small hardlight buckler.',
    { damage: 14, roundsPerMinute: 60, maxRangeMeters: 1.3, costArc: 1200, rarity: 'common' }],
  ['Melee/SM_Wep_Shield_02.glb', 'wardplate', 'Wardplate', 'melee',
    'Issue barrier projector. The field flickers where it has been hit.',
    { damage: 18, roundsPerMinute: 56, maxRangeMeters: 1.4, costArc: 2600 }],
  ['Melee/SM_Wep_Shield_03.glb', 'breakwater', 'Breakwater', 'melee',
    'Wide-field barrier for corridor holds. Heavy draw, worth it.',
    { rarity: 'uncommon', damage: 24, roundsPerMinute: 48, maxRangeMeters: 1.4, costArc: 4800 }],
  ['Melee/SM_Wep_Shield_04.glb', 'aegis-mark-iv', 'Aegis Mark IV', 'melee',
    'Powered barrier shield. Draws from the suit, and drains it fast.',
    { rarity: 'rare', damage: 26, roundsPerMinute: 52, maxRangeMeters: 1.4, costArc: 9900 }],
  ['Melee/SM_Wep_Shield_05.glb', 'the-last-word', 'The Last Word', 'melee',
    'Bastion projector recovered from a garrison that did not fall.',
    { rarity: 'legendary', damage: 34, roundsPerMinute: 46, maxRangeMeters: 1.5, costArc: 26_000 }],
];

/** Fully-resolved weapon rows with family defaults folded in. */
export const WEAPONS = ROWS.map(([glb, id, name, family, description, overrides = {}]) => {
  const base = FAMILIES[family];
  if (!base) throw new Error(`${id}: unknown family "${family}"`);
  return {
    id,
    name,
    description,
    family,
    melee: family === 'melee',
    glbPath: `${WEAPONS_DIR}/${glb}`,
    assetUrl: `/assets/${WEAPONS_DIR}/${glb}`,
    meshName: glb.split('/').pop().replace(/\.glb$/, ''),
    ...base,
    ...overrides,
  };
});

/** Already authored by hand; the generator must not overwrite them. */
export const EXISTING_WEAPON_IDS = new Set(['assault-01', 'twin-horned-pistol']);
