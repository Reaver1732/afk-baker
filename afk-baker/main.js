/*
 * AFK Baker: plays Cookie Clicker (Steam) while you're away.
 * Works out payback periods (PP) itself, by running the game's own CpS code on a copy of the game's state.
 * MIT License. See LICENSE.
 */
(function () {
	'use strict';

	const MOD_ID = 'afk baker';
	const VERSION = '3.0.0';
	// Settings saved before a default changed are reset to the new default:
	// v1 had auto-ascend on, v2 had Elder Pledge on, v3 had the Auto reserve.
	const SETTINGS_VERSION = 4;
	const LOG_PREFIX = '[AFK Baker]';

	/* =====================================================================
	   SETTINGS
	   ===================================================================== */

	// Upgrades the auto-buyer will never purchase, by exact in-game name.
	const NEVER_BUY_UPGRADES = [
		'Chocolate egg',
		'Sugar frenzy',
		'Elder Covenant',
		'Revoke Elder Covenant',
	];

	// Upgrade pools that are never auto-bought: switches/selectors, debug items and heavenly upgrades.
	const BLOCKED_POOLS = ['toggle', 'debug', 'prestige', 'prestigeDecor'];

	// A Lucky payout is min(bank * 0.15, CpS * 900), so a full payout needs 6000x CpS banked.
	// During a Frenzy (x7 CpS) that becomes 42000x the unbuffed CpS.
	// "Auto" keeps no reserve early in a run, then switches to Lucky.
	const RESERVE_MULTIPLIERS = { off: 0, auto: 6000, lucky: 6000, luckyFrenzy: 42000 };
	const RESERVE_MODES = { off: 'Off', auto: 'Auto', lucky: 'Lucky', luckyFrenzy: 'Lucky + Frenzy' };
	const WRINKLER_MODES = { feed: 'Feed, pop before ascending', instant: 'Pop instantly', off: 'Off' };
	const FORTUNE_MODES = { all: 'All fortunes', upgrades: 'Upgrade fortunes only' };
	const ASCEND_MODES = { gained: 'Prestige gained this run', total: 'Total prestige after ascending' };
	// Stock market strategies. The guide rules are from KarmicChaos's Ultimate Stock Market Guide: always buy
	// under $5, sell once past the bank ceiling. Simulated against the game's own price code, adding them
	// did best over 12-hour runs and tied over 24-hour runs.
	const MARKET_STRATEGIES = {
		restingGuide: 'Resting value + guide rules',
		resting: 'Resting value',
	};
	// Keyed as in the Grimoire's M.spells.
	const GRIMOIRE_SPELLS = {
		'hand of fate': 'Force the Hand of Fate',
		'conjure baked goods': 'Conjure Baked Goods',
	};
	// How far research may take the grandmapocalypse. One research upgrade opens each stage, and research
	// is a chain (each purchase starts the next), so holding that upgrade back holds back all that follow.
	const GRANDMA_LIMITS = { never: 'Never start', awoken: 'Awoken (One Mind)', displeased: 'Displeased', angered: 'Angered (no limit)' };
	const GRANDMA_LIMIT_STAGE = { never: 0, awoken: 1, displeased: 2, angered: 3 };
	const GRANDMA_STAGE_UPGRADES = ['One mind', 'Communal brainsweep', 'Elder Pact'];
	// The research from One mind on, in the order the game hands it out.
	const GRANDMA_RESEARCH = ['One mind', 'Exotic nuts', 'Communal brainsweep', 'Arcane sugar', 'Elder Pact'];
	// Indexed by Game.elderWrath.
	const GRANDMA_STAGE_NAMES = ['Appeased', 'Awoken', 'Displeased', 'Angered'];
	const GODZAMOK_MODES = { buffs: 'During click buffs only', always: 'Whenever it pays' };
	// The seasons with something to collect, in the order Auto seasons visits them. Keyed as in Game.seasons.
	const SEASON_ORDER = ['valentines', 'christmas', 'halloween', 'easter'];
	const SEASON_NAMES = { valentines: "Valentine's Day", christmas: 'Christmas', halloween: 'Halloween', easter: 'Easter', fools: 'Business Day' };
	const SEASON_TOGGLES = { valentines: 'seasonValentines', christmas: 'seasonChristmas', halloween: 'seasonHalloween', easter: 'seasonEaster' };
	// Where to stay once nothing is left to collect.
	const HOME_SEASONS = { fools: 'Business Day', none: 'None', christmas: 'Christmas', halloween: 'Halloween', valentines: "Valentine's Day", easter: 'Easter' };
	// When Force the Hand of Fate is cast, once the magic meter is full.
	const GRIMOIRE_TIMINGS = { full: 'When magic is full', buff: 'During a Frenzy or click buff', click: 'Only during a click buff' };
	const CYCLE_OPTIONS = {
		grimoireTiming: GRIMOIRE_TIMINGS,
		grandmaLimit: GRANDMA_LIMITS,
		godzamokMode: GODZAMOK_MODES,
		homeSeason: HOME_SEASONS,
		reserveMode: RESERVE_MODES,
		wrinklerMode: WRINKLER_MODES,
		fortuneMode: FORTUNE_MODES,
		marketStrategy: MARKET_STRATEGIES,
		grimoireSpell: GRIMOIRE_SPELLS,
		ascendMode: ASCEND_MODES,
	};

	// Game.ClickCookie ignores clicks that come less than 20 ms apart.
	const MAX_CLICK_RATE = 50;
	const MAX_AUTO_RESERVE_MINUTES = 1440;
	const BUY_INTERVAL_MS = 1000;
	// Payback periods are worked out for buying 1, 10 and 100 of each building.
	const BUY_AMOUNTS = [1, 10, 100];
	// How long the payback simulations may run per logic tick; a full round is spread over several ticks.
	const PP_TICK_BUDGET_MS = 8;
	// The game's functions the simulator needs its own copies of, because they read state a purchase changes.
	const SHADOWED_FUNCTIONS = ['Has', 'HasAchiev', 'hasBuff', 'GetTieredCpsMult', 'UnlockTiered', 'mouseCps'];
	// How Game.CalculateGains starts in the game's main.js.
	const GAME_CALCULATE_GAINS = 'Game.CalculateGains=function()';
	// What the text of the real Game.CalculateGains contains, and a wrapper around it doesn't.
	const CALCULATES_CPS = /Game\.unbuffedCps\s*=/;
	const MAX_SETTLE_PASSES = 6;
	// The simulator's CpS for the unchanged game must match the game's own. The game only recalculates
	// its CpS every 10 seconds, and Cyclius can move it by nearly 0.1% in that time.
	const SELF_CHECK_TOLERANCE = 0.002;
	const SELF_CHECK_RETRY_MS = 5000;
	const SELF_CHECK_GRACE_MS = 12000;
	// After each purchase the game's new CpS must match the prediction made just before buying.
	const LIVE_CHECK_TOLERANCE = 0.001;
	// Auto-buy pauses when this many of the last purchases were off.
	const LIVE_CHECK_WINDOW = 10;
	const LIVE_CHECK_MAX_MISSES = 3;
	// Utility upgrades help without raising CpS (golden cookies, reindeer, wrinklers, prices, drops), so
	// they have no payback period. These three only add income while the game is closed, and only with
	// the heavenly upgrade that turns offline income on.
	const OFFLINE_UPGRADES = ['Fern tea', 'Ichor syrup', 'Fortune #102'];
	const OFFLINE_UNLOCK = 'Twin Gates of Transcendence';
	// A price the game works out from current CpS never gets cheaper by waiting, so it has its own limit.
	const CPS_PRICED = /cookiesPs|unbuffedCps/;
	// Fast buying: while the best items pay for themselves in under this many seconds, the order they are
	// bought in hardly matters, so auto-buy takes several of them at once.
	const FAST_PP_SECONDS = 1;
	const FAST_BATCH_MAX = 25;
	// Fast buying stops for the rest of the run once this many batches changed CpS differently than predicted.
	const FAST_MAX_MISSES = 2;
	// While fast buying, the store ratings are refreshed this often at most.
	const FAST_OVERLAY_REFRESH_MS = 1000;
	// The game checks for count achievements every 5 seconds.
	const COUNT_ACHIEVEMENT_WAIT_S = 6;
	const CM_COMPARE_TOLERANCE = 0.01;
	const RECALC_WAIT_NOTICE_MS = 5000;
	// Achievements for owning this many of every building, of buildings in total, and of upgrades.
	const EVERY_BUILDING_ACHIEVEMENTS = [
		[100, 'Centennial'], [150, 'Centennial and a half'], [200, 'Bicentennial'], [250, 'Bicentennial and a half'],
		[300, 'Tricentennial'], [350, 'Tricentennial and a half'], [400, 'Quadricentennial'], [450, 'Quadricentennial and a half'],
		[500, 'Quincentennial'], [550, 'Quincentennial and a half'], [600, 'Sexcentennial'], [650, 'Sexcentennial and a half'],
		[700, 'Septcentennial'],
	];
	const BUILDINGS_OWNED_ACHIEVEMENTS = [
		[100, 'Builder'], [500, 'Architect'], [1000, 'Engineer'], [2500, 'Lord of Constructs'], [5000, 'Grand design'],
		[7500, 'Ecumenopolis'], [10000, 'Myriad'],
	];
	const UPGRADES_OWNED_ACHIEVEMENTS = [
		[20, 'Enhancer'], [50, 'Augmenter'], [100, 'Upgrader'], [200, 'Lord of Progress'], [300, 'The full picture'],
		[400, "When there's nothing left to add"], [500, 'Kaizen'], [600, 'Beyond quality'], [700, "Oft we mar what's well"],
	];
	const HALLOWEEN_COOKIES = ['Skull cookies', 'Ghost cookies', 'Bat cookies', 'Slime cookies', 'Pumpkin cookies', 'Eyeball cookies', 'Spider cookies'];
	const CHRISTMAS_COOKIES = ['Christmas tree biscuits', 'Snowflake biscuits', 'Snowman biscuits', 'Holly biscuits', 'Candy cane biscuits', 'Bell biscuits', 'Present biscuits'];
	const SKIP_UNBUYABLE_MS = 60000;
	const DEBUG_TOP_CANDIDATES = 5;
	// How long the autoclicker's landed clicks are counted to measure its real click rate.
	const CLICK_RATE_WINDOW_MS = 10000;
	// Object.buy and Upgrade.buy play one of snd/buy1.mp3 to snd/buy4.mp3; a building level-up plays snd/upgrade.mp3.
	const PURCHASE_SOUND = /^snd\/(buy\d|upgrade)\.mp3$/;
	const LUMP_CHECK_INTERVAL_MS = 1000;
	const MAX_KEEP_LUMPS = 1000000;
	const MAX_TARGET_LEVEL = 1000;
	const MAX_PRIORITY_ENTRIES = 100;
	// Levelling these to 1 unlocks their minigame. Players add anything else themselves.
	const DEFAULT_LUMP_PRIORITY = [
		{ building: 'Farm', level: 1 },
		{ building: 'Temple', level: 1 },
		{ building: 'Wizard tower', level: 1 },
		{ building: 'Bank', level: 1 },
	];
	const DRAGON_CHECK_INTERVAL_MS = 1000;
	const MAX_DRAGON_TRAIN_MINUTES = 1000000;
	// Game.UpgradeDragon plays shimmerClick; Game.ClickSpecialPic (petting) plays a click and a growl.
	const DRAGON_SOUND = /^snd\/(shimmerClick|click\d|growl)\.mp3$/;
	const PET_INTERVAL_MS = 100;
	// A pet has a 1 in 20 chance of a drop, so after this many pets in one quarter-hour without one,
	// that quarter's drop is almost certainly one already found (an available drop is missed under 1% of the time).
	const MAX_PETS_PER_WINDOW = 100;
	const DRAGON_DROPS = ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'];
	// These two have no CpS or click effect, so the PP buyer never picks them; auto-pet buys them itself.
	const DRAGON_DROPS_WITHOUT_PP = ['Dragon fang', 'Dragon teddy bear'];
	// Prestige can pass 2^53, so the threshold is a plain number, not a safe integer.
	const MAX_ASCEND_THRESHOLD = 1e300;
	const GRIMOIRE_CHECK_INTERVAL_MS = 1000;
	// M.castSpell plays spell.mp3 on a success and spellFail.mp3 on a backfire.
	const SPELL_SOUND = /^snd\/(spell|spellFail)\.mp3$/;
	// What a clicked golden cookie turned out to be (Game.shimmerTypes.golden.last), in the game's own words.
	const GOLDEN_EFFECT_NAMES = {
		'frenzy': 'Frenzy',
		'multiply cookies': 'Lucky',
		'click frenzy': 'Click frenzy',
		'building special': 'Building special',
		'cookie storm': 'Cookie storm',
		'cookie storm drop': 'Cookie storm drop',
		'blab': 'nothing (a blab)',
		'free sugar lump': 'Free sugar lump',
		'dragon harvest': 'Dragon Harvest',
		'dragonflight': 'Dragonflight',
		'chain cookie': 'Cookie chain',
		'clot': 'Clot',
		'ruin cookies': 'Ruin',
		'cursed finger': 'Cursed finger',
		'blood frenzy': 'Elder frenzy',
	};
	const MARKET_CHECK_INTERVAL_MS = 1000;
	// M.buyGood plays cashOut, M.sellGood cashIn, and the broker and office buttons cashIn2.
	const MARKET_SOUND = /^snd\/cash(In|In2|Out)\.mp3$/;
	// Whole-number settings and their limits: [min, max].
	const INT_SETTINGS = {
		clickRate: [0, MAX_CLICK_RATE],
		autoReserveMinutes: [0, MAX_AUTO_RESERVE_MINUTES],
		utilityMinutes: [0, MAX_DRAGON_TRAIN_MINUTES],
		utilityCpsMinutes: [0, MAX_DRAGON_TRAIN_MINUTES],
		keepLumps: [0, MAX_KEEP_LUMPS],
		dragonTrainMinutes: [0, MAX_DRAGON_TRAIN_MINUTES],
		marketBuyPercent: [1, 100],
		marketSellPercent: [1, 1000],
		marketBankPercent: [0, 100],
		officeMinutes: [0, MAX_DRAGON_TRAIN_MINUTES],
		sunderRate: [1, 30],
		godzamokCapPercent: [1, 50],
		seasonRenewMinutes: [0, MAX_DRAGON_TRAIN_MINUTES],
	};
	const REINCARNATE_GRACE_MS = 3000;
	const STATUS_REFRESH_MS = 500;
	// The store ratings' colors. Skipped is a stripe pattern, not a color, and can't be changed.
	const DEFAULT_COLORS = { best: '#ffd84a', close: '#56e0d0', average: '#8fb8ff', poor: '#c79bff', none: '#8a8a8a', utility: '#7be07b', research: '#f4efe0' };
	// A picked color darker than this gets a white outline on price text, since a black one would hide it.
	const DARK_COLOR_LUMINANCE = 0.3;
	// The line under the news ticker that says what auto-buy is doing changes this often at most.
	const BUY_LINE_REFRESH_MS = 1000;
	// The Pantheon's slots, in the order the mod fills them.
	const PANTHEON_SLOT_KEYS = ['pantheonDiamond', 'pantheonRuby', 'pantheonJade'];
	const PANTHEON_SLOT_NAMES = ['Diamond', 'Ruby', 'Jade'];
	// Keyed as in the Pantheon's M.gods.
	const HOLOBORE = 'asceticism';
	const GODZAMOK = 'ruin';
	// How long a worship swap takes to come back with 0, 1 and 2 left (minigamePantheon.js, M.logic).
	const PANTHEON_SWAP_MS = [16 * 3600000, 4 * 3600000, 3600000];
	const PANTHEON_CHECK_INTERVAL_MS = 1000;
	// The sounds of slotting a god (the game's drop: a tick and the spirit sound).
	const PANTHEON_SOUND = /^snd\/(tick|spirit)\.mp3$/;
	// Click power per building sold, by the slot Godzamok is in (Game.Object.sell in main.js): 0 is unslotted.
	const GODZAMOK_BONUS = [0, 0.01, 0.005, 0.0025];
	// How long the buff from a sale, Devastation, lasts.
	const DEVASTATION_SECONDS = 10;
	// A combo is only made if the extra click income expected is at least this many times its cost.
	const GODZAMOK_MIN_RETURN = 10;
	// Never sold: Wizard towers, since the magic meter's size comes from how many there are.
	const GODZAMOK_NEVER_SELL = ['Wizard tower'];
	// How many of a building a combo always leaves standing. Selling the last Grandma pops every wrinkler
	// and ends an Elder Pledge (the Grandma's sellFunction), and with none the grandmapocalypse stops.
	const GODZAMOK_KEEP = { Grandma: 1 };
	const GODZAMOK_CHECK_INTERVAL_MS = 250;
	const COMBO_SOUND = /^snd\/(sell|buy)\d\.mp3$/;
	const SEASON_CHECK_INTERVAL_MS = 1000;
	// Santa's last level (Game.santaLevels); each level costs (level + 1) to the power (level + 1) cookies.
	const SANTA_MAX_LEVEL = 14;
	// Seconds a wrinkler takes to crawl to the cookie before it feeds (Game.UpdateWrinklers).
	const WRINKLER_CRAWL_SECONDS = 10;
	// Where "wrinkler" turns up on screen: tooltips, the menus, the news ticker, notifications, prompts,
	// the dragon and Santa panel, and AFK Baker's own panel and tab.
	const REDFOX_CONTAINERS = ['tooltip', 'menu', 'commentsText', 'notes', 'prompt', 'specialPopup', 'afkPanel', 'afkOpen'];
	// Where cookies come from, in the order the Stats tab lists them: [key, label, explanation].
	const INCOME_GAINS = [
		['prod', 'Buildings', 'What your buildings make at your CpS without buffs.'],
		['prodBuff', 'Buildings, extra under buffs', 'What Frenzy, building specials, Elder frenzy and other CpS buffs added on top.'],
		['clicks', 'Big cookie clicks', 'Clicks on the big cookie, yours and the autoclicker\'s, at their strength without click buffs.'],
		['clickBuff', 'Clicks, extra from click buffs', 'What Click frenzy, Dragonflight, Cursed finger and Devastation added to those clicks.'],
		['golden', 'Golden cookies', 'Lucky, cookie chain and cookie storm payouts from golden cookies AFK Baker clicked.'],
		['wrath', 'Wrath cookies', 'The same, from wrath cookies AFK Baker clicked.'],
		['reindeer', 'Reindeer', ''],
		['wrinklers', 'Wrinklers popped', 'What popped wrinklers paid out, by the game\'s own payout rule. What they withered first is under Losses.'],
		['fortune', 'Fortune tickers', ''],
		['grimoire', 'Grimoire', 'Conjure Baked Goods. A golden cookie from Force the Hand of Fate counts as a golden cookie.'],
		['market', 'Stock market sales', 'Only the part of a sale the game counts as cookies baked. The market\'s whole effect on your bank is further down.'],
		['offline', 'While the game was closed', ''],
		['other', 'Other', 'Everything AFK Baker did not do itself: golden cookies and reindeer you clicked, garden harvests, gifts, sugar blessings. It is what is left of the game\'s "cookies baked" after everything above, so the total always matches the game\'s.'],
		['sales', 'Building sales', 'Only where a Godzamok combo\'s refund lifted the bank above everything baked this run, which the game then counts as baked.'],
		['uncounted', 'While AFK Baker was not counting', 'Baked this run before counting started, or while it was switched off.'],
	];
	const INCOME_LOSSES = [
		['withered', 'Withered by wrinklers', 'Taken from production while wrinklers feed. It comes back, with interest, under Wrinklers popped.'],
		['debuff', 'Lost to Clot and other CpS debuffs', 'How far production fell below your CpS without buffs.'],
		['ruin', 'Ruin and other bank losses', 'Taken from the bank, not from cookies baked: Ruin from a wrath cookie, a backfired Conjure Baked Goods.'],
		['combo', 'Godzamok combos, cost', 'What selling buildings and buying them back cost the bank. What it bought is under Clicks, extra from click buffs.'],
	];
	const INCOME_HISTORY_MAX = 20;
	// A run's setup changes a few times at most; past this many different ones the rest are not told apart.
	const INCOME_SETUPS_MAX = 24;
	const INCOME_SAMPLE_MS = 1000;
	// What an exported settings text starts with.
	const EXPORT_PREFIX = 'AFKB1:';
	// Below this width the panel's dashboard stacks its columns.
	const NARROW_PANEL_PX = 520;
	// Store ratings: a payback period up to this many times the best one is "close to best" or "average".
	const CLOSE_RATIO = 1.5;
	const AVERAGE_RATIO = 5;
	// What each setting is called when an import lists what it would change.
	const SETTING_LABELS = {
		clickRate: 'Big cookie clicks per second', muteCookieClick: 'Mute big cookie click sound', clickGolden: 'Golden cookies',
		clickWrath: 'Include wrath cookies', clickReindeer: 'Reindeer', wrinklerMode: 'Wrinklers', clickFortunes: 'Fortune tickers',
		fortuneMode: 'Fortune clicks', autoBuy: 'Auto-buy', muteBuySounds: 'Mute auto-buy purchase sounds', reserveMode: 'Cookie reserve',
		autoReserveMinutes: 'Auto reserve: minutes without a reserve', buyResearch: 'Buy research', grandmaLimit: 'Stop the grandmapocalypse at', elderPledge: 'Elder Pledge',
		buyUtility: 'Buy no-payback upgrades when cheap', overlayColors: 'Store rating colors', ratingBar: 'Rating counts above the upgrades', showBuyLine: 'Show what auto-buy is doing', utilityMinutes: 'No-payback upgrades: limit, minutes of CpS', utilityCpsMinutes: 'No-payback upgrades priced in CpS: limit, minutes of CpS',
		storeOverlay: 'Show ratings in the store', autoHarvestLumps: 'Auto-harvest sugar lumps', autoSpendLumps: 'Auto-spend sugar lumps',
		keepLumps: 'Lumps to keep', lumpPriority: 'Sugar lump priority list', autoTrainDragon: 'Auto-train dragon',
		dragonTrainMinutes: 'Dragon training limit, minutes of CpS', dragonAura1: 'Primary aura', dragonAura2: 'Secondary aura',
		autoPetDragon: 'Auto-pet dragon', autoPantheon: 'Auto-Pantheon', pantheonDiamond: 'Pantheon: Diamond slot', pantheonRuby: 'Pantheon: Ruby slot', pantheonJade: 'Pantheon: Jade slot', godzamokCombo: 'Godzamok combos', godzamokMode: 'Godzamok combos: when', godzamokCapPercent: 'Godzamok combos: limit, % of the bank',
		autoSeasons: 'Auto seasons', seasonValentines: "Auto seasons: Valentine's Day", seasonChristmas: 'Auto seasons: Christmas', seasonHalloween: 'Auto seasons: Halloween', seasonEaster: 'Auto seasons: Easter',
		homeSeason: 'Home season', seasonRenewMinutes: 'Home season: renewal limit, minutes of CpS',
		redFox: 'RedFox', sunder: 'Sunder', sunderRate: 'Sunder: pets per second', autoTrade: 'Auto-trade stocks', marketStrategy: 'Stock strategy', marketBuyPercent: 'Buy at % of resting value',
		marketSellPercent: 'Sell at % of resting value', marketBankPercent: '% of the bank the market may use', marketSellAtLoss: 'Sell at a loss',
		autoBrokers: 'Hire brokers', autoOffice: 'Upgrade office', officeMinutes: 'Office upgrade limit, minutes of CpS', autoCast: 'Auto-cast spell',
		grimoireSpell: 'Spell', grimoireTiming: 'Cast Force the Hand of Fate', trackIncome: 'Count where cookies come from', autoAscend: 'Auto-ascend', ascendMode: 'Threshold type', ascendThreshold: 'Ascend threshold', debug: 'Debug logging',
	};

	const DEFAULTS = {
		clickRate: 30,
		muteCookieClick: true,
		clickGolden: true,
		clickWrath: true,
		clickReindeer: true,
		wrinklerMode: 'feed',
		clickFortunes: true,
		fortuneMode: 'all',
		autoBuy: true,
		muteBuySounds: true,
		reserveMode: 'off',
		autoReserveMinutes: 30,
		buyResearch: true,
		grandmaLimit: 'angered',
		elderPledge: false,
		buyUtility: true,
		ratingBar: true,
		showBuyLine: true,
		utilityMinutes: 5,
		utilityCpsMinutes: 180,
		autoHarvestLumps: true,
		autoSpendLumps: false,
		keepLumps: 0,
		autoTrainDragon: false,
		dragonTrainMinutes: 10,
		// Aura names as in Game.dragonAuras; '' means the mod leaves that slot alone.
		dragonAura1: '',
		dragonAura2: '',
		autoPetDragon: false,
		autoPantheon: false,
		// Keys of M.gods; '' leaves the slot alone.
		pantheonDiamond: '',
		pantheonRuby: '',
		pantheonJade: '',
		godzamokCombo: false,
		godzamokMode: 'buffs',
		godzamokCapPercent: 5,
		autoSeasons: false,
		seasonValentines: true,
		seasonChristmas: true,
		seasonHalloween: true,
		seasonEaster: true,
		homeSeason: 'fools',
		seasonRenewMinutes: 30,
		autoTrade: false,
		marketStrategy: 'restingGuide',
		marketBuyPercent: 30,
		marketSellPercent: 100,
		marketBankPercent: 25,
		marketSellAtLoss: false,
		autoBrokers: false,
		autoOffice: false,
		officeMinutes: 30,
		autoCast: false,
		grimoireSpell: 'hand of fate',
		grimoireTiming: 'full',
		autoAscend: false,
		ascendMode: 'gained',
		ascendThreshold: 1000,
		redFox: false,
		sunder: false,
		sunderRate: 10,
		trackIncome: true,
		debug: false,
	};

	function clampInt(value, min, max, fallback) {
		const n = Math.floor(Number(value));
		if (!Number.isFinite(n)) return fallback;
		return Math.min(max, Math.max(min, n));
	}

	function hasKey(object, key) {
		return typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
	}

	function defaultLumpPriority() {
		return DEFAULT_LUMP_PRIORITY.map(function (entry) { return Object.assign({}, entry); });
	}

	function isValidPriorityEntry(entry) {
		return !!entry && typeof entry === 'object' && hasKey(Game.Objects, entry.building) &&
			Number.isInteger(entry.level) && entry.level >= 1 && entry.level <= MAX_TARGET_LEVEL;
	}

	// Any bad entry means the saved list can't be trusted, so the whole list falls back to the default.
	function sanitizeLumpPriority(raw) {
		if (!Array.isArray(raw) || raw.length > MAX_PRIORITY_ENTRIES || !raw.every(isValidPriorityEntry)) {
			return defaultLumpPriority();
		}
		return raw.map(function (entry) { return { building: entry.building, level: entry.level }; });
	}

	// Accepts plain digits, commas or spaces as separators, and scientific notation such as 1.146e15.
	// Returns NaN for anything else.
	function parseBigNumber(text) {
		const cleaned = String(text).replace(/[,\s_]/g, '');
		if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return NaN;
		return Number(cleaned);
	}

	function sanitizeThreshold(value, fallback) {
		const n = Math.floor(typeof value === 'number' ? value : parseBigNumber(value));
		if (!Number.isFinite(n)) return fallback;
		return Math.min(MAX_ASCEND_THRESHOLD, Math.max(1, n));
	}

	function isAuraName(name) {
		return hasKey(Game.dragonAurasBN, name) && Game.dragonAurasBN[name].id > 0;
	}

	// What the mod paid for the stock it holds, per building name: { shares, cost in $ with fees }.
	// Entries that don't make sense are dropped; the mod rebuilds them from the game's own records.
	function sanitizeMarketBasis(raw) {
		const basis = {};
		if (!raw || typeof raw !== 'object') return basis;
		for (const name in raw) {
			const entry = raw[name];
			if (!hasKey(Game.Objects, name) || !entry || typeof entry !== 'object') continue;
			if (!Number.isInteger(entry.shares) || entry.shares <= 0) continue;
			if (typeof entry.cost !== 'number' || !Number.isFinite(entry.cost) || entry.cost < 0) continue;
			basis[name] = { shares: entry.shares, cost: entry.cost };
		}
		return basis;
	}

	// The player's own rating colors: { rating: '#rrggbb' } for the ratings that were changed.
	function sanitizeColors(raw) {
		const colors = {};
		if (!raw || typeof raw !== 'object') return colors;
		for (const rating in DEFAULT_COLORS) {
			if (typeof raw[rating] === 'string' && /^#[0-9a-f]{6}$/i.test(raw[rating]) && raw[rating].toLowerCase() !== DEFAULT_COLORS[rating]) colors[rating] = raw[rating].toLowerCase();
		}
		return colors;
	}

	function sanitizeSettings(raw) {
		const settings = Object.assign({}, DEFAULTS);
		settings.lumpPriority = sanitizeLumpPriority(raw && raw.lumpPriority);
		settings.marketBasis = sanitizeMarketBasis(raw && raw.marketBasis);
		// null until the player chooses: on, unless Cookie Monster is drawing its own store colors.
		settings.storeOverlay = raw && typeof raw.storeOverlay === 'boolean' ? raw.storeOverlay : null;
		settings.overlayColors = sanitizeColors(raw && raw.overlayColors);
		// God keys are checked against the Pantheon when it is there; here only their form, and no god twice.
		const seenGods = {};
		for (const key of PANTHEON_SLOT_KEYS) {
			const god = raw && raw[key];
			settings[key] = typeof god === 'string' && /^[a-z]{1,20}$/.test(god) && !seenGods[god] ? god : '';
			if (settings[key]) seenGods[god] = true;
		}
		if (!raw || typeof raw !== 'object') return settings;

		for (const key in DEFAULTS) {
			if (typeof DEFAULTS[key] === 'boolean' && typeof raw[key] === 'boolean') settings[key] = raw[key];
		}
		for (const key in CYCLE_OPTIONS) {
			if (hasKey(CYCLE_OPTIONS[key], raw[key])) settings[key] = raw[key];
		}
		for (const key in INT_SETTINGS) {
			settings[key] = clampInt(raw[key], INT_SETTINGS[key][0], INT_SETTINGS[key][1], DEFAULTS[key]);
		}
		settings.ascendThreshold = sanitizeThreshold(raw.ascendThreshold, DEFAULTS.ascendThreshold);
		if (isAuraName(raw.dragonAura1)) settings.dragonAura1 = raw.dragonAura1;
		if (isAuraName(raw.dragonAura2) && raw.dragonAura2 !== settings.dragonAura1) settings.dragonAura2 = raw.dragonAura2;
		const savedVersion = Number(raw.settingsVersion) || 1;
		if (savedVersion < 2) settings.autoAscend = DEFAULTS.autoAscend;
		if (savedVersion < 3) settings.elderPledge = DEFAULTS.elderPledge;
		if (savedVersion < 4) settings.reserveMode = DEFAULTS.reserveMode;
		return settings;
	}

	// The collecting seasons Auto seasons has been in this run. Each gets one visit a run.
	function sanitizeSeasonRun(raw) {
		const run = { run: 0, visited: [] };
		if (!raw || typeof raw !== 'object') return run;
		run.run = finiteOr(raw.run, 0);
		if (Array.isArray(raw.visited)) run.visited = SEASON_ORDER.filter(function (key) { return raw.visited.indexOf(key) !== -1; });
		return run;
	}

	function freshRun() {
		return { start: 0, allStart: 0, seen: 0, gains: {}, losses: {}, base: 0, bank: 0, setups: {} };
	}

	function freshIncome() {
		return { run: freshRun(), history: [] };
	}

	function finiteOr(value, fallback) {
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	// The amounts of a run by category. Only known categories and real numbers are kept.
	function sanitizeBook(raw, categories) {
		const book = {};
		if (!raw || typeof raw !== 'object') return book;
		for (const category of categories) {
			const amount = finiteOr(raw[category[0]], 0);
			if (amount) book[category[0]] = amount;
		}
		return book;
	}

	// A run's setup: { a: aura names, g: the gods by slot, w: the grandmas' mood, c: autoclicker rate }.
	function sanitizeSetup(raw) {
		const text = function (value) { return typeof value === 'string' ? value.slice(0, 40) : ''; };
		const list = function (value, max) { return Array.isArray(value) ? value.slice(0, max).map(text) : []; };
		const setup = raw && typeof raw === 'object' ? raw : {};
		return { a: list(setup.a, 2), g: list(setup.g, 3), w: text(setup.w), c: clampInt(setup.c, 0, MAX_CLICK_RATE, 0) };
	}

	// A finished run, or null if it doesn't make sense.
	function sanitizeRecord(raw) {
		if (!raw || typeof raw !== 'object') return null;
		const record = {
			start: finiteOr(raw.start, 0), end: finiteOr(raw.end, 0), baked: finiteOr(raw.baked, 0),
			allStart: finiteOr(raw.allStart, -1), allEnd: finiteOr(raw.allEnd, 0), prestige: Math.max(0, finiteOr(raw.prestige, 0)),
			gains: sanitizeBook(raw.gains, INCOME_GAINS), losses: sanitizeBook(raw.losses, INCOME_LOSSES),
			base: Math.max(0, finiteOr(raw.base, 0)), bank: finiteOr(raw.bank, 0),
			setup: sanitizeSetup(raw.setup), share: clampInt(raw.share, 0, 100, 100), changed: raw.changed === true,
		};
		if (!(record.start > 0) || record.end < record.start || !(record.baked > 0) || record.allStart < 0 || record.allEnd < record.allStart) return null;
		return record;
	}

	function sanitizeHistory(raw) {
		if (!Array.isArray(raw)) return [];
		return raw.slice(0, INCOME_HISTORY_MAX).map(sanitizeRecord).filter(Boolean);
	}

	function sanitizeIncome(raw) {
		const income = freshIncome();
		if (!raw || typeof raw !== 'object') return income;
		income.history = sanitizeHistory(raw.history);
		const run = raw.run;
		if (!run || typeof run !== 'object' || !(finiteOr(run.start, 0) > 0)) return income;
		income.run = {
			start: run.start, allStart: Math.max(0, finiteOr(run.allStart, 0)), seen: Math.max(0, finiteOr(run.seen, 0)),
			gains: sanitizeBook(run.gains, INCOME_GAINS), losses: sanitizeBook(run.losses, INCOME_LOSSES),
			base: Math.max(0, finiteOr(run.base, 0)), bank: finiteOr(run.bank, 0), setups: {},
		};
		// How long each setup was active, in seconds, keyed by the setup as JSON.
		if (run.setups && typeof run.setups === 'object') {
			for (const key of Object.keys(run.setups).slice(0, INCOME_SETUPS_MAX)) {
				const seconds = finiteOr(run.setups[key], 0);
				if (!(seconds > 0)) continue;
				try {
					income.run.setups[JSON.stringify(sanitizeSetup(JSON.parse(key)))] = seconds;
				} catch (e) {
					// Not a setup; dropped.
				}
			}
		}
		return income;
	}

	const state = {
		lastClickTime: 0,
		owedClicks: 0,
		clickWindowStart: 0,
		clickWindowClicks: 0,
		measuredClickRate: null, // clicks per second that actually landed, once measured
		nextBuyAt: 0,
		buyResumeAt: 0,
		buyStatus: 'Starting up.',
		// Set after a purchase: buy again as soon as the payback data is ready, not a second later.
		buyAgain: false,
		recalcWaitSince: 0,
		// What the PP buyer is saving for, for the line under the news ticker: { label, cost }, or null.
		buyTarget: null,
		lastBought: '',
		nextBuyLineAt: 0,
		// Set while fast buying is at work: the store ratings are refreshed less often until then.
		fastBuyingUntil: 0,
		skipUntil: {}, // candidate key -> { until, reason }
		lastDumpSignature: '',
		nextLumpCheckAt: 0,
		lastHarvest: '',
		lastLevelUp: '',
		// The Add row of the lump priority list, kept here so menu rebuilds don't lose it.
		lumpDraft: { building: DEFAULT_LUMP_PRIORITY[0].building, level: '1' },
		drag: null, // a drag in the lump priority list, from pointerdown until it ends
		panelOpen: false,
		panelTab: 'dashboard',
		// Pause all: nothing is clicked, bought, traded or cast. Not saved, so a restart always runs.
		paused: false,
		importDraft: { text: '', preview: null, error: '' },
		exportCopied: false,
		statsClearArmed: false, // "Forget past runs" was clicked once and waits for a second click
		renderedDragonLevel: -1,
		lastLiveHtml: '',
		nextDragonCheckAt: 0,
		nextPetAt: 0,
		lastDragonAction: '',
		// While petting: the special panel to put back afterwards, and how many pets this window has had.
		petSession: null,
		// The quarter-hour that has given its drop, or been petted enough without one.
		petDoneWindow: '',
		nextMarketCheckAt: 0,
		nextPantheonCheckAt: 0,
		lastPantheonAction: '',
		nextSeasonCheckAt: 0,
		lastSeasonAction: '',
		seasonsSignature: '',
		nextComboCheckAt: 0,
		comboCount: 0,
		comboLast: '',
		comboStopped: '', // why Godzamok combos turned themselves off, or ''
		godDrag: null, // a god being dragged in the Pantheon tab
		godSelected: '', // a god clicked in the Pantheon tab, to be put in the next slot clicked
		auraSlot: '', // the aura slot whose picker is open in the Dragon tab
		sunder: null, // while Sunder pets: { restoreTab, owed, last }
		sunderBlocked: '',
		sunderPets: 0,
		lastTrade: '',
		lastMarketAction: '',
		// Set once the auto-ascend threshold is met: the market only sells from then on.
		ascendPending: false,
		nextGrimoireCheckAt: 0,
		lastCast: '',
		// The golden cookie the last Force the Hand of Fate summoned, until it's clicked or gone.
		spellCookie: null,
		// Wrath cookies summoned by a backfired spell; the clicker leaves these alone.
		backfiredCookies: new WeakSet(),
		ascendTriggered: false,
		// Set when the threshold was already met at load or by a settings change; cleared by re-arming.
		ascendWarning: false,
		needsLoadCheck: true,
		lastStatusRefresh: 0,
		lastError: '',
	};

	/* =====================================================================
	   EXTENSION HOOKS
	   Another mod can replace three of AFK Baker's decisions by setting a function on
	   Game.mods['afk baker'].ext.overrides. AFK Baker still does the casting, trading and petting
	   itself, with all its usual checks; an override only changes the decision. A function may be
	   called often (the status line calls it too), so it must not change anything. It returns
	   undefined to keep AFK Baker's own decision.

	     grimoireSpell({ M, spell })       The key in M.spells of the spell to cast once the magic meter
	                                       is full, or '' to cast nothing for now. `spell` is the
	                                       player's setting.
	     stockSignal({ M, good, signal })  { action: 'buy' | 'sell' | '', reason: 'text' } for one stock.
	                                       `signal` is AFK Baker's own decision, in the same shape.
	     petWindow({ key })                false to skip petting the dragon in the current quarter-hour.
	                                       `key` is 'hour:quarter'.

	   M is the minigame object.

	   Since version 2 an add-on can also have its own tab in AFK Baker's panel:

	     ext.registerTab({ id, title, render(container), status() })
	                                       id: letters, digits and dashes; title: the tab's label.
	                                       render fills the empty container each time the tab is drawn, and
	                                       handles its own clicks. status is optional: it returns the add-on's
	                                       Dashboard row as text, or { now, wait, state } with state one of
	                                       'on', 'off', 'wait', 'warn'; null for no row. Returns true if the
	                                       tab was added.
	     ext.redraw()                      Redraws the panel, for after the add-on changed one of its settings.
	     ext.openPanel(id)                 Opens the panel, on the tab with that id if given.
	     ext.isPaused()                    true while the player has paused AFK Baker. The overrides are not
	                                       called then; an add-on that acts on its own should hold off too.

	   Check ext.apiVersion first; it goes up when the hooks change. Version 2 added the tab functions and
	   left the overrides as they were.
	   ===================================================================== */
	const ext = {
		apiVersion: 2,
		overrides: { grimoireSpell: null, stockSignal: null, petWindow: null },
		tabs: [],
		registerTab: function (tab) {
			if (!tab || typeof tab.id !== 'string' || !/^[A-Za-z0-9-]+$/.test(tab.id) || typeof tab.title !== 'string' || typeof tab.render !== 'function') return false;
			const taken = TABS.some(function (own) { return own[0] === tab.id; }) || ext.tabs.some(function (other) { return other.id === tab.id; });
			if (taken) return false;
			ext.tabs.push({ id: tab.id, title: tab.title, render: tab.render, status: typeof tab.status === 'function' ? tab.status : null });
			renderMenuSection();
			return true;
		},
		redraw: function () { renderMenuSection(); },
		openPanel: function (tabId) { openPanel(tabId); },
		isPaused: function () { return state.paused; },
	};

	// An add-on's answer for a decision: undefined if there is no add-on for it, or if it threw.
	function askAddOn(name, context) {
		const override = ext.overrides[name];
		if (typeof override !== 'function') return undefined;
		try {
			return override(context);
		} catch (e) {
			state.lastError = `Add-on hook ${name}: ${String(e && e.message || e)}`;
			return undefined;
		}
	}

	const mod = {
		version: VERSION,
		ext: ext,
		settings: sanitizeSettings(null),
		income: freshIncome(),
		seasonRun: { run: 0, visited: [] },
		state: state,
		init: function () {
			Game.registerHook('logic', onLogic);
			Game.registerHook('reincarnate', onReincarnate);
			Game.registerHook('reset', onReset);
			installStyles();
			installMenuHook();
			ensurePanel();
			applyColors();
			installClickSoundHook();
			console.log(`${LOG_PREFIX} v${VERSION} loaded.`);
		},
		save: function () {
			return JSON.stringify(Object.assign({ settingsVersion: SETTINGS_VERSION }, mod.settings, { income: mod.income, seasonRun: mod.seasonRun }));
		},
		load: function (str) {
			let parsed = null;
			try {
				parsed = JSON.parse(str);
			} catch (e) {
				debugLog('Bad save data, using defaults.', e);
			}
			mod.settings = sanitizeSettings(parsed);
			mod.income = sanitizeIncome(parsed && parsed.income);
			mod.seasonRun = sanitizeSeasonRun(parsed && parsed.seasonRun);
			stopCounting();
			tracker.loaded = true;
			applyColors();
			state.ascendWarning = false;
			state.needsLoadCheck = true;
			renderMenuSection();
		},
	};

	function settings() {
		return mod.settings;
	}

	function debugLog(...args) {
		if (mod.settings.debug) console.log(LOG_PREFIX, ...args);
	}

	/* =====================================================================
	   MAIN LOOP
	   ===================================================================== */

	function isAscending() {
		return Game.OnAscend || Game.AscendTimer > 0;
	}

	function onLogic() {
		// An exception here would escape Game.Logic and stop the game loop, so contain it.
		try {
			trackIncome(Date.now());
			if (isAscending()) {
				state.owedClicks = 0;
				state.lastClickTime = 0;
				state.clickWindowStart = 0;
				return;
			}
			const s = settings();
			const now = Date.now();
			if (state.paused) {
				// The store ratings keep showing, so the payback data is kept current; nothing is done with it.
				if (isOverlayOn()) refreshPayback(now);
				refreshStatusLine(now);
				return;
			}
			clickBigCookie(now);
			if (s.clickGolden || s.clickReindeer) clickShimmers();
			if (isCollectingHalloween()) popFedWrinklers();
			else if (s.wrinklerMode === 'instant') popWrinklers(false);
			if (s.clickFortunes) clickFortune();
			const comboMade = runGodzamok(now);
			runAutoBuy(now);
			runLumps(now);
			// The dragon trainer sacrifices buildings and an aura change costs one: never in a combo's tick.
			if (!comboMade) runDragon(now);
			runMarket(now);
			runGrimoire(now);
			runPantheon(now);
			runSeasons(now);
			checkAutoAscend();
			refreshStatusLine(now);
		} catch (e) {
			state.lastError = String(e && e.message || e);
			debugLog('Error in logic hook:', e);
		}
	}

	function onReincarnate() {
		state.ascendTriggered = false;
		state.ascendWarning = false;
		// The game is still setting up the new run for a moment.
		state.buyResumeAt = Date.now() + REINCARNATE_GRACE_MS;
		state.skipUntil = {};
		forgetPurchaseChecks();
		forgetDragonRun();
		forgetMarketRun();
		forgetGrimoireRun();
	}

	function onReset(hard) {
		endIncomeRun(hard);
		state.ascendTriggered = false;
		state.ascendWarning = false;
		state.buyResumeAt = Date.now() + REINCARNATE_GRACE_MS;
		state.skipUntil = {};
		forgetPurchaseChecks();
		forgetDragonRun();
		forgetMarketRun();
		forgetGrimoireRun();
	}

	function forgetGrimoireRun() {
		state.lastCast = '';
		state.spellCookie = null;
	}

	// The game has already wiped the market (M.reset): holdings, brokers, office and profit.
	function forgetMarketRun() {
		settings().marketBasis = {};
		state.lastTrade = '';
		state.lastMarketAction = '';
		state.ascendPending = false;
	}

	// The game has already reset the dragon and closed the special panel, so there's nothing to put back.
	function forgetDragonRun() {
		state.petSession = null;
		state.petDoneWindow = '';
		state.lastDragonAction = '';
	}

	/* =====================================================================
	   CLICKERS
	   ===================================================================== */

	// Counts the autoclicker's landed clicks over a window to measure its real click rate.
	function measureClickRate(now, landed) {
		if (!state.clickWindowStart) {
			state.clickWindowStart = now;
			state.clickWindowClicks = 0;
		}
		state.clickWindowClicks += landed;
		const elapsed = now - state.clickWindowStart;
		if (elapsed < CLICK_RATE_WINDOW_MS) return;
		state.measuredClickRate = state.clickWindowClicks / (elapsed / 1000);
		state.clickWindowStart = now;
		state.clickWindowClicks = 0;
	}

	// Clicks per second the autoclicker really lands. The setting is already capped at the game's
	// 50 per second, but clicks are lost while the game is starting up, or when a throttled window
	// falls more than the 5-second catch-up behind.
	function effectiveClickRate() {
		const rate = settings().clickRate;
		if (rate <= 0) return 0;
		return state.measuredClickRate === null ? rate : Math.min(rate, state.measuredClickRate);
	}

	function clickBigCookie(now) {
		const rate = settings().clickRate;
		if (rate <= 0 || !state.lastClickTime) {
			state.owedClicks = 0;
			state.lastClickTime = now;
			state.clickWindowStart = 0;
			return;
		}
		// Clicks are owed by wall-clock time, so a throttled (minimized) window still gets the
		// configured rate. Capped at 5 seconds, matching the game's own catch-up limit.
		state.owedClicks = Math.min(state.owedClicks + (now - state.lastClickTime) / 1000 * rate, rate * 5);
		state.lastClickTime = now;
		if (state.owedClicks < 1) {
			measureClickRate(now, 0);
			return;
		}

		const clicks = Math.floor(state.owedClicks);
		const clicksBefore = Game.cookieClicks;
		// ClickCookie accepts one click per 20 ms. Several owed clicks become one click worth that many.
		Game.ClickCookie(0, clicks > 1 ? Game.computedMouseCps * clicks : 0);
		const landed = Game.cookieClicks !== clicksBefore;
		measureClickRate(now, landed ? clicks : 0);
		if (!landed) return;
		state.owedClicks -= clicks;
		// ClickCookie counted the batch as one click; count the rest (the click hook is not re-run).
		Game.cookieClicks += clicks - 1;
		Game.clicksThisSession += clicks - 1;
	}

	// Game.playCookieClickSound is only used by the big cookie: by Game.ClickCookie (player and
	// autoclicker clicks alike) and on mousedown with "Alt cookie sound" on. Every other sound is untouched.
	function installClickSoundHook() {
		const originalPlay = Game.playCookieClickSound;
		Game.playCookieClickSound = function () {
			if (settings().muteCookieClick) return;
			return originalPlay.apply(this, arguments);
		};
	}

	function clickShimmers() {
		const s = settings();
		// Popping removes the shimmer from Game.shimmers, so iterate over a copy.
		for (const shimmer of Game.shimmers.slice()) {
			if (shimmer.type === 'golden') {
				if (!s.clickGolden || (shimmer.wrath && !s.clickWrath)) continue;
				// A backfired spell's wrath cookie is mostly harmful; it's left to expire.
				if (state.backfiredCookies.has(shimmer)) continue;
			} else if (shimmer.type === 'reindeer') {
				if (!s.clickReindeer) continue;
			} else {
				continue;
			}
			countIncome(shimmer.type === 'reindeer' ? 'reindeer' : shimmer.wrath ? 'wrath' : 'golden', function () { shimmer.pop(); });
			if (shimmer === state.spellCookie) noteSpellCookieClicked();
		}
	}

	function clickFortune() {
		const effect = Game.TickerEffect;
		if (!effect || effect.type !== 'fortune') return;
		// sub is the upgrade to unlock, or the strings 'fortuneGC' / 'fortuneCPS'.
		if (settings().fortuneMode === 'upgrades' && typeof effect.sub !== 'object') return;
		countIncome('fortune', function () { Game.tickerL.click(); });
	}

	/* =====================================================================
	   WRINKLERS
	   ===================================================================== */

	// phase 0 = empty slot, 1 = crawling in, 2 = feeding. type 1 = shiny.
	function isShiny(wrinkler) {
		return wrinkler.type === 1;
	}

	function isShinyOnScreen() {
		return Game.wrinklers.some(function (wrinkler) { return wrinkler.phase > 0 && isShiny(wrinkler); });
	}

	// Marks wrinklers to pop; shinies only when includeShinies is set. The game pops any wrinkler
	// whose hp is 0.5 or below on its next update. Returns true while any of them are still on screen.
	function popWrinklers(includeShinies) {
		let remaining = false;
		for (const wrinkler of Game.wrinklers) {
			if (wrinkler.phase === 0 || (isShiny(wrinkler) && !includeShinies)) continue;
			if (wrinkler.hp > 0) wrinkler.hp = -10;
			remaining = true;
		}
		return remaining;
	}

	// Mirrors the payout in Game.UpdateWrinklers. Popping passes this amount to Game.Earn,
	// which adds it to both Game.cookies and Game.cookiesEarned.
	function wrinklerPayout(wrinkler) {
		let payout = wrinkler.sucked * (1 + Game.auraMult('Dragon Guts') * 0.2);
		let multiplier = 1.1;
		if (Game.Has('Sacrilegious corruption')) multiplier *= 1.05;
		if (wrinkler.type === 1) multiplier *= 3;
		payout *= multiplier;
		if (Game.Has('Wrinklerspawn')) payout *= 1.05;
		if (Game.hasGod) {
			const scornLevel = Game.hasGod('scorn');
			if (scornLevel === 1) payout *= 1.15;
			else if (scornLevel === 2) payout *= 1.1;
			else if (scornLevel === 3) payout *= 1.05;
		}
		return payout;
	}

	function wrinklerSummary() {
		const summary = { normal: 0, shinies: 0, normalPayout: 0, shinyPayout: 0 };
		for (const wrinkler of Game.wrinklers) {
			if (wrinkler.phase === 0) continue;
			if (isShiny(wrinkler)) {
				summary.shinies++;
				summary.shinyPayout += wrinklerPayout(wrinkler);
			} else {
				summary.normal++;
				summary.normalPayout += wrinklerPayout(wrinkler);
			}
		}
		return summary;
	}

	/* =====================================================================
	   INCOME
	   Where the run's cookies came from, counted from numbers the game shows: cookies baked, CpS with
	   and without buffs, what the wrinklers wither, cookies made by clicking. No game function is
	   wrapped. AFK Baker's own actions (popping a golden cookie, a cast, a trade) are measured by
	   reading the bank before and after. Whatever is left of the change in "cookies baked" each tick
	   goes to Other, so the total always matches the game's.
	   ===================================================================== */

	const tracker = {
		earned: null, // Game.cookiesEarned at the last tick; null while not counting
		handmade: 0,
		clickMult: 1, // the click buffs' combined multiplier at the last tick
		booked: 0, // baked by AFK Baker's own actions since the last tick, already counted
		wrinklers: [], // per wrinkler slot: { sucked, type } at the last tick
		lastSample: 0,
		lastTick: 0,
		loaded: false, // a save was just loaded: what was baked meanwhile is offline income
	};
	mod.tracker = tracker;

	function addIncome(book, category, amount) {
		book[category] = (book[category] || 0) + amount;
	}

	function stopCounting() {
		tracker.earned = null;
		tracker.booked = 0;
		tracker.wrinklers = [];
	}

	// What the click buffs multiply a click by (Game.mouseCps). A Cursed finger replaces the click outright.
	function clickBuffMultiplier() {
		if (Game.buffs['Cursed finger']) return Infinity;
		let mult = 1;
		for (const name in Game.buffs) {
			const multClick = Game.buffs[name].multClick;
			if (typeof multClick === 'number' && multClick > 1) mult *= multClick;
		}
		return mult;
	}

	function currentSetup() {
		const auras = [Game.dragonAura, Game.dragonAura2].filter(function (id) { return id > 0 && Game.dragonAuras[id]; })
			.map(function (id) { return Game.dragonAuras[id].name; });
		const M = pantheon();
		const gods = M ? [0, 1, 2].map(function (slot) { return M.slot[slot] !== -1 ? shortGodName(M.godsById[M.slot[slot]]) : '-'; }) : [];
		return sanitizeSetup({ a: auras, g: gods, w: grandmaMood(), c: state.paused ? 0 : settings().clickRate });
	}

	// Counting starts: at load, when it is switched on, or in a run AFK Baker has no record of.
	function startCounting(now) {
		const income = mod.income;
		const earned = Game.cookiesEarned;
		if (income.run.start !== Game.startDate) {
			income.run = freshRun();
			income.run.start = Game.startDate;
			income.run.allStart = Game.cookiesReset;
			if (earned > 0) income.run.gains.uncounted = earned;
		} else if (earned > income.run.seen) {
			addIncome(income.run.gains, tracker.loaded ? 'offline' : 'uncounted', earned - income.run.seen);
		}
		income.run.seen = earned;
		tracker.earned = earned;
		tracker.handmade = Game.handmadeCookies;
		tracker.clickMult = clickBuffMultiplier();
		tracker.booked = 0;
		tracker.wrinklers = [];
		tracker.lastSample = now;
		tracker.lastTick = now;
		tracker.loaded = false;
	}

	// Once a game tick, before AFK Baker does anything: books what the tick that just ran brought in.
	function trackIncome(now) {
		if (!settings().trackIncome) {
			if (tracker.earned !== null) stopCounting();
			return;
		}
		if (tracker.earned === null || mod.income.run.start !== Game.startDate) {
			startCounting(now);
			return;
		}
		const run = mod.income.run;
		const earned = Game.cookiesEarned;
		const delta = earned - tracker.earned;
		tracker.earned = earned;
		run.seen = earned;
		tracker.lastTick = now;
		let known = tracker.booked;
		tracker.booked = 0;

		// Production (Game.Logic: Game.Earn(cookiesPs / fps), then the wrinklers' share is taken off).
		if (!isAscending()) {
			const base = Game.unbuffedCps / Game.fps;
			const made = Game.cookiesPs / Game.fps;
			if (base > 0 || made > 0) {
				addIncome(run.gains, 'prod', base);
				run.base += base;
				if (made > base) addIncome(run.gains, 'prodBuff', made - base);
				else if (made < base) addIncome(run.losses, 'debuff', base - made);
				const withered = made * Game.cpsSucked;
				if (withered > 0) addIncome(run.losses, 'withered', withered);
				known += made - withered;
			}
		}

		// Clicks, split by the click buffs that were active when they were made.
		const handmade = Game.handmadeCookies - tracker.handmade;
		tracker.handmade = Game.handmadeCookies;
		if (handmade > 0) {
			const plain = handmade / tracker.clickMult;
			if (plain > 0) addIncome(run.gains, 'clicks', plain);
			if (handmade > plain) addIncome(run.gains, 'clickBuff', handmade - plain);
			known += handmade;
		}
		// A buff that came or went this tick only changes what a click is worth once the game has
		// recalculated; until then the clicks are still made at the old strength.
		if (!Game.recalculateGains) tracker.clickMult = clickBuffMultiplier();

		// A wrinkler whose stomach emptied was popped, by AFK Baker, the player or a pledge.
		const seen = tracker.wrinklers;
		for (let i = 0; i < Game.wrinklers.length; i++) {
			const wrinkler = Game.wrinklers[i];
			const last = seen[i];
			if (!last) {
				seen[i] = { sucked: wrinkler.sucked, type: wrinkler.type };
				continue;
			}
			if (last.sucked > 0.5 && wrinkler.sucked < last.sucked) {
				const paid = wrinklerPayout(last);
				addIncome(run.gains, 'wrinklers', paid);
				known += paid;
			}
			last.sucked = wrinkler.sucked;
			last.type = wrinkler.type;
		}

		if (delta !== known) addIncome(run.gains, 'other', delta - known);

		if (now - tracker.lastSample >= INCOME_SAMPLE_MS) {
			// Capped, so time the game spent frozen is not credited to a setup.
			const seconds = Math.min(now - tracker.lastSample, 5 * INCOME_SAMPLE_MS) / 1000;
			tracker.lastSample = now;
			const key = JSON.stringify(currentSetup());
			if (hasKey(run.setups, key) || Object.keys(run.setups).length < INCOME_SETUPS_MAX) run.setups[key] = (run.setups[key] || 0) + seconds;
		}
	}

	// Runs one of AFK Baker's own actions and books what it paid out under `category`. A payout shows as a
	// rise in cookies baked; a loss (Ruin, a backfire) only as a drop in the bank.
	function countIncome(category, action) {
		if (tracker.earned === null) return action();
		const earned = Game.cookiesEarned;
		const bank = Game.cookies;
		const result = action();
		const gained = Game.cookiesEarned - earned;
		if (gained > 0) {
			addIncome(mod.income.run.gains, category, gained);
			tracker.booked += gained;
		} else if (Game.cookies < bank) {
			addIncome(mod.income.run.losses, 'ruin', bank - Game.cookies);
		}
		return result;
	}

	// A stock trade moves cookies in and out of the bank. The game only counts a sale as cookies baked
	// where it lifts the bank above everything baked this run.
	function countMarket(trade) {
		if (tracker.earned === null) return trade();
		const earned = Game.cookiesEarned;
		const bank = Game.cookies;
		const result = trade();
		mod.income.run.bank += Game.cookies - bank;
		const gained = Game.cookiesEarned - earned;
		if (gained > 0) {
			addIncome(mod.income.run.gains, 'market', gained);
			tracker.booked += gained;
		}
		return result;
	}

	function roundAmount(amount) {
		return Number(amount.toPrecision(6));
	}

	function roundBook(book) {
		const rounded = {};
		for (const category in book) {
			if (book[category]) rounded[category] = roundAmount(book[category]);
		}
		return rounded;
	}

	// The setup that was active longest, what share of the counted time it held, and whether it ever changed.
	function longestSetup(run) {
		let best = '';
		let total = 0;
		for (const key in run.setups) {
			total += run.setups[key];
			if (!best || run.setups[key] > run.setups[best]) best = key;
		}
		if (!best) return { setup: currentSetup(), share: 100, changed: false };
		return { setup: sanitizeSetup(JSON.parse(best)), share: Math.round(run.setups[best] / total * 100), changed: Object.keys(run.setups).length > 1 };
	}

	// A run as the Stats tab shows it and the save keeps it. allStart and allEnd are the all-time cookies
	// baked (the game's "cookies baked (all time)") when the run began and ended.
	function runRecord(run, end, baked) {
		const allEnd = run.allStart + baked;
		const setup = longestSetup(run);
		return {
			start: run.start, end: end, baked: baked, allStart: run.allStart, allEnd: allEnd,
			prestige: Math.max(0, Math.floor(Game.HowMuchPrestige(allEnd)) - Math.floor(Game.HowMuchPrestige(run.allStart))),
			gains: roundBook(run.gains), losses: roundBook(run.losses), base: roundAmount(run.base), bank: run.bank ? roundAmount(run.bank) : 0,
			setup: setup.setup, share: setup.share, changed: setup.changed,
		};
	}

	function liveRecord() {
		return runRecord(mod.income.run, Date.now(), Game.cookiesEarned);
	}

	// The game's reset hook: an ascension (the run goes into the history) or a wipe (everything goes).
	// Game.Reset has already added the run's cookies to the all-time total and zeroed the run.
	function endIncomeRun(hard) {
		if (hard) {
			mod.income = freshIncome();
			stopCounting();
			return;
		}
		const income = mod.income;
		const run = income.run;
		if (tracker.earned !== null && run.start > 0 && run.seen > 0) {
			let baked = run.seen;
			// Anything baked after the last tick AFK Baker saw.
			const missed = Game.cookiesReset - run.allStart - baked;
			if (missed > baked * 1e-9) {
				addIncome(run.gains, 'other', missed);
				baked += missed;
			}
			income.history.unshift(runRecord(run, tracker.lastTick || Date.now(), baked));
			income.history.length = Math.min(income.history.length, INCOME_HISTORY_MAX);
		}
		income.run = freshRun();
		income.run.start = Game.startDate;
		income.run.allStart = Game.cookiesReset;
		if (tracker.earned === null) return;
		stopCounting();
		tracker.earned = Game.cookiesEarned;
		tracker.handmade = Game.handmadeCookies;
		tracker.clickMult = 1;
		tracker.lastSample = Date.now();
		tracker.lastTick = tracker.lastSample;
	}

	function runHours(record) {
		return Math.max(0, record.end - record.start) / 3600000;
	}

	// How many times over the all-time cookies grew per hour of the run: the number that drives prestige,
	// and one that can be compared between runs of very different size. null for a first run.
	function growthPerHour(record) {
		const hours = runHours(record);
		if (!(record.allStart > 0) || !(hours > 0)) return null;
		return Math.log10(record.allEnd / record.allStart) / hours;
	}

	function growthText(record) {
		const log = growthPerHour(record);
		if (log === null) return '&ndash;';
		if (!(log > 0)) return '+0% an hour';
		if (log >= 6) return `x10<sup>${Math.round(log)}</sup> an hour`;
		const factor = Math.pow(10, log);
		if (factor < 2) return `+${((factor - 1) * 100).toFixed(factor < 1.1 ? 2 : 1)}% an hour`;
		return `x${factor < 100 ? factor.toFixed(2) : Beautify(Math.round(factor))} an hour`;
	}

	// Everything counted while the game ran, against what the buildings alone would have made at CpS
	// without buffs: how much clicks, golden cookies, buffs and wrinklers added. null if nothing was counted.
	function incomeMultiplier(record) {
		if (!(record.base > 0)) return null;
		let counted = 0;
		for (const category in record.gains) {
			if (category !== 'offline' && category !== 'uncounted') counted += record.gains[category];
		}
		counted -= (record.losses.withered || 0) + (record.losses.debuff || 0);
		return counted / record.base;
	}

	/* =====================================================================
	   PAYBACK PERIODS
	   What a purchase would add to CpS is worked out by running the game's own CpS code on a copy of
	   the game's state. The copy (the "shadow") inherits everything from Game and holds its own
	   building amounts, upgrade flags and achievement flags. The game's functions are rebuilt from
	   their source so that "Game" inside them means the shadow. Nothing in the real game is changed.

	   Everything here is unbuffed: a Frenzy scales every payback period alike, and a building buff
	   lasts seconds, so neither should decide what to buy.
	   ===================================================================== */

	const calc = {
		sim: null,
		source: '', // which copy of Game.CalculateGains the simulator runs: 'game' (the live function) or 'file'
		// The function's text from the game's own main.js: undefined until asked for, null while loading,
		// '' if it couldn't be read.
		fileSource: undefined,
		// The simulator's clock. Fixed for one round of calculations, so that time-based boosts (Century egg,
		// Cyclius) are the same in every simulation of the round.
		now: 0,
		signature: '',
		ready: false,
		blocked: '', // why the self-check failed, or ''
		verified: false, // the current simulator has matched the game at least once
		mismatchSince: 0, // when a verified simulator stopped matching, or 0
		retryAt: 0,
		queue: [],
		base: null,
		results: new Map(), // candidate key -> outcome of buying it
		pendingCheck: null, // the last purchase, until the game has recalculated its CpS
		expectedAchievements: [], // { label, names, dueT }: count achievements a purchase should bring
		recentChecks: [], // true for each of the last purchases that changed CpS as predicted
		lastMiss: '',
		checkedCount: 0, // purchases (or batches) checked against their prediction since the game loaded
		missCount: 0,
		fastBatches: 0, // batches bought by fast buying since the game loaded
		fastMisses: 0, // batches that missed their prediction this run
		paused: '', // why the purchase checks stopped auto-buy, or ''
		comparison: null, // debug: the last comparison with Cookie Monster
		comparisonSignature: '',
		achievementsSeen: null, // debug: the achievements that were won at the last look
		predictedWins: {}, // debug: achievements the recent purchases were predicted to bring
		watchUntilT: 0, // debug: Game.T until which a newly won achievement counts as following a purchase
	};
	mod.calc = calc;

	// Rebuilds a game function so that "Game" and "Date" inside it are ours. CalculateGains assigns to
	// "name" without declaring it; the var keeps that off the window.
	function rebind(source, shadow, clock) {
		return new Function('Game', 'Date', 'var name; return (' + source + ');')(shadow, clock);
	}

	function buildSim(calculateGainsSource) {
		const shadow = Object.create(Game);
		const sim = { shadow: shadow, pairs: [], wins: [] };
		const clock = new Proxy(Date, {
			get: function (target, key) {
				return key === 'now' ? function () { return calc.now; } : Reflect.get(target, key);
			},
		});
		const copyOf = function (fn) { return rebind(fn.toString(), shadow, clock); };

		for (const name of SHADOWED_FUNCTIONS) shadow[name] = copyOf(Game[name]);
		shadow.CalculateGains = rebind(calculateGainsSource, shadow, clock);
		// What the game's functions would do to the real game is replaced by harmless versions.
		shadow.Win = function (what) {
			if (typeof what !== 'string') {
				for (const i in what) shadow.Win(what[i]);
				return;
			}
			const real = Game.Achievements[what];
			if (!real || shadow.Achievements[what].won) return;
			shadow.Achievements[what] = Object.create(real, { won: { value: 1 } });
			if (Game.CountsAsAchievementOwned(real.pool)) shadow.AchievementsOwned++;
			sim.wins.push(what);
		};
		shadow.Unlock = function () {};
		shadow.Notify = function () {};
		shadow.computeLumpTimes = function () {};
		// Other mods' official hooks ('cps', 'cookiesPerClick') are part of the game's CpS, so they run in
		// the simulation too. A hook that reads the game's state has to see the shadow's for a simulated
		// purchase to count, so each hook is rebuilt like the game's own functions where that is possible.
		shadow.runModHookOnValue = function (hook, value) {
			const hooks = Game.modHooks[hook] || [];
			for (let i = 0; i < hooks.length; i++) value = runHook(sim, hooks[i], value);
			return value;
		};
		sim.hooks = new Map(); // another mod's hook function -> its copy for the shadow, or null
		sim.inBase = false;
		sim.rebindHook = copyOf;

		shadow.Objects = {};
		shadow.ObjectsById = [];
		for (const real of Game.ObjectsById) {
			const copy = Object.create(real);
			copy.cps = copyOf(real.cps);
			// A building's buy function unlocks upgrades and wins the achievements for owning that many.
			copy.buyFunction = real.buyFunction ? copyOf(real.buyFunction) : null;
			shadow.Objects[real.name] = copy;
			shadow.ObjectsById[real.id] = copy;
			sim.pairs.push({ real: real, copy: copy });
		}
		// Synergy upgrades point at the real buildings; the copies get ones that point at the shadow's.
		for (const pair of sim.pairs) {
			const synergies = pair.real.synergies || [];
			pair.copy.synergies = synergies.map(function (synergy) {
				return Object.create(synergy, {
					buildingTie1: { value: shadow.Objects[synergy.buildingTie1.name] },
					buildingTie2: { value: shadow.Objects[synergy.buildingTie2.name] },
				});
			});
		}
		return sim;
	}

	// Puts the shadow back to the game's current state.
	function resetSim(sim) {
		const shadow = sim.shadow;
		for (const pair of sim.pairs) pair.copy.amount = pair.real.amount;
		shadow.Upgrades = Object.create(Game.Upgrades);
		shadow.Achievements = Object.create(Game.Achievements);
		shadow.AchievementsOwned = Game.AchievementsOwned;
		shadow.UpgradesOwned = Game.UpgradesOwned;
		shadow.BuildingsOwned = Game.BuildingsOwned;
		shadow.cookiesMultByType = {};
		shadow.cookiesPsByType = {};
		shadow.buffs = {};
		// Without these the shadow would show the game's own numbers if the CpS code never wrote any.
		shadow.unbuffedCps = NaN;
		shadow.computedMouseCps = NaN;
		sim.wins = [];
	}

	// The achievements for owning buildings and upgrades that the game hands out in its check every
	// five seconds (Game.Logic in main.js, from "var buildingsOwned=0;" on). This list is the one part
	// of the calculator that mirrors game code by hand; the check after each purchase watches it.
	function winCountAchievements(shadow) {
		const buildings = shadow.ObjectsById;
		let owned = 0;
		let minAmount = 100000;
		let mathematician = true;
		let base10 = true;
		for (const building of buildings) {
			owned += building.amount;
			minAmount = Math.min(building.amount, minAmount);
			if (building.amount < Math.min(128, Math.pow(2, buildings.length - building.id - 1))) mathematician = false;
			if (building.amount < (buildings.length - building.id) * 10) base10 = false;
		}
		const upgrades = shadow.UpgradesOwned;
		const winAt = function (value, steps) {
			for (const step of steps) {
				if (value >= step[0]) shadow.Win(step[1]);
			}
		};
		const hasAll = function (names) {
			return names.every(function (name) { return shadow.Has(name); });
		};
		const countOwned = function (names) {
			return names.filter(function (name) { return shadow.Has(name); }).length;
		};

		if (minAmount >= 1) shadow.Win('One with everything');
		if (mathematician) shadow.Win('Mathematician');
		if (base10) shadow.Win('Base 10');
		winAt(minAmount, EVERY_BUILDING_ACHIEVEMENTS);
		winAt(owned, BUILDINGS_OWNED_ACHIEVEMENTS);
		winAt(upgrades, UPGRADES_OWNED_ACHIEVEMENTS);
		if (owned >= 4000 && upgrades >= 300) shadow.Win('Polymath');
		if (owned >= 8000 && upgrades >= 400) shadow.Win('Renaissance baker');
		if (shadow.Objects['Cursor'].amount + shadow.Objects['Grandma'].amount >= 777) shadow.Win('The elder scrolls');

		const kittens = (Game.UpgradesByPool['kitten'] || []).map(function (upgrade) { return upgrade.name; });
		if (countOwned(kittens) >= 10) shadow.Win('Jellicles');
		const grandmaTypes = countOwned(Game.GrandmaSynergies || []);
		if (grandmaTypes >= 7) shadow.Win('Elder');
		if (grandmaTypes >= 14) shadow.Win('Veteran');
		if (hasAll(HALLOWEEN_COOKIES)) shadow.Win('Spooky cookies');
		if (hasAll(CHRISTMAS_COOKIES)) shadow.Win('Let it snow');
		if (shadow.Has('Prism heart biscuits')) shadow.Win('Lovely cookies');
	}

	// CpS achievements are won inside CalculateGains, after the milk they add has been counted, so it
	// runs again until no more are won. The real game counts that milk at its next recalculation.
	function settleSim(sim) {
		const shadow = sim.shadow;
		for (let pass = 0; pass < MAX_SETTLE_PASSES; pass++) {
			const owned = shadow.AchievementsOwned;
			shadow.CalculateGains();
			if (shadow.AchievementsOwned === owned) break;
		}
	}

	// immediate: unbuffed CpS as the game has it right after the purchase, from one recalculation.
	// cps: once the milk of every achievement the purchase brings is counted, including the count
	// achievements from the game's five-second check.
	function runSim(sim) {
		const shadow = sim.shadow;
		const ownedBefore = shadow.AchievementsOwned;
		shadow.CalculateGains();
		const immediate = shadow.unbuffedCps;
		if (shadow.AchievementsOwned !== ownedBefore) settleSim(sim);
		const winsBefore = sim.wins.length;
		winCountAchievements(shadow);
		const countWins = sim.wins.slice(winsBefore);
		if (countWins.length) settleSim(sim);
		return {
			immediate: immediate, cps: shadow.unbuffedCps, mouseCps: shadow.computedMouseCps,
			wins: sim.wins.slice(), countWins: countWins,
		};
	}

	// Runs another mod's hook for the simulation. The copy that reads the shadow is used only once it
	// has given the same answer as the original for the game as it is (a hook that uses variables of
	// its own mod can't be rebuilt, and fails or differs). Until then, and for hooks without a usable
	// copy, the original runs: its answer is right for the game as it is, but it won't see a simulated
	// purchase. The check after each real purchase covers that case.
	function runHook(sim, hook, value) {
		let entry = sim.hooks.get(hook);
		if (!entry) {
			entry = { copy: null, trusted: false };
			try {
				entry.copy = sim.rebindHook(hook);
			} catch (e) {
				entry.copy = null;
			}
			sim.hooks.set(hook, entry);
		}
		if (!entry.copy) return hook(value);
		if (entry.trusted) {
			try {
				return entry.copy(value);
			} catch (e) {
				entry.copy = null;
				return hook(value);
			}
		}
		const original = hook(value);
		if (!sim.inBase) return original;
		try {
			if (entry.copy(value) === original) entry.trusted = true;
			else entry.copy = null;
		} catch (e) {
			entry.copy = null;
		}
		return original;
	}

	function simulateBase() {
		const sim = calc.sim;
		resetSim(sim);
		sim.inBase = true;
		try {
			return runSim(sim);
		} finally {
			sim.inBase = false;
		}
	}

	// Makes one purchase on the shadow.
	function applyPurchase(sim, candidate) {
		const shadow = sim.shadow;
		if (candidate.kind === 'building') {
			const copy = shadow.Objects[candidate.name];
			copy.amount += candidate.amount;
			shadow.BuildingsOwned += candidate.amount;
			if (copy.buyFunction) copy.buyFunction();
		} else {
			const real = Game.Upgrades[candidate.name];
			shadow.Upgrades[candidate.name] = Object.create(real, { bought: { value: 1 } });
			if (Game.CountsAsUpgradeOwned(real.pool)) shadow.UpgradesOwned++;
		}
	}

	function simulatePurchase(candidate) {
		return simulatePurchases([candidate]);
	}

	// What the game's CpS would be after buying all of these together.
	function simulatePurchases(candidates) {
		const sim = calc.sim;
		resetSim(sim);
		for (const candidate of candidates) applyPurchase(sim, candidate);
		return runSim(sim);
	}

	// False for NaN.
	function isClose(a, b, tolerance) {
		return Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b));
	}

	// The body of a function in the game's main.js, found by the line it starts on and the first later
	// line that closes it at the same indentation. '' if it isn't there.
	function extractFunctionSource(text, opening) {
		const at = text.indexOf(opening);
		if (at === -1) return '';
		const indent = text.slice(text.lastIndexOf('\n', at) + 1, at);
		if (/\S/.test(indent)) return '';
		const closing = new RegExp('\\n' + indent + '\\}\\r?\\n');
		const rest = text.slice(at);
		const match = closing.exec(rest);
		if (!match) return '';
		return rest.slice(opening.indexOf('function'), match.index + 1 + indent.length + 1);
	}

	// Another mod may have swapped Game.CalculateGains for a wrapper that calls the original (Cookie
	// Monster does). A wrapper can't be rebuilt, so the original is read from the game's own script.
	function loadGameSource() {
		calc.fileSource = null;
		const urls = Array.from(document.querySelectorAll('script[src]'))
			.map(function (script) { return script.src; })
			.filter(function (src) { return /(^|\/)main\.js(\?|$)/.test(src); });
		const tryNext = function () {
			const url = urls.shift();
			if (!url) {
				calc.fileSource = '';
				return;
			}
			const request = new XMLHttpRequest();
			request.onload = function () {
				const source = extractFunctionSource(String(request.responseText || ''), GAME_CALCULATE_GAINS);
				if (!source) return tryNext();
				calc.fileSource = source;
				calc.retryAt = 0;
			};
			request.onerror = tryNext;
			try {
				request.open('GET', url);
				request.send();
			} catch (e) {
				tryNext();
			}
		};
		tryNext();
	}

	// Why the simulator's CpS for the game as it is doesn't match the game's own, or ''.
	function baseProblem() {
		calc.base = null;
		try {
			calc.base = simulateBase();
		} catch (e) {
			return `the game's CpS code could not be run on a copy (${String(e && e.message || e)})`;
		}
		if (!isClose(calc.base.immediate, Game.unbuffedCps, SELF_CHECK_TOLERANCE)) {
			return `it gives ${Beautify(calc.base.immediate, 1)} CpS where the game has ${Beautify(Game.unbuffedCps, 1)}`;
		}
		return '';
	}

	function selfCheckPassed() {
		calc.verified = true;
		calc.mismatchSince = 0;
		return '';
	}

	// The self-check: the simulator must reproduce the game's own unbuffed CpS before any of its numbers
	// are used. Tries the simulator it has, then a fresh one from the live function, then one from the
	// game's file. Returns what is wrong, or ''.
	function selfCheck(now) {
		if (calc.sim) {
			if (!baseProblem()) return selfCheckPassed();
			// The game's own number can be out of date for up to 10 seconds: the milk of an achievement won
			// during a recalculation is only counted at the next one. A simulator that has matched before
			// is trusted for that long; the check after each purchase still runs.
			if (calc.verified && calc.base) {
				if (!calc.mismatchSince) calc.mismatchSince = now;
				if (now - calc.mismatchSince < SELF_CHECK_GRACE_MS) return '';
			}
		}
		let problem = '';
		for (const kind of ['game', 'file']) {
			const source = kind === 'game' ? String(Game.CalculateGains) : calc.fileSource;
			if (!source) continue;
			// A wrapper that calls the original must not be rebuilt: on the shadow it would run the real
			// function on the real game. Only the function that does the calculation itself will do.
			if (!CALCULATES_CPS.test(source)) {
				problem = "another mod has replaced the game's CpS function and the original could not be read";
				continue;
			}
			try {
				calc.sim = buildSim(source);
				calc.source = kind;
				calc.verified = false;
			} catch (e) {
				calc.sim = null;
				problem = `the game's CpS code could not be copied (${String(e && e.message || e)})`;
				continue;
			}
			problem = baseProblem();
			if (!problem) return selfCheckPassed();
		}
		if (calc.fileSource === undefined) loadGameSource();
		if (calc.fileSource === null) return "reading the game's own CpS code";
		return problem;
	}

	// Changes whenever something that affects a purchase's CpS gain does. Game.unbuffedCps moves with
	// nearly all of it (levels, auras, gods, plants, seasons, achievements); the rest is what is on offer.
	function paybackSignature() {
		let signature = `${Game.unbuffedCps}|${Game.AchievementsOwned}|${Game.UpgradesOwned}`;
		for (const building of Game.ObjectsById) signature += `|${building.amount}`;
		for (const upgrade of Game.UpgradesInStore) signature += `|u${upgrade.id}`;
		return signature;
	}

	function paybackCandidates() {
		const candidates = [];
		for (const upgrade of Game.UpgradesInStore) {
			if (upgrade.bought || upgrade.pool === 'tech' || BLOCKED_POOLS.indexOf(upgrade.pool) !== -1) continue;
			candidates.push({ kind: 'upgrade', name: upgrade.name, amount: 1 });
		}
		for (const name in Game.Objects) {
			for (const amount of BUY_AMOUNTS) candidates.push({ kind: 'building', name: name, amount: amount });
		}
		return candidates;
	}

	function purchaseOutcome(candidate) {
		const run = simulatePurchase(candidate);
		return {
			gain: run.cps - calc.base.cps,
			clickGain: run.mouseCps - calc.base.mouseCps,
			immediate: run.immediate, cps: run.cps, wins: run.wins, countWins: run.countWins,
		};
	}

	function startPaybackRound(signature, now) {
		calc.signature = signature;
		calc.ready = false;
		calc.results = new Map();
		calc.queue = [];
		calc.now = Date.now();
		calc.blocked = selfCheck(now);
		// While blocked or in doubt, the check is repeated every few seconds even if nothing changes.
		calc.retryAt = now + SELF_CHECK_RETRY_MS;
		if (calc.blocked) return;
		calc.queue = paybackCandidates();
	}

	// Keeps the payback data current: starts a new round when the game changed, and does a few
	// milliseconds of simulations per tick until the round is done.
	function refreshPayback(now) {
		// The game is about to recalculate its CpS; its numbers and ours can't be compared until it has.
		if (Game.recalculateGains) return;
		checkLastPurchase();
		checkExpectedAchievements();
		noteUnpredictedAchievements();
		const signature = paybackSignature();
		if (signature !== calc.signature || ((calc.blocked || calc.mismatchSince) && now >= calc.retryAt)) startPaybackRound(signature, now);
		if (calc.blocked) return;
		const deadline = performance.now() + PP_TICK_BUDGET_MS;
		while (calc.queue.length && performance.now() < deadline) {
			const candidate = calc.queue.pop();
			try {
				calc.results.set(candidateKey(candidate), purchaseOutcome(candidate));
			} catch (e) {
				calc.blocked = `buying ${candidateLabel(candidate)} could not be simulated (${String(e && e.message || e)})`;
				calc.retryAt = now + SELF_CHECK_RETRY_MS;
				return;
			}
		}
		if (!calc.queue.length && !calc.ready) {
			calc.ready = true;
			compareWithCookieMonster();
		}
	}

	// A payback period for the status line. Right after an ascension they can be billionths of a second.
	function ppText(seconds) {
		return seconds < 1 ? 'under 1 s' : shortTime(seconds);
	}

	// The PP formula: how long until the item is affordable, plus how long it takes to pay for itself.
	// CpS is the simulator's unbuffed CpS for the game as it is, which the self-check holds to the game's own.
	function paybackPeriod(price, incomeGain) {
		const payback = price / incomeGain;
		const cps = calc.base ? calc.base.immediate : 0;
		return cps > 0 ? Math.max(price - Game.cookies, 0) / cps + payback : payback;
	}

	/* ----- Checking predictions against real purchases ----- */

	function recordPurchaseCheck(matched, miss) {
		calc.checkedCount++;
		if (!matched) calc.missCount++;
		calc.recentChecks.push(matched);
		if (calc.recentChecks.length > LIVE_CHECK_WINDOW) calc.recentChecks.shift();
		if (matched) return;
		calc.lastMiss = miss;
		console.log(`${LOG_PREFIX} CpS prediction was off: ${miss}`);
		if (recentMisses() >= LIVE_CHECK_MAX_MISSES) {
			calc.paused = `${recentMisses()} of the last ${calc.recentChecks.length} purchases changed CpS differently ` +
				`than predicted (last: ${miss})`;
		}
	}

	function recentMisses() {
		return calc.recentChecks.filter(function (matched) { return !matched; }).length;
	}

	// Simulates what is about to be bought (one item, or a batch bought together), with the clock at
	// now, and remembers what it should do to CpS.
	function predictPurchase(candidates, label) {
		const roundClock = calc.now;
		calc.now = Date.now();
		try {
			const run = simulatePurchases(candidates);
			calc.pendingCheck = { label: label, batch: candidates.length > 1, immediate: run.immediate, cps: run.cps, wins: run.wins, countWins: run.countWins, T: Game.T };
		} catch (e) {
			calc.pendingCheck = null;
		} finally {
			calc.now = roundClock;
		}
	}

	// Called once the game has recalculated its CpS after our purchase. The count achievements come up
	// to five seconds later, so either prediction counts as a match.
	function checkLastPurchase() {
		const check = calc.pendingCheck;
		if (!check || Game.T <= check.T) return;
		calc.pendingCheck = null;
		const actual = Game.unbuffedCps;
		const matched = isClose(actual, check.immediate, LIVE_CHECK_TOLERANCE) || isClose(actual, check.cps, LIVE_CHECK_TOLERANCE);
		if (!matched && check.batch) calc.fastMisses++;
		recordPurchaseCheck(matched, `${check.label}: predicted ${Beautify(check.immediate, 1)} CpS, got ${Beautify(actual, 1)}`);
		const due = Game.T + Game.fps * COUNT_ACHIEVEMENT_WAIT_S;
		if (check.countWins.length) calc.expectedAchievements.push({ label: check.label, names: check.countWins, dueT: due });
		calc.watchUntilT = due;
		for (const name of check.wins) calc.predictedWins[name] = true;
	}

	// A count achievement a purchase was predicted to bring must be there after the game's next check.
	function checkExpectedAchievements() {
		while (calc.expectedAchievements.length && Game.T >= calc.expectedAchievements[0].dueT) {
			const expected = calc.expectedAchievements.shift();
			const missing = expected.names.filter(function (name) { return !Game.HasAchiev(name); });
			if (missing.length) recordPurchaseCheck(false, `${expected.label}: expected the achievement "${missing[0]}", which the game did not give`);
		}
	}

	// Debug only: achievements won soon after one of our purchases that the purchase did not predict.
	// Most are unrelated (cookies baked, clicks); one about buildings or upgrades would be a gap in
	// winCountAchievements.
	function noteUnpredictedAchievements() {
		if (!settings().debug) {
			calc.achievementsSeen = null;
			return;
		}
		const seen = calc.achievementsSeen;
		const won = {};
		for (const name in Game.Achievements) {
			if (Game.Achievements[name].won) won[name] = true;
		}
		calc.achievementsSeen = won;
		if (!seen) return;
		if (Game.T > calc.watchUntilT) {
			calc.predictedWins = {};
			return;
		}
		for (const name in won) {
			if (seen[name] || hasKey(calc.predictedWins, name)) continue;
			debugLog(`Achievement "${name}" was won soon after a purchase and was not predicted. That is fine unless it is for owning buildings or upgrades.`);
		}
	}

	function forgetPurchaseChecks() {
		calc.pendingCheck = null;
		calc.expectedAchievements = [];
		calc.predictedWins = {};
		calc.watchUntilT = 0;
		calc.fastMisses = 0;
	}

	/* ----- Debug: comparison with Cookie Monster, if it is installed ----- */

	function hasCpsBuff() {
		for (const name in Game.buffs) {
			if (typeof Game.buffs[name].multCpS !== 'undefined' && Game.buffs[name].multCpS !== 1) return true;
		}
		return false;
	}

	function ownsSynergyUpgrade(buildingName) {
		return (Game.Objects[buildingName].synergies || []).some(function (synergy) { return Game.Has(synergy.name); });
	}

	// Why our PP for a candidate may differ from Cookie Monster's.
	function differenceReason(candidate, ours, monster) {
		if (monster.price !== undefined && !isClose(monster.price, candidate.price, CM_COMPARE_TOLERANCE)) return "Cookie Monster's data is out of date";
		if (hasCpsBuff()) return 'a buff is active: Cookie Monster uses buffed CpS, AFK Baker unbuffed';
		if (candidate.tag === 'click') return 'click upgrade: AFK Baker counts the autoclicker, Cookie Monster does not';
		if (isClose(ours.gain, monster.bonus, CM_COMPARE_TOLERANCE)) return 'same CpS gain: the bank or current CpS differs (Cookie Monster can count wrinklers)';
		const reasons = [];
		if (candidate.kind === 'building' && ownsSynergyUpgrade(candidate.name)) reasons.push('synergy upgrades owned: AFK Baker counts the boost to the partner buildings');
		if (ours.wins.length) reasons.push(`AFK Baker expects ${ours.wins.length} achievement(s)`);
		return reasons.join('; ') || 'unexplained';
	}

	// With debug logging on and Cookie Monster loaded: both PPs for every candidate, and a log of the ones
	// more than 1% apart with the likely reason. AFK Baker never uses Cookie Monster's numbers.
	function compareWithCookieMonster() {
		const data = window.CookieMonsterData;
		if (!settings().debug || !data || !data.Objects1 || !data.Upgrades) {
			calc.comparison = null;
			return;
		}
		const report = { filtered: [], infinite: [] };
		const rows = [];
		for (const candidate of rankCandidates(report)) {
			const monster = candidate.kind === 'building' ?
				(data['Objects' + candidate.amount] || {})[candidate.name] : data.Upgrades[candidate.name];
			if (!monster || typeof monster.pp !== 'number') continue;
			const ours = calc.results.get(candidateKey(candidate));
			const agrees = isClose(candidate.pp, monster.pp, CM_COMPARE_TOLERANCE);
			rows.push({
				item: candidateLabel(candidate), agrees: agrees,
				pp: candidate.pp, monsterPP: monster.pp, gain: ours.gain, monsterGain: monster.bonus,
				reason: agrees ? '' : differenceReason(candidate, ours, monster),
			});
		}
		const differing = rows.filter(function (row) { return !row.agrees; });
		calc.comparison = { total: rows.length, agreeing: rows.length - differing.length, rows: rows };
		const signature = differing.map(function (row) { return `${row.item}|${row.reason}`; }).join(';') + '#' + rows.length;
		if (signature === calc.comparisonSignature) return;
		calc.comparisonSignature = signature;
		console.log(`${LOG_PREFIX} Cookie Monster comparison: ${rows.length - differing.length} of ${rows.length} payback periods within 1%.`);
		if (differing.length) {
			console.table(differing.map(function (row) {
				return {
					item: row.item, 'AFK Baker PP': Number(row.pp.toPrecision(4)), 'Cookie Monster PP': Number(Number(row.monsterPP).toPrecision(4)),
					'AFK Baker gain': Beautify(row.gain, 1), 'Cookie Monster gain': Beautify(row.monsterGain, 1), reason: row.reason,
				};
			}));
		}
	}

	/* =====================================================================
	   AUTO-BUY
	   ===================================================================== */

	function autoReserveMinutesLeft() {
		// Game.startDate is reset when a new run starts; the Legacy tooltip uses it for run length.
		const minutesIntoRun = (Date.now() - Game.startDate) / 60000;
		return Math.max(0, settings().autoReserveMinutes - minutesIntoRun);
	}

	function reserveAmount() {
		const mode = settings().reserveMode;
		if (mode === 'auto' && autoReserveMinutesLeft() > 0) return 0;
		return RESERVE_MULTIPLIERS[mode] * Game.unbuffedCps;
	}

	function canAfford(price) {
		return Game.cookies - price >= reserveAmount();
	}

	function isInStore(upgrade) {
		return !!upgrade && Game.UpgradesInStore.indexOf(upgrade) !== -1;
	}

	// Why an upgrade is never auto-bought, or '' if it may be.
	function upgradeFilterReason(upgrade) {
		if (upgrade.bought) return 'already bought';
		if (BLOCKED_POOLS.indexOf(upgrade.pool) !== -1) return `${upgrade.pool} pool`;
		if (NEVER_BUY_UPGRADES.indexOf(upgrade.name) !== -1) return 'never-buy list';
		if (upgrade.isVaulted()) return 'vaulted';
		if (upgrade.priceLumps > 0) return 'costs sugar lumps';
		// Selectors open a menu instead of buying, and buy() still reports success.
		if (upgrade.choicesFunction) return 'selector';
		if (isPastGrandmaLimit(upgrade)) return 'grandmapocalypse limit';
		return '';
	}

	// True for the research upgrade that would open a stage beyond the player's limit.
	function isPastGrandmaLimit(upgrade) {
		return GRANDMA_STAGE_UPGRADES.indexOf(upgrade.name) + 1 > GRANDMA_LIMIT_STAGE[settings().grandmaLimit];
	}

	// The highest stage the research already bought lets the grandmas reach (Game.UpdateGrandmapocalypse).
	function openedGrandmaStage() {
		return GRANDMA_STAGE_UPGRADES.filter(function (name) { return Game.Has(name); }).length;
	}

	// The grandmas' mood in a word, from what the game shows.
	function grandmaMood() {
		if (Game.Has('Elder Covenant')) return 'Covenant';
		if (Game.pledgeT > 0) return 'Pledge';
		return GRANDMA_STAGE_NAMES[Game.elderWrath] || GRANDMA_STAGE_NAMES[0];
	}

	// Unbuffed CpS with the grandmapocalypse research owned up to each limit, worked out by the payback
	// simulator for the game as it is now. null while the simulator isn't ready.
	function grandmaLimitCps() {
		const sim = calc.sim;
		if (!sim || !calc.verified || calc.blocked) return null;
		const cps = {};
		try {
			for (const limit in GRANDMA_LIMIT_STAGE) {
				// Each stage's upgrade and the plain CpS research that follows it.
				const owned = Math.min(GRANDMA_RESEARCH.length, GRANDMA_LIMIT_STAGE[limit] * 2);
				resetSim(sim);
				GRANDMA_RESEARCH.forEach(function (name, i) {
					sim.shadow.Upgrades[name] = Object.create(Game.Upgrades[name], { bought: { value: i < owned ? 1 : 0 } });
				});
				cps[limit] = runSim(sim).cps;
			}
		} catch (e) {
			return null;
		}
		return cps.angered > 0 ? cps : null;
	}

	function grandmaLimitName(limit) {
		return GRANDMA_LIMITS[limit].replace(/ \(.*$/, '');
	}

	function grandmaLimitTip() {
		let text = 'Research is a chain: each upgrade starts the next, so holding one back holds back everything after it. ' +
			'Never start stops before One mind, Awoken before Communal brainsweep, Displeased before Elder Pact. ' +
			'Wrinklers appear from Awoken on, three times as fast at Angered as at Awoken, and wrath cookies replace a third, two thirds, then all of the golden cookies. ';
		const cps = grandmaLimitCps();
		if (cps) {
			text += 'On this save, next to letting research run to the end, your CpS would be: ' + Object.keys(GRANDMA_LIMITS).map(function (limit) {
				return `${grandmaLimitName(limit)} ${Math.round(cps[limit] / cps.angered * 100)}%`;
			}).join(', ') + '. ';
		} else {
			text += 'What each choice costs in CpS on this save is shown here once AFK Baker has its payback numbers (auto-buy or the store ratings must be on). ';
		}
		return text + 'If the grandmas are already past the stage you pick, AFK Baker buys nothing to undo it: the Dashboard lists your options.';
	}

	function isAllowedUpgrade(upgrade) {
		return !upgradeFilterReason(upgrade);
	}

	function isUsefulPP(pp) {
		// Infinite for a purchase with no income effect, <= 0 for a harmful one.
		return typeof pp === 'number' && Number.isFinite(pp) && pp > 0;
	}

	// Runs one of our own actions with the sounds matching `pattern` suppressed. PlaySound is a global the
	// game looks up on every call, so swapping it only for the length of this call leaves the player's
	// own purchases, golden cookies and every other sound alone.
	function withSoundsMuted(pattern, action) {
		if (!settings().muteBuySounds) return action();
		const originalPlaySound = window.PlaySound;
		window.PlaySound = function (url) {
			if (typeof url === 'string' && pattern.test(url)) return 0;
			return originalPlaySound.apply(this, arguments);
		};
		try {
			return action();
		} finally {
			window.PlaySound = originalPlaySound;
		}
	}

	function withPurchaseSoundMuted(purchase) {
		return withSoundsMuted(PURCHASE_SOUND, purchase);
	}

	// Anything of ours that changes buildings or CpS outside the PP buyer: the last purchase can no longer
	// be checked on its own, and the buyer carries on as soon as the payback data has caught up.
	function noteGameChanged() {
		calc.pendingCheck = null;
		state.buyAgain = true;
	}

	function tryBuyUpgrade(upgrade) {
		if (upgrade.bought || !canAfford(upgrade.getPrice()) || !upgrade.canBuy()) return false;
		// buy(1) skips confirmation prompts such as the one on "One mind".
		withPurchaseSoundMuted(function () { upgrade.buy(1); });
		const bought = !!upgrade.bought;
		if (bought) debugLog('Bought upgrade', upgrade.name);
		return bought;
	}

	function buyBuilding(name, amount) {
		const building = Game.Objects[name];
		const amountBefore = building.amount;
		// Object.buy() sells instead of buying while the store is in sell mode. Given an amount, it
		// ignores the store's bulk setting (Game.buyBulk), so only the mode has to be switched.
		const savedMode = Game.buyMode;
		Game.buyMode = 1;
		try {
			withPurchaseSoundMuted(function () { building.buy(amount); });
		} finally {
			Game.buyMode = savedMode;
		}
		// buy() redrew this building's store price for buy mode; redraw the store for the player's mode.
		if (savedMode !== 1) Game.storeToRefresh = 1;
		const bought = building.amount - amountBefore;
		if (bought > 0) debugLog(`Bought ${bought}x ${name}` + (bought < amount ? ` (wanted ${amount})` : ''));
		return bought > 0;
	}

	function buyElderPledgeItems() {
		// Feed mode wants the grandmapocalypse running so wrinklers can feed.
		if (settings().wrinklerMode === 'feed') return false;
		// A Halloween visit needs the wrinklers a pledge would send away.
		if (isCollectingHalloween()) return false;
		const pins = Game.Upgrades['Sacrificial rolling pins'];
		if (isInStore(pins) && tryBuyUpgrade(pins)) return true;
		// Pledging runs Game.CollectWrinklers, which pops every wrinkler including shinies.
		if (isShinyOnScreen()) return false;
		// elderWrath > 0 means the grandmapocalypse is active.
		const pledge = Game.Upgrades['Elder Pledge'];
		return Game.elderWrath > 0 && isInStore(pledge) && tryBuyUpgrade(pledge);
	}

	function buyResearch() {
		for (const upgrade of Game.UpgradesInStore) {
			if (upgrade.pool === 'tech' && isAllowedUpgrade(upgrade) && tryBuyUpgrade(upgrade)) return true;
		}
		return false;
	}

	function candidateKey(candidate) {
		return `${candidate.kind}:${candidate.name}:${candidate.amount}`;
	}

	function candidateLabel(candidate) {
		return candidate.kind === 'building' ? `${candidate.amount}x ${candidate.name}` : candidate.name;
	}

	// "you own no Idleverses" for an upgrade that boosts a building of which none is owned (the dragon's
	// training can sacrifice them all while their upgrades stay in the store), or ''.
	function unownedBuildingNote(upgrade) {
		const ties = [upgrade.buildingTie1, upgrade.buildingTie2, upgrade.buildingTie];
		for (const tie of ties) {
			const building = tie && Game.Objects[tie.name];
			if (building && building.amount === 0) return `you own no ${building.plural}`;
		}
		return '';
	}

	// Every building bundle and upgrade with a useful PP, best first. Upgrades that are never
	// auto-bought are left out here, before ranking, and listed in report.filtered for the debug dump.
	// An upgrade that doesn't change CpS has an infinite PP. While the autoclicker is on, the ones
	// that raise click income get a click PP instead; the rest go in report.infinite.
	function rankCandidates(report) {
		const candidates = [];
		for (const name in Game.Objects) {
			const building = Game.Objects[name];
			for (const amount of BUY_AMOUNTS) {
				const candidate = { kind: 'building', name: name, amount: amount };
				const outcome = calc.results.get(candidateKey(candidate));
				if (!outcome || !(outcome.gain > 0)) continue;
				candidate.price = building.getSumPrice(amount);
				candidate.pp = paybackPeriod(candidate.price, outcome.gain);
				if (isUsefulPP(candidate.pp)) candidates.push(candidate);
			}
		}
		const clickRate = effectiveClickRate();
		for (const upgrade of Game.UpgradesInStore) {
			// Research is handled separately by its own toggle.
			if (upgrade.pool === 'tech') continue;
			const reason = upgradeFilterReason(upgrade);
			if (reason) {
				report.filtered.push(`${upgrade.name} (${reason})`);
				continue;
			}
			const candidate = { kind: 'upgrade', name: upgrade.name, amount: 1, price: upgrade.getPrice() };
			const outcome = calc.results.get(candidateKey(candidate));
			if (!outcome || outcome.gain < 0) continue; // < 0: it lowers CpS
			let incomeGain = outcome.gain;
			if (!(incomeGain > 0)) {
				if (clickRate <= 0) {
					report.infinite.push(`${upgrade.name} (${unownedBuildingNote(upgrade) || 'autoclicker off'})`);
					continue;
				}
				// The upgrade's extra click income stands in for extra CpS.
				incomeGain = outcome.clickGain * clickRate;
				if (!(incomeGain > 0)) {
					report.infinite.push(`${upgrade.name} (${unownedBuildingNote(upgrade) || 'no click income gain'})`);
					continue;
				}
				candidate.tag = 'click';
			}
			candidate.pp = paybackPeriod(candidate.price, incomeGain);
			if (isUsefulPP(candidate.pp)) candidates.push(candidate);
		}
		candidates.sort(function (a, b) { return a.pp - b.pp; });
		return candidates;
	}

	// Why a candidate can't be bought right now however many cookies are banked, or ''.
	function unbuyableReason(candidate, now) {
		const skip = state.skipUntil[candidateKey(candidate)];
		if (skip && now < skip.until) return skip.reason;
		if (candidate.kind === 'upgrade') {
			const upgrade = Game.Upgrades[candidate.name];
			if (upgrade.canBuyFunc && !upgrade.canBuyFunc()) return 'the game does not allow buying it';
		}
		return '';
	}

	function skipCandidate(candidate, now, reason) {
		state.skipUntil[candidateKey(candidate)] = { until: now + SKIP_UNBUYABLE_MS, reason: reason };
	}

	// Object.buy() charges each building's rounded-up price, which can add up to a few cookies more
	// than getSumPrice(). Allow for that so a bundle is never cut short.
	function purchaseCost(candidate) {
		return candidate.price + candidate.amount - 1;
	}

	/* ----- Utility upgrades: no payback period, bought when cheap ----- */

	function isCpsPriced(upgrade) {
		return typeof upgrade.priceFunc === 'function' && CPS_PRICED.test(String(upgrade.priceFunc));
	}

	// The most a utility upgrade may cost, in minutes of unbuffed CpS.
	function utilityLimitMinutes(upgrade) {
		return isCpsPriced(upgrade) ? settings().utilityCpsMinutes : settings().utilityMinutes;
	}

	// What the utility rule makes of an upgrade in the store:
	//   null                      it isn't a utility upgrade (it has a payback period, or is never bought)
	//   { skip: 'why' }           it has no payback period, and the rule leaves it alone
	//   { price, limit, cheap }   it is bought once it is cheap: under limit minutes of unbuffed CpS
	function utilityStatus(upgrade) {
		const s = settings();
		if (!s.buyUtility || upgrade.pool === 'tech' || upgradeFilterReason(upgrade)) return null;
		const outcome = calc.results.get(candidateKey({ kind: 'upgrade', name: upgrade.name, amount: 1 }));
		if (!outcome || outcome.gain !== 0) return null;
		// A CpS upgrade for a building of which none is owned: it will have a payback period once there is one.
		if (unownedBuildingNote(upgrade)) return null;
		if (outcome.clickGain > 0) {
			// With the autoclicker on it has a click payback period and is ranked with everything else.
			return effectiveClickRate() > 0 ? null : { skip: 'it only raises click income, and the autoclicker is off' };
		}
		if (OFFLINE_UPGRADES.indexOf(upgrade.name) !== -1 && !Game.Has(OFFLINE_UNLOCK)) {
			return { skip: `it only adds income while the game is closed, and you don't own ${OFFLINE_UNLOCK}` };
		}
		// Auto-pet buys these two itself as soon as they are affordable.
		if (s.autoPetDragon && DRAGON_DROPS_WITHOUT_PP.indexOf(upgrade.name) !== -1) return { skip: '', byAutoPet: true };
		const price = upgrade.getPrice();
		const limit = utilityLimitMinutes(upgrade);
		const cps = calc.base ? calc.base.immediate : 0;
		// The tiny allowance is for prices that are exactly a number of minutes of CpS.
		return { price: price, limit: limit, cpsPriced: isCpsPriced(upgrade), cheap: price <= limit * 60 * cps * (1 + 1e-9) };
	}

	// The utility upgrade to buy in this pass, or null. At most one per pass, the cheapest first, and
	// never at the PP buyer's expense: only if the PP target stays affordable, or is still further away
	// than the upgrade's own limit (so it is delayed by less than it was going to take anyway).
	function nextUtilityPurchase(ppTarget, now) {
		if (!settings().buyUtility) return null;
		const spare = Game.cookies - reserveAmount();
		const cps = calc.base ? calc.base.immediate : 0;
		const targetCost = ppTarget ? purchaseCost(ppTarget) : 0;
		let best = null;
		for (const upgrade of Game.UpgradesInStore) {
			const status = utilityStatus(upgrade);
			if (!status || !status.cheap || status.price > spare) continue;
			const candidate = { kind: 'upgrade', name: upgrade.name, amount: 1, price: status.price, limit: status.limit };
			if (unbuyableReason(candidate, now)) continue;
			if (ppTarget) {
				const stillAffordable = spare - status.price >= targetCost;
				const waitSeconds = cps > 0 ? Math.max(targetCost - spare, 0) / cps : Infinity;
				if (!stillAffordable && !(waitSeconds > status.limit * 60)) continue;
			}
			if (!best || candidate.price < best.price) best = candidate;
		}
		return best;
	}

	function buyUtility(candidate, now) {
		predictPurchase([candidate], candidate.name);
		const bought = tryBuyUpgrade(Game.Upgrades[candidate.name]);
		if (!bought) {
			calc.pendingCheck = null;
			skipCandidate(candidate, now, 'buying it failed');
			return false;
		}
		state.lastBought = candidate.name;
		state.buyStatus = `Bought ${candidate.name} (no payback period; bought because it costs under ${candidate.limit} min of CpS).`;
		return true;
	}

	// Fast buying. Right after an ascension hundreds of items pay for themselves in a fraction of a
	// second, and which of them comes first hardly matters. So while the best item's payback period
	// is under FAST_PP_SECONDS, everything else under it that the bank can cover is bought in the same
	// tick: the largest such bundle of each building, and each such upgrade. Returns what to buy;
	// fewer than two items means the usual one-at-a-time buying.
	function fastBatch(candidates, now) {
		// After a prediction miss, buy one at a time, so that the checks can show which item it was. A
		// second batch that misses means buying together is itself the problem: no more batches this run.
		if (recentMisses() > 0 || calc.fastMisses >= FAST_MAX_MISSES) return [];
		let budget = Game.cookies - reserveAmount();
		const batch = [];
		const buildingsTaken = {};
		for (const candidate of candidates) {
			if (!(candidate.pp < FAST_PP_SECONDS) || batch.length >= FAST_BATCH_MAX) break;
			if (unbuyableReason(candidate, now)) continue;
			let pick = candidate;
			if (candidate.kind === 'building') {
				if (buildingsTaken[candidate.name]) continue;
				// The largest bundle of this building that also pays back that fast and is affordable.
				for (const other of candidates) {
					if (other.kind !== 'building' || other.name !== candidate.name || !(other.pp < FAST_PP_SECONDS)) continue;
					if (other.amount > pick.amount && purchaseCost(other) <= budget && !unbuyableReason(other, now)) pick = other;
				}
			}
			if (purchaseCost(pick) > budget) continue;
			if (pick.kind === 'building') buildingsTaken[pick.name] = true;
			budget -= purchaseCost(pick);
			batch.push(pick);
		}
		return batch;
	}

	// Buys a fast batch. The whole batch is simulated together first, and the game's CpS after it is
	// checked against that prediction, the same as for a single purchase.
	function buyFastBatch(batch, now) {
		const labels = batch.map(candidateLabel);
		const summary = `${batch.length} items (${labels.slice(0, 3).join(', ')}${batch.length > 3 ? ', ...' : ''})`;
		predictPurchase(batch, summary);
		let boughtCount = 0;
		let complete = true;
		for (const candidate of batch) {
			const amountBefore = candidate.kind === 'building' ? Game.Objects[candidate.name].amount : 0;
			const bought = candidate.kind === 'building' ?
				buyBuilding(candidate.name, candidate.amount) :
				tryBuyUpgrade(Game.Upgrades[candidate.name]);
			if (bought) boughtCount++;
			else skipCandidate(candidate, now, 'buying it failed');
			if (!bought || (candidate.kind === 'building' && Game.Objects[candidate.name].amount - amountBefore !== candidate.amount)) complete = false;
		}
		// Anything short of the whole batch isn't what was predicted, so there is nothing to check it against.
		if (!complete) calc.pendingCheck = null;
		if (!boughtCount) {
			state.buyStatus = `Couldn't buy ${summary}, skipping them for now.`;
			return false;
		}
		calc.fastBatches++;
		state.fastBuyingUntil = now + FAST_OVERLAY_REFRESH_MS * 2;
		state.buyStatus = `Fast buying: bought ${summary}. Each pays for itself in under ${FAST_PP_SECONDS} s.`;
		return true;
	}

	// Picks the lowest-PP candidate that can be bought and buys it, or saves up for it.
	function buyBestByPP(now) {
		const report = { filtered: [], infinite: [] };
		const candidates = rankCandidates(report);
		const skipped = new Map();
		let chosen = null;
		for (const candidate of candidates) {
			const reason = unbuyableReason(candidate, now);
			if (!reason) {
				chosen = candidate;
				break;
			}
			skipped.set(candidate, reason);
		}

		let outcome = '';
		let bought = false;
		if (!chosen) state.buyTarget = null;
		const utility = nextUtilityPurchase(chosen, now);
		const batch = chosen && !utility ? fastBatch(candidates, now) : [];
		if (utility && buyUtility(utility, now)) {
			// One utility upgrade, then the PP buyer carries on in the next pass with fresh numbers.
			dumpCandidates(candidates, null, '', skipped, report);
			return true;
		}
		if (batch.length > 1) {
			bought = buyFastBatch(batch, now);
			outcome = bought ? `bought in a fast batch of ${batch.length}` : 'fast batch failed';
			if (batch.indexOf(chosen) === -1) chosen = batch[0];
		} else if (!chosen) {
			state.buyStatus = candidates.length ?
				`Nothing buyable: ${skipped.size} item(s) skipped for now (turn on debug logging for details).` :
				'Nothing with a payback period to buy.';
		} else {
			const result = decideAndBuy(chosen, now);
			outcome = result.outcome;
			bought = result.bought;
		}
		dumpCandidates(candidates, chosen, outcome, skipped, report);
		return bought;
	}

	function decideAndBuy(candidate, now) {
		const label = candidateLabel(candidate);
		const reserve = reserveAmount();
		const cost = purchaseCost(candidate);
		const shortfall = cost + reserve - Game.cookies;
		state.buyTarget = shortfall > 0 ? { label: label, cost: cost } : null;
		if (shortfall > 0) {
			if (Game.cookies >= cost) {
				state.buyStatus = `Waiting on reserve: ${label} (${Beautify(candidate.price)}) is affordable, ` +
					`but the reserve (${Beautify(reserve)}) has to stay banked, need ${Beautify(shortfall)} more.`;
				return { outcome: 'waiting on reserve', bought: false };
			}
			const reservePart = reserve > 0 ? ` + reserve (${Beautify(reserve)})` : '';
			state.buyStatus = `Waiting on the item: saving for ${label} (${Beautify(candidate.price)})${reservePart}, ` +
				`need ${Beautify(shortfall)} more.`;
			return { outcome: 'waiting on the item', bought: false };
		}

		predictPurchase([candidate], label);
		const amountBefore = candidate.kind === 'building' ? Game.Objects[candidate.name].amount : 0;
		const bought = candidate.kind === 'building' ?
			buyBuilding(candidate.name, candidate.amount) :
			tryBuyUpgrade(Game.Upgrades[candidate.name]);
		// A bundle cut short isn't what was predicted, so there is nothing to check it against.
		const complete = candidate.kind !== 'building' || Game.Objects[candidate.name].amount - amountBefore === candidate.amount;
		if (!bought || !complete) calc.pendingCheck = null;
		if (!bought) {
			skipCandidate(candidate, now, 'buying it failed');
			state.buyStatus = `Couldn't buy ${label}, skipping it for now.`;
			return { outcome: 'buying it failed', bought: false };
		}
		state.lastBought = label;
		state.buyStatus = `Bought ${label} (${candidate.tag ? candidate.tag + ' ' : ''}PP ${ppText(candidate.pp)}).`;
		return { outcome: 'bought', bought: true };
	}

	// Debug only: the top candidates and what happened to each. Logged when the decisions change.
	function dumpCandidates(candidates, chosen, outcome, skipped, report) {
		if (!settings().debug) return;
		const shown = candidates.slice(0, DEBUG_TOP_CANDIDATES);
		if (chosen && shown.indexOf(chosen) === -1) shown.push(chosen);
		const rows = shown.map(function (candidate) {
			let decision = 'not reached, a better item was chosen';
			if (candidate === chosen) decision = `chosen: ${outcome}`;
			else if (skipped.has(candidate)) decision = `skipped: ${skipped.get(candidate)}`;
			return {
				name: candidate.name,
				tag: candidate.tag || '',
				amount: candidate.amount,
				pp: Number(candidate.pp.toPrecision(4)),
				price: Beautify(candidate.price),
				decision: decision,
			};
		});
		// Prices and PP change constantly, so only a change of items or decisions triggers a new dump.
		const signature = rows.map(function (row) { return `${row.name}|${row.amount}|${row.decision}`; }).join(';') +
			'#' + report.filtered.join(';') + '#' + report.infinite.join(';');
		if (signature === state.lastDumpSignature) return;
		state.lastDumpSignature = signature;
		console.log(`${LOG_PREFIX} Top auto-buy candidates:`);
		console.table(rows);
		if (report.filtered.length) console.log(LOG_PREFIX, 'Filtered out before ranking:', report.filtered.join(', '));
		if (report.infinite.length) console.log(LOG_PREFIX, 'Infinite PP, still skipped:', report.infinite.join(', '));
	}

	function runAutoBuy(now) {
		const s = settings();
		if (!s.autoBuy) {
			state.buyStatus = 'Off.';
			state.buyTarget = null;
			state.lastBought = '';
			// Turning auto-buy off and on again is how the player resumes after the purchase checks paused it.
			calc.paused = '';
			calc.recentChecks = [];
			forgetPurchaseChecks();
			// The store ratings use the same payback data, whether or not anything is bought with it.
			if (isOverlayOn()) refreshPayback(now);
			return;
		}
		refreshPayback(now);
		if (Game.recalculateGains) {
			// Something changed this tick. The game recalculates at the start of the next one; buying on
			// the old numbers would also leave the last purchase unchecked.
			if (!state.recalcWaitSince) state.recalcWaitSince = now;
			if (now - state.recalcWaitSince >= RECALC_WAIT_NOTICE_MS) state.buyStatus = 'Waiting for the game to recalculate its CpS.';
			return;
		}
		state.recalcWaitSince = 0;
		if (calc.paused) {
			state.buyStatus = `Paused: ${calc.paused}. Turn auto-buy off and on to resume.`;
			return;
		}
		// Right after a purchase, go again as soon as the payback data is ready. Otherwise check once a second.
		if (!(state.buyAgain && calc.ready) && now < state.nextBuyAt) return;
		state.buyAgain = false;
		state.nextBuyAt = now + BUY_INTERVAL_MS;

		if (now < state.buyResumeAt) {
			state.buyStatus = 'Waiting for the new run to settle.';
			return;
		}
		// While the game's file is still being read, the check isn't over yet.
		if (calc.blocked && calc.fileSource !== null) {
			state.buyStatus = `Paused: AFK Baker's CpS check failed: ${calc.blocked}. Another mod may be changing how CpS ` +
				'is calculated. It checks again every few seconds.';
			return;
		}
		if (!calc.ready) {
			state.buyStatus = 'Working out payback periods.';
			return;
		}

		const bought = (s.elderPledge && buyElderPledgeItems()) ||
			(s.buyResearch && buyResearch()) ||
			buyBestByPP(now);
		if (bought) state.buyAgain = true;
	}

	/* =====================================================================
	   SUGAR LUMPS
	   ===================================================================== */

	// Indexed by Game.lumpCurrentType.
	const LUMP_TYPES = ['normal', 'bifurcated', 'golden', 'meaty', 'caramelized'];

	function lumpCount(n) {
		return `${Beautify(n)} lump${n === 1 ? '' : 's'}`;
	}

	// The game hides sugar lumps during a Born again run, so they can't be harvested or spent by hand there.
	function isBornAgain() {
		return Game.ascensionMode === 1;
	}

	function lumpAge() {
		return Date.now() - Game.lumpT;
	}

	// The same test Game.clickLump uses: ripe from lumpRipeAge until the game drops it at lumpOverripeAge.
	function isLumpRipe() {
		const age = lumpAge();
		return age >= Game.lumpRipeAge && age < Game.lumpOverripeAge;
	}

	// Game.clickLump harvests every lump type; the type only changes how many lumps it yields.
	function harvestRipeLump() {
		if (!isLumpRipe()) return;
		const type = LUMP_TYPES[Game.lumpCurrentType] || 'unknown';
		const lumpsBefore = Game.lumps;
		Game.clickLump();
		const gained = Game.lumps - lumpsBefore;
		state.lastHarvest = `+${gained} from a ${type} lump`;
		debugLog(`Harvested a ${type} sugar lump: +${gained}.`);
	}

	// Object.levelUp charges level + 1 lumps to go from `level` to the next one.
	function levelCost(level) {
		return level + 1;
	}

	// The first entry whose building is below its target. Later entries wait until it's done.
	function nextLumpSpend() {
		for (const entry of settings().lumpPriority) {
			const building = Game.Objects[entry.building];
			if (building && building.level < entry.level) {
				return { building: building, target: entry.level, cost: levelCost(building.level) };
			}
		}
		return null;
	}

	// Each entry's status (done, next or waiting) and the lumps it still needs, levelling the list in
	// order. A building listed more than once (Farm to 1, later Farm to 9) has each level counted once.
	function lumpPlan() {
		const levels = {};
		let nextFound = false;
		return settings().lumpPriority.map(function (entry) {
			const building = Game.Objects[entry.building];
			let level = hasKey(levels, entry.building) ? levels[entry.building] : building.level;
			let cost = 0;
			for (; level < entry.level; level++) cost += levelCost(level);
			levels[entry.building] = level;
			let status = 'done';
			if (building.level < entry.level) {
				status = nextFound ? 'waiting' : 'next';
				nextFound = true;
			}
			return { entry: entry, building: building, cost: cost, status: status };
		});
	}

	function lumpsToFinishList() {
		return lumpPlan().reduce(function (total, item) { return total + item.cost; }, 0);
	}

	// Object.levelUp spends through Game.spendLump, which opens a Yes/No prompt instead of spending
	// while the game's "Lump confirmation" option is on. Switch it off for our own call only.
	function levelUpBuilding(building) {
		const levelBefore = building.level;
		const savedAskLumps = Game.prefs.askLumps;
		Game.prefs.askLumps = 0;
		try {
			withPurchaseSoundMuted(function () { building.levelUp(); });
		} finally {
			Game.prefs.askLumps = savedAskLumps;
		}
		const levelled = building.level > levelBefore;
		// A level raises the building's CpS.
		if (levelled) noteGameChanged();
		return levelled;
	}

	// Building levels are the only thing lumps are ever spent on. A building that isn't owned yet is
	// levelled too, since levels carry over through ascensions.
	function spendLumps() {
		const next = nextLumpSpend();
		if (!next || Game.lumps - next.cost < settings().keepLumps) return;
		if (!levelUpBuilding(next.building)) return;
		state.lastLevelUp = `Leveled ${next.building.name} to ${next.building.level}` +
			(next.building.amount === 0 ? ' (none owned yet)' : '');
		debugLog(state.lastLevelUp);
	}

	function runLumps(now) {
		if (now < state.nextLumpCheckAt) return;
		state.nextLumpCheckAt = now + LUMP_CHECK_INTERVAL_MS;
		// canLumps is false until the save has baked a billion cookies in total.
		if (!Game.canLumps() || isBornAgain()) return;
		const s = settings();
		if (s.autoHarvestLumps) harvestRipeLump();
		if (s.autoSpendLumps) spendLumps();
	}

	/* =====================================================================
	   KRUMBLOR (DRAGON)
	   The dragon's level, its auras and its drops all reset on every ascension (Game.Reset), so
	   everything here starts over each run.
	   ===================================================================== */

	function hasDragonEgg() {
		return !!Game.Has('A crumbly egg');
	}

	function dragonMaxLevel() {
		return Game.dragonLevels.length - 1;
	}

	// What the next training step asks for, mirroring Game.dragonLevels in main.js: levels 0 to 4 cost
	// cookies (1 million, doubling each level), the next ones 100 of one building each in store order,
	// and the last two 50 and then 200 of every building. Game.UpgradeDragon still runs the game's own
	// check before anything is spent, so a mismatch here can only make the mod wait.
	function dragonStep() {
		const level = Game.dragonLevel;
		const max = dragonMaxLevel();
		if (level >= max) return null;
		if (level <= 4) return { cookies: 1000000 * Math.pow(2, level), buildings: [], everyBuilding: 0 };
		if (level <= max - 3) {
			return { cookies: 0, buildings: [{ building: Game.ObjectsById[level - 5], amount: 100 }], everyBuilding: 0 };
		}
		const amount = level === max - 2 ? 50 : 200;
		const buildings = Object.keys(Game.Objects).map(function (name) {
			return { building: Game.Objects[name], amount: amount };
		});
		return { cookies: 0, buildings: buildings, everyBuilding: amount };
	}

	// The price of taking a building from `from` owned to `to` owned. Game.Object.getSumPrice does the
	// same sum, but only starting from the current amount.
	function buildingRangePrice(building, from, to) {
		let sum = 0;
		for (let i = Math.max(0, from); i < Math.max(0, to); i++) {
			sum += building.basePrice * Math.pow(Game.priceIncrease, Math.max(0, i - building.free));
		}
		return Math.ceil(Game.modifyBuildingPrice(building, sum));
	}

	// What a sacrifice step costs in cookies: buying the buildings still missing, then buying back
	// everything that was sacrificed. A sacrifice refunds nothing.
	function sacrificePlan(step) {
		const plan = { missing: [], missingCost: 0, rebuyCost: 0, total: 0 };
		for (const need of step.buildings) {
			const owned = need.building.amount;
			const short = Math.max(0, need.amount - owned);
			if (short > 0) {
				const cost = buildingRangePrice(need.building, owned, owned + short);
				plan.missing.push({ building: need.building, amount: short, cost: cost });
				plan.missingCost += cost;
			}
			const left = owned + short - need.amount;
			plan.rebuyCost += buildingRangePrice(need.building, left, left + need.amount);
		}
		plan.total = plan.missingCost + plan.rebuyCost;
		return plan;
	}

	// Unbuffed, so a Frenzy doesn't trigger a sacrifice that is then rebuilt at normal speed.
	function isCheapSacrifice(plan) {
		return plan.total < settings().dragonTrainMinutes * 60 * Game.unbuffedCps;
	}

	// 'dragon', 'santa', or '' for closed. ToggleSpecialMenu(0) only closes while a tab is selected.
	function showSpecialPanel(tab) {
		if (tab) {
			Game.specialTab = tab;
			Game.ToggleSpecialMenu(1);
		} else {
			if (!Game.specialTab) Game.specialTab = 'dragon';
			Game.ToggleSpecialMenu(0);
		}
	}

	// Game.UpgradeDragon ends with Game.ToggleSpecialMenu(1), which shows the special panel even if it
	// was closed. Afterwards, put back whatever the player had open: the dragon, Santa, or nothing.
	function withSpecialPanelRestored(action) {
		const tab = Game.specialTab;
		try {
			return action();
		} finally {
			showSpecialPanel(tab);
		}
	}

	function upgradeDragon() {
		const levelBefore = Game.dragonLevel;
		withSpecialPanelRestored(function () {
			withSoundsMuted(DRAGON_SOUND, function () { Game.UpgradeDragon(); });
		});
		if (Game.dragonLevel <= levelBefore) return false;
		state.lastDragonAction = `Trained the dragon to level ${Game.dragonLevel}`;
		debugLog(state.lastDragonAction);
		return true;
	}

	function buyDragonEgg() {
		const egg = Game.Upgrades['A crumbly egg'];
		return isInStore(egg) && isAllowedUpgrade(egg) && tryBuyUpgrade(egg);
	}

	// One training action per call: the egg, a cookie step, missing buildings for a cheap sacrifice,
	// or the sacrifice itself. Returns true if anything was bought or sacrificed.
	function trainDragon() {
		if (!hasDragonEgg()) return buyDragonEgg();
		const step = dragonStep();
		if (!step) return false;
		if (step.cookies > 0) return canAfford(step.cookies) && upgradeDragon();

		const plan = sacrificePlan(step);
		if (!isCheapSacrifice(plan)) return false;
		if (plan.missing.length) {
			const short = plan.missing[0];
			// The same rounding allowance as purchaseCost: buy() charges each building's rounded-up price.
			return canAfford(short.cost + short.amount - 1) && buyBuilding(short.building.name, short.amount);
		}
		return upgradeDragon();
	}

	function auraId(name) {
		return isAuraName(name) ? Game.dragonAurasBN[name].id : 0;
	}

	// Game.SelectDragonAura offers aura number n once the dragon is level n + 4.
	function auraUnlockLevel(id) {
		return id + 4;
	}

	// The second slot comes with the last training step (a fully trained dragon).
	function hasSecondAuraSlot() {
		return Game.dragonLevel >= dragonMaxLevel();
	}

	// The game has no function for setting an aura. Its picker, Game.SelectDragonAura in main.js, is a
	// prompt whose Confirm button runs this as inline code:
	//     Game.dragonAura (or Game.dragonAura2) = the picked aura;
	//     sacrifice 1 of the highest-tier building owned, unless none are owned or the aura is unchanged;
	//     Game.ToggleSpecialMenu(1); Game.ClosePrompt();
	// This does the same without the prompt. If a game update changes that button, change this to match.
	function setDragonAura(slot, id) {
		const current = slot === 0 ? Game.dragonAura : Game.dragonAura2;
		if (current === id) return;
		let highestBuilding = null;
		for (const name in Game.Objects) {
			if (Game.Objects[name].amount > 0) highestBuilding = Game.Objects[name];
		}
		if (slot === 0) Game.dragonAura = id;
		else Game.dragonAura2 = id;
		if (highestBuilding) highestBuilding.sacrifice(1);
		// The button redraws the dragon panel it was opened from; only do that if the panel is showing.
		if (Game.specialTab === 'dragon') Game.ToggleSpecialMenu(1);
		Game.recalculateGains = 1;
		state.lastDragonAction = `Set aura ${Game.dragonAuras[id].name}` +
			(highestBuilding ? ` (cost 1 ${highestBuilding.name})` : ' (free, no buildings owned)');
		debugLog(state.lastDragonAction);
	}

	// The picked auras that can be set right now: unlocked, and the secondary only with two slots.
	function wantedAuras() {
		const s = settings();
		const picks = [auraId(s.dragonAura1), hasSecondAuraSlot() ? auraId(s.dragonAura2) : 0];
		return picks.map(function (id) { return id > 0 && Game.dragonLevel >= auraUnlockLevel(id) ? id : 0; });
	}

	// Slot order makes no difference in the game (Game.hasAura and Game.auraMult check both slots), so a
	// pick only has to be present in either slot. It's never moved from one slot to the other, and an
	// aura is only changed when a pick is missing. Returns true if an aura was changed.
	function applyDragonAuras() {
		if (!hasDragonEgg()) return false;
		const wanted = wantedAuras();
		const current = [Game.dragonAura, hasSecondAuraSlot() ? Game.dragonAura2 : -1];
		for (let slot = 0; slot < wanted.length; slot++) {
			const id = wanted[slot];
			if (!id || current.indexOf(id) !== -1) continue;
			// Its own slot, unless that one already holds the other pick.
			const other = 1 - slot;
			const target = current[slot] === wanted[other] && wanted[other] ? other : slot;
			if (target === 1 && !hasSecondAuraSlot()) continue;
			setDragonAura(target, id);
			return true;
		}
		return false;
	}

	function isDropFound(name) {
		return !!(Game.Has(name) || Game.HasUnlocked(name));
	}

	// Game.ClickSpecialPic only drops something for a hatched dragon at level 8 or more, with the
	// heavenly upgrade "Pet the dragon".
	function canPetForDrops() {
		return hasDragonEgg() && !!Game.Has('Pet the dragon') && Game.dragonLevel >= 8;
	}

	function dropsFound() {
		return DRAGON_DROPS.filter(isDropFound);
	}

	// The quarter of the hour the clock is in. The game gives a different drop in each quarter; which
	// one is decided by the run's seed, which the mod doesn't read. It simply tries every quarter.
	function petWindowKey(date) {
		return `${date.getHours()}:${Math.floor(date.getMinutes() / 15)}`;
	}

	// Each pet throws a heart from the mouse pointer (when the game's particles option is on). Auto-pet
	// leaves that out, since the pointer can be anywhere; with hearts, the pointer is placed over the
	// dragon for the length of the pet, so the heart rises from Krumblor as when the player pets him.
	function petDragon(hearts) {
		const pic = hearts && Game.prefs.particles ? l('specialPic') : null;
		const savedParticles = Game.prefs.particles;
		const savedX = Game.mouseX;
		const savedY = Game.mouseY;
		if (pic) {
			// The game's own mouse coordinates: page position, less the top bar, at the game's scale.
			const box = pic.getBoundingClientRect();
			Game.mouseX = (box.left + box.width / 2) / Game.scale;
			Game.mouseY = (box.top + box.height / 2 - TopBarOffset) / Game.scale;
		} else {
			Game.prefs.particles = 0;
		}
		try {
			withSoundsMuted(DRAGON_SOUND, function () { Game.ClickSpecialPic(); });
		} finally {
			Game.prefs.particles = savedParticles;
			Game.mouseX = savedX;
			Game.mouseY = savedY;
		}
	}

	function endPetSession() {
		const session = state.petSession;
		if (!session) return;
		state.petSession = null;
		if (session.restoreTab !== Game.specialTab) showSpecialPanel(session.restoreTab);
	}

	// Petting only works with the dragon panel open (Game.ClickSpecialPic checks for it), so the panel
	// is opened while the mod pets, then the panel the player had open before is put back. It pets in
	// each quarter-hour until a drop appears or enough pets have passed without one, then waits for the
	// next quarter, and stops for good once all four drops are found.
	function runAutoPet(now) {
		// Sunder pets nonstop; regular auto-pet stands aside meanwhile.
		if (settings().sunder) {
			endPetSession();
			return;
		}
		if (now < state.nextPetAt) return;
		state.nextPetAt = now + PET_INTERVAL_MS;
		const key = petWindowKey(new Date(now));
		if (!settings().autoPetDragon || !canPetForDrops() || dropsFound().length === DRAGON_DROPS.length || state.petDoneWindow === key) {
			endPetSession();
			return;
		}
		if (askAddOn('petWindow', { key: key }) === false) {
			endPetSession();
			return;
		}

		let session = state.petSession;
		if (!session) {
			session = state.petSession = { restoreTab: Game.specialTab, windowKey: key, pets: 0 };
		} else if (Game.specialTab !== 'dragon') {
			// The player switched panels during the session; that's the one to put back.
			session.restoreTab = Game.specialTab;
		}
		if (session.windowKey !== key) {
			session.windowKey = key;
			session.pets = 0;
		}
		if (Game.specialTab !== 'dragon' || !document.getElementById('specialPic')) showSpecialPanel('dragon');
		const foundBefore = dropsFound();
		petDragon();
		session.pets++;
		const dropped = dropsFound().filter(function (name) { return foundBefore.indexOf(name) === -1; })[0];
		if (dropped) {
			state.lastDragonAction = `The dragon dropped ${dropped}`;
			debugLog(state.lastDragonAction);
		}
		// A quarter-hour only ever gives one particular drop, so it's done once that drop has appeared.
		if (dropped || session.pets >= MAX_PETS_PER_WINDOW) state.petDoneWindow = key;
	}

	// Dragon scale and Dragon claw have a PP and are left to the PP buyer.
	function buyDragonDrops() {
		for (const name of DRAGON_DROPS_WITHOUT_PP) {
			const upgrade = Game.Upgrades[name];
			if (isInStore(upgrade) && isAllowedUpgrade(upgrade) && tryBuyUpgrade(upgrade)) return true;
		}
		return false;
	}

	function runDragon(now) {
		runSunder(now);
		runAutoPet(now);
		if (now < state.nextDragonCheckAt) return;
		state.nextDragonCheckAt = now + DRAGON_CHECK_INTERVAL_MS;
		if (now < state.buyResumeAt) return;
		const s = settings();
		const changed = (s.autoTrainDragon && trainDragon()) ||
			applyDragonAuras() ||
			(s.autoPetDragon && buyDragonDrops());
		if (changed) noteGameChanged();
	}

	/* =====================================================================
	   STOCK MARKET (the Bank minigame, minigameMarket.js)
	   Holdings, brokers, the office and the profit counter are all wiped on every ascension (M.reset),
	   so everything here starts over each run. Prices are in $: $1 is one second of the highest raw CpS
	   this ascension. Buying costs the price plus an overhead; selling has no fee.
	   ===================================================================== */

	// The minigame once the Bank has a level and its script has loaded. The game doesn't run minigames
	// in a Born again run.
	function market() {
		const bank = Game.Objects['Bank'];
		return bank && Game.isMinigameReady(bank) && !isBornAgain() ? bank.minigame : null;
	}

	// The fee on purchases, as in M.buyGood: 20%, cut by 5% for each broker.
	function marketOverhead(brokers) {
		return 0.01 * (20 * Math.pow(0.95, brokers));
	}

	// What the shares held of a stock cost, fees included. The game only remembers the last purchase
	// price (good.prev), so the mod keeps its own record and squares it with the real stock on every
	// look: shares it has no record of count as bought at that last price with today's fee.
	function costBasis(M, good) {
		const all = settings().marketBasis;
		const key = good.building.name;
		if (good.stock <= 0) {
			delete all[key];
			return { shares: 0, cost: 0 };
		}
		const basis = all[key] || (all[key] = { shares: 0, cost: 0 });
		if (good.stock < basis.shares) {
			basis.cost *= good.stock / basis.shares;
		} else if (good.stock > basis.shares) {
			const price = good.prev > 0 ? good.prev : good.val;
			basis.cost += (good.stock - basis.shares) * price * (1 + marketOverhead(M.brokers));
		}
		basis.shares = good.stock;
		return basis;
	}

	// In $. The market may hold up to its share of the bank above the cookie reserve plus what it has
	// already invested; `free` is what it may still spend right now.
	function marketBudget(M) {
		const rate = Game.cookiesPsRawHighest;
		let invested = 0;
		for (const good of M.goodsById) invested += costBasis(M, good).cost;
		if (!(rate > 0)) return { invested: invested, allowed: 0, free: 0 };
		const bank = Math.max(0, Game.cookies - reserveAmount()) / rate;
		const allowed = settings().marketBankPercent / 100 * (bank + invested);
		return { invested: invested, allowed: allowed, free: Math.max(0, Math.min(allowed - invested, bank)) };
	}

	function dollars(amount) {
		const size = Math.abs(amount);
		return (amount < 0 ? '-$' : '$') + (size < 1000 ? size.toFixed(2) : Beautify(Math.round(size)));
	}

	// `reason` names the rule behind the trade, for the status line.
	function sellStock(M, good, reason) {
		const shares = good.stock;
		const price = M.getGoodPrice(good);
		const basis = costBasis(M, good);
		const paid = basis.cost / basis.shares;
		if (!countMarket(function () { return withSoundsMuted(MARKET_SOUND, function () { return M.sellGood(good.id, shares); }); })) return false;
		costBasis(M, good);
		state.lastTrade = `Sold ${shares} ${good.symbol} at ${dollars(price)} (resting ${dollars(M.getRestingVal(good.id))}, paid ${dollars(paid)} with fees${reason ? '; ' + reason : ''})`;
		debugLog(state.lastTrade);
		return true;
	}

	function buyStock(M, good, shares, reason) {
		const before = good.stock;
		const price = M.getGoodPrice(good);
		costBasis(M, good);
		// 10000 is M.buyGood's code for "as many as the bank allows".
		const amount = shares === 10000 ? 9999 : shares;
		if (!countMarket(function () { return withSoundsMuted(MARKET_SOUND, function () { return M.buyGood(good.id, amount); }); })) return false;
		// M.buyGood has set good.prev to this price, so this records the new shares at what they cost.
		costBasis(M, good);
		state.lastTrade = `Bought ${good.stock - before} ${good.symbol} at ${dollars(price)} (resting ${dollars(M.getRestingVal(good.id))}${reason ? '; ' + reason : ''})`;
		debugLog(state.lastTrade);
		return true;
	}

	/* Trading only uses what a player can see: each stock's price, the resting value (a public formula,
	   shown in the guide), the bank ceiling, warehouse space and the trade lock the game explains in its
	   tooltip. It never reads the hidden market state the game uses
	   to move prices (good.mode, good.dur, good.d); that would be cheating. */

	// Mirrors M.tick: above 100 + 3 per Bank level past 1 (the guide's $97 + $3 per level), a rising
	// stock loses momentum.
	function bankCeiling() {
		return 100 + (Game.Objects['Bank'].level - 1) * 3;
	}

	function usesGuideRules() {
		return settings().marketStrategy === 'restingGuide';
	}

	// Whether the strategy would buy or sell this stock at today's price, and why: { action, reason }.
	function tradeSignal(M, good) {
		const signal = ownTradeSignal(M, good);
		const picked = askAddOn('stockSignal', { M: M, good: good, signal: signal });
		if (!picked || ['buy', 'sell', ''].indexOf(picked.action) === -1) return signal;
		return { action: picked.action, reason: String(picked.reason || 'add-on') };
	}

	function ownTradeSignal(M, good) {
		const s = settings();
		const price = M.getGoodPrice(good);
		if (usesGuideRules() && price < 5) return { action: 'buy', reason: 'under $5' };
		if (usesGuideRules() && price > bankCeiling()) return { action: 'sell', reason: `past the $${bankCeiling()} bank ceiling` };
		const rest = M.getRestingVal(good.id);
		if (price <= s.marketBuyPercent / 100 * rest) return { action: 'buy', reason: `${s.marketBuyPercent}% of resting or less` };
		if (price >= s.marketSellPercent / 100 * rest) return { action: 'sell', reason: `${s.marketSellPercent}% of resting or more` };
		return { action: '', reason: '' };
	}

	// The price the strategy buys this stock at, for sizing a warehouse fill.
	function buyPrice(M, good) {
		return settings().marketBuyPercent / 100 * M.getRestingVal(good.id);
	}

	// A stock can't be sold in the tick it was bought (good.last 1), or bought in the tick it was sold (2).
	function tradeStocks(M) {
		const s = settings();
		for (const good of M.goodsById) {
			if (!good.active || good.stock <= 0 || good.last === 1) continue;
			const signal = tradeSignal(M, good);
			if (signal.action !== 'sell') continue;
			const basis = costBasis(M, good);
			if (!s.marketSellAtLoss && M.getGoodPrice(good) <= basis.cost / basis.shares) continue;
			sellStock(M, good, signal.reason);
		}

		if (state.ascendPending) return;
		const priceRatio = function (good) { return M.getGoodPrice(good) / M.getRestingVal(good.id); };
		const cheap = M.goodsById.filter(function (good) {
			return good.active && good.last !== 2 && good.stock < M.getGoodMaxStock(good) && tradeSignal(M, good).action === 'buy';
		}).sort(function (a, b) { return priceRatio(a) - priceRatio(b); });
		for (const good of cheap) {
			const perShare = M.getGoodPrice(good) * (1 + marketOverhead(M.brokers));
			const shares = Math.min(M.getGoodMaxStock(good) - good.stock, Math.floor(marketBudget(M).free / perShare));
			if (shares >= 1) buyStock(M, good, shares, tradeSignal(M, good).reason);
		}
	}

	// Sells every stock that can be sold, at whatever it fetches; used right before auto-ascending,
	// when the stock would be wiped anyway. Returns true while stock bought this tick is still held.
	function sellAllStock(M) {
		let remaining = false;
		for (const good of M.goodsById) {
			if (good.stock <= 0) continue;
			if (good.last === 1 || !sellStock(M, good, 'selling everything before ascending')) remaining = true;
		}
		return remaining;
	}

	function holdingsValue(M) {
		let shares = 0;
		let stocks = 0;
		let value = 0;
		for (const good of M.goodsById) {
			if (good.stock <= 0) continue;
			shares += good.stock;
			stocks++;
			value += good.stock * M.getGoodPrice(good);
		}
		return { shares: shares, stocks: stocks, value: value };
	}

	// The game has no function for hiring a broker or upgrading the office: both are click handlers on
	// the Bank minigame's own buttons (bankBrokersBuy and bankOfficeUpgrade in minigameMarket.js). The
	// buttons exist while the panel is closed, so this runs the game's handler as it is. The click
	// doesn't bubble, so nothing else in the game sees it, and the sparkle the handler would draw on
	// the (possibly hidden) button is left out.
	function clickMarketButton(id) {
		const button = document.getElementById(id);
		if (!button) return;
		const savedSparkle = Game.SparkleOn;
		Game.SparkleOn = function () {};
		try {
			withSoundsMuted(MARKET_SOUND, function () {
				button.dispatchEvent(new MouseEvent('click', { bubbles: false }));
			});
		} finally {
			Game.SparkleOn = savedSparkle;
		}
	}

	// One full fill of the warehouses at the buy threshold, in $: what a round of buying is worth.
	function warehouseFillValue(M) {
		let total = 0;
		for (const good of M.goodsById) {
			if (good.active) total += M.getGoodMaxStock(good) * buyPrice(M, good);
		}
		return total;
	}

	// The next broker lowers the fee on everything bought afterwards. It's hired when that saving on
	// one warehouse fill covers its price.
	function brokerPlan(M) {
		const rate = Game.cookiesPsRawHighest;
		const saving = marketOverhead(M.brokers) - marketOverhead(M.brokers + 1);
		const price = rate > 0 ? M.getBrokerPrice() / rate : Infinity;
		return { fill: warehouseFillValue(M), needed: price / saving, full: M.brokers >= M.getMaxBrokers() };
	}

	function hireBroker(M) {
		const plan = brokerPlan(M);
		if (plan.full || plan.fill < plan.needed || !canAfford(M.getBrokerPrice())) return false;
		const before = M.brokers;
		clickMarketButton('bankBrokersBuy');
		if (M.brokers <= before) return false;
		state.lastMarketAction = `Hired broker ${M.brokers}`;
		debugLog(state.lastMarketAction);
		return true;
	}

	// The next office upgrade: the Cursors it sacrifices (no refund), the Cursor level it requires
	// (a requirement only, no lumps are spent) and what buying those Cursors back would cost.
	function officePlan(M) {
		const office = M.offices[M.officeLevel];
		if (!office || !office.cost) return null;
		const cursors = Game.Objects['Cursor'];
		return {
			cursors: office.cost[0],
			level: office.cost[1],
			hasCursors: cursors.amount >= office.cost[0],
			hasLevel: cursors.level >= office.cost[1],
			rebuyCost: buildingRangePrice(cursors, cursors.amount - office.cost[0], cursors.amount),
		};
	}

	function isCheapOffice(plan) {
		return plan.rebuyCost < settings().officeMinutes * 60 * Game.unbuffedCps;
	}

	function upgradeOffice(M) {
		const plan = officePlan(M);
		if (!plan || !plan.hasCursors || !plan.hasLevel || !isCheapOffice(plan)) return false;
		const before = M.officeLevel;
		clickMarketButton('bankOfficeUpgrade');
		if (M.officeLevel <= before) return false;
		state.lastMarketAction = `Upgraded the office to level ${M.officeLevel + 1} (sacrificed ${plan.cursors} Cursors)`;
		debugLog(state.lastMarketAction);
		return true;
	}

	function runMarket(now) {
		if (now < state.nextMarketCheckAt) return;
		state.nextMarketCheckAt = now + MARKET_CHECK_INTERVAL_MS;
		const M = market();
		const s = settings();
		if (!M || !s.autoTrade || now < state.buyResumeAt) return;
		tradeStocks(M);
		if (state.ascendPending) return;
		if (s.autoBrokers) hireBroker(M);
		// The sacrificed Cursors change CpS, so the PP buyer waits for fresh data.
		if (s.autoOffice && upgradeOffice(M)) noteGameChanged();
	}

	/* =====================================================================
	   GRIMOIRE (the Wizard tower minigame, minigameGrimoire.js)
	   Casting only uses what a player can see: the magic meter, the spell's cost, the backfire chance
	   its tooltip shows, golden cookies on screen and active buffs. Spell outcomes are fixed in advance
	   by the run's seed and the lifetime spell count (M.castSpell seeds the random numbers with them);
	   the mod never reads either, never simulates a cast, and never reads a summoned cookie's hidden
	   effect. A result is only reported once the game has shown it.
	   ===================================================================== */

	// The minigame once the Wizard tower has a level and its script has loaded. The game doesn't run
	// minigames in a Born again run.
	function grimoire() {
		const tower = Game.Objects['Wizard tower'];
		return tower && Game.isMinigameReady(tower) && !isBornAgain() ? tower.minigame : null;
	}

	// Why the backfire chance is above its normal value right now, or '' if it isn't. Each golden or
	// wrath cookie on screen adds to Force the Hand of Fate's chance (the spell's own failFunc), and the
	// Magic inept buff multiplies every spell's chance by 5.
	function raisedBackfireReason(spell) {
		if (Game.hasBuff('Magic inept')) return 'the Magic inept buff raises the backfire chance';
		if (spell.failFunc && spell.failFunc(0) > 0) return 'a golden cookie on screen raises the backfire chance';
		return '';
	}

	// Why the spell isn't being cast right now, or '' if it can be. Magic regenerates faster the fuller
	// the meter is and stops at full, so casting from a full meter gives the most casts.
	function castHoldReason(M, spell, byAddOn) {
		const cost = M.getSpellCost(spell);
		if (cost > M.magicM) return `max magic is too low for this spell (it costs ${Beautify(cost)})`;
		if (spell === M.spells['hand of fate'] && !settings().clickGolden) return 'golden cookie clicking is off, so the summoned cookie would go to waste';
		if (M.magic < M.magicM) return 'waiting for full magic';
		// An add-on that picks the spell has made its own plan for when.
		if (spell === M.spells['hand of fate'] && !byAddOn) {
			const timing = castTimingReason();
			if (timing) return timing;
		}
		return raisedBackfireReason(spell);
	}

	// The player's timing for Force the Hand of Fate: what it is waiting for at full magic, or ''. What
	// the spell gives (a Frenzy, a Click frenzy, a building special) stacks on a buff already running,
	// so a cast during one is worth more. Only the buffs on screen are looked at.
	function castTimingReason() {
		const timing = settings().grimoireTiming;
		if (timing === 'full') return '';
		let cps = false;
		let click = false;
		for (const name in Game.buffs) {
			// Devastation comes from Godzamok combos, every ten seconds; it is not what to wait for.
			if (name === 'Devastation') continue;
			const buff = Game.buffs[name];
			if (typeof buff.multClick === 'number' && buff.multClick > 1) click = true;
			if (typeof buff.multCpS === 'number' && buff.multCpS > 1) cps = true;
		}
		if (click || (timing === 'buff' && cps)) return '';
		return timing === 'buff' ? 'waiting for a Frenzy, a building special or a click buff' : 'waiting for a click buff (Click frenzy or Dragonflight)';
	}

	// Seconds until the meter is full. Mirrors M.logic: each frame adds 0.002 x sqrt(magic / max), with
	// the max counted as at least 100.
	function secondsToFullMagic(M) {
		if (M.magic >= M.magicM) return 0;
		const scale = Math.sqrt(Math.max(M.magicM, 100));
		return 2 * scale * (Math.sqrt(M.magicM) - Math.sqrt(Math.max(0, M.magic))) / (0.002 * Game.fps);
	}

	// The spell to cast once the meter is full: the player's setting, unless an add-on picks another one
	// or, with '', none for now.
	function spellChoice(M) {
		const setting = settings().grimoireSpell;
		const picked = askAddOn('grimoireSpell', { M: M, spell: setting });
		if (picked === undefined) return { spell: M.spells[setting], byAddOn: false };
		return { spell: hasKey(M.spells, picked) ? M.spells[picked] : null, byAddOn: true };
	}

	function castSpell(M, spell) {
		const name = spell.name;
		const cookiesBefore = Game.cookies;
		const shimmersBefore = Game.shimmers.slice();
		// The spell button may be hidden (panel closed); skip the sparkle the game would draw on it.
		const savedSparkle = Game.SparkleAt;
		if (!M.parent.onMinigame) Game.SparkleAt = function () {};
		// The game announces a backfire: M.castSpell plays spellFail.mp3 for one and spell.mp3 for a
		// success. Listen for which, and mute both under the mute setting.
		let backfired = false;
		const originalPlaySound = window.PlaySound;
		window.PlaySound = function (url) {
			if (url === 'snd/spellFail.mp3') backfired = true;
			if (settings().muteBuySounds && typeof url === 'string' && SPELL_SOUND.test(url)) return 0;
			return originalPlaySound.apply(this, arguments);
		};
		let cast;
		try {
			cast = countIncome('grimoire', function () { return M.castSpell(spell); });
		} finally {
			window.PlaySound = originalPlaySound;
			Game.SparkleAt = savedSparkle;
		}
		if (!cast) return false;

		if (spell === M.spells['hand of fate']) {
			// The cookie the spell just summoned. What it will do stays unknown until it's clicked.
			const summoned = Game.shimmers.filter(function (shimmer) { return shimmersBefore.indexOf(shimmer) === -1; })[0];
			if (backfired) {
				if (summoned) state.backfiredCookies.add(summoned);
				state.spellCookie = null;
				state.lastCast = `Cast ${name}: backfired (wrath cookie left alone)`;
			} else {
				state.spellCookie = summoned || null;
				state.lastCast = `Cast ${name}: golden cookie summoned`;
			}
		} else if (spell === M.spells['conjure baked goods']) {
			// Conjure Baked Goods adds cookies on a success, and takes some and starts a Clot on a backfire.
			const change = Game.cookies - cookiesBefore;
			state.lastCast = backfired ?
				`Cast ${name}: backfired (Clot, lost ${Beautify(Math.max(0, -change))} cookies)` :
				`Cast ${name}: +${Beautify(Math.max(0, change))} cookies`;
		} else {
			// Any other spell is one an add-on picked.
			state.lastCast = `Cast ${name}: ${backfired ? 'backfired' : 'done'}`;
		}
		debugLog(state.lastCast);
		return true;
	}

	// The clicker has just popped the summoned cookie, so the game has shown what it was.
	function noteSpellCookieClicked() {
		state.spellCookie = null;
		const effect = Game.shimmerTypes['golden'].last;
		state.lastCast = `Cast ${GRIMOIRE_SPELLS['hand of fate']}: ${GOLDEN_EFFECT_NAMES[effect] || effect}`;
		debugLog(state.lastCast);
	}

	function runGrimoire(now) {
		if (now < state.nextGrimoireCheckAt) return;
		state.nextGrimoireCheckAt = now + GRIMOIRE_CHECK_INTERVAL_MS;
		if (state.spellCookie && Game.shimmers.indexOf(state.spellCookie) === -1) {
			// It left the screen without the mod's clicker popping it.
			state.spellCookie = null;
			state.lastCast += ' (not clicked by the mod)';
		}
		const M = grimoire();
		if (!M || !settings().autoCast) return;
		const choice = spellChoice(M);
		if (choice.spell && !castHoldReason(M, choice.spell, choice.byAddOn)) castSpell(M, choice.spell);
	}

	/* =====================================================================
	   AUTO-ASCEND
	   ===================================================================== */

	function prestigeProgress() {
		// In "feed" mode every wrinkler, shinies included, is popped before ascending, so count their payout now.
		const summary = wrinklerSummary();
		const wrinklers = settings().wrinklerMode === 'feed' ? summary.normalPayout + summary.shinyPayout : 0;
		// With auto-trade on, all stock is sold before ascending too. A sale only raises the cookies baked
		// when the bank ends up above them (M.sellGood: cookiesEarned = max(cookies, cookiesEarned)),
		// while a popped wrinkler adds to both.
		const M = settings().autoTrade ? market() : null;
		const stock = M ? holdingsValue(M).value * Game.cookiesPsRawHighest : 0;
		const baked = Math.max(Game.cookiesEarned + wrinklers, Game.cookies + wrinklers + stock);
		// Same expressions the game uses for the Legacy button tooltip.
		const owned = Math.floor(Game.HowMuchPrestige(Game.cookiesReset));
		const afterAscending = Math.floor(Game.HowMuchPrestige(Game.cookiesReset + baked));
		return { gained: afterAscending - owned, total: afterAscending };
	}

	function ascendProgressValue(progress) {
		return settings().ascendMode === 'total' ? progress.total : progress.gained;
	}

	function isThresholdMet(progress) {
		// Never ascend for zero gain, e.g. a "total" threshold already below the current level.
		return progress.gained >= 1 && ascendProgressValue(progress) >= settings().ascendThreshold;
	}

	// Reaching the threshold through a settings change or by loading a save never ascends on its own.
	// It raises a warning instead, which is cleared by toggling auto-ascend off and on.
	function recheckAscendWarning() {
		if (!isThresholdMet(prestigeProgress())) state.ascendWarning = false;
		else if (settings().autoAscend) state.ascendWarning = true;
	}

	function onAutoAscendToggled() {
		if (!settings().autoAscend) return;
		if (state.ascendWarning) state.ascendWarning = false; // re-armed: the player confirmed
		else recheckAscendWarning();
	}

	function checkAutoAscend() {
		const s = settings();
		if (state.needsLoadCheck) {
			state.needsLoadCheck = false;
			recheckAscendWarning();
		}
		if (!s.autoAscend || state.ascendWarning) state.ascendPending = false;
		if (!s.autoAscend || state.ascendTriggered || state.ascendWarning) return;
		const progress = prestigeProgress();
		state.ascendPending = isThresholdMet(progress);
		if (!state.ascendPending) return;

		// Wrinklers only pop during normal logic ticks, not during the ascend animation, and
		// reincarnating wipes them, shinies included. Pop them all first and ascend on a later
		// tick once they've paid out.
		const waitingForWrinklers = s.wrinklerMode === 'feed' && popWrinklers(true);
		// Ascending wipes the market, so sell all stock first. Stock bought this market tick can't be
		// sold until the next one, up to a minute away; the market buys nothing more in the meantime.
		const M = s.autoTrade ? market() : null;
		const waitingForStock = !!M && sellAllStock(M);
		if (waitingForWrinklers || waitingForStock) return;

		state.ascendTriggered = true;
		console.log(`${LOG_PREFIX} Auto-ascending: +${progress.gained} prestige (total ${progress.total}).`);
		Game.Ascend(1);
	}

	/* =====================================================================
	   PANTHEON (the Temple minigame, minigamePantheon.js)
	   The player picks a god for each slot; each run the mod slots them. Every ascension the game empties
	   the slots and refills the worship swaps to 3, and a swap is spent for each god put in a slot. Swaps
	   come back one at a time: 1 hour after the last with 2 left, 4 hours with 1 left, 16 hours with none.
	   The Pantheon needs a Temple level, not Temples owned, and doesn't run in a Born again run.
	   ===================================================================== */

	function pantheon() {
		const temple = Game.Objects['Temple'];
		return Game.ascensionMode !== 1 && Game.isMinigameReady(temple) ? temple.minigame : null;
	}

	// What the Pantheon is waiting for before anything can be slotted, or ''.
	function pantheonBlockedReason() {
		if (Game.ascensionMode === 1) return "a normal run: the Pantheon doesn't run in a Born again run";
		if (Game.Objects['Temple'].level < 1) return 'a Temple level (bought with a sugar lump) to unlock the Pantheon';
		if (!pantheon()) return 'the Pantheon to finish loading';
		return '';
	}

	// Why the mod won't slot a god right now, or ''.
	function godRefusal(key) {
		if (key === HOLOBORE && settings().clickGolden) {
			return 'Holobore is thrown out of its slot, and every worship swap is lost, as soon as a golden cookie is clicked, and golden cookie clicking is on';
		}
		return '';
	}

	function shortGodName(god) {
		return god ? god.name.split(',')[0] : '';
	}

	// The picks, as { key, god } per slot (Diamond, Ruby, Jade), or null for a slot left alone.
	function pantheonPicks(M) {
		return PANTHEON_SLOT_KEYS.map(function (settingKey) {
			const key = settings()[settingKey];
			return key && M.gods[key] ? { key: key, god: M.gods[key] } : null;
		});
	}

	// The one move that brings the slots closest to the picks: a single swap that puts two picks in place
	// if there is one, otherwise the first slot that is wrong, Diamond first. null when nothing can be done.
	function nextPantheonMove(M) {
		const picks = pantheonPicks(M);
		const usable = function (slot) { return picks[slot] && !godRefusal(picks[slot].key); };
		const wrong = [0, 1, 2].filter(function (slot) { return usable(slot) && M.slot[slot] !== picks[slot].god.id; });
		if (!wrong.length) return null;
		for (const slot of wrong) {
			const god = picks[slot].god;
			const from = god.slot;
			if (from !== -1 && usable(from) && M.slot[slot] === picks[from].god.id) return { god: god, slot: slot };
		}
		for (const slot of wrong) {
			const god = picks[slot].god;
			// A god sitting in a slot that is left alone stays where it is.
			if (god.slot !== -1 && !usable(god.slot)) continue;
			return { god: god, slot: slot };
		}
		return null;
	}

	// A pick that can't be put in place because its god sits in a slot that is left alone, as text, or ''.
	function pantheonStuckNote(M) {
		const picks = pantheonPicks(M);
		for (let slot = 0; slot < 3; slot++) {
			const pick = picks[slot];
			if (!pick || godRefusal(pick.key) || M.slot[slot] === pick.god.id) continue;
			const from = pick.god.slot;
			if (from !== -1 && (!picks[from] || godRefusal(picks[from].key))) {
				return `${shortGodName(pick.god)} is in the ${PANTHEON_SLOT_NAMES[from]} slot, which is left alone`;
			}
		}
		return '';
	}

	// Slots a god the way the game's own drag and drop does: one worship swap, the god's tile moved in the
	// minigame's screen (and the god it replaces moved to where this one came from), then M.slotGod.
	function slotGodLikeGame(M, god, slot) {
		withSoundsMuted(PANTHEON_SOUND, function () {
			M.useSwap(1);
			M.lastSwapT = 0;
			const tile = l('templeGod' + god.id);
			const previous = M.slot[slot];
			if (previous !== -1) {
				const previousTile = l('templeGod' + previous);
				if (previousTile && god.slot !== -1) {
					l('templeSlot' + god.slot).appendChild(previousTile);
				} else if (previousTile) {
					const placeholder = l('templeGodPlaceholder' + previous);
					placeholder.parentNode.insertBefore(previousTile, placeholder);
				}
			}
			if (tile) l('templeSlot' + slot).appendChild(tile);
			const ownPlaceholder = l('templeGodPlaceholder' + god.id);
			if (ownPlaceholder) ownPlaceholder.style.display = 'none';
			M.slotGod(god, slot);
			PlaySound('snd/tick.mp3');
			PlaySound('snd/spirit.mp3', 0.5);
		});
	}

	// Milliseconds until the next worship swap comes back.
	function msToNextSwap(M) {
		const wait = M.swaps === 0 ? PANTHEON_SWAP_MS[0] : M.swaps === 1 ? PANTHEON_SWAP_MS[1] : PANTHEON_SWAP_MS[2];
		return Math.max(0, M.swapT + wait - Date.now());
	}

	function runPantheon(now) {
		if (now < state.nextPantheonCheckAt) return;
		state.nextPantheonCheckAt = now + PANTHEON_CHECK_INTERVAL_MS;
		if (!settings().autoPantheon) return;
		const M = pantheon();
		if (!M || M.swaps < 1 || M.dragging) return;
		const move = nextPantheonMove(M);
		if (!move) return;
		slotGodLikeGame(M, move.god, move.slot);
		state.lastPantheonAction = `Slotted ${shortGodName(move.god)} in the ${PANTHEON_SLOT_NAMES[move.slot]} slot`;
		debugLog(state.lastPantheonAction);
		noteGameChanged();
	}

	/* =====================================================================
	   SEASONS
	   Each run, visits the seasons that still have something to collect, buys what turns up, and then
	   stays in a home season. Seasonal upgrades are lost on ascending (bar the Keepsakes carry-over),
	   so this starts over every run. It looks at what the store and the switchers show: what is unlocked
	   and bought, the season and its timer, prices. Drops are left to the game's own rolls.
	   ===================================================================== */

	function seasonRun() {
		if (mod.seasonRun.run !== Game.startDate) mod.seasonRun = { run: Game.startDate, visited: [] };
		return mod.seasonRun;
	}

	// A group of seasonal upgrades: how many are there (unlocked counts for drops, bought for the rest).
	function seasonPart(label, names, needBought) {
		const missing = names.filter(function (name) {
			const upgrade = Game.Upgrades[name];
			return needBought ? !upgrade.bought : !(upgrade.bought || upgrade.unlocked);
		});
		return { label: label, total: names.length, have: names.length - missing.length, missing: missing };
	}

	// Why no wrinkler will come right now, or ''.
	function wrinklerBlock() {
		if (Game.Has('Elder Covenant')) return 'the Elder Covenant keeps the grandmas calm, so no wrinklers come';
		if (Game.pledgeT > 0) return 'an Elder Pledge is running, so no wrinklers come';
		if (Game.elderWrath > 0) return '';
		if (openedGrandmaStage() > 0) return 'the grandmas are calm for now, so no wrinklers come';
		return settings().grandmaLimit === 'never' ?
			'your grandmapocalypse limit is Never start, so no wrinklers come' :
			'the grandmapocalypse has not started (it starts with the research One mind), so no wrinklers come yet';
	}

	// What a season still has to collect. `left` counts what a visit can still bring; a visit ends at 0.
	function seasonStatus(key) {
		const s = settings();
		const status = { key: key, name: SEASON_NAMES[key], enabled: !!s[SEASON_TOGGLES[key]], parts: [], left: 0, blocked: '', note: '' };
		if (key === 'valentines') {
			// Each heart biscuit unlocks, in season, once the one before it is bought.
			status.parts.push(seasonPart('heart biscuits', Game.heartDrops, true));
			status.left = status.parts[0].missing.length;
		} else if (key === 'christmas') {
			const hat = seasonPart('festive hat', ['A festive hat'], true);
			const cookies = seasonPart('Christmas cookies', Game.reindeerDrops, false);
			status.parts.push(hat, cookies,
				{ label: 'Santa levels', total: SANTA_MAX_LEVEL, have: Math.min(Game.santaLevel, SANTA_MAX_LEVEL), missing: [] },
				seasonPart("Santa's gifts", Game.santaDrops, false));
			// Santa is levelled in any season once the hat is bought, so only the hat and the cookies hold a visit.
			status.left = hat.missing.length + (s.clickReindeer ? cookies.missing.length : 0);
			if (!s.clickReindeer && cookies.missing.length) status.note = 'reindeer clicking is off, so the Christmas cookies are left out';
		} else if (key === 'halloween') {
			status.parts.push(seasonPart('spooky cookies', Game.halloweenDrops, false));
			status.left = status.parts[0].missing.length;
			if (status.left) status.blocked = wrinklerBlock();
		} else if (key === 'easter') {
			status.parts.push(seasonPart('eggs', Game.easterEggs, false));
			status.left = status.parts[0].missing.length;
			if (status.left && !s.clickGolden) status.blocked = 'golden cookie clicking is off, and eggs come from golden cookies';
		}
		status.done = status.left === 0;
		return status;
	}

	// True while Auto seasons is in Halloween for the spooky cookies. For that time wrinklers are popped
	// as soon as they have fed and no Elder Pledge is bought; the player's own settings are not changed.
	function isCollectingHalloween() {
		const s = settings();
		if (!s.autoSeasons || !s.seasonHalloween || Game.season !== 'halloween' || state.paused) return false;
		return Game.halloweenDrops.some(function (name) { return !(Game.Upgrades[name].bought || Game.Upgrades[name].unlocked); });
	}

	// A wrinkler only rolls for a drop if it has eaten something (Game.UpdateWrinklers: sucked > 0.5),
	// so each is popped once it has, not before. Shiny wrinklers are left alone.
	function popFedWrinklers() {
		for (const wrinkler of Game.wrinklers) {
			if (wrinkler.phase === 2 && wrinkler.sucked > 0.5 && !isShiny(wrinkler) && wrinkler.hp > 0) wrinkler.hp = -10;
		}
	}

	// What Selebrak, the god of seasons, takes off a drop's failure rate, by his slot.
	function seasonGodFactor() {
		const level = Game.hasGod ? Game.hasGod('seasons') : 0;
		return level === 1 ? 0.9 : level === 2 ? 0.95 : level === 3 ? 0.97 : 1;
	}

	// How many tries it takes on average to find `missing` more of `kinds` equally likely drops, when a
	// try succeeds with chance p and a drop already found counts for nothing.
	function expectedTries(p, kinds, missing) {
		let tries = 0;
		for (let left = 1; left <= missing; left++) tries += kinds / (p * left);
		return tries;
	}

	// Hours a Halloween visit should take from here, from the game's published drop and spawn rules
	// (Game.UpdateWrinklers) and what the save shows. null while no wrinklers come.
	function halloweenHours() {
		const missing = seasonPart('', Game.halloweenDrops, false).missing.length;
		if (!missing || Game.elderWrath < 1) return null;
		let fail = Game.HasAchiev('Spooky cookies') ? 0.8 : 0.95;
		if (Game.Has('Starterror')) fail *= 0.9;
		fail = fail / Game.dropRateMult() * seasonGodFactor();
		let spawn = 0.00001 * Game.elderWrath * Game.eff('wrinklerSpawn');
		if (Game.Has('Unholy bait')) spawn *= 5;
		const scorn = Game.hasGod ? Game.hasGod('scorn') : 0;
		spawn *= scorn === 1 ? 2.5 : scorn === 2 ? 2 : scorn === 3 ? 1.5 : 1;
		const secondsPerPop = 1 / (Game.getWrinklersMax() * spawn * Game.fps) + WRINKLER_CRAWL_SECONDS;
		return expectedTries(1 - fail, Game.halloweenDrops.length, missing) * secondsPerPop / 3600;
	}

	// The same for the Christmas cookies, which reindeer drop.
	function christmasHours() {
		const missing = seasonPart('', Game.reindeerDrops, false).missing.length;
		if (!missing) return null;
		let fail = Game.HasAchiev('Let it snow') ? 0.6 : 0.8;
		fail = fail / Game.dropRateMult() * seasonGodFactor();
		if (Game.Has('Starsnow')) fail *= 0.95;
		const reindeer = Game.shimmerTypes['reindeer'];
		const min = reindeer.getMinTime(reindeer);
		const max = reindeer.getMaxTime(reindeer);
		// The game's spawn curve puts the average a third of the way from the shortest wait to the longest.
		const secondsPerReindeer = (min + (max - min) / 3) / Game.fps;
		return expectedTries(1 - fail, Game.reindeerDrops.length, missing) * secondsPerReindeer / 3600;
	}

	function hoursText(hours) {
		return hours < 1 ? `about ${Math.max(1, Math.round(hours * 60))} minutes` : `about ${hours.toFixed(1)} hours`;
	}

	// Switching needs the heavenly upgrade, and heavenly upgrades are off in a Born again run.
	function switchBlock() {
		if (Game.ascensionMode === 1) return 'seasons can\'t be switched in a Born again run';
		if (!Game.Has('Season switcher')) return 'switching needs the heavenly upgrade "Season switcher"';
		return '';
	}

	// A switch to a season: ready to buy, or what it waits for. A switch to the home season is also
	// held to the renewal limit, since each one costs half as much again as the last.
	function switchStep(key, purpose) {
		const step = { action: 'wait', season: key, purpose: purpose, wait: '', price: 0 };
		step.wait = switchBlock();
		if (step.wait) return step;
		const upgrade = Game.seasons[key].triggerUpgrade;
		step.price = upgrade.getPrice();
		if (purpose === 'home' && step.price > settings().seasonRenewMinutes * 60 * Game.unbuffedCps) {
			step.action = 'idle';
			step.tooDear = true;
			return step;
		}
		if (!isInStore(upgrade) || upgrade.bought) step.wait = 'its switcher to be on offer';
		else if (!canAfford(step.price)) step.wait = `${Beautify(Math.max(0, step.price + reserveAmount() - Game.cookies))} more cookies`;
		else step.action = 'switch';
		return step;
	}

	// What Auto seasons does next: { action: 'collect' | 'switch' | 'wait' | 'idle', season, ... } plus
	// the status of every season and the ones waiting on something.
	function seasonPlan() {
		const s = settings();
		const visited = seasonRun().visited;
		const current = Game.season;
		const statuses = {};
		SEASON_ORDER.forEach(function (key) { statuses[key] = seasonStatus(key); });
		const workable = function (key) { return !!statuses[key] && statuses[key].enabled && !statuses[key].done && !statuses[key].blocked; };
		let plan;
		const next = SEASON_ORDER.filter(function (key) { return key !== current && workable(key) && visited.indexOf(key) === -1; })[0];
		if (workable(current)) {
			// The season it is in still has something: stay, whether it was bought or the calendar gave it.
			plan = { action: 'collect', season: current, free: current === Game.baseSeason };
		} else if (next) {
			plan = switchStep(next, 'collect');
		} else if (s.homeSeason === 'none' || current === s.homeSeason) {
			plan = { action: 'idle', season: current, atHome: s.homeSeason !== 'none' };
		} else {
			plan = switchStep(s.homeSeason, 'home');
		}
		plan.statuses = statuses;
		plan.next = plan.action === 'collect' ? (next || '') : '';
		// Seasons that still have something but can't be worked on, or were already given their visit.
		plan.pending = SEASON_ORDER.filter(function (key) { return key !== current && statuses[key].enabled && !statuses[key].done && statuses[key].blocked && visited.indexOf(key) === -1; });
		return plan;
	}

	// The one place a season switcher is bought. Switchers are switches, which nothing else in AFK
	// Baker buys; this is called only by runSeasons, for the season its plan chose.
	function switchSeason(key) {
		const upgrade = Game.seasons[key] && Game.seasons[key].triggerUpgrade;
		if (!upgrade || upgrade.bought || !isInStore(upgrade) || !canAfford(upgrade.getPrice())) return false;
		const price = upgrade.getPrice();
		// buy(1) goes straight to the purchase; without it the click handler for cancelling a season runs first.
		withPurchaseSoundMuted(function () { upgrade.buy(1); });
		if (Game.season !== key) return false;
		state.lastSeasonAction = `switched to ${SEASON_NAMES[key]} for ${Beautify(price)} cookies`;
		debugLog('Seasons:', state.lastSeasonAction);
		return true;
	}

	// Buys what the seasons have turned up: the hat, Santa's levels, and every seasonal upgrade on offer
	// (the Chocolate egg is on the never-buy list). Each has to cost less than the no-payback limit and
	// leave the cookie reserve alone. Works in any season: an unlocked upgrade stays on offer.
	function buySeasonItems() {
		const s = settings();
		const limit = s.utilityMinutes * 60 * Game.unbuffedCps;
		let bought = false;
		const groups = [];
		if (s.seasonValentines) groups.push(Game.heartDrops);
		if (s.seasonChristmas) groups.push(['A festive hat', "Santa's dominion"], Game.santaDrops, Game.reindeerDrops);
		if (s.seasonHalloween) groups.push(Game.halloweenDrops);
		if (s.seasonEaster) groups.push(Game.easterEggs);
		for (const names of groups) {
			for (const name of names) {
				const upgrade = Game.Upgrades[name];
				if (!upgrade.unlocked || upgrade.bought || !isInStore(upgrade) || !isAllowedUpgrade(upgrade)) continue;
				if (upgrade.getPrice() > limit || !tryBuyUpgrade(upgrade)) continue;
				bought = true;
				state.lastSeasonAction = `bought ${upgrade.name}`;
			}
		}
		if (s.seasonChristmas && Game.Has('A festive hat') && Game.santaLevel < SANTA_MAX_LEVEL) {
			const cost = Math.pow(Game.santaLevel + 1, Game.santaLevel + 1);
			// Game.UpgradeSanta wants more than the cost banked.
			if (cost <= limit && canAfford(cost) && Game.cookies > cost) {
				const level = Game.santaLevel;
				withSpecialPanelRestored(function () {
					withSoundsMuted(DRAGON_SOUND, function () { Game.UpgradeSanta(); });
				});
				if (Game.santaLevel > level) {
					bought = true;
					state.lastSeasonAction = `raised Santa to level ${Game.santaLevel}`;
				}
			}
		}
		if (bought) {
			debugLog('Seasons:', state.lastSeasonAction);
			noteGameChanged();
		}
	}

	// Being in a collecting season is its visit for this run, however it came about. The calendar's own
	// season costs nothing and never runs out, so it is not counted.
	function noteSeasonVisit() {
		const run = seasonRun();
		const current = Game.season;
		if (SEASON_ORDER.indexOf(current) !== -1 && current !== Game.baseSeason && run.visited.indexOf(current) === -1) run.visited.push(current);
	}

	function runSeasons(now) {
		if (!settings().autoSeasons || now < state.nextSeasonCheckAt) return;
		state.nextSeasonCheckAt = now + SEASON_CHECK_INTERVAL_MS;
		// Nothing is bought with an ascension on its way.
		if (state.ascendPending || state.ascendTriggered) return;
		noteSeasonVisit();
		buySeasonItems();
		const plan = seasonPlan();
		if (plan.action === 'switch' && switchSeason(plan.season)) noteSeasonVisit();
	}

	function seasonTimeLeft() {
		if (!Game.season) return '';
		if (Game.season === Game.baseSeason) return 'calendar season, free';
		return `${formatDuration(Math.max(0, Game.seasonT) / Game.fps * 1000)} left`;
	}

	// "4 of 7 Christmas cookies, Santa level 9 of 14": what a season's parts still lack.
	function seasonProgress(status) {
		return status.parts.filter(function (part) { return part.have < part.total; }).map(function (part) {
			return part.total === 1 ? `no ${part.label} yet` : `${part.have} of ${part.total} ${part.label}`;
		}).join(', ');
	}

	function seasonsRow() {
		const s = settings();
		const row = { tab: 'seasons', name: 'Seasons', dot: 'on', now: '', wait: '' };
		const current = Game.season ? `${SEASON_NAMES[Game.season] || Game.season} (${seasonTimeLeft()})` : 'No season';
		if (!s.autoSeasons) return Object.assign(row, { dot: 'off', now: `Auto seasons off. ${current}.` });
		const plan = seasonPlan();
		const waiting = plan.pending.map(function (key) { return `${SEASON_NAMES[key]} waits: ${plan.statuses[key].blocked}`; }).join('; ');
		if (plan.action === 'collect') {
			row.now = `${current}: collecting. So far: ${seasonProgress(plan.statuses[plan.season])}.`;
			row.wait = plan.next ? `the rest here, then ${SEASON_NAMES[plan.next]}` : 'the rest here, then the home season';
			row.dot = 'wait';
		} else if (plan.action === 'switch' || plan.action === 'wait') {
			const price = plan.price ? ` (${Beautify(plan.price)} cookies)` : '';
			row.now = `${current}. Next: ${SEASON_NAMES[plan.season]}${price}, ${plan.purpose === 'home' ? 'the home season' : 'to collect there (so far: ' + seasonProgress(plan.statuses[plan.season]) + ')'}.`;
			row.wait = plan.wait;
			row.dot = 'wait';
		} else if (plan.tooDear) {
			row.now = `${current}. Nothing left to collect. Not switching to ${SEASON_NAMES[plan.season]}: the switch costs ${cpsTime(plan.price)} of CpS, over your limit of ${s.seasonRenewMinutes} min.`;
		} else {
			row.now = `${current}${plan.atHome ? ', the home season' : ''}. Nothing left to collect${plan.atHome || s.homeSeason !== 'none' ? '' : ', and no home season is set'}.`;
		}
		if (waiting) row.now += ` ${waiting}.`;
		if (state.lastSeasonAction) row.now += ` Last: ${state.lastSeasonAction}.`;
		return row;
	}

	/* =====================================================================
	   GODZAMOK COMBOS
	   With Godzamok slotted, selling buildings gives Devastation: +1% click power per building sold
	   (Diamond slot; half that in Ruby, a quarter in Jade) for 10 seconds. A combo sells whole building
	   types and buys each straight back, all inside one game tick, so CpS, the store and the payback
	   numbers never see them gone. What it costs is the gap between the refund and the price of buying
	   back. Decisions use what the game shows: buffs and their timers, prices, the bank, cookies per click.
	   ===================================================================== */

	// The buffs other than Devastation that change what a click is worth: whether one of them is a click
	// buff, and the shortest time any of them has left (capped at Devastation's own length).
	function clickBuffWindow() {
		let click = false;
		let seconds = DEVASTATION_SECONDS;
		for (const name in Game.buffs) {
			const buff = Game.buffs[name];
			if (name === 'Devastation') continue;
			const clicks = typeof buff.multClick === 'number' && buff.multClick !== 1;
			const cps = typeof buff.multCpS === 'number' && buff.multCpS !== 1;
			if (!clicks && !cps) continue;
			if (clicks && buff.multClick > 1) click = true;
			seconds = Math.min(seconds, buff.time / Game.fps);
		}
		return { click: click, seconds: seconds };
	}

	// What a combo would sell right now: { sales, sold, cost, rebuy, gain, mult }, or { wait: why not }.
	function comboPlan() {
		const s = settings();
		if (!pantheon()) return { wait: 'the Pantheon' };
		const level = Game.hasGod('ruin');
		if (!level) return { wait: 'Godzamok in a Pantheon slot' };
		const rate = effectiveClickRate();
		if (!(rate > 0)) return { wait: 'the autoclicker, which is off' };
		// Game.mouseCps: a Cursed finger sets the click's worth outright, after the click buffs.
		if (Game.buffs['Cursed finger']) return { wait: 'the Cursed finger to end (Devastation does nothing during it)' };
		const running = Game.buffs['Devastation'];
		if (running) return { running: running, wait: 'Devastation to run out' };
		const buffs = clickBuffWindow();
		if (s.godzamokMode === 'buffs' && !buffs.click) return { wait: 'a click buff (Click frenzy or Dragonflight)' };
		if (Game.recalculateGains) return { wait: 'the game to recalculate its CpS' };

		// Cookies per click now, and once the buffs running now are over. Click power mostly follows CpS,
		// so a CpS buff is taken out too; where it doesn't follow, this only makes the estimate lower.
		const perClick = Game.computedMouseCps;
		const cpsBuff = Game.unbuffedCps > 0 ? Math.max(1, Game.cookiesPs / Game.unbuffedCps) : 1;
		const plainClick = perClick / clickBuffMultiplier() / cpsBuff;
		// What one building sold adds over Devastation's 10 seconds.
		const perBuilding = rate * GODZAMOK_BONUS[level] * (buffs.seconds * perClick + (DEVASTATION_SECONDS - buffs.seconds) * plainClick);
		const spendable = Math.max(0, Game.cookies - reserveAmount());
		const cap = spendable * s.godzamokCapPercent / 100;
		const options = [];
		for (const building of Game.ObjectsById) {
			if (GODZAMOK_NEVER_SELL.indexOf(building.name) !== -1) continue;
			const amount = building.amount - (GODZAMOK_KEEP[building.name] || 0);
			if (!(amount > 0)) continue;
			const sellShare = building.getSellMultiplier();
			// getReverseSumPrice is the price of the last units bought times the refund share: undone, it is
			// what buying them back costs. A sale refunds each unit at the next unit's price (Game.Object.sell).
			const rebuy = building.getReverseSumPrice(amount) / sellShare;
			const cost = rebuy * (1 - sellShare * Game.priceIncrease);
			const gain = perBuilding * amount;
			if (!(cost > 0) || !(gain >= cost * GODZAMOK_MIN_RETURN)) continue;
			options.push({ building: building, amount: amount, rebuy: rebuy, cost: cost, gain: gain });
		}
		if (!options.length) return { wait: `a combo that brings in ${GODZAMOK_MIN_RETURN} times its cost` };
		options.sort(function (a, b) { return b.gain / b.cost - a.gain / a.cost; });
		const plan = { sales: [], sold: 0, cost: 0, rebuy: 0, gain: 0, mult: 1 };
		for (const option of options) {
			// The bank must cover buying everything back in full, without counting on the refunds.
			if (plan.cost + option.cost > cap || plan.rebuy + option.rebuy > spendable) continue;
			plan.sales.push(option);
			plan.sold += option.amount;
			plan.cost += option.cost;
			plan.rebuy += option.rebuy;
			plan.gain += option.gain;
		}
		if (!plan.sales.length) return { wait: `a bigger bank: the cheapest combo costs ${Beautify(options[options.length - 1].cost)} cookies, and one may cost ${s.godzamokCapPercent}% of the bank` };
		plan.mult = 1 + plan.sold * GODZAMOK_BONUS[level];
		return plan;
	}

	// Sells each building type in the plan and buys it straight back. Returns true if anything was sold.
	function makeCombo(plan) {
		const bank = Game.cookies;
		const earned = Game.cookiesEarned;
		const savedMode = Game.buyMode;
		const missing = [];
		const labels = [];
		withSoundsMuted(COMBO_SOUND, function () {
			try {
				for (const sale of plan.sales) {
					const building = sale.building;
					const had = building.amount;
					building.sell(sale.amount);
					// Object.buy() sells instead of buying while the store is in sell mode.
					Game.buyMode = 1;
					building.buy(had - building.amount);
					Game.buyMode = savedMode;
					labels.push(`${sale.amount} ${sale.amount === 1 ? building.single : building.plural}`);
					if (building.amount !== had) {
						missing.push(`${building.plural} (had ${had}, now ${building.amount})`);
						break;
					}
				}
			} finally {
				Game.buyMode = savedMode;
			}
		});
		// buy() redrew the store rows for buy mode; redraw the store for the player's mode.
		if (savedMode !== 1) Game.storeToRefresh = 1;
		const cost = bank - Game.cookies;
		if (tracker.earned !== null) {
			const gained = Game.cookiesEarned - earned;
			if (gained > 0) {
				addIncome(mod.income.run.gains, 'sales', gained);
				tracker.booked += gained;
			}
			if (cost > 0) addIncome(mod.income.run.losses, 'combo', cost);
		}
		const buff = Game.buffs['Devastation'];
		state.comboCount++;
		const what = labels.length > 3 ? `${Beautify(plan.sold)} buildings of ${labels.length} types` : labels.join(', ');
		state.comboLast = `sold and bought back ${what}: click power x${(buff ? buff.multClick : 1).toFixed(2)} for ${DEVASTATION_SECONDS} seconds, for ${Beautify(Math.max(0, cost))} cookies`;
		debugLog('Godzamok combo:', state.comboLast);
		if (missing.length) {
			settings().godzamokCombo = false;
			state.comboStopped = `Godzamok combos turned themselves off: after a combo the count of ${missing.join(', ')} was not what it had been. Check your buildings, then turn combos back on if you want them.`;
			debugLog(state.comboStopped);
			noteGameChanged();
			renderMenuSection();
		}
		return true;
	}

	function runGodzamok(now) {
		if (!settings().godzamokCombo || now < state.nextComboCheckAt) return false;
		state.nextComboCheckAt = now + GODZAMOK_CHECK_INTERVAL_MS;
		// Nothing is sold with an ascension on its way.
		if (state.ascendPending || state.ascendTriggered) return false;
		const plan = comboPlan();
		return plan.sales ? makeCombo(plan) : false;
	}

	function godzamokRow() {
		const s = settings();
		const row = { tab: 'pantheon', name: 'Godzamok combos', dot: 'on', now: '', wait: '' };
		if (!s.godzamokCombo) {
			if (!state.comboStopped) return null;
			return Object.assign(row, { dot: 'warn', now: state.comboStopped, wait: 'you to turn them back on' });
		}
		const plan = comboPlan();
		const mode = s.godzamokMode === 'buffs' ? 'During click buffs only.' : 'Whenever it pays.';
		if (plan.running) {
			row.now = `Devastation: click power x${plan.running.multClick.toFixed(2)} for another ${Math.ceil(plan.running.time / Game.fps)} s.`;
		} else if (plan.sales) {
			row.now = `Selling and buying back ${plan.sold} buildings for click power x${plan.mult.toFixed(2)}.`;
		} else {
			row.now = mode;
			row.dot = 'wait';
			row.wait = plan.wait;
		}
		if (state.comboLast) row.now += ` ${state.comboCount} so far; last: ${state.comboLast}.`;
		return row;
	}

	/* =====================================================================
	   EXTRAS
	   ===================================================================== */

	/* ----- Sunder: Krumblor petted at all times ----- */

	// Why the dragon can't be petted right now, or ''.
	function petBlockedReason() {
		if (!Game.Has('Pet the dragon')) return 'it needs the heavenly upgrade "Pet the dragon"';
		if (!hasDragonEgg() || Game.dragonLevel < 4) return 'the dragon has to hatch first (level 4)';
		return '';
	}

	function endSunder() {
		const session = state.sunder;
		if (!session) return;
		state.sunder = null;
		if (Game.specialTab !== session.restoreTab) showSpecialPanel(session.restoreTab);
	}

	// Keeps the dragon panel open and pets at the set rate: at most one pet per logic tick (30 a second).
	function runSunder(now) {
		const s = settings();
		if (!s.sunder) {
			endSunder();
			return;
		}
		state.sunderBlocked = petBlockedReason();
		if (state.sunderBlocked) {
			endSunder();
			return;
		}
		let session = state.sunder;
		if (!session) session = state.sunder = { restoreTab: Game.specialTab, owed: 0, last: now };
		if (Game.specialTab !== 'dragon' || !l('specialPic')) showSpecialPanel('dragon');
		session.owed = Math.min(1, session.owed + Math.max(0, now - session.last) / 1000 * s.sunderRate);
		session.last = now;
		if (session.owed < 1) return;
		session.owed -= 1;
		petDragon(true);
		state.sunderPets++;
	}

	/* ----- RedFox: wrinklers shown as nibblers ----- */

	// Only text on screen is rewritten, inside the places where the word turns up. Names the game and
	// AFK Baker use inside, and the save, are never touched, and every rewritten text node keeps its
	// original so turning RedFox off puts it back.
	const redFox = { observers: [], replaced: new Set(), originals: new WeakMap(), on: false, ms: 0, calls: 0 };

	function isGameInEnglish() {
		return typeof EN === 'undefined' || !!EN;
	}

	function nibble(text) {
		return text.replace(/wrinkler/gi, function (word) {
			if (word === 'WRINKLER') return 'NIBBLER';
			return word.charAt(0) === 'W' ? 'Nibbler' : 'nibbler';
		});
	}

	function redFoxText(node) {
		const text = node.data;
		if (!text || (text.indexOf('rinkler') === -1 && text.indexOf('RINKLER') === -1)) return;
		const changed = nibble(text);
		if (changed === text) return;
		redFox.originals.set(node, text);
		redFox.replaced.add(node);
		node.data = changed;
	}

	function redFoxSweep(root) {
		if (root.nodeType === 3) {
			redFoxText(root);
			return;
		}
		if (root.nodeType !== 1) return;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) redFoxText(node);
	}

	function onRedFoxMutations(records) {
		const start = performance.now();
		for (const record of records) {
			if (record.type === 'characterData') redFoxText(record.target);
			else for (const node of record.addedNodes) redFoxSweep(node);
		}
		redFox.ms += performance.now() - start;
		redFox.calls++;
	}

	function startRedFox() {
		redFox.on = true;
		for (const id of REDFOX_CONTAINERS) {
			const element = document.getElementById(id);
			if (!element) continue;
			const observer = new MutationObserver(onRedFoxMutations);
			observer.observe(element, { childList: true, subtree: true, characterData: true });
			redFox.observers.push(observer);
			redFoxSweep(element);
		}
	}

	function stopRedFox() {
		redFox.on = false;
		for (const observer of redFox.observers) observer.disconnect();
		redFox.observers = [];
		redFox.replaced.forEach(function (node) {
			const original = redFox.originals.get(node);
			// Only text that is still our rewrite goes back; anything the game has redrawn since is already right.
			if (original !== undefined && node.data === nibble(original)) node.data = original;
		});
		redFox.replaced.clear();
	}

	function refreshRedFox() {
		const wanted = !!settings().redFox && typeof MutationObserver !== 'undefined';
		// The panel and its tab are built after the mod loads; watch them as soon as they are there.
		if (wanted && redFox.on && redFox.observers.length < REDFOX_CONTAINERS.filter(function (id) { return document.getElementById(id); }).length) stopRedFox();
		if (wanted && !redFox.on) startRedFox();
		else if (!wanted && redFox.on) stopRedFox();
		else if (redFox.replaced.size > 2000) {
			// Text nodes the game threw away are forgotten.
			redFox.replaced.forEach(function (node) { if (!node.isConnected) redFox.replaced.delete(node); });
		}
	}

	/* =====================================================================
	   STORE OVERLAY
	   Marks each upgrade and colors each building's price by how its payback period compares with the
	   best one. It only reads what the payback calculator has already worked out: no simulation is run
	   for it, and drawing is a matter of setting one attribute per store item.
	   ===================================================================== */

	// The bands are a ratio to the best payback period, so they mean the same in a small store and a full one.
	const RATINGS = {
		best: { label: 'Best buy', legend: 'the lowest payback period: what auto-buy buys next. While several items pay back in under a second, all of them are marked, and auto-buy takes them together' },
		close: { label: 'Close to best', legend: `payback period up to ${CLOSE_RATIO} times the best` },
		average: { label: 'Average', legend: `up to ${AVERAGE_RATIO} times the best` },
		poor: { label: 'Poor', legend: `more than ${AVERAGE_RATIO} times the best` },
		none: { label: 'No payback period', legend: "the purchase doesn't raise your income, so it never pays for itself" },
		utility: { label: 'Utility: bought when cheap', legend: 'no payback period, but useful (golden cookies, reindeer, wrinklers, prices, drops): bought once it costs less than the limit set above' },
		research: { label: 'Bought by the research setting', legend: 'research, bought as soon as it is affordable while Buy research is on' },
		skip: { label: 'Skipped by AFK Baker', legend: 'never bought: switches, vaulted upgrades, the never-buy list, research while Buy research is off, and research past your grandmapocalypse limit' },
	};
	const RATING_ORDER = ['best', 'close', 'average', 'poor', 'utility', 'none', 'research', 'skip'];
	const SKIP_REASONS = {
		'toggle pool': 'it is a switch, not a purchase',
		'never-buy list': 'it is on the never-buy list',
		vaulted: 'you put it in the vault',
		'costs sugar lumps': 'it costs sugar lumps',
		selector: 'it opens a selection, not a purchase',
		'already bought': 'it is already bought',
		'grandmapocalypse limit': 'it would take the grandmapocalypse past the stage you set',
	};
	const UPGRADE_BOXES = ['upgrades', 'techUpgrades', 'toggleUpgrades', 'vaultUpgrades'];

	const overlay = {
		ratings: new Map(), // candidate key -> { rating, pp, rank, tag, why }
		ranked: 0, // how many items have a payback period
		hover: '', // the id of the store item under the mouse
		fast: false, // several items pay back in under a second: they all count as the best buy
		nextRatingAt: 0,
		watching: false,
	};

	function ratingColor(rating) {
		return settings().overlayColors[rating] || DEFAULT_COLORS[rating];
	}

	// Whether a '#rrggbb' color is dark enough that a black outline would hide it.
	function isDarkColor(hex) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < DARK_COLOR_LUMINANCE;
	}

	// The colors are CSS variables on the page, read by every mark and price; an unset one means the default.
	function applyColors() {
		const root = document.documentElement;
		const colors = settings().overlayColors;
		for (const rating in DEFAULT_COLORS) {
			if (colors[rating]) root.style.setProperty('--afk-' + rating, colors[rating]);
			else root.style.removeProperty('--afk-' + rating);
			// Price text is outlined so it reads on the building rows: in black, or in white for a dark color.
			if (colors[rating] && isDarkColor(colors[rating])) root.style.setProperty('--afk-' + rating + '-edge', '#fff');
			else root.style.removeProperty('--afk-' + rating + '-edge');
		}
	}

	// A small bar just above the upgrades: how many of them have each rating.
	function updateRatingBar() {
		const upgrades = document.getElementById('upgrades');
		if (!upgrades || !upgrades.parentNode) return;
		let bar = document.getElementById('afkRatingBar');
		const show = isOverlayOn() && settings().ratingBar;
		if (!show) {
			if (bar) bar.remove();
			return;
		}
		const counts = {};
		for (const id of UPGRADE_BOXES) {
			const box = document.getElementById(id);
			if (!box) continue;
			const crates = box.getElementsByClassName('upgrade');
			for (let i = 0; i < crates.length; i++) {
				const rating = crates[i].dataset.afkRating;
				if (rating) counts[rating] = (counts[rating] || 0) + 1;
			}
		}
		const html = RATING_ORDER.filter(function (rating) { return counts[rating]; }).map(function (rating) {
			const tip = `<div style="padding:8px;white-space:nowrap;font-size:11px;"><b>${RATINGS[rating].label}</b>: ${counts[rating]} upgrade${counts[rating] === 1 ? '' : 's'} in the store</div>`;
			return `<span class="afk-count" data-afk-count="${rating}" ${Game.getTooltip(tip, 'store')}><span class="afk-mark" data-afk-rating="${rating}"></span>${counts[rating]}</span>`;
		}).join('');
		if (!bar) {
			bar = document.createElement('div');
			bar.id = 'afkRatingBar';
		}
		// Kept directly above the upgrades, whatever else (another mod's bar) is put there.
		if (bar.nextSibling !== upgrades) upgrades.parentNode.insertBefore(bar, upgrades);
		if (bar.dataset.afkHtml !== html) {
			bar.dataset.afkHtml = html;
			bar.innerHTML = html;
		}
		bar.style.display = html ? '' : 'none';
	}

	function isMonsterLoaded() {
		return !!window.CookieMonsterData;
	}

	// Until the player chooses, the overlay is on unless Cookie Monster is drawing its own store colors.
	function isOverlayOn() {
		const choice = settings().storeOverlay;
		return choice === null ? !isMonsterLoaded() : choice;
	}

	function ratingFor(pp, bestPP) {
		if (pp <= bestPP * CLOSE_RATIO) return 'close';
		return pp <= bestPP * AVERAGE_RATIO ? 'average' : 'poor';
	}

	// Rates everything in the store from the cached payback results. The best buy is the item auto-buy
	// would take: the lowest payback period among the items it can buy right now.
	function computeRatings(now) {
		// The ratings only change when a full round of payback results is in. Between rounds (after every
		// purchase the results start over) the store keeps the ratings it has, so nothing blinks.
		if (!calc.ready || !calc.base) return;
		const ratings = new Map();
		overlay.ratings = ratings;
		const report = { filtered: [], infinite: [] };
		const candidates = rankCandidates(report);
		overlay.ranked = candidates.length;
		let best = null;
		for (const candidate of candidates) {
			if (!unbuyableReason(candidate, now)) {
				best = candidate;
				break;
			}
		}
		let bestPP = best ? best.pp : candidates.length ? candidates[0].pp : 0;
		// While the best items pay back in under a second, they are all as good as each other and auto-buy
		// takes them together: all are marked Best buy, and the rest are rated against that second.
		const fast = bestPP < FAST_PP_SECONDS;
		overlay.fast = fast;
		if (fast) bestPP = FAST_PP_SECONDS;
		candidates.forEach(function (candidate, i) {
			const held = candidate === best ? '' : unbuyableReason(candidate, now);
			const isBest = candidate === best || (fast && candidate.pp < FAST_PP_SECONDS);
			ratings.set(candidateKey(candidate), {
				rating: isBest ? 'best' : ratingFor(candidate.pp, bestPP),
				pp: candidate.pp, rank: i + 1, tag: candidate.tag || '', why: held ? `auto-buy is passing over it for now: ${held}` : '',
			});
		});

		const s = settings();
		const clickRate = effectiveClickRate();
		for (const upgrade of Game.UpgradesInStore) {
			const key = candidateKey({ kind: 'upgrade', name: upgrade.name, amount: 1 });
			if (ratings.has(key)) continue;
			const reason = upgradeFilterReason(upgrade);
			if (reason) {
				ratings.set(key, { rating: 'skip', why: SKIP_REASONS[reason] || `it is in the ${reason}` });
			} else if (upgrade.pool === 'tech') {
				ratings.set(key, s.buyResearch ?
					{ rating: 'research', why: 'research is bought as soon as it is affordable, whatever its payback period' + (s.autoBuy ? '' : ' (auto-buy is off)') } :
					{ rating: 'skip', why: 'it is research, and Buy research is off' });
			} else {
				const outcome = calc.results.get(key);
				if (!outcome) continue; // not worked out yet
				let why = "it doesn't raise your income, so it never pays for itself";
				const unowned = unownedBuildingNote(upgrade);
				if (unowned) why = `${unowned}, so for now it adds nothing`;
				if (outcome.gain < 0) why = 'it lowers your CpS';
				else if (outcome.clickGain > 0 && clickRate <= 0) why = 'it only raises click income, and the autoclicker is off';
				const utility = utilityStatus(upgrade);
				if (utility && utility.byAutoPet) ratings.set(key, { rating: 'utility', why: 'auto-pet buys it as soon as it is affordable' });
				else if (utility && !utility.skip) ratings.set(key, { rating: 'utility', utility: utility });
				else ratings.set(key, { rating: 'none', why: utility && utility.skip ? utility.skip : why });
			}
		}
		for (const name in Game.Objects) {
			for (const amount of BUY_AMOUNTS) {
				const key = candidateKey({ kind: 'building', name: name, amount: amount });
				if (!ratings.has(key) && calc.results.has(key)) ratings.set(key, { rating: 'none', why: "it doesn't raise your CpS" });
			}
		}
	}

	// The upgrade a store crate stands for: the game numbers the crates "upgrade0", "upgrade1"... in
	// the order of Game.UpgradesInStore.
	function crateUpgrade(crate) {
		const match = /^upgrade(\d+)$/.exec(crate.id || '');
		return match ? Game.UpgradesInStore[Number(match[1])] || null : null;
	}

	function setRating(element, rating) {
		if (!element) return;
		if (!rating) {
			if (element.dataset.afkRating !== undefined) delete element.dataset.afkRating;
		} else if (element.dataset.afkRating !== rating) {
			element.dataset.afkRating = rating;
		}
	}

	// The amount the store's bulk buttons are set to, if it is one the calculator rates.
	function storeBulk() {
		return Game.buyMode === 1 && BUY_AMOUNTS.indexOf(Game.buyBulk) !== -1 ? Game.buyBulk : 0;
	}

	// Writes the ratings onto the store's elements. The ratings are attributes, which the game leaves
	// alone when it redraws a price or swaps a class.
	function applyOverlay() {
		const on = isOverlayOn();
		for (const id of UPGRADE_BOXES) {
			const box = document.getElementById(id);
			if (!box) continue;
			const crates = box.getElementsByClassName('upgrade');
			for (let i = 0; i < crates.length; i++) {
				const upgrade = on ? crateUpgrade(crates[i]) : null;
				const entry = upgrade ? overlay.ratings.get(candidateKey({ kind: 'upgrade', name: upgrade.name, amount: 1 })) : null;
				setRating(crates[i], entry ? entry.rating : '');
			}
		}
		const bulk = on ? storeBulk() : 0;
		for (const building of Game.ObjectsById) {
			const entry = bulk ? overlay.ratings.get(candidateKey({ kind: 'building', name: building.name, amount: bulk })) : null;
			setRating(document.getElementById('product' + building.id), entry ? entry.rating : '');
		}
		updateRatingBar();
	}

	// A payback period or a wait, in the two largest units that matter.
	function shortTime(seconds) {
		if (!Number.isFinite(seconds)) return 'never';
		if (seconds < 1) return 'under a second';
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
		const hours = Math.floor(minutes / 60);
		if (hours < 48) return `${hours}h ${minutes % 60}m`;
		const days = Math.floor(hours / 24);
		if (days < 730) return `${days}d ${hours % 24}h`;
		return `${Beautify(Math.floor(days / 365))} years`;
	}

	function affordableText(price) {
		const shortfall = price - Game.cookies;
		if (shortfall <= 0) return 'now';
		const cps = calc.base ? calc.base.immediate : 0;
		return cps > 0 ? `in ${shortTime(shortfall / cps)}` : 'not without income';
	}

	function tipRow(label, value) {
		return `<tr><td>${label}</td><td>${value}</td></tr>`;
	}

	function ratingWords(entry) {
		return `<span class="afk-mark" data-afk-rating="${entry.rating}"></span> ${RATINGS[entry.rating].label}`;
	}

	function entryRows(entry) {
		let rows = '';
		if (entry.rating === 'best' && overlay.fast) rows += tipRow('Fast buying', 'everything that pays back in under a second is bought together');
		if (entry.pp !== undefined) {
			rows += tipRow('Payback period', shortTime(entry.pp) + (entry.tag === 'click' ? ` (click upgrade, at ${effectiveClickRate().toFixed(1)} clicks per second)` : '')) +
				tipRow('Rank', `${entry.rank} of ${overlay.ranked}`);
		}
		if (entry.utility) {
			const u = entry.utility;
			const cps = calc.base ? calc.base.immediate : 0;
			const minutes = cps > 0 ? u.price / cps / 60 : Infinity;
			const costText = minutes < 0.1 ? 'under 0.1 min' : `${minutes < 10 ? minutes.toFixed(1) : Beautify(Math.round(minutes))} min`;
			rows += tipRow('Why', "It doesn't raise CpS, so it has no payback period, but it is useful") +
				tipRow('Bought when', `it costs ${u.limit} min of CpS or less${u.cpsPriced ? ' (its price follows your CpS)' : ''}`) +
				tipRow('Costs now', `${costText} of CpS`) +
				tipRow('So', u.cheap ? (u.price <= Game.cookies - reserveAmount() ? 'it is bought next, unless that would hold up the current target' : 'it is bought once you can afford it') :
					(u.cpsPriced ? 'not at this limit: raise the limit on the Auto-buy tab to have it bought' : 'it is bought once your CpS has grown enough'));
		}
		if (entry.why) rows += tipRow('Why', escapeHtml(capitalize(entry.why)));
		return rows;
	}

	// What AFK Baker adds to the game's tooltip for a store item, or '' if it has nothing to say.
	function overlayTipHtml(element) {
		let rows = '';
		let head = null;
		const product = /^product(\d+)$/.exec(element.id || '');
		if (product) {
			const building = Game.ObjectsById[Number(product[1])];
			if (!building) return '';
			const bulk = storeBulk();
			head = bulk ? overlay.ratings.get(candidateKey({ kind: 'building', name: building.name, amount: bulk })) : null;
			if (head) rows += entryRows(head) + tipRow('Affordable', affordableText(building.getSumPrice(bulk)));
			for (const amount of BUY_AMOUNTS) {
				const entry = overlay.ratings.get(candidateKey({ kind: 'building', name: building.name, amount: amount }));
				if (!entry) continue;
				rows += tipRow(`Buy ${amount}`, RATINGS[entry.rating].label + (entry.pp !== undefined ? `, ${shortTime(entry.pp)}` : ''));
			}
		} else {
			const upgrade = crateUpgrade(element);
			if (!upgrade) return '';
			head = overlay.ratings.get(candidateKey({ kind: 'upgrade', name: upgrade.name, amount: 1 }));
			if (head) rows += entryRows(head) + tipRow('Affordable', affordableText(upgrade.getPrice()));
		}
		if (!rows) return '';
		return '<div class="afk-tip-who">AFK Baker</div>' + (head ? `<div class="afk-tip-rating">${ratingWords(head)}</div>` : '') + `<table>${rows}</table>`;
	}

	// Adds AFK Baker's block to the game's tooltip while a store item is hovered. The game redraws its
	// tooltip itself; this only appends to what it drew.
	function extendTooltip() {
		const tooltip = document.getElementById('tooltip');
		const hovered = overlay.hover ? document.getElementById(overlay.hover) : null;
		if (!tooltip || !hovered || !isOverlayOn()) return;
		if (tooltip.querySelector('.afk-tip')) return;
		const html = overlayTipHtml(hovered);
		if (!html) return;
		const block = document.createElement('div');
		block.className = 'afk-tip';
		block.innerHTML = html;
		tooltip.appendChild(block);
	}

	function storeItemAt(target) {
		return target && target.closest ? target.closest('.crate.upgrade, .product') : null;
	}

	// Follows the store as the game rebuilds it, so a rebuilt store is marked at once and not at the next
	// half-second refresh.
	function watchStore() {
		if (overlay.watching || typeof MutationObserver === 'undefined') return;
		const store = document.getElementById('store');
		const tooltip = document.getElementById('tooltip');
		if (!store || !tooltip) return;
		overlay.watching = true;
		const marker = new MutationObserver(applyOverlay);
		for (const id of UPGRADE_BOXES) {
			const box = document.getElementById(id);
			if (box) marker.observe(box, { childList: true });
		}
		store.addEventListener('mouseover', function (event) {
			const item = storeItemAt(event.target);
			overlay.hover = item ? item.id : '';
			// The game has usually drawn its tooltip by now; the observer below catches the later redraws.
			extendTooltip();
		});
		store.addEventListener('mouseout', function (event) {
			if (!storeItemAt(event.relatedTarget)) overlay.hover = '';
		});
		new MutationObserver(extendTooltip).observe(tooltip, { childList: true });
	}

	function refreshOverlay(now) {
		watchStore();
		if (!isOverlayOn()) {
			overlay.ratings = new Map();
		} else if (now >= overlay.nextRatingAt) {
			computeRatings(now);
			// While fast buying is going through the store, the ratings are redone once a second at most.
			if (calc.ready && now < state.fastBuyingUntil) overlay.nextRatingAt = now + FAST_OVERLAY_REFRESH_MS;
		}
		applyOverlay();
	}

	/* =====================================================================
	   PANEL
	   AFK Baker's own panel, opened from a tab under the news ticker. It is drawn only when the player
	   does something, so nothing is ever replaced under a field being edited or a drag in progress.
	   ===================================================================== */

	// There is no menu hook, so Game.UpdateMenu is wrapped: the Options menu gets one line with a button
	// that opens the panel, and the panel closes when one of the game's menus opens in its place.
	function installMenuHook() {
		const originalUpdateMenu = Game.UpdateMenu;
		Game.UpdateMenu = function () {
			const result = originalUpdateMenu.apply(this, arguments);
			if (Game.onMenu !== '') closePanel();
			if (Game.onMenu === 'prefs') addOptionsLine();
			return result;
		};
	}

	function addOptionsLine() {
		const menu = document.getElementById('menu');
		if (!menu || document.getElementById('afkBakerOptionsLine')) return;
		const line = document.createElement('div');
		line.id = 'afkBakerOptionsLine';
		line.className = 'block';
		line.style.cssText = 'padding:0px;margin:8px 4px;';
		line.innerHTML = '<div class="subsection" style="padding:0px;">' +
			`<div class="title">AFK Baker <small style="opacity:0.6;">v${VERSION}</small></div>` +
			'<div class="listing"><label>AFK Baker\'s settings and status are in its own panel.</label>' +
			'<a class="smallFancyButton option" id="afkBakerOpenFromOptions">Open AFK Baker</a></div></div>';
		line.querySelector('#afkBakerOpenFromOptions').addEventListener('click', function () {
			PlaySound('snd/tick.mp3');
			openPanel();
		});
		// The prefs menu ends with an empty spacer div; slot in just above it.
		if (menu.lastElementChild) menu.insertBefore(line, menu.lastElementChild);
		else menu.appendChild(line);
	}

	function escapeHtml(text) {
		return String(text).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	function toggleButton(key, label) {
		const on = settings()[key];
		return `<a class="smallFancyButton prefButton option${on ? '' : ' off'}" data-afk-toggle="${key}">${label} ${on ? 'ON' : 'OFF'}</a>`;
	}

	function cycleButton(key, label) {
		const value = CYCLE_OPTIONS[key][settings()[key]];
		return `<a class="smallFancyButton option" data-afk-cycle="${key}">${label}: ${value}</a>`;
	}

	// max-width keeps wide fields (aura dropdowns, the threshold box) inside a narrow Options column.
	const FIELD_STYLE = 'background:#000;color:#ccc;border:1px solid #ccc;padding:3px 6px;font-size:12px;margin:2px 4px 2px 0px;max-width:calc(100% - 20px);';

	// Layout for the panel, the lump priority list and the store overlay. Borders, fonts and buttons come from the game's own classes
	// (smallFramed, smallFancyButton, option, tinyProductIcon). The game runs Electron 11 (Chromium 87),
	// so nothing newer than that is used.
	const STYLES = `
#afkBakerMenu .afk-palette{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));grid-gap:6px;padding:4px 16px 8px;}
#afkBakerMenu .afk-tile{padding:5px 2px 4px;text-align:center;cursor:grab;user-select:none;touch-action:none;overflow:hidden;}
#afkBakerMenu .afk-tile:hover{border-color:#fff;}
#afkBakerMenu .afk-unowned{opacity:0.45;}
#afkBakerMenu .afk-tile .afk-icon{margin:0 auto;}
#afkBakerMenu .afk-icon,.afk-ghost .afk-icon{width:32px;height:32px;pointer-events:none;}
#afkBakerMenu .afk-tile-name{font-family:'Merriweather',Georgia,serif;font-variant:small-caps;font-weight:bold;font-size:11px;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#afkBakerMenu .afk-tile-level{font-size:10px;opacity:0.75;margin-top:1px;}
#afkBakerMenu .afk-list{position:relative;margin:2px 16px 6px;overflow-x:auto;}
#afkBakerMenu .afk-row{display:grid;grid-template-columns:14px 18px 32px minmax(56px,1fr) 28px 44px 50px 42px 68px;grid-column-gap:4px;align-items:center;min-width:370px;min-height:36px;padding:1px 2px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:12px;}
#afkBakerMenu .afk-head{min-height:0;padding:2px 2px;font-size:11px;font-weight:bold;font-variant:small-caps;opacity:0.6;border-bottom:1px solid rgba(255,255,255,0.25);}
#afkBakerMenu .afk-handle{cursor:grab;user-select:none;touch-action:none;text-align:center;font-size:18px;line-height:32px;opacity:0.6;}
#afkBakerMenu .afk-handle:hover{opacity:1;}
#afkBakerMenu .afk-num,#afkBakerMenu .afk-cur,#afkBakerMenu .afk-need{text-align:center;}
#afkBakerMenu .afk-name{font-family:'Merriweather',Georgia,serif;font-variant:small-caps;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#afkBakerMenu .afk-target{width:28px;text-align:center;padding:3px 2px !important;}
#afkBakerMenu .afk-status{font-variant:small-caps;font-weight:bold;}
#afkBakerMenu .afk-status-done{opacity:0.5;}
#afkBakerMenu .afk-status-next .afk-status{color:#ffe38c;text-shadow:0px 0px 4px rgba(255,200,80,0.6);}
#afkBakerMenu .afk-status-waiting .afk-status{opacity:0.7;}
#afkBakerMenu .afk-btns{white-space:nowrap;text-align:right;}
#afkBakerMenu a.option.smallFancyButton.afk-mini{width:auto;min-width:0;padding:2px 4px;margin:0px 0px 0px 2px;text-align:center;font-size:10px;}
#afkBakerMenu .afk-stats{display:contents;}
#afkBakerMenu .afk-narrow .afk-row{grid-template-columns:14px 18px 32px minmax(0,1fr) 68px;grid-row-gap:2px;min-width:0;padding:3px 2px;}
#afkBakerMenu .afk-narrow .afk-row>:nth-child(1){grid-row:1 / span 2;}
#afkBakerMenu .afk-narrow .afk-stats{display:grid;grid-template-columns:28px 44px 50px 42px;grid-column-gap:4px;align-items:center;grid-row:2;grid-column:2 / span 4;}
#afkBakerMenu .afk-narrow .afk-row>:nth-child(6){grid-row:1;grid-column:5;}
#afkBakerMenu .afk-empty{padding:10px 4px;opacity:0.6;font-style:italic;}
#afkBakerMenu .afk-drop-line{display:none;position:absolute;left:0px;right:0px;height:3px;margin-top:-2px;border-radius:2px;background:#ffe38c;box-shadow:0px 0px 6px 1px rgba(255,200,80,0.8);pointer-events:none;z-index:5;}
#afkBakerMenu .afk-row.afk-drag-source{opacity:0.3;}
body.afk-dragging,body.afk-dragging *{cursor:grabbing !important;}
.afk-ghost{position:fixed;left:0px;top:0px;z-index:100000000;pointer-events:none;display:flex;align-items:center;padding:3px 10px 3px 4px;font-family:'Merriweather',Georgia,serif;font-variant:small-caps;font-weight:bold;font-size:13px;color:#fff;opacity:0.92;}
#afkOpen{position:absolute;left:50%;bottom:0px;transform:translateX(-50%);z-index:1001;height:16px;line-height:14px;padding:0px 10px;box-sizing:border-box;cursor:pointer;white-space:nowrap;font-family:'Merriweather',Georgia,serif;font-size:11px;color:#bbb;background:#000 url(img/darkNoise.jpg);border:1px solid;border-color:#ece2b6 #875526 #733726 #dfbc9a;border-bottom:none;border-radius:6px 6px 0px 0px;text-shadow:0px 1px 1px #000;}
#afkOpen:hover,#afkOpen.afk-selected{color:#fff;}
.afk-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#5fe36a;box-shadow:0px 0px 4px #5fe36a;}
.afk-dot-off{background:#555;box-shadow:none;}
.afk-dot-wait{background:#ffc94a;box-shadow:0px 0px 4px #ffc94a;}
.afk-dot-warn{background:#ff6b5e;box-shadow:0px 0px 4px #ff6b5e;}
#afkPanel{position:absolute;left:0px;right:0px;top:0px;bottom:0px;z-index:500;display:flex;flex-direction:column;background:#000 url(img/darkNoise.jpg);box-shadow:0px 0px 24px #000 inset;font-size:12px;color:#ccc;text-align:left;}
#afkPanelHead{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;padding:8px 8px 6px 16px;background:linear-gradient(to right,rgba(0,0,0,0.5),rgba(0,0,0,0));border-bottom:1px solid rgba(255,255,255,0.18);}
#afkPanelHead .afk-panel-name{font-family:'Merriweather',Georgia,serif;font-size:22px;color:#fff;text-shadow:0px 1px 4px #000;margin-right:10px;}
#afkPanelHead .afk-panel-name small{font-size:12px;opacity:0.6;}
#afkPanelHead .afk-grow{flex:1 1 auto;}
#afkPanelHead a.option.afk-pause{min-width:74px;text-align:center;}
#afkPanelHead a.option.afk-is-paused{color:#ffd84a;border-color:#ffd84a;}
#afkPanelHead a.option.afk-close{min-width:0px;width:auto;padding:4px 8px;}
#afkPanelTabs{flex:0 0 auto;display:flex;flex-wrap:wrap;padding:6px 8px 0px 12px;border-bottom:1px solid #875526;}
#afkPanelTabs .afk-tab{padding:5px 9px 6px;margin-right:2px;cursor:pointer;color:#999;border:1px solid transparent;border-bottom:none;border-radius:4px 4px 0px 0px;white-space:nowrap;position:relative;top:1px;}
#afkPanelTabs .afk-tab:hover{color:#fff;}
#afkPanelTabs .afk-tab.afk-selected{color:#fff;border-color:#ece2b6 #875526 transparent #dfbc9a;background:#1c1c1c;}
#afkPanelTabs .afk-tab-addon{font-style:italic;}
#afkPanelBody{flex:1 1 auto;min-height:0px;overflow-y:auto;overflow-x:hidden;padding:6px 0px 24px;}
#afkPanel.afk-panel-narrow #afkPanelHead{padding:5px 6px 4px 12px;}
#afkPanel.afk-panel-narrow #afkPanelHead .afk-panel-name{font-size:16px;}
#afkPanel.afk-panel-narrow #afkPanelTabs{padding:4px 6px 0px 8px;}
#afkPanel.afk-panel-narrow #afkPanelTabs .afk-tab{padding:3px 6px 4px;}
#afkPanel .afk-paused{margin:4px 16px 8px;padding:6px 10px;border:1px solid #ffd84a;color:#ffd84a;border-radius:3px;}
#afkPanel .afk-dash{display:grid;grid-template-columns:14px minmax(86px,120px) minmax(0,1.4fr) minmax(0,1fr);grid-column-gap:8px;align-items:baseline;padding:5px 16px;border-bottom:1px solid rgba(255,255,255,0.07);cursor:pointer;line-height:1.3;}
#afkPanel .afk-dash:hover{background:rgba(255,255,255,0.05);}
#afkPanel .afk-dash .afk-dot{margin-right:0px;}
#afkPanel .afk-dash-head{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.5;cursor:default;padding-top:2px;padding-bottom:2px;}
#afkPanel .afk-dash-head:hover{background:none;}
#afkPanel .afk-dash-name{font-family:'Merriweather',Georgia,serif;font-size:13px;color:#fff;}
#afkPanel .afk-dash-now{color:#ddd;}
#afkPanel .afk-dash-wait{color:#aaa;}
#afkPanel .afk-dash-off .afk-dash-name,#afkPanel .afk-dash-off .afk-dash-now{opacity:0.5;}
#afkPanel.afk-panel-narrow .afk-dash{grid-template-columns:14px minmax(0,1fr);}
#afkPanel.afk-panel-narrow .afk-dash-now,#afkPanel.afk-panel-narrow .afk-dash-wait{grid-column:2;}
#afkPanel.afk-panel-narrow .afk-dash-wait:before{content:'Waiting for: ';font-size:10px;text-transform:uppercase;letter-spacing:0.4px;opacity:0.6;}
#afkPanel.afk-panel-narrow .afk-dash-nothing,#afkPanel.afk-panel-narrow .afk-dash-head{display:none;}
#afkPanel .afk-hint{display:inline-block;width:15px;height:15px;line-height:14px;text-align:center;border-radius:50%;border:1px solid #888;color:#aaa;font-size:10px;cursor:help;margin:0px 4px 0px 2px;}
#afkPanel .afk-hint:hover{color:#fff;border-color:#fff;}
#afkPanel .afk-legend{display:grid;grid-template-columns:16px minmax(90px,max-content) 28px minmax(0,1fr);grid-gap:5px 8px;align-items:baseline;padding:4px 16px;}
#afkPanel .afk-legend b{color:#fff;font-weight:normal;opacity:1;}
#afkPanel.afk-panel-narrow .afk-legend{grid-template-columns:16px minmax(0,1fr) 28px;}
#afkPanel.afk-panel-narrow .afk-legend span:nth-child(4n){grid-column:2 / span 2;opacity:0.7;}
#afkPanel .afk-changes{margin:4px 0px 2px;padding:6px 8px;border:1px solid rgba(255,255,255,0.2);border-radius:3px;line-height:1.5;max-height:180px;overflow-y:auto;}
#afkPanel textarea{resize:vertical;}
#afkBakerOptionsLine a.option{margin-left:8px;}
.afk-mark{display:inline-block;width:10px;height:10px;border:1px solid #000;box-shadow:0px 0px 0px 1px rgba(255,255,255,0.6);vertical-align:-1px;}
.afk-mark[data-afk-rating="best"],.crate.upgrade[data-afk-rating="best"]:after,.product[data-afk-rating="best"] .price:after{background:var(--afk-best,#ffd84a);box-shadow:0px 0px 0px 1px #fff,0px 0px 6px var(--afk-best,#ffd84a);}
.afk-mark[data-afk-rating="close"],.crate.upgrade[data-afk-rating="close"]:after,.product[data-afk-rating="close"] .price:after{background:var(--afk-close,#56e0d0);}
.afk-mark[data-afk-rating="average"],.crate.upgrade[data-afk-rating="average"]:after,.product[data-afk-rating="average"] .price:after{background:var(--afk-average,#8fb8ff);}
.afk-mark[data-afk-rating="poor"],.crate.upgrade[data-afk-rating="poor"]:after,.product[data-afk-rating="poor"] .price:after{background:var(--afk-poor,#c79bff);}
.afk-mark[data-afk-rating="none"],.crate.upgrade[data-afk-rating="none"]:after,.product[data-afk-rating="none"] .price:after{background:var(--afk-none,#8a8a8a);}
.afk-mark[data-afk-rating="utility"],.crate.upgrade[data-afk-rating="utility"]:after{background:linear-gradient(var(--afk-utility,#7be07b),var(--afk-utility,#7be07b)) center/2px 100% no-repeat,linear-gradient(var(--afk-utility,#7be07b),var(--afk-utility,#7be07b)) center/100% 2px no-repeat,#163016;}
.afk-mark[data-afk-rating="research"],.crate.upgrade[data-afk-rating="research"]:after{background:radial-gradient(circle,#111 0px,#111 2px,var(--afk-research,#f4efe0) 3px);}
.afk-mark[data-afk-rating="skip"],.crate.upgrade[data-afk-rating="skip"]:after{background:repeating-linear-gradient(135deg,#111 0px,#111 2px,#e9e9e9 2px,#e9e9e9 4px);}
.crate.upgrade[data-afk-rating]:after{content:'';position:absolute;left:-1px;top:-1px;width:10px;height:10px;border:1px solid #000;box-shadow:0px 0px 0px 1px rgba(255,255,255,0.6);z-index:20;pointer-events:none;}
.product[data-afk-rating] .price:after{content:'';display:inline-block;width:8px;height:8px;margin-left:6px;border:1px solid #000;box-shadow:0px 0px 0px 1px rgba(255,255,255,0.6);}
.product[data-afk-rating="best"] .price{text-shadow:-1px 0px 0px var(--afk-best-edge,#000),1px 0px 0px var(--afk-best-edge,#000),0px -1px 0px var(--afk-best-edge,#000),0px 1px 0px var(--afk-best-edge,#000),0px 0px 4px var(--afk-best-edge,#000),0px 2px 4px #000;}
.product[data-afk-rating="close"] .price{text-shadow:-1px 0px 0px var(--afk-close-edge,#000),1px 0px 0px var(--afk-close-edge,#000),0px -1px 0px var(--afk-close-edge,#000),0px 1px 0px var(--afk-close-edge,#000),0px 0px 4px var(--afk-close-edge,#000),0px 2px 4px #000;}
.product[data-afk-rating="average"] .price{text-shadow:-1px 0px 0px var(--afk-average-edge,#000),1px 0px 0px var(--afk-average-edge,#000),0px -1px 0px var(--afk-average-edge,#000),0px 1px 0px var(--afk-average-edge,#000),0px 0px 4px var(--afk-average-edge,#000),0px 2px 4px #000;}
.product[data-afk-rating="poor"] .price{text-shadow:-1px 0px 0px var(--afk-poor-edge,#000),1px 0px 0px var(--afk-poor-edge,#000),0px -1px 0px var(--afk-poor-edge,#000),0px 1px 0px var(--afk-poor-edge,#000),0px 0px 4px var(--afk-poor-edge,#000),0px 2px 4px #000;}
.product[data-afk-rating="none"] .price{text-shadow:-1px 0px 0px var(--afk-none-edge,#000),1px 0px 0px var(--afk-none-edge,#000),0px -1px 0px var(--afk-none-edge,#000),0px 1px 0px var(--afk-none-edge,#000),0px 0px 4px var(--afk-none-edge,#000),0px 2px 4px #000;}
.product[data-afk-rating="best"] .price{color:var(--afk-best,#ffd84a) !important;}
.product[data-afk-rating="close"] .price{color:var(--afk-close,#56e0d0) !important;}
.product[data-afk-rating="average"] .price{color:var(--afk-average,#8fb8ff) !important;}
.product[data-afk-rating="poor"] .price{color:var(--afk-poor,#c79bff) !important;}
.product[data-afk-rating="none"] .price{color:var(--afk-none,#d0d0d0) !important;}
#afkRatingBar{display:flex;flex-wrap:wrap;align-items:center;padding:3px 8px;background:rgba(0,0,0,0.55);font-size:11px;line-height:14px;color:#ddd;text-shadow:0px 1px 1px #000;position:relative;z-index:1;}
#afkRatingBar .afk-count{display:inline-flex;align-items:center;margin-right:10px;cursor:default;}
#afkRatingBar .afk-count .afk-mark{margin-right:4px;}
#afkOpen{max-width:calc(100% - 150px);overflow:hidden;text-overflow:ellipsis;}
#afkBuyLine{margin-left:8px;padding-left:8px;border-left:1px solid #666;font-family:Tahoma,Arial,sans-serif;font-size:10px;color:#ddd;}
#afkBuyLine:hover{color:#fff;text-decoration:underline;}
#afkBuyLine:empty{display:none;}
#afkPanel input.afk-color{width:26px;height:16px;padding:0px;margin:0px;border:1px solid #777;background:#000;cursor:pointer;vertical-align:middle;}
#afkPanel .afk-pantheon{position:relative;margin:4px 12px 8px;padding:10px 8px 8px;text-align:center;border-radius:4px;background:url(img/shadedBorders.png),url(img/BGpantheon.jpg);background-size:100% 100%,auto;}
#afkPanel .afk-pantheon-slots{display:flex;justify-content:center;flex-wrap:wrap;margin-bottom:4px;}
#afkPanel .afk-pslot-wrap{display:flex;flex-direction:column;align-items:center;width:96px;margin:0px 6px 6px;position:relative;}
#afkPanel .afk-pslot-wrap .afk-mini{position:absolute;right:4px;top:0px;}
#afkPanel .afk-pslot.afk-pslot-hover{filter:brightness(1.4);}
#afkPanel .afk-pslot .afk-god{position:absolute;left:0px;top:0px;margin:0px;}
#afkPanel .afk-pslot-label{font-size:11px;line-height:1.3;margin-top:4px;color:#fff;text-shadow:0px 1px 2px #000,0px 0px 4px #000;}
#afkPanel .afk-pslot-label small{opacity:0.75;}
#afkPanel .afk-pantheon-info{display:inline-block;margin:2px auto 6px;padding:4px 14px;font-size:11px;color:rgba(255,255,255,0.8);background:rgba(0,0,0,0.75);border-radius:12px;}
#afkPanel .afk-pantheon-roster{text-align:center;}
#afkPanel .afk-pantheon-roster .afk-god{margin:3px;}
#afkPanel .afk-god{touch-action:none;}
#afkPanel .afk-god-picked{opacity:0.45;}
#afkPanel .afk-god-refused{filter:grayscale(100%);opacity:0.4;}
#afkPanel .afk-god-selected{outline:2px solid #ffd84a;}
.afk-god-ghost{position:fixed;left:0px;top:0px;z-index:100000000;pointer-events:none;opacity:0.9;}
#afkPanel .afk-aura-slots{display:flex;flex-wrap:wrap;padding:4px 12px;}
#afkPanel .afk-aura-slot{display:flex;align-items:center;margin:2px 4px;padding:6px 12px 6px 10px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer;flex:1 1 180px;min-width:0px;max-width:280px;box-sizing:border-box;}
#afkPanel .afk-aura-slot:hover,#afkPanel .afk-aura-slot.afk-selected{border-color:#ece2b6;background:rgba(255,255,255,0.06);}
#afkPanel .afk-aura-slot .crate{float:none;margin:0px 12px 0px 0px;flex:0 0 auto;}
#afkPanel .afk-aura-slot-text{line-height:1.4;}
#afkPanel .afk-aura-grid{display:flex;flex-wrap:wrap;padding:6px 14px;}
#afkPanel .afk-aura{position:relative;cursor:pointer;margin:6px;}
#afkPanel .afk-aura-locked .crate{filter:grayscale(100%);opacity:0.45 !important;}
#afkPanel .afk-aura-taken{opacity:0.3;cursor:not-allowed;}
#afkPanel .afk-aura-level{position:absolute;left:-4px;right:-4px;bottom:-4px;z-index:20;text-align:center;font-size:10px;font-weight:bold;color:#fff;text-shadow:0px 0px 3px #000,0px 1px 1px #000;pointer-events:none;}
#afkPanel .afk-stats-wrap{margin:4px 12px 8px;overflow-x:auto;}
#afkPanel table.afk-stats{border-collapse:collapse;font-size:11px;line-height:1.35;}
#afkPanel .afk-stats th,#afkPanel .afk-stats td{padding:3px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.08);vertical-align:top;}
#afkPanel .afk-stats th{color:#fff;font-weight:bold;}
#afkPanel .afk-stats th small,#afkPanel .afk-stats td small{font-weight:normal;opacity:0.6;}
#afkPanel .afk-stats td small{margin-left:4px;}
#afkPanel .afk-stats th:first-child,#afkPanel .afk-stats td:first-child{text-align:left;position:sticky;left:0px;background:#0b0b0b;}
#afkPanel .afk-stats td.afk-stats-live{color:#fff;}
#afkPanel .afk-stats tr.afk-stats-section td{padding-top:10px;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:rgba(255,255,255,0.6);border-bottom:1px solid rgba(255,255,255,0.25);}
#afkPanel .afk-seasons th,#afkPanel .afk-seasons td{text-align:left;}
#afkPanel .afk-seasons td.afk-seasons-missing{white-space:normal;min-width:120px;max-width:260px;}
#tooltip .afk-tip{margin:0px 8px 8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.2);font-size:11px;text-align:left;position:relative;}
#tooltip .afk-tip-who{font-size:9px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.55;}
#tooltip .afk-tip-rating{font-size:13px;color:#fff;margin:2px 0px;}
#tooltip .afk-tip td{padding:1px 10px 1px 0px;vertical-align:top;}
#tooltip .afk-tip td:first-child{opacity:0.6;white-space:nowrap;}
`;

	function installStyles() {
		if (document.getElementById('afkBakerStyles')) return;
		const style = document.createElement('style');
		style.id = 'afkBakerStyles';
		style.textContent = STYLES;
		document.head.appendChild(style);
	}

	function numberInput(key, width) {
		return `<input type="text" inputmode="numeric" data-afk-number="${key}" value="${settings()[key]}" ` +
			`style="width:${width || 90}px;${FIELD_STYLE}">`;
	}

	// The threshold in the game's own number format, to check the digits against.
	function thresholdReadable(value) {
		return Number.isFinite(value) ? `= ${Beautify(value)}` : 'not a number, the old value is kept';
	}

	function lumpButton(action, index, label, title) {
		const mini = title ? ` afk-mini" title="${title}` : '';
		return `<a class="smallFancyButton option${mini}" data-afk-lump="${action}" data-index="${index}">${label}</a>`;
	}

	// Drawn the way the store does it: a 64px tile of img/buildings.png (column 0, row building.icon,
	// or iconFunc for the Grandma's grandmapocalypse faces), shown at half size by .tinyProductIcon.
	function buildingIconHtml(building) {
		const icon = building.iconFunc ? building.iconFunc() : [0, building.icon];
		return `<div class="afk-icon"><div class="tinyProductIcon" style="background-position:-${icon[0] * 64}px -${icon[1] * 64}px;"></div></div>`;
	}

	function lumpPaletteHtml() {
		const tiles = Object.keys(Game.Objects).map(function (name) {
			const building = Game.Objects[name];
			const owned = building.amount > 0;
			return `<div class="afk-tile smallFramed${owned ? '' : ' afk-unowned'}" data-afk-drag="palette" data-building="${escapeHtml(name)}" ` +
				`title="${escapeHtml(name)}: level ${building.level}, ${owned ? `${building.amount} owned` : 'none owned yet'}. Drag into the list to add it.">` +
				buildingIconHtml(building) +
				`<div class="afk-tile-name">${escapeHtml(name)}</div>` +
				`<div class="afk-tile-level">Lv ${building.level}</div></div>`;
		});
		return `<div class="afk-palette">${tiles.join('')}</div>`;
	}

	function lumpListHtml() {
		const rows = lumpPlan().map(function (item, i) {
			const need = item.cost > 0 ? Beautify(item.cost) : '-';
			return `<div class="afk-row afk-status-${item.status}" data-afk-row="${i}">` +
				`<div class="afk-handle" data-afk-drag="row" data-index="${i}" title="Drag to reorder">&#8801;</div>` +
				`<div class="afk-num">${i + 1}</div>` +
				buildingIconHtml(item.building) +
				`<div class="afk-name" title="${escapeHtml(item.entry.building)}">${escapeHtml(item.entry.building)}</div>` +
				'<div class="afk-stats">' +
				`<div class="afk-cur">${item.building.level}</div>` +
				`<div><input type="text" inputmode="numeric" class="afk-target" data-afk-lump-target="${i}" value="${item.entry.level}" ` +
				`title="Target level" style="${FIELD_STYLE}"></div>` +
				`<div class="afk-status">${item.status}</div>` +
				`<div class="afk-need">${need}</div></div>` +
				'<div class="afk-btns">' + lumpButton('up', i, '&#9650;', 'Move up') + lumpButton('down', i, '&#9660;', 'Move down') +
				lumpButton('remove', i, '&#10005;', 'Remove') + '</div></div>';
		});
		const head = '<div class="afk-row afk-head"><div></div><div>#</div><div></div><div>Building</div>' +
			'<div class="afk-stats"><div class="afk-cur">Now</div><div>Target</div><div>Status</div><div class="afk-need">Needed</div></div><div></div></div>';
		const body = rows.length ? rows.join('') : '<div class="afk-empty">Empty, so nothing will be levelled. Drag a building here, or use Add below.</div>';
		return `<div class="afk-list" id="afkLumpList">${head}${body}<div class="afk-drop-line" id="afkDropLine"></div></div>`;
	}

	function lumpPriorityHtml() {
		const draft = state.lumpDraft;
		const options = Object.keys(Game.Objects).map(function (name) {
			return `<option value="${escapeHtml(name)}"${name === draft.building ? ' selected' : ''}>${escapeHtml(name)}</option>`;
		}).join('');
		return listing('<label>Buildings: drag one into the list to add it (target = its level + 1). Dimmed ones aren\'t owned yet but can still be levelled.</label>') +
			lumpPaletteHtml() +
			listing('<label>Priority list, levelled from the top down. Drag &#8801; to reorder, or edit a target level in place.</label>') +
			lumpListHtml() +
			listing(`<label>Add</label> <select data-afk-lump-field="building" style="${FIELD_STYLE}">${options}</select>` +
				`<label>to level</label> <input type="text" inputmode="numeric" data-afk-lump-field="level" ` +
				`value="${escapeHtml(draft.level)}" style="width:50px;${FIELD_STYLE}">` +
				lumpButton('add', -1, 'Add')) +
			listing(lumpButton('reset', -1, 'Reset to default') + note('Farm, Temple, Wizard tower and Bank to level 1, which unlocks their minigames'));
	}

	function heading(text) {
		return `<div class="listing" style="font-weight:bold;font-size:14px;margin-top:10px;border-bottom:1px solid rgba(255,255,255,0.2);">${text}</div>`;
	}

	function listing(content) {
		return `<div class="listing">${content}</div>`;
	}

	function note(text) {
		return `<label>(${text})</label>`;
	}

	function reserveLabel() {
		const mode = settings().reserveMode;
		if (mode !== 'auto') return RESERVE_MODES[mode];
		const minutesLeft = autoReserveMinutesLeft();
		return minutesLeft > 0 ? `Auto: none for another ${Math.ceil(minutesLeft)} min` : 'Auto: Lucky';
	}

	function wrinklerLine() {
		const summary = wrinklerSummary();
		if (settings().wrinklerMode === 'feed') {
			let line = `Wrinklers: ${summary.normal + summary.shinies} feeding, ` +
				`${Beautify(summary.normalPayout + summary.shinyPayout)} cookies pending at ascension`;
			if (summary.shinies > 0) line += ` (includes ${summary.shinies} shiny)`;
			return line;
		}
		let line = `Wrinklers: ${summary.normal} feeding, ${Beautify(summary.normalPayout)} cookies if popped`;
		if (summary.shinies > 0) line += ` (plus ${summary.shinies} shiny, never popped)`;
		return line;
	}

	function formatDuration(ms) {
		const minutes = Math.max(0, Math.ceil(ms / 60000));
		const hours = Math.floor(minutes / 60);
		return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
	}

	function lumpLines() {
		if (!Game.canLumps()) return ['Sugar lumps: not unlocked yet (they start once you have baked a billion cookies)'];
		const s = settings();
		const age = lumpAge();
		let harvest;
		if (isBornAgain()) harvest = 'auto-harvest and auto-spend are paused during Born again';
		else if (!isLumpRipe()) harvest = `current lump ripe in ${formatDuration(Game.lumpRipeAge - age)}`;
		else if (s.autoHarvestLumps) harvest = 'current lump is ripe, harvesting';
		else harvest = `current lump is ripe, the game drops it in ${formatDuration(Game.lumpOverripeAge - age)}`;
		if (!s.autoHarvestLumps && !isBornAgain()) harvest += ', auto-harvest off';
		let lumpLine = `Sugar lumps: ${lumpCount(Game.lumps)} owned, ${harvest}`;
		if (state.lastHarvest) lumpLine += `. Last harvest: ${state.lastHarvest}`;

		let spend;
		const next = nextLumpSpend();
		if (!next) {
			spend = 'priority list complete';
		} else {
			const need = next.cost + s.keepLumps - Game.lumps;
			spend = `Next: ${next.building.name} to level ${next.building.level + 1}` +
				(next.target > next.building.level + 1 ? ` (target ${next.target})` : '') +
				(need > 0 ? `, ${Beautify(need)} more ${need === 1 ? 'lump' : 'lumps'} needed` : `, costs ${lumpCount(next.cost)}`) +
				(next.building.amount === 0 ? ', none owned yet' : '') +
				`. ${lumpCount(lumpsToFinishList())} to finish the list`;
		}
		let spendLine = `Lump spending: ${s.autoSpendLumps ? '' : 'auto-spend off. '}${spend}`;
		if (state.lastLevelUp) spendLine += `. Last: ${state.lastLevelUp}`;
		return [lumpLine, spendLine];
	}

	// A cookie amount as time at unbuffed CpS: "14 min", "3.5 hours" or "12 days".
	function cpsTime(cookies) {
		const cps = Game.unbuffedCps;
		if (!(cps > 0)) return 'unknown time, no CpS yet';
		const minutes = cookies / cps / 60;
		if (minutes < 1) return 'under 1 min';
		if (minutes < 120) return `${Math.round(minutes)} min`;
		if (minutes < 2880) return `${(minutes / 60).toFixed(1)} hours`;
		return `${Beautify(Math.round(minutes / 1440))} days`;
	}

	function capitalize(text) {
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	function sacrificeLabel(step) {
		if (step.everyBuilding) return `sacrifice ${step.everyBuilding} of every building`;
		return `sacrifice ${step.buildings[0].amount} ${capitalize(step.buildings[0].building.plural)}`;
	}

	// The next training step, what it costs and what it's waiting for.
	function dragonTrainingText() {
		if (!hasDragonEgg()) {
			const egg = Game.Upgrades['A crumbly egg'];
			if (isInStore(egg)) return `Next: buy A crumbly egg (${Beautify(egg.getPrice())} cookies)`;
			if (!Game.Has('How to bake your dragon')) return 'No egg: it needs the heavenly upgrade "How to bake your dragon"';
			return 'No egg yet: it appears once 1 million cookies are baked this run';
		}
		const step = dragonStep();
		if (!step) return 'Fully trained';
		if (step.cookies > 0) {
			const reserve = reserveAmount();
			const shortfall = step.cookies + reserve - Game.cookies;
			const waiting = shortfall > 0 ? `waiting for ${Beautify(shortfall)} more cookies${reserve > 0 ? ', reserve included' : ''}` : 'ready';
			return `Next: level ${Game.dragonLevel + 1} for ${Beautify(step.cookies)} cookies (${waiting})`;
		}

		const plan = sacrificePlan(step);
		const cheap = isCheapSacrifice(plan);
		const limit = `waiting for under ${settings().dragonTrainMinutes} min`;
		let detail;
		if (!plan.missing.length) {
			detail = `rebuy cost ${cpsTime(plan.total)} of CpS, ${cheap ? 'ready' : limit}`;
		} else {
			const first = plan.missing[0];
			const shortText = plan.missing.length === 1 ?
				`${first.amount} ${capitalize(first.building.plural)} short` :
				`short on ${plan.missing.length} kinds of building`;
			const cost = `buying them and rebuying costs ${cpsTime(plan.total)} of CpS`;
			if (!cheap) {
				detail = `${shortText}; ${cost}, ${limit}`;
			} else {
				const shortfall = first.cost + first.amount - 1 + reserveAmount() - Game.cookies;
				detail = `${shortText}; ${cost}, buying them first` + (shortfall > 0 ? `, need ${Beautify(shortfall)} more cookies` : '');
			}
		}
		return `Next: ${sacrificeLabel(step)} (${detail})`;
	}

	// The picks that aren't in place yet, and what each one is waiting for.
	function pendingAuraText() {
		const s = settings();
		const active = [Game.dragonAura, hasSecondAuraSlot() ? Game.dragonAura2 : 0];
		const notes = [];
		[s.dragonAura1, s.dragonAura2].forEach(function (name, slot) {
			const id = auraId(name);
			if (!id || active.indexOf(id) !== -1) return;
			if (Game.dragonLevel < auraUnlockLevel(id)) notes.push(`${name} waits for level ${auraUnlockLevel(id)}`);
			else if (slot === 1 && !hasSecondAuraSlot()) notes.push(`${name} (secondary) waits for a fully trained dragon`);
		});
		return notes.length ? ` Aura picks: ${notes.join(', ')}.` : '';
	}

	function petLine() {
		if (!Game.Has('Pet the dragon')) return 'Dragon petting: needs the heavenly upgrade "Pet the dragon"';
		if (!canPetForDrops()) return 'Dragon petting: drops start at dragon level 8';
		const found = dropsFound().length;
		if (found === DRAGON_DROPS.length) {
			const toBuy = DRAGON_DROPS_WITHOUT_PP.filter(function (name) { return isInStore(Game.Upgrades[name]); });
			return 'Dragon petting: all four drops found' + (toBuy.length ? `, buying ${toBuy.join(' and ')} when affordable` : '');
		}
		const now = new Date();
		const pets = state.petSession ? state.petSession.pets : 0;
		const waiting = state.petDoneWindow === petWindowKey(now) ?
			`waiting for the next quarter-hour (in ${15 - now.getMinutes() % 15} min)` :
			`petting (${pets} of up to ${MAX_PETS_PER_WINDOW} pets this quarter-hour)`;
		return `Dragon petting: ${found} of ${DRAGON_DROPS.length} drops found, ${waiting}`;
	}

	function dragonLines() {
		const s = settings();
		let line = 'Dragon: ';
		if (hasDragonEgg()) {
			const auras = [Game.dragonAura, hasSecondAuraSlot() ? Game.dragonAura2 : 0]
				.filter(function (id) { return id > 0; })
				.map(function (id) { return Game.dragonAuras[id].name; });
			const auraText = auras.length ? `aura${auras.length > 1 ? 's' : ''} ${auras.join(' + ')}` : 'no aura';
			line += `level ${Game.dragonLevel} of ${dragonMaxLevel()}, ${auraText}. `;
		}
		line += (s.autoTrainDragon ? '' : 'Auto-train off. ') + dragonTrainingText() + '.' + pendingAuraText();
		if (state.lastDragonAction) line += ` Last: ${state.lastDragonAction}.`;
		return s.autoPetDragon ? [line, petLine()] : [line];
	}

	function marketStaffLine(M) {
		const s = settings();
		const parts = [];
		if (s.autoBrokers) {
			const plan = brokerPlan(M);
			let text = `Brokers: ${M.brokers} of ${M.getMaxBrokers()} (buying fee ${(marketOverhead(M.brokers) * 100).toFixed(1)}%)`;
			if (plan.full) text += ', at the maximum';
			else if (plan.fill < plan.needed) text += `, the next pays off once a warehouse fill is worth ${dollars(plan.needed)} (now ${dollars(plan.fill)})`;
			else if (!canAfford(M.getBrokerPrice())) text += `, hiring the next when ${Beautify(M.getBrokerPrice())} cookies are spare`;
			else text += ', hiring the next';
			parts.push(text);
		}
		if (s.autoOffice) {
			const plan = officePlan(M);
			let text = `Office: level ${M.officeLevel + 1} of ${M.offices.length}`;
			if (!plan) {
				text += ', fully upgraded';
			} else {
				text += `, next upgrade sacrifices ${plan.cursors} Cursors`;
				if (!plan.hasLevel) text += ` (waiting for Cursor level ${plan.level})`;
				else if (!plan.hasCursors) text += ` (waiting until you own ${plan.cursors})`;
				else text += ` (rebuy cost ${cpsTime(plan.rebuyCost)} of CpS, ${isCheapOffice(plan) ? 'ready' : `waiting for under ${s.officeMinutes} min`})`;
			}
			parts.push(text);
		}
		if (state.lastMarketAction) parts.push(`Last: ${state.lastMarketAction}`);
		return 'Market staff: ' + parts.join('. ') + '.';
	}

	function marketLines() {
		const s = settings();
		const M = market();
		if (!M) return s.autoTrade ? ['Stock market: not unlocked yet (the Bank needs a level, bought with a sugar lump)'] : [];
		const held = holdingsValue(M);
		const budget = marketBudget(M);
		const holding = held.shares ?
			`Holding ${Beautify(held.shares)} shares in ${held.stocks} stock${held.stocks === 1 ? '' : 's'} worth ${dollars(held.value)}` :
			'Holding nothing';
		let line = 'Stock market: ' + (s.autoTrade ? `${MARKET_STRATEGIES[s.marketStrategy]}. ` : 'Auto-trade off. ') +
			`${holding}, profit this run ${dollars(M.profit)}. Budget ${dollars(budget.invested)} of ${dollars(budget.allowed)}.`;
		if (s.autoTrade && state.ascendPending) line += ' Selling everything before ascending.';
		if (state.lastTrade) line += ` Last: ${state.lastTrade}.`;
		return s.autoTrade && (s.autoBrokers || s.autoOffice) ? [line, marketStaffLine(M)] : [line];
	}

	function grimoireLines() {
		const s = settings();
		const M = grimoire();
		if (!M) return s.autoCast ? ['Grimoire: not unlocked yet (the Wizard tower needs a level, bought with a sugar lump)'] : [];
		const full = M.magic >= M.magicM;
		let line = `Grimoire: magic ${Math.floor(M.magic)} / ${M.magicM}, ` +
			(full ? 'full. ' : `full in ${formatDuration(secondsToFullMagic(M) * 1000)}. `);
		if (!s.autoCast) {
			line += 'Auto-cast off.';
		} else {
			const choice = spellChoice(M);
			if (!choice.spell) {
				line += 'An add-on is holding the cast.';
			} else {
				const name = choice.spell.name + (choice.byAddOn ? ' (picked by an add-on)' : '');
				const hold = castHoldReason(M, choice.spell, choice.byAddOn);
				line += hold ? `${name}: ${hold}.` : `Casting ${name}.`;
			}
		}
		if (state.lastCast) line += ` Last: ${state.lastCast}.`;
		return [line];
	}

	// Shown while any of the last purchases changed CpS differently than predicted.
	function predictionLines() {
		const misses = recentMisses();
		if (!misses) return [];
		return [`CpS predictions: ${misses} of the last ${calc.recentChecks.length} purchases were off (last: ${calc.lastMiss})`];
	}

	function fastBuyingNote() {
		return calc.fastMisses >= FAST_MAX_MISSES ? ` Fast buying is off for this run: ${calc.fastMisses} batches changed CpS differently than predicted.` : '';
	}

	function statusLines() {
		const s = settings();
		const progress = prestigeProgress();
		let ascendLine = `Prestige: ${Beautify(ascendProgressValue(progress))} / ${Beautify(s.ascendThreshold)} ` +
			(s.ascendMode === 'total' ? 'total' : 'gained this run');
		if (s.wrinklerMode === 'feed') ascendLine += ' (includes wrinkler payout)';
		if (s.autoTrade && market()) ascendLine += ' (stock sale counted where it adds to cookies baked)';
		if (!s.autoAscend) ascendLine += ', auto-ascend off';

		const lines = [
			`Auto-buy: ${state.buyStatus}`,
		].concat(predictionLines(), [
			`Cookie reserve: ${Beautify(reserveAmount())} (${reserveLabel()})`,
			wrinklerLine(),
		]).concat(lumpLines(), dragonLines(), marketLines(), grimoireLines(), [ascendLine]);
		if (s.autoAscend && state.ascendWarning) {
			lines.push('WARNING: Threshold already reached. Toggle auto-ascend off and on to confirm.');
		}
		if (state.lastError) lines.push(`Last error: ${state.lastError}`);
		return lines;
	}

	// Below this width the list's columns don't fit on one line, so each row takes two.
	const NARROW_LIST_PX = 390;
	let listWidthObserver = null;

	// Chromium 87 has no container queries; a single observer follows whichever list is current.
	function watchLumpListWidth(list) {
		if (!list || typeof ResizeObserver === 'undefined') return;
		if (!listWidthObserver) {
			listWidthObserver = new ResizeObserver(function (entries) {
				for (const entry of entries) {
					entry.target.classList.toggle('afk-narrow', entry.contentRect.width < NARROW_LIST_PX);
				}
			});
		}
		listWidthObserver.disconnect();
		list.classList.toggle('afk-narrow', list.clientWidth < NARROW_LIST_PX);
		listWidthObserver.observe(list);
	}

	/* ----- The panel: its tabs and their settings ----- */

	// AFK Baker's own tabs, in order. Tabs registered by add-ons come after them.
	const TABS = [
		['dashboard', 'Dashboard'], ['clickers', 'Clickers'], ['autobuy', 'Auto-buy'], ['lumps', 'Sugar lumps'], ['dragon', 'Dragon'], ['pantheon', 'Pantheon'],
		['market', 'Stock Market'], ['grimoire', 'Grimoire'], ['ascend', 'Auto-ascend'], ['seasons', 'Seasons'], ['stats', 'Stats'], ['other', 'Other'],
	];

	// A "?" that shows an explanation in the game's own tooltip when hovered.
	function hint(text) {
		const tip = `<div style="padding:8px;width:300px;font-size:11px;line-height:1.35;">${escapeHtml(text)}</div>`;
		return `<span class="afk-hint" ${Game.getTooltip(tip, 'this')}>?</span>`;
	}

	function actionButton(action, label, extraClass) {
		return `<a class="smallFancyButton option${extraClass ? ' ' + extraClass : ''}" data-afk-action="${action}">${label}</a>`;
	}

	function clickersTabHtml() {
		const s = settings();
		return listing(`<label>Big cookie clicks per second</label> ${numberInput('clickRate')}` +
				hint(`0 turns the autoclicker off. The most the game accepts is ${MAX_CLICK_RATE}. It keeps clicking while the game is minimized.`)) +
			listing(toggleButton('muteCookieClick', 'Mute big cookie click sound') +
				hint('Silences the big cookie click, for your clicks and the autoclicker. Every other sound stays on.')) +
			listing(toggleButton('clickGolden', 'Golden cookies') + (s.clickGolden ? toggleButton('clickWrath', 'Include wrath cookies') : '')) +
			listing(toggleButton('clickReindeer', 'Reindeer')) +
			listing(cycleButton('wrinklerMode', 'Wrinklers') +
				hint('Feed: lets wrinklers feed and pops them right before an auto-ascend. Pop instantly: pops each one as it appears. Off: leaves them alone. Shiny wrinklers are only ever popped by Feed mode, right before ascending.')) +
			listing(toggleButton('clickFortunes', 'Fortune tickers') + (s.clickFortunes ? cycleButton('fortuneMode', 'Click') : ''));
	}

	// The legend, with a color picker for every rating that has a color. Skipped is a pattern.
	function legendHtml() {
		const rows = RATING_ORDER.map(function (rating) {
			const picker = hasKey(DEFAULT_COLORS, rating) ?
				`<span><input type="color" class="afk-color" data-afk-color="${rating}" value="${ratingColor(rating)}" title="Color for ${RATINGS[rating].label}"></span>` : '<span></span>';
			return `<span class="afk-mark" data-afk-rating="${rating}"></span><b>${RATINGS[rating].label}</b>${picker}<span>${RATINGS[rating].legend}</span>`;
		});
		return `<div class="afk-legend">${rows.join('')}</div>`;
	}

	function autobuyTabHtml() {
		const s = settings();
		let html = listing(toggleButton('autoBuy', 'Auto-buy') +
			hint('Buys the upgrade or building (1, 10 or 100 at once) with the lowest payback period, and saves up for it rather than buying something worse. With the autoclicker on, click upgrades such as the mouse upgrades are ranked by the click income they add.'));
		html += listing(toggleButton('showBuyLine', 'Show what auto-buy is doing under the news ticker') +
			hint('A short line next to the AFK Baker tab, such as "Saving for 10x Fractal engine (2h 41m)", "Fast buying", "Paused" or "Auto-buy off". It changes at most once a second. Click it to open this tab.'));
		if (s.autoBuy) {
			html += listing(toggleButton('buyResearch', 'Buy research') + hint('Research upgrades advance the grandmapocalypse.')) +
				(s.buyResearch ? listing(cycleButton('grandmaLimit', 'Stop the grandmapocalypse at') + hint(grandmaLimitTip())) : '') +
				listing(toggleButton('elderPledge', 'Elder Pledge') +
					hint('Pledging stops wrinklers from spawning. Never pledges in Feed mode or while a shiny wrinkler is on screen. It is also held while Auto seasons collects in Halloween, which needs wrinklers.'));
		}
		if (s.autoBuy) {
			html += listing(toggleButton('buyUtility', 'Buy no-payback upgrades') +
				(s.buyUtility ? `<label>when they cost less than</label> ${numberInput('utilityMinutes', 50)}<label>minutes of CpS</label>` : '') +
				hint('Some upgrades help without raising CpS, so they have no payback period: golden cookie, reindeer and wrinkler upgrades, cheaper prices, more drops. They are bought once they cost less than this many minutes of unbuffed CpS, at most one each pass, respecting the cookie reserve, and never when that would hold up what auto-buy is saving for. Click upgrades are left out while the autoclicker is off, and offline-income upgrades unless you own Twin Gates of Transcendence.'));
			if (s.buyUtility) {
				html += listing(`<label>Ones priced in CpS: when they cost less than</label> ${numberInput('utilityCpsMinutes', 50)}<label>minutes of CpS</label>` +
					hint('A few are priced by the game as a share of your CpS, so they never get cheaper by waiting: Green yeast digestives (180 minutes), Ichor syrup (120), Fern tea (60), the dragon drops (30, or 3 with a fully trained dragon), and Fortune #102 (a day, until your CpS is very high). They have their own, higher limit. Set it to 0 to never buy them.'));
			}
		}
		html += listing(cycleButton('reserveMode', 'Cookie reserve') +
			hint('How many cookies always stay banked. Auto-buy, dragon training and the stock market all respect it. Off by default. Lucky keeps 6,000x unbuffed CpS, Lucky + Frenzy 42,000x: the bank sizes a full Lucky payout needs. Auto keeps nothing early in a run, then switches to Lucky.'));
		if (s.reserveMode === 'auto') {
			html += listing(`<label>Auto: no reserve for the first</label> ${numberInput('autoReserveMinutes')}<label>minutes of a run, then Lucky</label>`);
		}
		html += listing(toggleButton('muteBuySounds', 'Mute auto-buy purchase sounds') +
			hint("Purchases, level-ups, dragon training and petting, stock trades and spell casts made by AFK Baker are silent. Your own purchases still make a sound."));

		const monster = isMonsterLoaded();
		html += heading('Store overlay') +
			listing(`<a class="smallFancyButton prefButton option${isOverlayOn() ? '' : ' off'}" data-afk-action="overlay">Show ratings in the store ${isOverlayOn() ? 'ON' : 'OFF'}</a>` +
				hint("Marks each upgrade's corner and colors each building's price by how its payback period compares with the best one, and adds the numbers to the game's tooltips. It reads the numbers auto-buy works out and runs no calculations of its own." +
					(monster ? ' Cookie Monster is loaded and draws its own colors in the store, so this starts switched off to avoid two sets of squares. Turning it on here is remembered.' : ''))) +
			(monster && s.storeOverlay === null ? listing('<label>Off because Cookie Monster is loaded and draws its own colors in the store. You can turn this on anyway.</label>') : '') +
			(isOverlayOn() ? listing(toggleButton('ratingBar', 'Rating counts above the upgrades') +
				hint('A small bar just above the upgrades in the store: a mark and a number for each rating, in your colors. Hover a number for the rating\'s name.')) : '') +
			legendHtml() +
			listing(actionButton('colors-reset', 'Reset to default colors') +
				hint('Click a color to change it. It applies to the upgrade squares, the building prices and the count bar. Price text is outlined so it stays readable on the building rows whatever you pick: in black, or in white if you pick a dark color. Skipped keeps its stripes, and every tooltip still names the rating in words.')) +
			listing('<label>Every rating is also written out in the tooltip, so it doesn\'t depend on telling the colors apart. A building\'s price shows the rating for the amount the store is set to buy (1, 10 or 100).</label>');
		return html;
	}

	function lumpsTabHtml() {
		const s = settings();
		let html = listing(toggleButton('autoHarvestLumps', 'Auto-harvest sugar lumps') +
				hint('Harvests only when the lump is ripe, whatever its type. Paused during Born again.')) +
			listing(toggleButton('autoSpendLumps', 'Auto-spend sugar lumps') +
				hint('Spends lumps only on building levels, in list order. It never skips ahead to a later entry.'));
		// The list stays visible while auto-spend is off: it is what to set up before turning it on.
		if (!s.autoSpendLumps) html += listing('<label>Auto-spend is off: no lumps are spent until you turn it on.</label>');
		return html + listing(`<label>Keep at least</label> ${numberInput('keepLumps')}<label>lumps</label>`) + lumpPriorityHtml();
	}

	function dragonTabHtml() {
		const s = settings();
		let html = listing('<label>The dragon, its auras and its drops reset on every ascension, so AFK Baker starts over each run.</label>') +
			listing(toggleButton('autoTrainDragon', 'Auto-train dragon') +
				hint('Buys the crumbly egg, then trains level by level. Steps paid in cookies respect the cookie reserve.'));
		if (s.autoTrainDragon) {
			html += listing(`<label>Train when a step costs less than</label> ${numberInput('dragonTrainMinutes')}<label>minutes of CpS</label>` +
				hint('For sacrifice steps the cost is what it takes to buy any missing buildings plus rebuy everything sacrificed, at unbuffed CpS.'));
		}
		return html +
			auraPickerHtml() +
			listing('<label>The secondary aura is used once the dragon is fully trained. Setting an aura costs one of your highest building; an aura already in either slot is never moved, so the same pair in either order costs nothing.</label>') +
			listing(toggleButton('autoPetDragon', 'Auto-pet dragon') +
				hint('Opens the dragon panel to pet until all four drops are found, then buys Dragon fang and Dragon teddy bear. Needs the heavenly upgrade Pet the dragon.'));
	}

	function marketTabHtml() {
		const s = settings();
		let html = listing('<label>The whole market resets on every ascension. Nothing happens until the Bank minigame is unlocked.</label>') +
			listing(toggleButton('autoTrade', 'Auto-trade stocks') +
				hint("Uses only what a player can see: the prices. It never reads the market's hidden state and never takes loans."));
		if (!s.autoTrade) return html;
		html += listing(cycleButton('marketStrategy', 'Strategy') +
				hint("The guide rules come from KarmicChaos's stock market guide: always buy under $5, and sell once past the bank ceiling ($97 + $3 per Bank level).")) +
			listing(`<label>Buy at</label> ${numberInput('marketBuyPercent', 40)}<label>% of resting value or less; sell at</label> ${numberInput('marketSellPercent', 40)}<label>% or more</label>`) +
			listing(`<label>The market may use up to</label> ${numberInput('marketBankPercent', 40)}<label>% of your bank</label>` +
				hint('Counted on the bank above the cookie reserve, plus what is already invested.')) +
			listing(toggleButton('marketSellAtLoss', 'Sell at a loss') +
				hint('Off: only sells for more than the stock cost, buying fee included. All stock is still sold right before an auto-ascend.')) +
			listing(toggleButton('autoBrokers', 'Hire brokers') +
				hint('Each broker cuts the 20% buying fee by a twentieth. One is hired when the saving on one full warehouse fill covers its price.')) +
			listing(toggleButton('autoOffice', 'Upgrade office') +
				(s.autoOffice ? `<label>when rebuying the Cursors costs less than</label> ${numberInput('officeMinutes', 50)}<label>minutes of CpS</label>` : '') +
				hint('An office upgrade sacrifices Cursors and needs a Cursor level. AFK Baker never spends sugar lumps for it.'));
		return html;
	}

	function grimoireTabHtml() {
		const s = settings();
		let html = listing(toggleButton('autoCast', 'Auto-cast spell') + (s.autoCast ? cycleButton('grimoireSpell', 'Spell') : '') +
			hint('Casts when the magic meter is full: magic regenerates faster the fuller the meter is, so that gives the most casts. Nothing happens until the Wizard tower minigame is unlocked. Uses only what a player can see; it never reads the seed or predicts what a spell will do.'));
		if (!s.autoCast) return html;
		html += listing(s.grimoireSpell === 'hand of fate' ?
			'<label>Force the Hand of Fate summons a golden cookie.</label>' +
				hint('It waits while a golden cookie is on screen or Magic inept is active (both raise the backfire chance), and while golden cookie clicking is off. The wrath cookie from a backfire is left alone.') :
			'<label>Conjure Baked Goods gives 30 minutes of CpS.</label>' +
				hint('The payout is capped at 15% of your bank, so it is weak when auto-buy keeps the bank low.'));
		if (s.grimoireSpell === 'hand of fate') {
			html += listing(cycleButton('grimoireTiming', 'Cast') +
				hint('What the spell gives (a Frenzy, a Click frenzy, a building special) adds to a buff already running, so a cast during one is worth more. ' +
					'When magic is full: casts at once, for the most casts. ' +
					'During a Frenzy or click buff: at full magic it waits until a buff that raises CpS (Frenzy, Dragon Harvest, a building special, Elder frenzy) or a click buff is running. Late in a run a Frenzy is running most of the time, so few casts are lost. ' +
					'Only during a click buff: it waits for a Click frenzy or a Dragonflight. This is high-variance. There are about a third fewer casts and a typical hour looks the same, but once in a while the spell lands a building special or a Frenzy on top of the click buff, and those rare casts are worth more than all the others together. ' +
					'Magic does not regenerate while it waits at full. Devastation from Godzamok combos does not count as a click buff here. It only looks at the buffs on screen, never at what the spell will give.'));
		}
		return html;
	}

	function ascendTabHtml() {
		const s = settings();
		// The threshold stays visible while auto-ascend is off: it is what to check before turning it on.
		return listing(toggleButton('autoAscend', 'Auto-ascend') +
				hint('Ascends only. Reincarnating and heavenly upgrades are up to you. If the threshold is already reached when the mod loads or you change a setting, it warns instead of ascending.')) +
			listing(cycleButton('ascendMode', 'Threshold type')) +
			listing(`<label>Threshold</label> ${numberInput('ascendThreshold', 190)}<label id="afkThresholdReadable">${thresholdReadable(s.ascendThreshold)}</label>` +
				hint('Plain digits, or scientific notation such as 1.146e15.'));
	}

	function otherTabHtml() {
		const draft = state.importDraft;
		let importHtml = listing(`<textarea data-afk-import rows="3" spellcheck="false" placeholder="Paste a settings text here" style="width:calc(100% - 20px);font-family:Consolas,monospace;font-size:11px;${FIELD_STYLE}">${escapeHtml(draft.text)}</textarea>`) +
			listing(actionButton('import-check', 'Check import') +
				hint('Nothing is changed until you confirm. The text is checked the same way a saved game\'s settings are, so a bad or edited text can\'t break anything. Auto-ascend is always imported switched off, and what the stock market paid for its current stock stays as it is.'));
		if (draft.error) importHtml += listing(`<label style="color:#f66;">${escapeHtml(draft.error)}</label>`);
		if (draft.preview) {
			const changes = draft.preview.changes;
			const runs = draft.preview.runs.length;
			importHtml += listing(changes.length ?
				`<label>Importing would change ${changes.length} setting${changes.length === 1 ? '' : 's'}:</label>` +
					`<div class="afk-changes">${changes.map(function (change) { return `<div>${escapeHtml(change)}</div>`; }).join('')}</div>` :
				'<label>These are the settings you already have. No setting would change.</label>') +
				(runs ? listing(`<label>It also adds ${runs} past run${runs === 1 ? '' : 's'} to the Stats tab. Your own past runs are kept.</label>`) : '') +
				listing((changes.length || runs ? actionButton('import-apply', 'Apply these changes') : '') + actionButton('import-cancel', 'Cancel'));
		}
		return listing(toggleButton('debug', 'Debug logging') +
				hint('Extra console output, including the top auto-buy candidates and, if Cookie Monster is installed, a comparison of payback periods.')) +
			extrasHtml() +
			heading('Settings export') +
			listing(`<textarea readonly id="afkExportText" rows="3" style="width:calc(100% - 20px);font-family:Consolas,monospace;font-size:11px;${FIELD_STYLE}">${escapeHtml(exportSettings())}</textarea>`) +
			listing(actionButton('export-copy', state.exportCopied ? 'Copied' : 'Copy') + hint('The text holds every AFK Baker setting, including the sugar lump list, and the past runs of the Stats tab.')) +
			heading('Settings import') + importHtml +
			heading('About') +
			listing(`<label>AFK Baker ${VERSION}. Extension hooks version ${ext.apiVersion}.</label>`);
	}

	/* ----- Pantheon tab: a near-copy of the game's Pantheon screen ----- */

	// The game's god tooltip, with a line of AFK Baker's own added where it has something to say.
	function godTooltipFor(key) {
		const M = pantheon();
		if (!M || !M.gods[key]) return '';
		let html = M.godTooltip(M.gods[key].id)();
		const notes = [];
		const refusal = godRefusal(key);
		if (refusal) notes.push(`AFK Baker won't slot Holobore while golden cookie clicking is on: ${refusal.replace(/^Holobore /, 'it ')}.`);
		if (key === GODZAMOK) {
			notes.push(settings().godzamokCombo ?
				'Godzamok combos are on: with him slotted, AFK Baker sells buildings and buys them straight back for the click power.' :
				'Godzamok does nothing for AFK play unless you turn on Godzamok combos below: otherwise AFK Baker never sells buildings.');
		}
		if (notes.length) {
			const note = '<div class="line"></div><div style="padding:4px 2px 0px;font-size:11px;color:#fc9;">' + notes.join('<br>') + '</div>';
			html = html.replace(/<\/div>\s*$/, note + '</div>');
		}
		return html;
	}

	function godTileHtml(key, god, extraClass) {
		const icon = god.icon || [0, 0];
		const refused = godRefusal(key) ? ' afk-god-refused' : '';
		return `<div class="ready templeGod templeGod${god.id % 4} titleFont afk-god${refused}${extraClass || ''}${state.godSelected === key ? ' afk-god-selected' : ''}" data-afk-god="${key}" ` +
			Game.getDynamicTooltip(`Game.mods['afk baker'].godTip('${key}')`, 'this') + '>' +
			`<div class="usesIcon shadowFilter templeIcon" style="background-position:${-icon[0] * 48}px ${-icon[1] * 48}px;"></div></div>`;
	}

	function godzamokHtml() {
		const s = settings();
		let html = heading('Godzamok combos') +
			listing(toggleButton('godzamokCombo', 'Godzamok combos') +
				hint('With Godzamok in a Pantheon slot, selling buildings gives Devastation: more click power for 10 seconds, 1% per building sold with him in the Diamond slot, half that in Ruby, a quarter in Jade. A combo sells whole building types and buys them straight back in the same instant, so your CpS never drops. It costs the gap between the refund and the price of buying back: about 71% of that price, less with the Earth Shatterer aura. AFK Baker makes one only when all of this holds: the autoclicker is on; Godzamok is slotted (it never slots him for this, and never changes auras for it); no Devastation is running, so one round per 10 seconds and no stacking; the extra click income expected is at least ' + GODZAMOK_MIN_RETURN + ' times the cost; and the bank above your cookie reserve covers buying everything back in full. It sells the types that give the most for their cost, several in one round while they fit under the limit below. Wizard towers are never sold, and one Grandma always stays, so wrinklers and an Elder Pledge are never affected. The first Grandma sold wins the achievement Just wrong, if you don\'t have it yet. If a building count ever comes back different, combos turn themselves off and the Dashboard says so. Off by default.'));
		if (state.comboStopped) html += listing(`<label style="color:#f66;">${escapeHtml(state.comboStopped)}</label>`);
		if (!s.godzamokCombo) return html;
		return html +
			listing(cycleButton('godzamokMode', 'When') +
				hint('During click buffs only: a combo is made only while Click frenzy or Dragonflight is running, when a click is worth the most. Whenever it pays: also without one, whenever the expected gain is ' + GODZAMOK_MIN_RETURN + ' times the cost. Late in a run, when buildings cost next to nothing, that is every 10 seconds.')) +
			listing(`<label>A combo may cost up to</label> ${numberInput('godzamokCapPercent', 40)}<label>% of the bank</label>` +
				hint('Counted on the bank above the cookie reserve. It keeps combos from eating what auto-buy is saving up.')) +
			listing('<label>Never sold: Wizard towers (their number sets the size of the magic meter). One Grandma always stays: selling the last one would pop every wrinkler and end an Elder Pledge. The dragon is never trained and no aura is changed in the same instant as a combo.</label>');
	}

	function pantheonTabHtml() {
		const s = settings();
		let html = listing(toggleButton('autoPantheon', 'Auto-Pantheon') +
			hint('Each run, slots the gods picked below once the Pantheon is available, with the game\'s own slotting and one worship swap per god, as when you drag them yourself. Nothing happens if they are already in place. When swaps run short it fills Diamond first, then Ruby, then Jade, and a single swap that puts two picks in place comes first. A slot left empty here is never touched. It never refills swaps with sugar lumps.'));
		const M = pantheon();
		if (!M) {
			return html + godzamokHtml() + listing(`<label>The Pantheon isn't available: ${Game.ascensionMode === 1 ? "it doesn't run in a Born again run" : 'it unlocks when a Temple has a level (bought with a sugar lump)'}. The gods can be picked here once it is.</label>`);
		}
		const picks = pantheonPicks(M);
		const slots = [0, 1, 2].map(function (slot) {
			const pick = picks[slot];
			const now = M.slot[slot] !== -1 ? shortGodName(M.godsById[M.slot[slot]]) : 'empty';
			return '<div class="afk-pslot-wrap">' +
				`<div class="ready templeGod templeGod${slot % 4} templeSlot titleFont afk-pslot\" data-afk-pslot="${slot}">` +
				`<div class="usesIcon shadowFilter templeGem templeGem${slot + 1}"></div>` +
				(pick ? godTileHtml(pick.key, pick.god, ' afk-god-in-slot') : '') + '</div>' +
				`<div class="afk-pslot-label"><b>${PANTHEON_SLOT_NAMES[slot]}</b><br>${pick ? escapeHtml(shortGodName(pick.god)) : 'left alone'}<br><small>now: ${escapeHtml(now)}</small></div>` +
				(pick ? `<a class="smallFancyButton option afk-mini" data-afk-pslot-clear="${slot}" title="Leave this slot alone">&#10005;</a>` : '') +
				'</div>';
		}).join('');
		const pickedKeys = picks.filter(Boolean).map(function (pick) { return pick.key; });
		const roster = Object.keys(M.gods).map(function (key) {
			return godTileHtml(key, M.gods[key], pickedKeys.indexOf(key) !== -1 ? ' afk-god-picked' : '');
		}).join('');
		const swaps = `Worship swaps: ${M.swaps}/3` + (M.swaps < 3 ? `, next in ${shortTime(msToNextSwap(M) / 1000)}` : '');
		html += `<div class="afk-pantheon" id="afkPantheon"><div class="afk-pantheon-slots">${slots}</div>` +
			`<div class="afk-pantheon-info">${escapeHtml(swaps)}</div><div class="afk-pantheon-roster">${roster}</div></div>` +
			listing('<label>Drag a god onto a slot, or click a god and then a slot. Drag a picked god off its slot, or use its &#10005;, to leave that slot alone.</label>');
		if (s.clickGolden) html += listing('<label>Holobore is greyed out: it is thrown out of its slot, losing every worship swap, as soon as a golden cookie is clicked, and golden cookie clicking is on.</label>');
		return html + godzamokHtml();
	}

	// Puts a god in a slot's pick. A god picked for another slot trades places with this slot's pick.
	function setPantheonPick(slot, key) {
		const s = settings();
		const target = PANTHEON_SLOT_KEYS[slot];
		const previous = s[target];
		PANTHEON_SLOT_KEYS.forEach(function (other) {
			if (other !== target && s[other] === key) s[other] = previous;
		});
		s[target] = key;
		state.godSelected = '';
	}

	function clearPantheonPick(slot) {
		settings()[PANTHEON_SLOT_KEYS[slot]] = '';
	}

	// Dragging a god, with the pointer, in the Pantheon tab.
	function onGodPointerDown(event) {
		const tile = event.target.closest('[data-afk-god]');
		if (!tile || event.button !== 0 || state.godDrag) return;
		event.preventDefault();
		const fromSlot = tile.closest('[data-afk-pslot]');
		state.godDrag = { key: tile.dataset.afkGod, fromSlot: fromSlot ? Number(fromSlot.dataset.afkPslot) : -1, startX: event.clientX, startY: event.clientY, active: false, ghost: null, pointerId: event.pointerId };
		window.addEventListener('pointermove', onGodPointerMove, true);
		window.addEventListener('pointerup', onGodPointerUp, true);
		window.addEventListener('pointercancel', endGodDrag, true);
	}

	function onGodPointerMove(event) {
		const drag = state.godDrag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!drag.active) {
			if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
			drag.active = true;
			Game.tooltip.shouldHide = 1;
			const source = document.querySelector(`#afkPantheon [data-afk-god="${drag.key}"]`);
			const ghost = source.cloneNode(true);
			ghost.removeAttribute('onmouseover');
			ghost.removeAttribute('onmouseout');
			ghost.classList.add('afk-god-ghost');
			document.body.appendChild(ghost);
			drag.ghost = ghost;
		}
		drag.ghost.style.transform = `translate(${event.clientX - 30}px, ${event.clientY - 37}px)`;
		const under = document.elementFromPoint(event.clientX, event.clientY);
		document.querySelectorAll('#afkPantheon .afk-pslot').forEach(function (slot) {
			slot.classList.toggle('afk-pslot-hover', !!under && slot.contains(under));
		});
	}

	function onGodPointerUp(event) {
		const drag = state.godDrag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (drag.active) {
			swallowNextClick();
			if (drag.ghost) drag.ghost.style.display = 'none';
			const under = document.elementFromPoint(event.clientX, event.clientY);
			const slot = under && under.closest('[data-afk-pslot]');
			if (slot) setPantheonPick(Number(slot.dataset.afkPslot), drag.key);
			else if (drag.fromSlot !== -1) clearPantheonPick(drag.fromSlot);
			PlaySound('snd/tick.mp3');
		}
		endGodDrag();
		if (drag.active) renderMenuSection();
	}

	function endGodDrag() {
		const drag = state.godDrag;
		if (!drag) return;
		window.removeEventListener('pointermove', onGodPointerMove, true);
		window.removeEventListener('pointerup', onGodPointerUp, true);
		window.removeEventListener('pointercancel', endGodDrag, true);
		if (drag.ghost) drag.ghost.remove();
		state.godDrag = null;
	}

	/* ----- Dragon tab: the aura picker ----- */

	function auraTooltip(id, slotKey) {
		const aura = Game.dragonAuras[id];
		const s = settings();
		const other = slotKey === 'dragonAura1' ? s.dragonAura2 : s.dragonAura1;
		let note = '';
		if (id > 0 && Game.dragonLevel < auraUnlockLevel(id)) note = `Unlocks at dragon level ${auraUnlockLevel(id)}. It can be picked now and is set once the dragon gets there.`;
		if (id > 0 && aura.name === other) note = "It is the other slot's pick.";
		const text = id === 0 ? 'Leave this slot alone: AFK Baker never changes it.' : aura.desc;
		return `<div style="min-width:220px;max-width:300px;padding:8px;text-align:center;"><div class="icon" style="float:left;margin:-4px 4px 0px -4px;${writeIcon(aura.pic)}"></div>` +
			`<div class="name">${id === 0 ? 'None (leave it alone)' : (aura.dname || aura.name)}</div><div class="line"></div><div class="description">${text}` +
			(note ? `<div style="margin-top:6px;font-size:11px;color:#fc9;">${note}</div>` : '') + '</div></div>';
	}

	// Two slots like the game's aura buttons; clicking one opens a grid of every aura, as in the game's
	// picker, but with the locked ones shown greyed with their level. Picking costs nothing: it only says
	// which aura AFK Baker sets once the dragon allows it.
	function auraPickerHtml() {
		const s = settings();
		const slotBox = function (key, label) {
			const name = s[key];
			const id = name ? auraId(name) : 0;
			return `<div class="afk-aura-slot${state.auraSlot === key ? ' afk-selected' : ''}" data-afk-aura-slot="${key}">` +
				`<div class="crate enabled afk-aura-icon" style="${writeIcon(Game.dragonAuras[id].pic)}"></div>` +
				`<div class="afk-aura-slot-text"><b>${label}</b><br>${name ? escapeHtml(name) : 'None (leave it alone)'}</div></div>`;
		};
		let html = `<div class="afk-aura-slots">${slotBox('dragonAura1', 'Primary aura')}${slotBox('dragonAura2', 'Secondary aura')}</div>`;
		const key = state.auraSlot;
		if (!key) return html + listing('<label>Click a slot to pick its aura.</label>');
		const other = key === 'dragonAura1' ? s.dragonAura2 : s.dragonAura1;
		const current = s[key] ? auraId(s[key]) : 0;
		let grid = '';
		for (const index in Game.dragonAuras) {
			const id = Number(index);
			const aura = Game.dragonAuras[id];
			const locked = id > 0 && Game.dragonLevel < auraUnlockLevel(id);
			const taken = id > 0 && aura.name === other;
			grid += `<div class="afk-aura${locked ? ' afk-aura-locked' : ''}${taken ? ' afk-aura-taken' : ''}${id === current ? ' afk-aura-current' : ''}" data-afk-aura="${id}" ` +
				Game.getDynamicTooltip(`Game.mods['afk baker'].auraTip(${id},'${key}')`, 'this') + '>' +
				`<div class="crate enabled${id === current ? ' highlighted' : ''}" style="opacity:1;float:none;margin:0px;${writeIcon(aura.pic)}"></div>` +
				(locked ? `<div class="afk-aura-level">Lv ${auraUnlockLevel(id)}</div>` : '') + '</div>';
		}
		return html + `<div class="afk-aura-grid">${grid}</div>` +
			listing(`<label>${key === 'dragonAura1' ? 'Primary' : 'Secondary'} aura: click one to pick it. Greyed ones are locked right now and are set once the dragon reaches their level. The other slot's pick can't be chosen twice.</label>`);
	}

	// An aura picked in the grid: '' (id 0) leaves the slot alone, and the same aura can't be in both.
	function pickAura(key, id) {
		const s = settings();
		const other = key === 'dragonAura1' ? s.dragonAura2 : s.dragonAura1;
		const name = id > 0 && Game.dragonAuras[id] ? Game.dragonAuras[id].name : '';
		if (name && (!isAuraName(name) || name === other)) return false;
		s[key] = name;
		state.auraSlot = '';
		return true;
	}

	/* ----- RedFox and Sunder, in the Other tab ----- */

	function extrasHtml() {
		const s = settings();
		return heading('Just for fun') +
			listing(toggleButton('redFox', 'RedFox') +
				hint('Every "wrinkler" on screen reads "nibbler" instead, keeping capitals: Wrinkler becomes Nibbler, wrinklers become nibblers, Shiny wrinkler becomes Shiny nibbler, Wrinklerspawn becomes Nibblerspawn. Only the text you see changes. The names the game and AFK Baker use inside, and your save, stay as they are, and turning it off puts the original text back at once. Named after RedFox, who calls them nibblers.' +
					(isGameInEnglish() ? '' : ' The game is not set to English, so there is nothing to change: RedFox only works in English.'))) +
			listing(toggleButton('sunder', 'Sunder') +
				(s.sunder ? `<label>pets per second</label> ${numberInput('sunderRate', 40)}` : '') +
				hint('Pets Krumblor nonstop, from 1 to 30 times a second. The dragon panel stays open while it is on, which covers the lower left of the big cookie, and whatever panel was open before comes back when you turn it off. Regular auto-pet stands aside meanwhile. Pet sounds follow the mute setting. Each pet sends up a heart from Krumblor, as when you pet him yourself, if particles are on in the game\'s options. It needs the heavenly upgrade Pet the dragon and a hatched dragon. Named after Sunder, who wants Krumblor petted at all times.'));
	}

	function pantheonRow() {
		const s = settings();
		if (!s.autoPantheon) return { tab: 'pantheon', name: 'Pantheon', dot: 'off', now: 'Auto-Pantheon off.', wait: '' };
		const blocked = pantheonBlockedReason();
		const M = pantheon();
		const pickNames = PANTHEON_SLOT_KEYS.map(function (key, slot) {
			const god = M && s[key] ? M.gods[s[key]] : null;
			return `${PANTHEON_SLOT_NAMES[slot]} ${god ? shortGodName(god) : (s[key] ? s[key] : '-')}`;
		}).join(', ');
		if (blocked) return { tab: 'pantheon', name: 'Pantheon', dot: 'wait', now: `Picked: ${pickNames}.`, wait: blocked };
		const slotted = [0, 1, 2].map(function (slot) { return M.slot[slot] !== -1 ? shortGodName(M.godsById[M.slot[slot]]) : 'empty'; }).join(', ');
		let now = `Picked: ${pickNames}. Slotted: ${slotted}.`;
		if (state.lastPantheonAction) now += ` Last: ${state.lastPantheonAction}.`;
		const refused = pantheonPicks(M).some(function (pick) { return pick && godRefusal(pick.key); });
		if (refused) now += ' Holobore is not slotted while golden cookie clicking is on.';
		let wait = '';
		if (nextPantheonMove(M)) wait = M.swaps < 1 ? `a worship swap (next in ${shortTime(msToNextSwap(M) / 1000)})` : 'its next check';
		else if (pantheonStuckNote(M)) wait = pantheonStuckNote(M);
		return { tab: 'pantheon', name: 'Pantheon', dot: wait ? 'wait' : 'on', now: now, wait: wait };
	}

	function extrasRows() {
		const s = settings();
		const rows = [];
		if (s.sunder) {
			rows.push({ tab: 'other', name: 'Sunder', dot: state.sunderBlocked ? 'wait' : 'on',
				now: state.sunderBlocked ? `Can't pet: ${state.sunderBlocked}.` : `Petting Krumblor ${s.sunderRate} times a second (${Beautify(state.sunderPets)} pets so far).`, wait: '' });
		}
		if (s.redFox) rows.push({ tab: 'other', name: 'RedFox', dot: 'on', now: isGameInEnglish() ? 'Wrinklers read "nibblers".' : 'On, but it only works with the game in English.', wait: '' });
		return rows;
	}

	// Shown while a limit is set: where research stops, or what can be done once the grandmas are past it.
	function grandmaRow() {
		const s = settings();
		const limit = GRANDMA_LIMIT_STAGE[s.grandmaLimit];
		if (limit >= GRANDMA_STAGE_UPGRADES.length) return null;
		const row = { tab: 'autobuy', name: 'Grandmapocalypse', dot: 'on', now: '', wait: '' };
		const limitName = grandmaLimitName(s.grandmaLimit);
		const mood = grandmaMood();
		if (openedGrandmaStage() <= limit) {
			row.now = `Limit: ${limitName}. Research stops before ${GRANDMA_STAGE_UPGRADES[limit]}. Grandmas now: ${mood}.`;
			if (!s.buyResearch || !s.autoBuy) {
				row.dot = 'off';
				row.now += s.autoBuy ? ' Buy research is off, so no research is bought at all.' : ' Auto-buy is off, so no research is bought at all.';
			}
			return row;
		}
		const pledge = Game.Upgrades['Elder Pledge'];
		const covenant = Game.Upgrades['Elder Covenant'];
		const pledgeMinutes = Math.round(Game.getPledgeDuration() / Game.fps / 60);
		const options = [
			Game.Has('Elder Pact') ?
				`an Elder Pledge (${Beautify(pledge.getPrice())} cookies) calms them for ${pledgeMinutes} minutes at a time and pops every wrinkler` :
				'the Elder Pledge only comes with Elder Pact, so it is not on offer',
			covenant.unlocked || covenant.bought ?
				`the Elder Covenant (${Beautify(covenant.getPrice())} cookies) calms them for good at 5% less CpS` :
				'the Elder Covenant, which calms them for good at 5% less CpS, appears after a first pledge',
			'ascending starts research over',
		];
		row.now = `The research already bought takes the grandmas past your limit (${limitName}); they are now: ${mood}. ` +
			`There is no way back to a stage in between. Your options: ${options.join('; ')}. AFK Baker buys none of these for this setting.`;
		if (Game.Has('Elder Covenant')) return row;
		if (Game.pledgeT > 0) {
			row.dot = 'wait';
			row.wait = `the pledge to run out (${formatDuration(Game.pledgeT / Game.fps * 1000)})`;
			return row;
		}
		row.dot = 'warn';
		row.wait = 'you to choose';
		return row;
	}

	/* ----- Stats tab: this run and the past ones, side by side ----- */

	function shareText(amount, total) {
		if (!(total > 0)) return '';
		const percent = amount / total * 100;
		return percent > 0 && percent < 0.1 ? '&lt;0.1%' : percent.toFixed(1) + '%';
	}

	// One run's column: row key -> the cell's HTML, '' for a row the run has nothing in.
	function recordCells(record) {
		const cells = {};
		let total = 0;
		for (const category in record.gains) {
			if (record.gains[category] > 0) total += record.gains[category];
		}
		const multiplier = incomeMultiplier(record);
		cells.length = formatDuration(record.end - record.start);
		cells.baked = Beautify(record.baked);
		cells.growth = growthText(record);
		cells.multiplier = multiplier === null ? '&ndash;' : 'x' + (multiplier < 100 ? multiplier.toFixed(2) : Beautify(Math.round(multiplier)));
		cells.prestige = '+' + Beautify(record.prestige);
		for (const category of INCOME_GAINS) {
			const amount = record.gains[category[0]] || 0;
			cells['g:' + category[0]] = amount > 0 ? `${shareText(amount, total)} <small>${Beautify(amount)}</small>` : '';
		}
		for (const category of INCOME_LOSSES) {
			const amount = record.losses[category[0]] || 0;
			cells['l:' + category[0]] = amount > 0 ? `${shareText(amount, total)} <small>${Beautify(amount)}</small>` : '';
		}
		const unaccounted = -(record.gains.other || 0);
		cells['l:unaccounted'] = unaccounted > 0 ? `${shareText(unaccounted, total)} <small>${Beautify(unaccounted)}</small>` : '';
		cells.bank = record.bank ? (record.bank > 0 ? '+' : '-') + Beautify(Math.abs(record.bank)) : '';
		const setup = record.setup;
		cells['s:auras'] = escapeHtml(setup.a.join(', ') || 'none');
		cells['s:gods'] = escapeHtml(setup.g.length ? setup.g.join(', ') : 'none');
		cells['s:grandmas'] = escapeHtml(setup.w || '?');
		cells['s:clicks'] = setup.c > 0 ? setup.c + ' a second' : 'off';
		cells['s:changed'] = record.changed ? `yes: this one held ${record.share}%` : 'no';
		return cells;
	}

	// The table's rows: [key, label, explanation], or [null, section title]. A row with nothing in it
	// in any run is left out, except the ones marked as always shown.
	function statsRows() {
		const rows = [
			['length', 'Length', '', true],
			['baked', 'Cookies baked', '', true],
			['growth', 'Growth', 'How fast your all-time cookies grew: +20% an hour means that after each hour of the run you had baked a fifth more, over all your runs, than an hour before. That is what earns prestige, and it compares runs of very different size. Growth slows down as a game goes on, so compare runs that are close together. A first run has nothing to compare with.', true],
			['multiplier', 'Income multiplier', 'Everything counted while the game ran, divided by what your buildings alone would have made at your CpS without buffs. x3.00 means clicks, golden cookies, buffs and wrinklers tripled it.', true],
			['prestige', 'Prestige earned', '', true],
			[null, 'Where the cookies came from (share of all gains)'],
		];
		INCOME_GAINS.forEach(function (category) { rows.push(['g:' + category[0], category[1], category[2]]); });
		rows.push([null, 'Losses (against all gains)']);
		INCOME_LOSSES.forEach(function (category) { rows.push(['l:' + category[0], category[1], category[2]]); });
		rows.push(['l:unaccounted', 'Not accounted for', 'Cookies the count expected that the game did not bake. Small rounding differences end up here.']);
		rows.push(['bank', 'Stock market, bank change', "Cookies the market took out of the bank and put back, sales minus purchases. Stock still held has been paid for and not yet sold."]);
		rows.push([null, 'Setup (the one active longest)']);
		rows.push(['s:auras', 'Dragon auras', '', true], ['s:gods', 'Pantheon', 'Diamond, Ruby and Jade slot.', true], ['s:grandmas', 'Grandmas', '', true],
			['s:clicks', 'Autoclicker', '', true], ['s:changed', 'Changed during run', '', true]);
		return rows;
	}

	function runDateText(record) {
		return new Date(record.end).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function statsTableHtml() {
		const counting = settings().trackIncome;
		const history = mod.income.history;
		const columns = (counting ? [recordCells(liveRecord())] : []).concat(history.map(recordCells));
		if (!columns.length) return '';
		let html = '<tr><th></th>' + (counting ? '<th>This run</th>' : '') +
			history.map(function (record, i) { return `<th>${i + 1} run${i ? 's' : ''} ago<br><small>${escapeHtml(runDateText(record))}</small></th>`; }).join('') + '</tr>';
		let section = '';
		for (const row of statsRows()) {
			if (row[0] === null) {
				section = `<tr class="afk-stats-section"><td colspan="${columns.length + 1}">${row[1]}</td></tr>`;
				continue;
			}
			if (!row[3] && !columns.some(function (cells) { return cells[row[0]]; })) continue;
			html += section + `<tr><td>${row[1]}${row[2] ? hint(row[2]) : ''}</td>` + columns.map(function (cells, i) {
				return `<td${counting && i === 0 ? ` class="afk-stats-live" data-afk-stat="${row[0]}"` : ''}>${cells[row[0]] || '&ndash;'}</td>`;
			}).join('') + '</tr>';
			section = '';
		}
		return `<div class="afk-stats-wrap"><table class="afk-stats" id="afkStats" data-afk-runs="${history.length}">${html}</table></div>`;
	}

	function statsTabHtml() {
		const s = settings();
		const history = mod.income.history;
		let html = listing(toggleButton('trackIncome', 'Count where cookies come from') +
			hint('Counts where this run\'s cookies come from, using only numbers the game shows: cookies baked, CpS with and without buffs, what wrinklers wither, cookies made by clicking. AFK Baker measures its own golden cookie clicks, casts, trades and wrinkler pops; what you click yourself, garden harvests and gifts land in Other. It costs a few additions per game tick. When you ascend, the run joins the table with the setup that was active longest. The last ' + INCOME_HISTORY_MAX + ' runs are kept in your save and in the settings export.'));
		if (!s.trackIncome) html += listing('<label>Counting is off. Past runs are kept.</label>');
		html += statsTableHtml();
		if (s.trackIncome && !history.length) html += listing('<label>Past runs appear next to this one each time you ascend.</label>');
		if (history.length) {
			html += listing(actionButton('stats-clear', state.statsClearArmed ? 'Click again to forget them' : 'Forget past runs') +
				hint('Removes the past runs from the table and from your save. This run keeps counting.'));
		}
		return html;
	}

	// The "This run" column moves all the time: its cells are rewritten in place. A row that isn't in
	// the table yet (a first golden cookie, say) or a new past run means the table is drawn again.
	function updateStatsTab() {
		const table = document.getElementById('afkStats');
		if (!table || !settings().trackIncome) return;
		if (Number(table.dataset.afkRuns) !== mod.income.history.length) {
			renderMenuSection();
			return;
		}
		const cells = recordCells(liveRecord());
		const shown = {};
		table.querySelectorAll('[data-afk-stat]').forEach(function (cell) {
			const key = cell.dataset.afkStat;
			shown[key] = true;
			const value = cells[key] || '&ndash;';
			if (cell.dataset.afkValue === value) return;
			cell.dataset.afkValue = value;
			cell.innerHTML = value;
		});
		for (const key in cells) {
			if (cells[key] && !shown[key]) {
				renderMenuSection();
				return;
			}
		}
	}

	/* ----- Seasons tab ----- */

	// Where a season stands in the plan, for the table.
	function seasonStanding(key, plan) {
		const status = plan.statuses[key];
		const visited = seasonRun().visited.indexOf(key) !== -1;
		if (!status.enabled) return 'Skipped: switched off below';
		if (plan.action === 'collect' && plan.season === key) return `Collecting now (${seasonTimeLeft()})`;
		if (status.done) return status.note ? `Done (${status.note})` : 'Done';
		if (status.blocked) return `Waiting: ${status.blocked}`;
		if (visited) return 'Had its visit this run; the rest waits for the next run';
		if (plan.season === key && plan.purpose === 'collect') return plan.wait ? `Next, waiting for ${plan.wait}` : 'Next';
		return 'Later this run';
	}

	function seasonsTableHtml(plan) {
		let html = '<tr><th>Season</th><th>Collected</th><th>Still missing</th><th>Plan</th></tr>';
		for (const key of SEASON_ORDER) {
			const status = plan.statuses[key];
			const collected = status.parts.map(function (part) { return `${capitalize(part.label)} ${part.have}/${part.total}`; }).join('<br>');
			const missing = [].concat.apply([], status.parts.map(function (part) { return part.missing; }));
			html += `<tr><td><b>${SEASON_NAMES[key]}</b></td><td>${collected}</td><td class="afk-seasons-missing">${missing.length ? escapeHtml(missing.join(', ')) : '&ndash;'}</td><td class="afk-seasons-missing">${escapeHtml(seasonStanding(key, plan))}</td></tr>`;
		}
		return `<div class="afk-stats-wrap"><table class="afk-stats afk-seasons">${html}</table></div>`;
	}

	// What the table shows, as one string: when it changes the tab is drawn again.
	function seasonsSignature(plan) {
		return JSON.stringify([Game.season, plan.action, plan.season, plan.wait || '', SEASON_ORDER.map(function (key) { return seasonStanding(key, plan) + plan.statuses[key].parts.map(function (part) { return part.have; }).join(','); })]);
	}

	function seasonToggleHint(key) {
		if (key === 'valentines') return 'The seven heart biscuits. Each one unlocks, during Valentine\'s Day, once the one before it is bought, so a visit takes about a minute late in a run and longer early on, when the next biscuit is not yet affordable.';
		if (key === 'christmas') {
			const hours = christmasHours();
			return 'The festive hat, Santa\'s 14 levels with a gift each, Santa\'s dominion, and the seven Christmas cookies that reindeer drop. The visit lasts until the hat is bought and the cookies are found; Santa is levelled afterwards too, in any season. Reindeer clicking has to be on for the cookies.' +
				(hours === null ? '' : ` On this save now: ${hoursText(hours)} for the cookies still missing.`);
		}
		if (key === 'halloween') {
			const hours = halloweenHours();
			const missing = seasonPart('', Game.halloweenDrops, false).missing.length;
			return 'The seven spooky cookies, which wrinklers drop when popped during Halloween. For the visit AFK Baker pops each wrinkler as soon as it has fed and buys no Elder Pledge, whatever your wrinkler and pledge settings say; those settings are not changed and apply again when the visit ends. With no pledge the grandmas stay awake, so golden cookies come as wrath cookies for that time: a third, two thirds or all of them, by stage. Shiny wrinklers are left alone. It needs wrinklers: it never buys research past your grandmapocalypse limit and never revokes an Elder Covenant, and waits or is passed over while the grandmas are calm. ' +
				(!missing ? 'On this save now: nothing is missing.' :
					hours === null ? `On this save now: ${wrinklerBlock()}.` :
					`On this save now: ${hoursText(hours)} for the ${missing} still missing, at the grandmas' current stage (${GRANDMA_STAGE_NAMES[Game.elderWrath]}).`);
		}
		return 'The 20 eggs, which golden and wrath cookies drop when clicked during Easter. This is the long one: several hours, and the rare eggs can outlast the 24 hours a visit has. Golden cookie clicking has to be on. The Chocolate egg is never bought; Easter counts as complete once it has dropped.';
	}

	function seasonsTabHtml() {
		const s = settings();
		let html = listing(toggleButton('autoSeasons', 'Auto seasons') +
			hint('Seasonal upgrades are lost on every ascension, so each run this visits the seasons that still have something to collect, in the order Valentine\'s Day, Christmas, Halloween, Easter, and buys what turns up. A season gets one visit a run: it ends when everything there is collected or when the 24 hours a switch buys run out. A season the calendar gives you for free comes first and is not left until it is complete. When nothing is left it moves to your home season. The hat, Santa\'s levels and the seasonal upgrades are bought when they cost less than the no-payback limit on the Auto-buy tab (' + s.utilityMinutes + ' minutes of CpS), with or without auto-buy. Every purchase, switches included, leaves your cookie reserve alone. Switching needs the heavenly upgrade Season switcher; a switch costs a billion cookies plus a minute of CpS, half as much again for each switch already made this run.'));
		const block = switchBlock();
		if (block) html += listing(`<label>${capitalize(block)}. Until then only a season the calendar brings is collected.</label>`);
		const plan = seasonPlan();
		state.seasonsSignature = seasonsSignature(plan);
		html += seasonsTableHtml(plan);
		if (!s.autoSeasons) return html;
		html += heading('Seasons to visit') +
			SEASON_ORDER.map(function (key) { return listing(toggleButton(SEASON_TOGGLES[key], SEASON_NAMES[key]) + hint(seasonToggleHint(key))); }).join('') +
			heading('Afterwards') +
			listing(cycleButton('homeSeason', 'Home season') +
				hint('Where to stay once nothing is left to collect. CpS is the same in every season. Business Day makes golden cookies come 5% more often with the heavenly upgrade Startrade, the best for a setup built on clicks and golden cookies; it also shows buildings under business names. Easter, Halloween and Valentine\'s Day give 2% with their Star upgrades. Christmas brings reindeer instead, which suits a setup without the autoclicker. None stops switching once collecting is done.')) +
			(s.homeSeason === 'none' ? '' : listing(`<label>Switch to it, and renew it each day, while that costs less than</label> ${numberInput('seasonRenewMinutes', 50)}<label>minutes of CpS</label>` +
				hint('A season lasts 24 hours, and every switch costs half as much again as the one before, so keeping a home season gets dearer by the day: about 7 minutes of CpS for the first, 37 by the fifth renewal, over an hour after a week. Past this limit AFK Baker lets the season run out. Set it to 0 to never switch to a home season.')));
		return html;
	}

	// The table changes as drops come in; it is drawn again when it does, unless a field is being typed in.
	function updateSeasonsTab() {
		const focused = document.activeElement;
		if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA')) return;
		if (seasonsSignature(seasonPlan()) !== state.seasonsSignature) renderMenuSection();
	}

	const TAB_HTML = {
		clickers: clickersTabHtml, autobuy: autobuyTabHtml, lumps: lumpsTabHtml, dragon: dragonTabHtml,
		pantheon: pantheonTabHtml, market: marketTabHtml, grimoire: grimoireTabHtml, ascend: ascendTabHtml, seasons: seasonsTabHtml, stats: statsTabHtml, other: otherTabHtml,
	};

	/* ----- The dashboard: one row per feature ----- */

	// A status line without its "Label: " prefix.
	function afterLabel(line) {
		return line.replace(/^[^:]{1,24}: /, '');
	}

	// Splits "Next: ... (waiting for ...)" into what is being done and what it is waiting for.
	function splitWait(text) {
		const match = /^(.*?)\s*\(((?:waiting|rebuy|buying|short|[0-9]).*)\)\.?(.*)$/.exec(text);
		if (!match) return { now: text, wait: '' };
		return { now: (match[1] + match[3]).trim(), wait: match[2].replace(/^waiting for /, '') };
	}

	function clickerRow() {
		const s = settings();
		const on = [];
		if (s.clickGolden) on.push(s.clickWrath ? 'golden and wrath cookies' : 'golden cookies');
		if (s.clickReindeer) on.push('reindeer');
		if (s.clickFortunes) on.push('fortunes');
		const measured = state.measuredClickRate;
		let now = s.clickRate > 0 ?
			`Big cookie ${s.clickRate}/s` + (measured !== null ? ` (${measured.toFixed(1)} landing)` : '') + '.' :
			'Big cookie autoclicker off.';
		now += on.length ? ` Clicking ${on.join(', ')}.` : '';
		return { tab: 'clickers', name: 'Clickers', dot: s.clickRate > 0 || on.length ? 'on' : 'off', now: now, wait: '' };
	}

	function wrinklerRow() {
		const s = settings();
		let wait = '';
		if (s.wrinklerMode === 'feed') wait = s.autoAscend ? 'the auto-ascend, to pop them first' : '';
		return { tab: 'clickers', name: 'Wrinklers', dot: s.wrinklerMode === 'off' ? 'off' : 'on',
			now: (s.wrinklerMode === 'off' ? 'Left alone. ' : '') + capitalize(afterLabel(wrinklerLine())) + '.' +
				(isCollectingHalloween() ? ' Halloween: Auto seasons pops each one as soon as it has fed, for the spooky cookies. Your setting is unchanged.' : ''), wait: wait };
	}

	function autoBuyRow() {
		const s = settings();
		const status = state.buyStatus;
		let dot = 'on';
		let now = status;
		let wait = '';
		if (!s.autoBuy) dot = 'off';
		else if (/^Paused/.test(status)) dot = 'warn';
		else if (/^Waiting on the item: /.test(status)) {
			dot = 'wait';
			const parts = /^Waiting on the item: saving for (.*), need (.*) more\.$/.exec(status);
			if (parts) {
				now = `Saving for ${parts[1]}.`;
				wait = `${parts[2]} more cookies`;
			}
		} else if (/^Waiting on reserve: /.test(status)) {
			dot = 'wait';
			const parts = /^Waiting on reserve: (.*), need (.*) more\.$/.exec(status);
			if (parts) {
				now = capitalize(parts[1]) + '.';
				wait = `${parts[2]} more cookies, to keep the reserve`;
			}
		} else if (/^(Working|Waiting)/.test(status)) dot = 'wait';
		predictionLines().forEach(function (line) { now += ' ' + line + '.'; });
		now += fastBuyingNote();
		return { tab: 'autobuy', name: 'Auto-buy', dot: dot, now: now, wait: wait };
	}

	function reserveRow() {
		const mode = settings().reserveMode;
		return { tab: 'autobuy', name: 'Cookie reserve', dot: mode === 'off' ? 'off' : 'on',
			now: mode === 'off' ? 'Off: nothing is kept banked.' : `${Beautify(reserveAmount())} kept banked (${reserveLabel()}).`, wait: '' };
	}

	function lumpRow() {
		const s = settings();
		const lines = lumpLines();
		if (lines.length < 2) return { tab: 'lumps', name: 'Sugar lumps', dot: 'off', now: capitalize(afterLabel(lines[0])) + '.', wait: '' };
		const waits = [];
		const next = nextLumpSpend();
		if (s.autoSpendLumps && next) {
			const need = next.cost + s.keepLumps - Game.lumps;
			if (need > 0) waits.push(`${Beautify(need)} more ${need === 1 ? 'lump' : 'lumps'}`);
		}
		if (!isBornAgain() && !isLumpRipe()) waits.push(`the current lump, ripe in ${formatDuration(Game.lumpRipeAge - lumpAge())}`);
		const anyOn = s.autoHarvestLumps || s.autoSpendLumps;
		return { tab: 'lumps', name: 'Sugar lumps', dot: !anyOn ? 'off' : waits.length ? 'wait' : 'on',
			now: `${lumpCount(Game.lumps)} owned. ${capitalize(afterLabel(lines[1]))}.` + (s.autoHarvestLumps ? '' : ' Auto-harvest off.') +
				(state.lastHarvest ? ` Last harvest: ${state.lastHarvest}.` : ''),
			wait: anyOn ? waits.join('; ') : '' };
	}

	function dragonRows() {
		const s = settings();
		const lines = dragonLines();
		const anyOn = s.autoTrainDragon || s.autoPetDragon || !!s.dragonAura1 || !!s.dragonAura2;
		const parts = splitWait(afterLabel(lines[0]));
		const rows = [{ tab: 'dragon', name: 'Dragon', dot: !anyOn ? 'off' : s.autoTrainDragon && parts.wait && !/ready$/.test(parts.wait) ? 'wait' : 'on',
			now: capitalize(parts.now), wait: s.autoTrainDragon ? parts.wait : '' }];
		if (lines[1]) {
			const pet = afterLabel(lines[1]);
			const petWait = /waiting for (the next quarter-hour.*)$/.exec(pet);
			rows.push({ tab: 'dragon', name: 'Dragon petting', dot: petWait ? 'wait' : 'on',
				now: capitalize(petWait ? pet.slice(0, petWait.index).replace(/, $/, '') : pet) + '.', wait: petWait ? petWait[1] : '' });
		}
		return rows;
	}

	function marketRows() {
		const s = settings();
		const lines = marketLines();
		if (!lines.length) return [{ tab: 'market', name: 'Stock Market', dot: 'off', now: 'Auto-trade off.', wait: '' }];
		const M = market();
		let wait = '';
		if (s.autoTrade && M) {
			if (state.ascendPending) wait = '';
			else if (holdingsValue(M).shares) wait = `a held stock at ${s.marketSellPercent}% of its resting value or more, to sell`;
			else wait = `a stock at ${s.marketBuyPercent}% of its resting value or less, to buy`;
		}
		const rows = [{ tab: 'market', name: 'Stock Market', dot: !s.autoTrade ? 'off' : M ? 'on' : 'wait',
			now: capitalize(afterLabel(lines[0])), wait: wait }];
		if (lines[1]) rows.push({ tab: 'market', name: 'Market staff', dot: 'on', now: capitalize(afterLabel(lines[1])), wait: '' });
		return rows;
	}

	function grimoireRow() {
		const s = settings();
		const lines = grimoireLines();
		if (!lines.length) return { tab: 'grimoire', name: 'Grimoire', dot: 'off', now: 'Auto-cast off.', wait: '' };
		const M = grimoire();
		let wait = '';
		let dot = s.autoCast ? 'on' : 'off';
		if (s.autoCast && M) {
			const choice = spellChoice(M);
			const hold = choice.spell ? castHoldReason(M, choice.spell, choice.byAddOn) : 'an add-on to allow the cast';
			if (M.magic < M.magicM) wait = `a full magic meter (${formatDuration(secondsToFullMagic(M) * 1000)})`;
			else if (hold) wait = hold.replace(/^waiting for /, '');
			if (wait) dot = 'wait';
		} else if (s.autoCast) {
			dot = 'wait';
		}
		return { tab: 'grimoire', name: 'Grimoire', dot: dot, now: capitalize(afterLabel(lines[0])), wait: wait };
	}

	function ascendRow() {
		const s = settings();
		const progress = prestigeProgress();
		const value = ascendProgressValue(progress);
		let now = `Prestige ${Beautify(value)} / ${Beautify(s.ascendThreshold)} ` + (s.ascendMode === 'total' ? 'in total' : 'gained this run');
		if (s.wrinklerMode === 'feed') now += ', wrinkler payout included';
		now += '.';
		if (!s.autoAscend) return { tab: 'ascend', name: 'Auto-ascend', dot: 'off', now: 'Off. ' + now, wait: '' };
		if (state.ascendWarning) {
			return { tab: 'ascend', name: 'Auto-ascend', dot: 'warn', now: now + ' The threshold was already reached, so it has not ascended.',
				wait: 'you to turn auto-ascend off and on to confirm' };
		}
		const left = s.ascendThreshold - value;
		return { tab: 'ascend', name: 'Auto-ascend', dot: left > 0 ? 'wait' : 'on', now: now, wait: left > 0 ? `${Beautify(left)} more prestige` : '' };
	}

	// What an add-on's status() returned, as a dashboard row. A string is taken as what it is doing now.
	function addOnRow(tab) {
		let status = null;
		try {
			status = tab.status ? tab.status() : null;
		} catch (e) {
			status = { now: `Its status could not be read (${String(e && e.message || e)}).`, state: 'warn' };
		}
		if (!status) return null;
		if (typeof status === 'string') status = { now: status };
		const dot = ['on', 'off', 'wait', 'warn'].indexOf(status.state) !== -1 ? status.state : 'on';
		return { tab: tab.id, name: tab.title, addOn: true, dot: dot, now: String(status.now || ''), wait: String(status.wait || '') };
	}

	function dashboardRows() {
		const grandmas = grandmaRow();
		const godzamok = godzamokRow();
		let rows = [clickerRow(), wrinklerRow(), autoBuyRow()].concat(grandmas ? [grandmas] : [], [reserveRow(), lumpRow()])
			.concat(dragonRows(), [pantheonRow()], godzamok ? [godzamok] : [], marketRows(), [grimoireRow(), seasonsRow(), ascendRow()]);
		rows = rows.concat(extrasRows());
		ext.tabs.forEach(function (tab) {
			const row = addOnRow(tab);
			if (row) rows.push(row);
		});
		if (state.lastError) rows.push({ tab: 'other', name: 'Last error', dot: 'warn', now: state.lastError, wait: '' });
		if (state.paused) rows = rows.map(function (row) { return Object.assign({}, row, { dot: row.dot === 'off' ? 'off' : 'wait' }); });
		return rows;
	}

	function dashboardRowHtml(row) {
		return `<div class="afk-dash${row.dot === 'off' ? ' afk-dash-off' : ''}" data-afk-go="${escapeHtml(row.tab)}">` +
			`<span class="afk-dot afk-dot-${row.dot}"></span>` +
			`<span class="afk-dash-name">${row.addOn ? '<i>' : ''}${escapeHtml(row.name)}${row.addOn ? '</i>' : ''}</span>` +
			`<span class="afk-dash-now">${escapeHtml(row.now)}</span>` +
			(row.wait ? `<span class="afk-dash-wait">${escapeHtml(row.wait)}</span>` : '<span class="afk-dash-wait afk-dash-nothing">&ndash;</span>') +
			'</div>';
	}

	// The live part of the open tab: every row on the Dashboard, the tab's own rows on a settings tab.
	function liveHtml() {
		const tab = state.panelTab;
		const rows = dashboardRows().filter(function (row) { return tab === 'dashboard' || row.tab === tab; });
		const paused = state.paused ?
			'<div class="afk-paused">Paused. Nothing is clicked, bought, traded or cast until you press Resume. Your settings are unchanged.</div>' : '';
		const head = tab === 'dashboard' ?
			'<div class="afk-dash afk-dash-head"><span></span><span>Feature</span><span>Doing now</span><span>Waiting for</span></div>' : '';
		return paused + head + rows.map(dashboardRowHtml).join('');
	}

	/* ----- Settings export and import ----- */

	function exportSettings() {
		return EXPORT_PREFIX + btoa(unescape(encodeURIComponent(mod.save())));
	}

	// What an exported text holds, or null if the text isn't one.
	function parseExport(text) {
		const cleaned = String(text).replace(/\s+/g, '');
		if (cleaned.indexOf(EXPORT_PREFIX) !== 0) return null;
		let parsed;
		try {
			parsed = JSON.parse(decodeURIComponent(escape(atob(cleaned.slice(EXPORT_PREFIX.length)))));
		} catch (e) {
			return null;
		}
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
	}

	// The past runs in an exported text that aren't in the Stats history yet. An import adds them and
	// never removes one of the player's own.
	function importedRuns(text) {
		const parsed = parseExport(text);
		const own = mod.income.history.map(function (record) { return record.start; });
		return sanitizeHistory(parsed && parsed.income && parsed.income.history).filter(function (record) { return own.indexOf(record.start) === -1; });
	}

	// The settings in an exported text, checked like a saved game's, or null if the text isn't one.
	function importedSettings(text) {
		const parsed = parseExport(text);
		if (!parsed) return null;
		const imported = sanitizeSettings(parsed);
		// An imported text must never be able to trigger an ascension.
		imported.autoAscend = false;
		// What the market paid for the stock it holds belongs to this game, not to the settings.
		imported.marketBasis = settings().marketBasis;
		return imported;
	}

	function settingText(key, value) {
		if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
		if (value === null) return 'automatic';
		if (hasKey(CYCLE_OPTIONS, key)) return CYCLE_OPTIONS[key][value];
		if (key === 'overlayColors') return Object.keys(value).length ? Object.keys(value).map(function (rating) { return `${RATINGS[rating].label} ${value[rating]}`; }).join(', ') : 'default';
		if (key === 'lumpPriority') return value.length ? value.map(function (entry) { return `${entry.building} to ${entry.level}`; }).join(', ') : 'empty';
		if (value === '') return 'none';
		return typeof value === 'number' ? Beautify(value) : String(value);
	}

	// One line per setting an import would change: "Label: old → new".
	function importChanges(imported) {
		const current = settings();
		const changes = [];
		for (const key in SETTING_LABELS) {
			if (JSON.stringify(current[key]) === JSON.stringify(imported[key])) continue;
			changes.push(`${SETTING_LABELS[key]}: ${settingText(key, current[key])} → ${settingText(key, imported[key])}`);
		}
		return changes;
	}

	function checkImport() {
		const draft = state.importDraft;
		draft.preview = null;
		draft.error = '';
		if (!draft.text.trim()) {
			draft.error = 'Paste a settings text first.';
			return;
		}
		const imported = importedSettings(draft.text);
		if (!imported) {
			draft.error = 'That is not an AFK Baker settings text.';
			return;
		}
		draft.preview = { settings: imported, changes: importChanges(imported), runs: importedRuns(draft.text) };
	}

	function applyImport() {
		const draft = state.importDraft;
		if (!draft.preview) return;
		mod.settings = draft.preview.settings;
		mod.income.history = mod.income.history.concat(draft.preview.runs)
			.sort(function (a, b) { return b.end - a.end; }).slice(0, INCOME_HISTORY_MAX);
		applyColors();
		state.importDraft = { text: '', preview: null, error: '' };
		state.ascendWarning = false;
		recheckAscendWarning();
		applyOverlay();
	}

	function copyExport() {
		const text = exportSettings();
		const field = document.getElementById('afkExportText');
		if (field) field.select();
		try {
			if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
			else document.execCommand('copy');
		} catch (e) {
			// The text stays selected, so Ctrl+C still copies it.
		}
		state.exportCopied = true;
	}

	/* ----- The panel itself ----- */

	function panelTabs() {
		return TABS.map(function (tab) { return { id: tab[0], title: tab[1], addOn: null }; })
			.concat(ext.tabs.map(function (tab) { return { id: tab.id, title: tab.title, addOn: tab }; }));
	}

	// The panel lies over the game's center area (the building rows) without being inside it: that area
	// scrolls, and the panel must not scroll away with it.
	function placePanel() {
		const panel = document.getElementById('afkPanel');
		const center = document.getElementById('centerArea');
		if (!panel || !center) return;
		panel.style.top = center.offsetTop + 'px';
		panel.style.left = center.offsetLeft + 'px';
	}

	// Built once. The panel covers the middle of the screen, where the game shows its own menus, and
	// leaves the cookie and the store clickable. Its opening tab hangs in the strip under the news ticker.
	function ensurePanel() {
		if (document.getElementById('afkPanel')) return true;
		const comments = document.getElementById('comments');
		const center = document.getElementById('centerArea');
		if (!comments || !center || !center.parentNode) return false;

		const open = document.createElement('div');
		open.id = 'afkOpen';
		open.innerHTML = '<span class="afk-dot afk-dot-on" id="afkOpenDot"></span>AFK Baker<span id="afkBuyLine"></span>';
		open.addEventListener('click', function (event) {
			PlaySound('snd/tick.mp3');
			// The line that says what auto-buy is doing opens its tab.
			if (event.target.closest('#afkBuyLine')) {
				openPanel('autobuy');
				return;
			}
			if (state.panelOpen) closePanel();
			else openPanel();
		});
		comments.appendChild(open);

		const panel = document.createElement('div');
		panel.id = 'afkPanel';
		panel.style.display = 'none';
		panel.innerHTML = '<div id="afkPanelHead"></div><div id="afkPanelTabs"></div>' +
			'<div id="afkPanelBody"><div id="afkPanelLive"></div><div id="afkBakerMenu"></div></div>';
		panel.addEventListener('click', onMenuClick);
		panel.addEventListener('change', onMenuChange);
		panel.addEventListener('input', onMenuInput);
		panel.addEventListener('keydown', onMenuKeyDown);
		panel.addEventListener('pointerdown', onDragPointerDown);
		panel.addEventListener('pointerdown', onGodPointerDown);
		center.parentNode.appendChild(panel);
		if (typeof ResizeObserver !== 'undefined') {
			new ResizeObserver(function (entries) {
				for (const entry of entries) panel.classList.toggle('afk-panel-narrow', entry.contentRect.width < NARROW_PANEL_PX);
			}).observe(panel);
		}
		return true;
	}

	function openPanel(tab) {
		if (!ensurePanel()) return;
		// The game's menus use the same space; close whichever is open.
		if (Game.onMenu !== '') Game.ShowMenu(Game.onMenu);
		if (tab) state.panelTab = tab;
		state.panelOpen = true;
		placePanel();
		document.getElementById('afkPanel').style.display = '';
		document.getElementById('afkOpen').classList.add('afk-selected');
		renderMenuSection();
	}

	function closePanel() {
		if (!state.panelOpen) return;
		state.panelOpen = false;
		const panel = document.getElementById('afkPanel');
		if (panel) panel.style.display = 'none';
		const open = document.getElementById('afkOpen');
		if (open) open.classList.remove('afk-selected');
		Game.tooltip.shouldHide = 1;
	}

	function setPaused(paused) {
		state.paused = !!paused;
		// Clicks owed from before the pause are not made up afterwards.
		state.owedClicks = 0;
		state.lastClickTime = 0;
		state.clickWindowStart = 0;
	}

	function renderPanelHead() {
		const head = document.getElementById('afkPanelHead');
		if (!head) return;
		head.innerHTML = `<span class="afk-panel-name">AFK Baker <small>v${VERSION}</small></span>` +
			'<span class="afk-grow"></span>' +
			`<a class="smallFancyButton option afk-pause${state.paused ? ' afk-is-paused' : ''}" data-afk-action="pause" ` +
			Game.getTooltip('<div style="padding:8px;width:300px;font-size:11px;line-height:1.35;">Stops everything AFK Baker does (clicking, buying, lumps, dragon, trading, casting, ascending) without changing any setting. Resume picks up where it left off. The store ratings keep showing. A pause is not remembered when the game restarts.</div>', 'this') +
			`>${state.paused ? 'Resume' : 'Pause all'}</a>` +
			'<a class="smallFancyButton option afk-close" data-afk-action="close">x</a>';
	}

	// Draws the open tab. Only called when the player does something (opens the panel, switches tab,
	// changes a setting), so a field being typed in is never replaced under the player. What changes on
	// its own, the status rows and the lump list's numbers, is updated in place by refreshStatusLine.
	function renderMenuSection() {
		if (!state.panelOpen || !ensurePanel()) return;
		const tabs = panelTabs();
		if (!tabs.some(function (tab) { return tab.id === state.panelTab; })) state.panelTab = 'dashboard';
		renderPanelHead();
		document.getElementById('afkPanelTabs').innerHTML = tabs.map(function (tab) {
			return `<div class="afk-tab${tab.id === state.panelTab ? ' afk-selected' : ''}${tab.addOn ? ' afk-tab-addon' : ''}" data-afk-tab="${escapeHtml(tab.id)}">${escapeHtml(tab.title)}</div>`;
		}).join('');
		document.getElementById('afkPanelLive').innerHTML = liveHtml();

		const body = document.getElementById('afkBakerMenu');
		const current = tabs.filter(function (tab) { return tab.id === state.panelTab; })[0];
		if (current.addOn) {
			// The add-on fills its own container and handles its own events.
			body.innerHTML = '';
			const container = document.createElement('div');
			container.className = 'afk-addon';
			body.appendChild(container);
			try {
				current.addOn.render(container);
			} catch (e) {
				container.textContent = `This add-on's tab could not be drawn: ${String(e && e.message || e)}`;
			}
		} else {
			body.innerHTML = TAB_HTML[state.panelTab] ? TAB_HTML[state.panelTab]() : '';
		}
		state.renderedDragonLevel = Game.dragonLevel;
		watchLumpListWidth(body.querySelector('#afkLumpList'));
	}

	// The lump list's numbers move as lumps come in and levels are bought. They are written into the
	// existing rows, so a target field being edited and a drag in progress are left alone.
	function updateLumpList() {
		const list = document.getElementById('afkLumpList');
		if (!list) return;
		const plan = lumpPlan();
		const rows = list.querySelectorAll('[data-afk-row]');
		if (rows.length !== plan.length) return;
		plan.forEach(function (item, i) {
			const row = rows[i];
			const dragged = row.classList.contains('afk-drag-source');
			row.className = `afk-row afk-status-${item.status}${dragged ? ' afk-drag-source' : ''}`;
			row.querySelector('.afk-cur').textContent = item.building.level;
			row.querySelector('.afk-status').textContent = item.status;
			row.querySelector('.afk-need').textContent = item.cost > 0 ? Beautify(item.cost) : '-';
		});
		document.querySelectorAll('#afkBakerMenu .afk-tile').forEach(function (tile) {
			const building = Game.Objects[tile.dataset.building];
			if (!building) return;
			tile.classList.toggle('afk-unowned', building.amount === 0);
			tile.querySelector('.afk-tile-level').textContent = `Lv ${building.level}`;
		});
	}

	function onMenuClick(event) {
		const target = event.target.closest('[data-afk-toggle],[data-afk-cycle],[data-afk-lump],[data-afk-tab],[data-afk-action],[data-afk-go],[data-afk-aura-slot],[data-afk-aura],[data-afk-pslot-clear],[data-afk-god],[data-afk-pslot]');
		if (!target) return;
		const s = settings();
		const data = target.dataset;
		if (data.afkAuraSlot) {
			state.auraSlot = state.auraSlot === data.afkAuraSlot ? '' : data.afkAuraSlot;
		} else if (data.afkAura !== undefined) {
			if (!state.auraSlot || !pickAura(state.auraSlot, Number(data.afkAura))) return;
		} else if (data.afkPslotClear !== undefined) {
			clearPantheonPick(Number(data.afkPslotClear));
		} else if (data.afkGod || data.afkPslot !== undefined) {
			// Click a god, then a slot. A click on a slot (or the god in it) with a god chosen puts that god there.
			const slot = target.closest('[data-afk-pslot]');
			if (slot && state.godSelected) setPantheonPick(Number(slot.dataset.afkPslot), state.godSelected);
			else if (data.afkGod) state.godSelected = state.godSelected === data.afkGod ? '' : data.afkGod;
			else return;
		} else if (data.afkTab || data.afkGo) {
			state.panelTab = data.afkTab || data.afkGo;
			document.getElementById('afkPanelBody').scrollTop = 0;
		} else if (data.afkAction) {
			const action = data.afkAction;
			if (action === 'close') {
				PlaySound('snd/tick.mp3');
				closePanel();
				return;
			}
			if (action === 'pause') setPaused(!state.paused);
			else if (action === 'overlay') {
				s.storeOverlay = !isOverlayOn();
				applyOverlay();
			} else if (action === 'colors-reset') {
				s.overlayColors = {};
				applyColors();
			} else if (action === 'export-copy') copyExport();
			else if (action === 'import-check') checkImport();
			else if (action === 'import-apply') applyImport();
			else if (action === 'import-cancel') state.importDraft = { text: '', preview: null, error: '' };
			else if (action === 'stats-clear') {
				if (state.statsClearArmed) mod.income.history = [];
				state.statsClearArmed = !state.statsClearArmed;
			}
		} else if (data.afkLump) {
			editLumpPriority(data.afkLump, Number(data.index));
		} else if (data.afkToggle) {
			const key = data.afkToggle;
			s[key] = !s[key];
			if (key === 'autoAscend') onAutoAscendToggled();
			if (key === 'godzamokCombo') state.comboStopped = '';
		} else {
			const key = data.afkCycle;
			const options = Object.keys(CYCLE_OPTIONS[key]);
			s[key] = options[(options.indexOf(s[key]) + 1) % options.length];
			if (key === 'ascendMode' || key === 'wrinklerMode') recheckAscendWarning();
		}
		if (!data.afkAction || data.afkAction !== 'export-copy') state.exportCopied = false;
		if (data.afkAction !== 'stats-clear') state.statsClearArmed = false;
		Game.tooltip.shouldHide = 1;
		PlaySound('snd/tick.mp3');
		renderMenuSection();
	}

	function editLumpPriority(action, index) {
		const s = settings();
		const list = s.lumpPriority;
		const valid = index >= 0 && index < list.length;
		if (action === 'up' && valid && index > 0) {
			list.splice(index - 1, 0, list.splice(index, 1)[0]);
		} else if (action === 'down' && valid && index < list.length - 1) {
			list.splice(index + 1, 0, list.splice(index, 1)[0]);
		} else if (action === 'remove' && valid) {
			list.splice(index, 1);
		} else if (action === 'reset') {
			s.lumpPriority = defaultLumpPriority();
		} else if (action === 'add') {
			const level = clampInt(state.lumpDraft.level, 1, MAX_TARGET_LEVEL, 0);
			if (level && hasKey(Game.Objects, state.lumpDraft.building) && list.length < MAX_PRIORITY_ENTRIES) {
				list.push({ building: state.lumpDraft.building, level: level });
			}
		}
	}

	function lumpTargetEntry(input) {
		return settings().lumpPriority[Number(input.dataset.afkLumpTarget)];
	}

	// Keeps the Add row's building and level in state, so a menu rebuild doesn't lose them. A row's
	// target level is saved as soon as it's a valid whole number; anything else waits for the change event.
	function onMenuInput(event) {
		const dataset = event.target.dataset || {};
		if (dataset.afkLumpField) state.lumpDraft[dataset.afkLumpField] = event.target.value;
		if (dataset.afkImport !== undefined) state.importDraft.text = event.target.value;
		if (dataset.afkColor && hasKey(DEFAULT_COLORS, dataset.afkColor) && /^#[0-9a-f]{6}$/i.test(event.target.value)) {
			// Applied as the picker moves; the panel isn't redrawn, so the picker stays open.
			const colors = Object.assign({}, settings().overlayColors);
			colors[dataset.afkColor] = event.target.value;
			settings().overlayColors = sanitizeColors(colors);
			applyColors();
		}
		if (dataset.afkLumpTarget !== undefined && /^\d+$/.test(event.target.value.trim())) {
			const entry = lumpTargetEntry(event.target);
			const level = clampInt(event.target.value, 1, MAX_TARGET_LEVEL, 1);
			if (entry && level === Number(event.target.value.trim())) {
				entry.level = level;
				refreshStatusLine(Date.now(), true);
			}
		}
		if (dataset.afkNumber === 'ascendThreshold') showThresholdReadable(Math.floor(parseBigNumber(event.target.value)));
	}

	function showThresholdReadable(value) {
		const label = document.getElementById('afkThresholdReadable');
		if (label) label.textContent = thresholdReadable(value);
	}

	function onMenuChange(event) {
		const input = event.target;
		if (input.dataset && input.dataset.afkColor) {
			onMenuInput(event);
			return;
		}
		if (input.dataset && input.dataset.afkLumpField) {
			onMenuInput(event);
			return;
		}
		if (input.dataset && input.dataset.afkLumpTarget !== undefined) {
			// Leaving the field or pressing Enter: clamp bad input, then redraw the row's status and needed lumps.
			const entry = lumpTargetEntry(input);
			if (entry) entry.level = clampInt(input.value, 1, MAX_TARGET_LEVEL, entry.level);
			input.value = entry ? entry.level : input.value;
			// The row's status and needed lumps follow the new target.
			updateLumpList();
			refreshStatusLine(Date.now(), true);
			return;
		}
		const key = input.dataset && input.dataset.afkNumber;
		if (!key) return;
		const s = settings();
		if (key === 'ascendThreshold') {
			// Anything that isn't a number keeps the old threshold.
			s.ascendThreshold = sanitizeThreshold(input.value, s.ascendThreshold);
			showThresholdReadable(s.ascendThreshold);
			recheckAscendWarning();
		} else if (hasKey(INT_SETTINGS, key)) {
			s[key] = clampInt(input.value, INT_SETTINGS[key][0], INT_SETTINGS[key][1], s[key]);
		}
		input.value = s[key];
		refreshStatusLine(Date.now(), true);
	}

	function onMenuKeyDown(event) {
		if (event.key !== 'Enter' || !event.target.dataset) return;
		if (event.target.dataset.afkNumber || event.target.dataset.afkLumpTarget !== undefined) {
			event.target.blur();
		} else if (event.target.dataset.afkLumpField === 'level') {
			// Enter in the Add row's level field adds the entry, like clicking Add.
			state.lumpDraft.level = event.target.value;
			editLumpPriority('add', -1);
			PlaySound('snd/tick.mp3');
			renderMenuSection();
		}
	}

	/* ---------------------------------------------------------------------
	   Drag and drop in the lump priority list. Pointer events are used, not HTML5 drag and drop: they
	   work the same with mouse, pen and touch, the drop line and ghost are fully under our control, and
	   they don't fire the game's document mousedown/mouseup handlers.
	   --------------------------------------------------------------------- */

	const DRAG_THRESHOLD_PX = 4;
	const AUTOSCROLL_EDGE_PX = 40;
	const AUTOSCROLL_STEP_PX = 14;
	const AUTOSCROLL_INTERVAL_MS = 30;

	function onDragPointerDown(event) {
		const source = event.target.closest('[data-afk-drag]');
		if (!source || event.button !== 0 || state.drag) return;
		// No text selection, and no mousedown for the game's own handlers.
		event.preventDefault();
		event.stopPropagation();
		const kind = source.dataset.afkDrag;
		const index = Number(source.dataset.index);
		const entry = kind === 'row' ? settings().lumpPriority[index] : null;
		const building = kind === 'row' ? entry && entry.building : source.dataset.building;
		if (!hasKey(Game.Objects, building)) return;
		state.drag = {
			kind: kind, index: index, building: building, pointerId: event.pointerId,
			startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
			active: false, slot: -1, ghost: null, scroller: null, scrollTimer: 0,
		};
		try {
			source.setPointerCapture(event.pointerId);
		} catch (e) {
			// Capture only keeps events coming when the pointer leaves the window; the window listeners still work.
		}
		window.addEventListener('pointermove', onDragPointerMove, true);
		window.addEventListener('pointerup', onDragPointerUp, true);
		window.addEventListener('pointercancel', onDragPointerCancel, true);
		window.addEventListener('keydown', onDragKeyDown, true);
	}

	function onDragPointerMove(event) {
		const drag = state.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		event.preventDefault();
		drag.x = event.clientX;
		drag.y = event.clientY;
		if (!drag.active) {
			if (Math.abs(drag.x - drag.startX) + Math.abs(drag.y - drag.startY) < DRAG_THRESHOLD_PX) return;
			beginDrag(drag);
		}
		updateDrag(drag);
	}

	function beginDrag(drag) {
		drag.active = true;
		const ghost = document.createElement('div');
		ghost.className = 'afk-ghost smallFramed';
		ghost.innerHTML = buildingIconHtml(Game.Objects[drag.building]) + escapeHtml(drag.building);
		document.body.appendChild(ghost);
		drag.ghost = ghost;
		document.body.classList.add('afk-dragging');
		if (drag.kind === 'row') {
			const row = document.querySelector(`#afkBakerMenu [data-afk-row="${drag.index}"]`);
			if (row) row.classList.add('afk-drag-source');
		}
		drag.scroller = scrollParent(document.getElementById('afkBakerMenu'));
		drag.scrollTimer = setInterval(autoScrollDuringDrag, AUTOSCROLL_INTERVAL_MS);
	}

	function scrollParent(el) {
		for (let node = el && el.parentElement; node; node = node.parentElement) {
			const overflow = getComputedStyle(node).overflowY;
			if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
		}
		return null;
	}

	// Scrolls the panel while the pointer is held near its top or bottom edge.
	function autoScrollDuringDrag() {
		const drag = state.drag;
		if (!drag || !drag.scroller) return;
		const box = drag.scroller.getBoundingClientRect();
		let delta = 0;
		if (drag.y < box.top + AUTOSCROLL_EDGE_PX) delta = -AUTOSCROLL_STEP_PX;
		else if (drag.y > box.bottom - AUTOSCROLL_EDGE_PX) delta = AUTOSCROLL_STEP_PX;
		if (!delta) return;
		drag.scroller.scrollTop += delta;
		updateDrag(drag);
	}

	// The slot the item would be inserted at (0 = above the first row), or -1 if the pointer isn't over
	// the list or a row would land where it already is.
	function dropSlot(drag) {
		const list = document.getElementById('afkLumpList');
		if (!list) return -1;
		const box = list.getBoundingClientRect();
		const margin = 16;
		if (drag.x < box.left - margin || drag.x > box.right + margin || drag.y < box.top - margin || drag.y > box.bottom + margin) return -1;
		const rows = list.querySelectorAll('[data-afk-row]');
		let slot = rows.length;
		for (let i = 0; i < rows.length; i++) {
			const rect = rows[i].getBoundingClientRect();
			if (drag.y < rect.top + rect.height / 2) {
				slot = i;
				break;
			}
		}
		if (drag.kind === 'row' && (slot === drag.index || slot === drag.index + 1)) return -1;
		return slot;
	}

	function updateDrag(drag) {
		drag.ghost.style.transform = `translate(${drag.x + 14}px, ${drag.y + 10}px)`;
		drag.slot = dropSlot(drag);
		const line = document.getElementById('afkDropLine');
		const list = document.getElementById('afkLumpList');
		if (!line || !list) return;
		if (drag.slot < 0) {
			line.style.display = 'none';
			return;
		}
		const rows = list.querySelectorAll('[data-afk-row]');
		let top;
		if (drag.slot < rows.length) top = rows[drag.slot].offsetTop;
		else if (rows.length) top = rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight;
		else top = list.querySelector('.afk-head').offsetHeight;
		line.style.top = top + 'px';
		line.style.display = 'block';
	}

	function onDragPointerUp(event) {
		const drag = state.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		if (drag.active) {
			// The release can land anywhere, the big cookie included; the click that follows must not reach the game.
			swallowNextClick();
			if (drag.slot >= 0) applyDrop(drag);
		}
		endDrag();
	}

	function onDragPointerCancel(event) {
		if (state.drag && event.pointerId === state.drag.pointerId) endDrag();
	}

	function onDragKeyDown(event) {
		if (event.key !== 'Escape' || !state.drag) return;
		// Escape cancels the drag only; the game's own Escape handling doesn't see it.
		event.preventDefault();
		event.stopPropagation();
		if (state.drag.active) swallowNextClick();
		endDrag();
	}

	function swallowNextClick() {
		const swallow = function (event) {
			event.stopPropagation();
			event.preventDefault();
		};
		window.addEventListener('click', swallow, true);
		setTimeout(function () { window.removeEventListener('click', swallow, true); }, 0);
	}

	function applyDrop(drag) {
		const list = settings().lumpPriority;
		if (drag.kind === 'row') {
			const moved = list.splice(drag.index, 1)[0];
			list.splice(drag.slot > drag.index ? drag.slot - 1 : drag.slot, 0, moved);
		} else if (list.length < MAX_PRIORITY_ENTRIES) {
			const level = Math.min(MAX_TARGET_LEVEL, Game.Objects[drag.building].level + 1);
			list.splice(drag.slot, 0, { building: drag.building, level: level });
		}
		PlaySound('snd/tick.mp3');
	}

	function endDrag() {
		const drag = state.drag;
		if (!drag) return;
		window.removeEventListener('pointermove', onDragPointerMove, true);
		window.removeEventListener('pointerup', onDragPointerUp, true);
		window.removeEventListener('pointercancel', onDragPointerCancel, true);
		window.removeEventListener('keydown', onDragKeyDown, true);
		clearInterval(drag.scrollTimer);
		if (drag.ghost) drag.ghost.remove();
		document.body.classList.remove('afk-dragging');
		const wasActive = drag.active;
		state.drag = null;
		if (wasActive) renderMenuSection();
	}

	// What auto-buy is doing, in a few words, for the line next to the panel's tab.
	function buyLineText() {
		const s = settings();
		if (state.paused) return 'Paused';
		if (!s.autoBuy) return 'Auto-buy off';
		if (calc.paused || (calc.blocked && calc.fileSource !== null)) return 'Paused: safety check';
		if (Date.now() < state.fastBuyingUntil) return 'Fast buying';
		const target = state.buyTarget;
		if (target) {
			const shortfall = target.cost + reserveAmount() - Game.cookies;
			const cps = Game.unbuffedCps;
			if (shortfall > 0) return `Saving for ${target.label}` + (cps > 0 ? ` (${shortTime(shortfall / cps)})` : '');
			return `Buying ${target.label}`;
		}
		return state.lastBought ? `Bought ${state.lastBought}` : 'Working out what to buy';
	}

	function refreshBuyLine(now) {
		const line = document.getElementById('afkBuyLine');
		if (!line) return;
		const show = settings().showBuyLine;
		if (!show) {
			if (line.textContent) line.textContent = '';
			return;
		}
		// At most once a second, so it doesn't flicker while purchases come in fast.
		if (line.textContent && now < state.nextBuyLineAt) return;
		const text = buyLineText();
		if (line.textContent !== text) line.textContent = text;
		state.nextBuyLineAt = now + BUY_LINE_REFRESH_MS;
	}

	// Twice a second: the store ratings, the dot on the panel's tab, and the open tab's live parts.
	function refreshStatusLine(now, force) {
		if (!force && now - state.lastStatusRefresh < STATUS_REFRESH_MS) return;
		state.lastStatusRefresh = now;
		refreshOverlay(now);
		if (!ensurePanel()) return;
		refreshRedFox();

		const s = settings();
		const stopped = state.lastError || (s.autoBuy && (calc.paused || (calc.blocked && calc.fileSource !== null))) || (s.autoAscend && state.ascendWarning);
		const dot = document.getElementById('afkOpenDot');
		const dotClass = `afk-dot afk-dot-${state.paused ? 'wait' : stopped ? 'warn' : 'on'}`;
		if (dot.className !== dotClass) dot.className = dotClass;
		refreshBuyLine(now);
		if (!state.panelOpen) return;

		placePanel();
		const live = liveHtml();
		if (live !== state.lastLiveHtml) {
			state.lastLiveHtml = live;
			document.getElementById('afkPanelLive').innerHTML = live;
		}
		if (state.panelTab === 'lumps') updateLumpList();
		if (state.panelTab === 'stats') updateStatsTab();
		if (state.panelTab === 'seasons') updateSeasonsTab();
		// The aura lists show which auras are locked; redraw them when the dragon levels up, unless one is open.
		if (state.panelTab === 'dragon' && Game.dragonLevel !== state.renderedDragonLevel) {
			const focused = document.activeElement;
			if (!focused || focused.tagName !== 'SELECT') renderMenuSection();
		}
	}

	// The Pantheon and aura pickers draw the game's tooltips through these.
	mod.godTip = function (key) { return function () { return godTooltipFor(key); }; };
	mod.auraTip = function (id, slotKey) { return function () { return auraTooltip(id, slotKey); }; };

	Game.registerMod(MOD_ID, mod);
})();
