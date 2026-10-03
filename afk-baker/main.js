/*
 * AFK Baker: plays Cookie Clicker (Steam) while you're away.
 * Requires the Cookie Monster mod for payback period (PP) data.
 * MIT License. See LICENSE.
 */
(function () {
	'use strict';

	const MOD_ID = 'afk baker';
	const VERSION = '1.10.0';
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
	const CYCLE_OPTIONS = {
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
	// Cookie Monster has PP data for buying 1, 10 and 100 of each building (Objects1/10/100).
	const BUY_AMOUNTS = [1, 10, 100];
	// Cookie Monster rebuilds its data every logic tick, but only recalculates income after the game's
	// CalculateGains, which runs at the start of the tick after a purchase. Its hook can run before or
	// after ours, so the second refresh seen after a purchase is the first one that is certainly fresh.
	const FRESH_DATA_REFRESHES = 2;
	const SKIP_UNBUYABLE_MS = 60000;
	const STALE_PRICE_SKIP_MS = 5000;
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
		keepLumps: [0, MAX_KEEP_LUMPS],
		dragonTrainMinutes: [0, MAX_DRAGON_TRAIN_MINUTES],
		marketBuyPercent: [1, 100],
		marketSellPercent: [1, 1000],
		marketBankPercent: [0, 100],
		officeMinutes: [0, MAX_DRAGON_TRAIN_MINUTES],
	};
	const REINCARNATE_GRACE_MS = 3000;
	const STATUS_REFRESH_MS = 500;

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
		elderPledge: false,
		autoHarvestLumps: true,
		autoSpendLumps: false,
		keepLumps: 0,
		autoTrainDragon: false,
		dragonTrainMinutes: 10,
		// Aura names as in Game.dragonAuras; '' means the mod leaves that slot alone.
		dragonAura1: '',
		dragonAura2: '',
		autoPetDragon: false,
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
		autoAscend: false,
		ascendMode: 'gained',
		ascendThreshold: 1000,
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

	function sanitizeSettings(raw) {
		const settings = Object.assign({}, DEFAULTS);
		settings.lumpPriority = sanitizeLumpPriority(raw && raw.lumpPriority);
		settings.marketBasis = sanitizeMarketBasis(raw && raw.marketBasis);
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

	const state = {
		lastClickTime: 0,
		owedClicks: 0,
		clickWindowStart: 0,
		clickWindowClicks: 0,
		measuredClickRate: null, // clicks per second that actually landed, once measured
		nextBuyAt: 0,
		buyResumeAt: 0,
		buyStatus: 'Starting up.',
		// Set after a purchase: buy again as soon as Cookie Monster's data is fresh, not a second later.
		buyAgain: false,
		lastMonsterData: null,
		refreshesSinceBuy: FRESH_DATA_REFRESHES,
		skipUntil: {}, // candidate key -> { until, reason }
		stalePriceKey: '',
		stalePriceSince: 0,
		lastDumpSignature: '',
		nextLumpCheckAt: 0,
		lastHarvest: '',
		lastLevelUp: '',
		// The Add row of the lump priority list, kept here so menu rebuilds don't lose it.
		lumpDraft: { building: DEFAULT_LUMP_PRIORITY[0].building, level: '1' },
		drag: null, // a drag in the lump priority list, from pointerdown until it ends
		renderPending: false,
		nextDragonCheckAt: 0,
		nextPetAt: 0,
		lastDragonAction: '',
		// While petting: the special panel to put back afterwards, and how many pets this window has had.
		petSession: null,
		// The quarter-hour that has given its drop, or been petted enough without one.
		petDoneWindow: '',
		nextMarketCheckAt: 0,
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

	   M is the minigame object. Check ext.apiVersion first; it goes up when the hooks change.
	   ===================================================================== */
	const ext = {
		apiVersion: 1,
		overrides: { grimoireSpell: null, stockSignal: null, petWindow: null },
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
		state: state,
		init: function () {
			Game.registerHook('logic', onLogic);
			Game.registerHook('reincarnate', onReincarnate);
			Game.registerHook('reset', onReset);
			installStyles();
			installMenuHook();
			installClickSoundHook();
			console.log(`${LOG_PREFIX} v${VERSION} loaded.`);
		},
		save: function () {
			return JSON.stringify(Object.assign({ settingsVersion: SETTINGS_VERSION }, mod.settings));
		},
		load: function (str) {
			let parsed = null;
			try {
				parsed = JSON.parse(str);
			} catch (e) {
				debugLog('Bad save data, using defaults.', e);
			}
			mod.settings = sanitizeSettings(parsed);
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
			if (isAscending()) {
				state.owedClicks = 0;
				state.lastClickTime = 0;
				state.clickWindowStart = 0;
				return;
			}
			const s = settings();
			const now = Date.now();
			clickBigCookie(now);
			if (s.clickGolden || s.clickReindeer) clickShimmers();
			if (s.wrinklerMode === 'instant') popWrinklers(false);
			if (s.clickFortunes) clickFortune();
			runAutoBuy(now);
			runLumps(now);
			runDragon(now);
			runMarket(now);
			runGrimoire(now);
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
		// Cookie Monster's data still describes the previous run for a moment.
		state.buyResumeAt = Date.now() + REINCARNATE_GRACE_MS;
		state.skipUntil = {};
		forgetDragonRun();
		forgetMarketRun();
		forgetGrimoireRun();
	}

	function onReset() {
		state.ascendTriggered = false;
		state.ascendWarning = false;
		state.buyResumeAt = Date.now() + REINCARNATE_GRACE_MS;
		state.skipUntil = {};
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
			shimmer.pop();
			if (shimmer === state.spellCookie) noteSpellCookieClicked();
		}
	}

	function clickFortune() {
		const effect = Game.TickerEffect;
		if (!effect || effect.type !== 'fortune') return;
		// sub is the upgrade to unlock, or the strings 'fortuneGC' / 'fortuneCPS'.
		if (settings().fortuneMode === 'upgrades' && typeof effect.sub !== 'object') return;
		Game.tickerL.click();
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
		return '';
	}

	function isAllowedUpgrade(upgrade) {
		return !upgradeFilterReason(upgrade);
	}

	function isUsefulPP(pp) {
		// Cookie Monster uses Infinity for upgrades with no CpS effect, and <= 0 for harmful ones.
		return typeof pp === 'number' && Number.isFinite(pp) && pp > 0;
	}

	function getMonsterData() {
		const data = window.CookieMonsterData;
		if (!data || !data.Objects1 || !data.Upgrades) return null;
		return data;
	}

	// Cookie Monster replaces Objects1 with a new object each time it refreshes its data.
	function trackMonsterRefresh(data) {
		const objects = data && data.Objects1;
		if (!objects || objects === state.lastMonsterData) return;
		state.lastMonsterData = objects;
		state.refreshesSinceBuy++;
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

	// Anything of ours that changes buildings or CpS outside the PP buyer: make the buyer wait for
	// Cookie Monster to catch up, then carry on straight away.
	function noteGameChanged() {
		state.refreshesSinceBuy = 0;
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

	// The product of the temporary click buffs (Click frenzy, Dragonflight...), as Game.mouseCps applies them.
	function clickBuffMultiplier() {
		let mult = 1;
		for (const name in Game.buffs) {
			if (typeof Game.buffs[name].multClick !== 'undefined') mult *= Game.buffs[name].multClick;
		}
		return mult;
	}

	// Cookies per click the upgrade would add, from calling Game.mouseCps with the upgrade marked as
	// bought. mouseCps only reads game state, plus the cookiesPerClick mod hook, which Cookie Monster's
	// own simulation calls as well, so this has no side effects. Temporary click buffs are divided out
	// so that buying during a Click frenzy doesn't make click upgrades look 777 times better.
	function clickGainPerClick(upgrade, baseMouseCps) {
		const wasBought = upgrade.bought;
		upgrade.bought = 1;
		let withUpgrade;
		try {
			withUpgrade = Game.mouseCps();
		} finally {
			upgrade.bought = wasBought;
		}
		const buffMult = clickBuffMultiplier();
		return buffMult > 0 ? (withUpgrade - baseMouseCps) / buffMult : 0;
	}

	// Cookie Monster's PP formula, with the upgrade's extra click income standing in for extra CpS.
	function clickPP(price, incomeGain) {
		const payback = price / incomeGain;
		return Game.cookiesPs ? Math.max(price - Game.cookies, 0) / Game.cookiesPs + payback : payback;
	}

	// Every building bundle and upgrade with a useful PP, best first. Upgrades that are never
	// auto-bought are left out here, before ranking, and listed in report.filtered for the debug dump.
	// Cookie Monster gives upgrades that don't change CpS an infinite PP. While the autoclicker is on,
	// the ones that raise click income get a click PP instead; the rest go in report.infinite.
	function rankCandidates(data, report) {
		const candidates = [];
		for (const name in Game.Objects) {
			const building = Game.Objects[name];
			for (const amount of BUY_AMOUNTS) {
				const objects = data['Objects' + amount];
				const entry = objects && objects[name];
				if (!entry || !isUsefulPP(entry.pp)) continue;
				candidates.push({
					kind: 'building', name: name, amount: amount, pp: entry.pp,
					price: building.getSumPrice(amount), monsterPrice: entry.price,
				});
			}
		}
		const clickRate = effectiveClickRate();
		const baseMouseCps = clickRate > 0 ? Game.mouseCps() : 0;
		for (const upgrade of Game.UpgradesInStore) {
			// Research is handled separately by its own toggle.
			if (upgrade.pool === 'tech') continue;
			const reason = upgradeFilterReason(upgrade);
			if (reason) {
				report.filtered.push(`${upgrade.name} (${reason})`);
				continue;
			}
			const entry = data.Upgrades[upgrade.name];
			if (!entry) continue;
			const price = upgrade.getPrice();
			if (isUsefulPP(entry.pp)) {
				candidates.push({ kind: 'upgrade', name: upgrade.name, amount: 1, pp: entry.pp, price: price });
				continue;
			}
			if (entry.pp !== Infinity) continue; // <= 0: Cookie Monster says it lowers CpS
			if (clickRate <= 0) {
				report.infinite.push(`${upgrade.name} (autoclicker off)`);
				continue;
			}
			const gain = clickGainPerClick(upgrade, baseMouseCps) * clickRate;
			if (!(gain > 0)) {
				report.infinite.push(`${upgrade.name} (no click income gain)`);
				continue;
			}
			candidates.push({ kind: 'upgrade', name: upgrade.name, amount: 1, pp: clickPP(price, gain), price: price, tag: 'click' });
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

	// Cookie Monster's price lagging the real price means its PP numbers are out of date.
	function hasStalePrice(candidate) {
		return candidate.kind === 'building' && Math.abs(candidate.monsterPrice - candidate.price) > candidate.price * 0.01;
	}

	// Object.buy() charges each building's rounded-up price, which can add up to a few cookies more
	// than getSumPrice(). Allow for that so a bundle is never cut short.
	function purchaseCost(candidate) {
		return candidate.price + candidate.amount - 1;
	}

	// Picks the lowest-PP candidate that can be bought and buys it, or saves up for it.
	function buyBestByPP(data, now) {
		const report = { filtered: [], infinite: [] };
		const candidates = rankCandidates(data, report);
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
		if (!chosen) {
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
		const key = candidateKey(candidate);
		if (hasStalePrice(candidate)) {
			if (state.stalePriceKey !== key) {
				state.stalePriceKey = key;
				state.stalePriceSince = now;
			} else if (now - state.stalePriceSince >= STALE_PRICE_SKIP_MS) {
				// It's not catching up, so move on to the next best item instead of waiting forever.
				skipCandidate(candidate, now, "Cookie Monster's price stayed out of date");
				state.buyStatus = `Waiting on Cookie Monster data: its price for ${label} stayed out of date, skipping it for now.`;
				return { outcome: 'skipped next time, price stayed out of date', bought: false };
			}
			state.buyStatus = `Waiting on Cookie Monster data: its price for ${label} is out of date.`;
			return { outcome: 'waiting on Cookie Monster data', bought: false };
		}
		state.stalePriceKey = '';

		const reserve = reserveAmount();
		const cost = purchaseCost(candidate);
		const shortfall = cost + reserve - Game.cookies;
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

		const bought = candidate.kind === 'building' ?
			buyBuilding(candidate.name, candidate.amount) :
			tryBuyUpgrade(Game.Upgrades[candidate.name]);
		if (!bought) {
			skipCandidate(candidate, now, 'buying it failed');
			state.buyStatus = `Couldn't buy ${label}, skipping it for now.`;
			return { outcome: 'buying it failed', bought: false };
		}
		state.buyStatus = `Bought ${label} (${candidate.tag ? candidate.tag + ' ' : ''}PP ${Beautify(candidate.pp, 1)}).`;
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
		const data = getMonsterData();
		trackMonsterRefresh(data);
		const fresh = state.refreshesSinceBuy >= FRESH_DATA_REFRESHES;
		// Right after a purchase, go again as soon as the data is fresh. Otherwise check once a second.
		if (!(state.buyAgain && fresh) && now < state.nextBuyAt) return;
		state.buyAgain = false;
		state.nextBuyAt = now + BUY_INTERVAL_MS;

		const s = settings();
		if (!s.autoBuy) {
			state.buyStatus = 'Off.';
			return;
		}
		if (now < state.buyResumeAt) {
			state.buyStatus = 'Waiting for the new run to settle.';
			return;
		}
		if (!data) {
			state.buyStatus = 'Waiting on Cookie Monster data: not loaded yet (Cookie Monster is required).';
			return;
		}
		if (!fresh) {
			state.buyStatus = 'Waiting on Cookie Monster data: it has not refreshed since the last purchase.';
			return;
		}

		const bought = (s.elderPledge && buyElderPledgeItems()) ||
			(s.buyResearch && buyResearch()) ||
			buyBestByPP(data, now);
		if (bought) {
			state.buyAgain = true;
			state.refreshesSinceBuy = 0;
		}
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
		return building.level > levelBefore;
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

	function petDragon() {
		// Each pet throws a particle from the mouse pointer; leave that out for our own pets.
		const savedParticles = Game.prefs.particles;
		Game.prefs.particles = 0;
		try {
			withSoundsMuted(DRAGON_SOUND, function () { Game.ClickSpecialPic(); });
		} finally {
			Game.prefs.particles = savedParticles;
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
		if (!withSoundsMuted(MARKET_SOUND, function () { return M.sellGood(good.id, shares); })) return false;
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
		if (!withSoundsMuted(MARKET_SOUND, function () { return M.buyGood(good.id, amount); })) return false;
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
	function castHoldReason(M, spell) {
		const cost = M.getSpellCost(spell);
		if (cost > M.magicM) return `max magic is too low for this spell (it costs ${Beautify(cost)})`;
		if (spell === M.spells['hand of fate'] && !settings().clickGolden) return 'golden cookie clicking is off, so the summoned cookie would go to waste';
		if (M.magic < M.magicM) return 'waiting for full magic';
		return raisedBackfireReason(spell);
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
			cast = M.castSpell(spell);
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
		const spell = spellChoice(M).spell;
		if (spell && !castHoldReason(M, spell)) castSpell(M, spell);
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
	   SETTINGS UI
	   ===================================================================== */

	// There is no menu hook, so the Options menu is extended by wrapping Game.UpdateMenu.
	function installMenuHook() {
		const originalUpdateMenu = Game.UpdateMenu;
		Game.UpdateMenu = function () {
			// The game rebuilds the Options menu every 5 seconds; don't wipe a field the player is typing in.
			// The same goes for a drag in progress in the lump priority list.
			if (Game.onMenu === 'prefs' && (isEditingField() || state.drag) && document.getElementById('afkBakerMenu')) return;
			const result = originalUpdateMenu.apply(this, arguments);
			if (Game.onMenu === 'prefs') renderMenuSection();
			return result;
		};
	}

	// A focused text field or dropdown in our section: a number, or the priority list's Add row.
	function isEditingField() {
		const el = document.activeElement;
		return !!(el && (el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.closest('#afkBakerMenu'));
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

	// Layout for the lump priority list. Borders, fonts and buttons come from the game's own classes
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

	// Every aura can be picked, locked ones too: the dragon resets on each ascension, and a pick is set
	// as soon as the dragon reaches its level again.
	function auraSelect(key) {
		const s = settings();
		const other = key === 'dragonAura1' ? s.dragonAura2 : s.dragonAura1;
		let options = `<option value=""${s[key] ? '' : ' selected'}>None (leave it alone)</option>`;
		for (const index in Game.dragonAuras) {
			const aura = Game.dragonAuras[index];
			if (aura.id === 0) continue;
			const locked = Game.dragonLevel < auraUnlockLevel(aura.id);
			options += `<option value="${escapeHtml(aura.name)}"` +
				(aura.name === s[key] ? ' selected' : '') +
				(aura.name === other ? ' disabled' : '') +
				(locked ? ' style="color:#777;"' : '') + '>' +
				escapeHtml(aura.name) + (locked ? ` (unlocks at level ${auraUnlockLevel(aura.id)})` : '') + '</option>';
		}
		return `<select data-afk-select="${key}" style="${FIELD_STYLE}">${options}</select>`;
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
				const hold = castHoldReason(M, choice.spell);
				line += hold ? `${name}: ${hold}.` : `Casting ${name}.`;
			}
		}
		if (state.lastCast) line += ` Last: ${state.lastCast}.`;
		return [line];
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
			`Cookie reserve: ${Beautify(reserveAmount())} (${reserveLabel()})`,
			wrinklerLine(),
		].concat(lumpLines(), dragonLines(), marketLines(), grimoireLines(), [ascendLine]);
		if (s.autoAscend && state.ascendWarning) {
			lines.push('WARNING: Threshold already reached. Toggle auto-ascend off and on to confirm.');
		}
		if (state.lastError) lines.push(`Last error: ${state.lastError}`);
		return lines;
	}

	function statusHtml() {
		return statusLines().map(escapeHtml).join('<br>');
	}

	function menuHtml() {
		return '<div class="subsection" style="padding:0px;">' +
			`<div class="title">AFK Baker <small style="opacity:0.6;">v${VERSION}</small></div>` +
			`<div class="listing" id="afkBakerStatus" style="opacity:0.85;">${statusHtml()}</div>` +

			heading('Clickers') +
			listing(`<label>Big cookie clicks per second</label> ${numberInput('clickRate')}${note(`0 = off, max ${MAX_CLICK_RATE}; keeps clicking while minimized`)}`) +
			listing(toggleButton('muteCookieClick', 'Mute big cookie click sound') + note('your clicks and the autoclicker; every other sound stays on')) +
			listing(toggleButton('clickGolden', 'Golden cookies') + toggleButton('clickWrath', 'Include wrath cookies')) +
			listing(toggleButton('clickReindeer', 'Reindeer')) +
			listing(cycleButton('wrinklerMode', 'Wrinklers') + note('shinies are only ever popped by Feed mode, right before ascending')) +
			listing(toggleButton('clickFortunes', 'Fortune tickers') + cycleButton('fortuneMode', 'Click')) +

			heading('Auto-buy') +
			listing(toggleButton('autoBuy', 'Auto-buy') + note("buys Cookie Monster's lowest-PP upgrade or building (1, 10 or 100 at once), and waits for it rather than buying worse items")) +
			listing(note('with the autoclicker on, click upgrades such as the mouse upgrades are ranked by the click income they add')) +
			listing(toggleButton('muteBuySounds', 'Mute auto-buy purchase sounds') + note('only purchases made by AFK Baker; your own purchases still make a sound')) +
			listing(cycleButton('reserveMode', 'Cookie reserve') + note('Off by default; Lucky = 6,000x unbuffed CpS, Lucky + Frenzy = 42,000x')) +
			listing(`<label>Auto: no reserve for the first</label> ${numberInput('autoReserveMinutes')}<label>minutes of a run, then Lucky</label>`) +
			listing(toggleButton('buyResearch', 'Buy research') + note('research upgrades advance the grandmapocalypse')) +
			listing(toggleButton('elderPledge', 'Elder Pledge') + note('pledging stops wrinklers from spawning; never pledges in Feed mode or while a shiny is on screen')) +

			heading('Sugar lumps') +
			listing(toggleButton('autoHarvestLumps', 'Auto-harvest sugar lumps') + note('only when ripe, every lump type; paused during Born again')) +
			listing(toggleButton('autoSpendLumps', 'Auto-spend sugar lumps') + note('only on building levels, in list order; never skips ahead to a later entry')) +
			listing(`<label>Keep at least</label> ${numberInput('keepLumps')}<label>lumps</label>`) +
			lumpPriorityHtml() +

			heading('Krumblor the dragon') +
			listing(note('the dragon, its auras and its drops reset on every ascension, so the mod starts over each run')) +
			listing(toggleButton('autoTrainDragon', 'Auto-train dragon') + note('buys the crumbly egg, then trains level by level; cookie steps respect the cookie reserve')) +
			listing(`<label>Train when a step costs less than</label> ${numberInput('dragonTrainMinutes')}<label>minutes of CpS</label>`) +
			listing(note('for sacrifice steps: the cost of buying any missing buildings plus rebuying everything sacrificed, at unbuffed CpS')) +
			listing(`<label>Primary aura</label> ${auraSelect('dragonAura1')}`) +
			listing(`<label>Secondary aura</label> ${auraSelect('dragonAura2')}${note('used once the dragon is fully trained')}`) +
			listing(note('greyed auras are locked right now and are set once the dragon reaches that level; setting an aura costs one of your highest building; an aura already in either slot is never moved')) +
			listing(toggleButton('autoPetDragon', 'Auto-pet dragon') + note('opens the dragon panel to pet until all four drops are found, then buys Dragon fang and Dragon teddy bear; needs the heavenly upgrade Pet the dragon')) +

			heading('Stock market') +
			listing(note('the whole market resets on every ascension (your stock, brokers and office), so the mod rebuilds it each run; nothing happens until the Bank minigame is unlocked')) +
			listing(toggleButton('autoTrade', 'Auto-trade stocks') + note('uses only what a player can see, the prices; never reads the market\'s hidden state; never takes loans')) +
			listing(cycleButton('marketStrategy', 'Strategy') + note('guide rules, from KarmicChaos\'s stock market guide: always buy under $5, sell once past the bank ceiling ($97 + $3 per Bank level)')) +
			listing(`<label>Buy at</label> ${numberInput('marketBuyPercent', 40)}<label>% of resting value or less; sell at</label> ${numberInput('marketSellPercent', 40)}<label>% or more</label>`) +
			listing(`<label>The market may use up to</label> ${numberInput('marketBankPercent', 40)}<label>% of your bank</label>` + note('counted on the bank above the cookie reserve plus what is already invested')) +
			listing(toggleButton('marketSellAtLoss', 'Sell at a loss') + note('off: only sells for more than the stock cost, buying fee included; all stock is still sold right before an auto-ascend')) +
			listing(toggleButton('autoBrokers', 'Hire brokers') + note('each cuts the 20% buying fee by a twentieth; hired when the saving on one full warehouse fill covers its price')) +
			listing(toggleButton('autoOffice', 'Upgrade office') + `<label>when rebuying the Cursors costs less than</label> ${numberInput('officeMinutes', 50)}<label>minutes of CpS</label>`) +
			listing(note('an office upgrade sacrifices Cursors and needs a Cursor level; the mod never spends sugar lumps for it; brokers and office only run while auto-trade is on')) +

			heading('Grimoire') +
			listing(toggleButton('autoCast', 'Auto-cast spell') + cycleButton('grimoireSpell', 'Spell')) +
			listing(note('casts when the magic meter is full: magic regenerates faster the fuller the meter is, so that gives the most casts; nothing happens until the Wizard tower minigame is unlocked')) +
			listing(note('Force the Hand of Fate summons a golden cookie. It waits while a golden cookie is on screen or Magic inept is active (both raise the backfire chance), and while golden cookie clicking is off. The wrath cookie from a backfire is left alone')) +
			listing(note('Conjure Baked Goods gives 30 minutes of CpS, but capped at 15% of your bank, so it is weak when auto-buy keeps the bank low')) +
			listing(note('uses only what a player can see; never reads the seed or predicts what a spell will do')) +

			heading('Auto-ascend') +
			listing(toggleButton('autoAscend', 'Auto-ascend') + cycleButton('ascendMode', 'Threshold type')) +
			listing(`<label>Threshold</label> ${numberInput('ascendThreshold', 190)}<label id="afkThresholdReadable">${thresholdReadable(settings().ascendThreshold)}</label>`) +
			listing(note('plain digits, or scientific notation such as 1.146e15; ascends only, reincarnating and heavenly upgrades are up to you')) +
			listing(note('if the threshold is already reached when the mod loads or you change a setting, it warns instead of ascending')) +

			heading('Other') +
			listing(toggleButton('debug', 'Debug logging') + note('extra console output, including the top auto-buy candidates')) +
			'</div>';
	}

	// The data attribute that identifies a text field or dropdown, so it can be refocused after a re-render.
	const FIELD_KEYS = ['afkNumber', 'afkLumpField', 'afkLumpTarget', 'afkSelect'];

	function focusedFieldSelector() {
		const el = document.activeElement;
		if (!el || !el.dataset || !el.closest('#afkBakerMenu')) return '';
		for (const key of FIELD_KEYS) {
			if (el.dataset[key] === undefined) continue;
			const attr = 'data-' + key.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
			return `[${attr}="${el.dataset[key]}"]`;
		}
		return '';
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

	function renderMenuSection() {
		if (Game.onMenu !== 'prefs') return;
		// Replacing the section mid-drag would drop the drag; it's redrawn when the drag ends.
		if (state.drag) {
			state.renderPending = true;
			return;
		}
		const menu = document.getElementById('menu');
		if (!menu) return;
		const refocus = focusedFieldSelector();

		const section = document.createElement('div');
		section.id = 'afkBakerMenu';
		section.className = 'block';
		section.style.cssText = 'padding:0px;margin:8px 4px;';
		section.innerHTML = menuHtml();
		section.addEventListener('click', onMenuClick);
		section.addEventListener('change', onMenuChange);
		section.addEventListener('input', onMenuInput);
		section.addEventListener('keydown', onMenuKeyDown);
		section.addEventListener('pointerdown', onDragPointerDown);

		const existing = document.getElementById('afkBakerMenu');
		if (existing) existing.replaceWith(section);
		// The prefs menu ends with an empty spacer div; slot in just above it.
		else if (menu.lastElementChild) menu.insertBefore(section, menu.lastElementChild);
		else menu.appendChild(section);

		watchLumpListWidth(section.querySelector('#afkLumpList'));

		const field = refocus && section.querySelector(refocus);
		if (field) {
			field.focus();
			if (field.tagName === 'INPUT') field.setSelectionRange(field.value.length, field.value.length);
		}
	}

	function onMenuClick(event) {
		const target = event.target.closest('[data-afk-toggle],[data-afk-cycle],[data-afk-lump]');
		if (!target) return;
		const s = settings();
		if (target.dataset.afkLump) {
			editLumpPriority(target.dataset.afkLump, Number(target.dataset.index));
		} else if (target.dataset.afkToggle) {
			const key = target.dataset.afkToggle;
			s[key] = !s[key];
			if (key === 'autoAscend') onAutoAscendToggled();
		} else {
			const key = target.dataset.afkCycle;
			const options = Object.keys(CYCLE_OPTIONS[key]);
			s[key] = options[(options.indexOf(s[key]) + 1) % options.length];
			if (key === 'ascendMode' || key === 'wrinklerMode') recheckAscendWarning();
		}
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

	// An aura dropdown: '' leaves the slot alone, and the same aura can't be picked twice.
	function onAuraPicked(select) {
		const s = settings();
		const key = select.dataset.afkSelect;
		const other = key === 'dragonAura1' ? s.dragonAura2 : s.dragonAura1;
		if (key !== 'dragonAura1' && key !== 'dragonAura2') return;
		if (select.value === '' || (isAuraName(select.value) && select.value !== other)) s[key] = select.value;
		refreshStatusLine(Date.now(), true);
		// Redraw so the other dropdown greys out this pick, once focus has settled.
		setTimeout(renderMenuSection, 0);
	}

	function onMenuChange(event) {
		const input = event.target;
		if (input.dataset && input.dataset.afkLumpField) {
			onMenuInput(event);
			return;
		}
		if (input.dataset && input.dataset.afkLumpTarget !== undefined) {
			// Leaving the field or pressing Enter: clamp bad input, then redraw the row's status and needed lumps.
			const entry = lumpTargetEntry(input);
			if (entry) entry.level = clampInt(input.value, 1, MAX_TARGET_LEVEL, entry.level);
			input.value = entry ? entry.level : input.value;
			refreshStatusLine(Date.now(), true);
			// After focus has moved on (Tab, Enter, a click), so the redraw keeps whatever is focused then.
			setTimeout(renderMenuSection, 0);
			return;
		}
		if (input.dataset && input.dataset.afkSelect) {
			onAuraPicked(input);
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

	// Scrolls the Options menu while the pointer is held near its top or bottom edge.
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
		if (wasActive || state.renderPending) {
			state.renderPending = false;
			renderMenuSection();
		}
	}

	function refreshStatusLine(now, force) {
		if (!force && now - state.lastStatusRefresh < STATUS_REFRESH_MS) return;
		state.lastStatusRefresh = now;
		if (Game.onMenu !== 'prefs') return;
		const el = document.getElementById('afkBakerStatus');
		if (el) el.innerHTML = statusHtml();
	}

	Game.registerMod(MOD_ID, mod);
})();
