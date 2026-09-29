/*
 * AFK Baker: plays Cookie Clicker (Steam) while you're away.
 * Requires the Cookie Monster mod for payback period (PP) data.
 * MIT License. See LICENSE.
 */
(function () {
	'use strict';

	const MOD_ID = 'afk baker';
	const VERSION = '1.3.0';
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
	const CYCLE_OPTIONS = {
		reserveMode: RESERVE_MODES,
		wrinklerMode: WRINKLER_MODES,
		fortuneMode: FORTUNE_MODES,
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
		reserveMode: 'off',
		autoReserveMinutes: 30,
		buyResearch: true,
		elderPledge: false,
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

	function sanitizeSettings(raw) {
		const settings = Object.assign({}, DEFAULTS);
		if (!raw || typeof raw !== 'object') return settings;

		for (const key in DEFAULTS) {
			if (typeof DEFAULTS[key] === 'boolean' && typeof raw[key] === 'boolean') settings[key] = raw[key];
		}
		for (const key in CYCLE_OPTIONS) {
			if (hasKey(CYCLE_OPTIONS[key], raw[key])) settings[key] = raw[key];
		}
		settings.clickRate = clampInt(raw.clickRate, 0, MAX_CLICK_RATE, DEFAULTS.clickRate);
		settings.autoReserveMinutes = clampInt(raw.autoReserveMinutes, 0, MAX_AUTO_RESERVE_MINUTES, DEFAULTS.autoReserveMinutes);
		settings.ascendThreshold = clampInt(raw.ascendThreshold, 1, Number.MAX_SAFE_INTEGER, DEFAULTS.ascendThreshold);
		const savedVersion = Number(raw.settingsVersion) || 1;
		if (savedVersion < 2) settings.autoAscend = DEFAULTS.autoAscend;
		if (savedVersion < 3) settings.elderPledge = DEFAULTS.elderPledge;
		if (savedVersion < 4) settings.reserveMode = DEFAULTS.reserveMode;
		return settings;
	}

	const state = {
		lastClickTime: 0,
		owedClicks: 0,
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
		ascendTriggered: false,
		// Set when the threshold was already met at load or by a settings change; cleared by re-arming.
		ascendWarning: false,
		needsLoadCheck: true,
		lastStatusRefresh: 0,
		lastError: '',
	};

	const mod = {
		version: VERSION,
		settings: Object.assign({}, DEFAULTS),
		state: state,
		init: function () {
			Game.registerHook('logic', onLogic);
			Game.registerHook('reincarnate', onReincarnate);
			Game.registerHook('reset', onReset);
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
				return;
			}
			const s = settings();
			const now = Date.now();
			clickBigCookie(now);
			if (s.clickGolden || s.clickReindeer) clickShimmers();
			if (s.wrinklerMode === 'instant') popWrinklers(false);
			if (s.clickFortunes) clickFortune();
			runAutoBuy(now);
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
	}

	function onReset() {
		state.ascendTriggered = false;
		state.ascendWarning = false;
		state.buyResumeAt = Date.now() + REINCARNATE_GRACE_MS;
		state.skipUntil = {};
	}

	/* =====================================================================
	   CLICKERS
	   ===================================================================== */

	function clickBigCookie(now) {
		const rate = settings().clickRate;
		if (rate <= 0 || !state.lastClickTime) {
			state.owedClicks = 0;
			state.lastClickTime = now;
			return;
		}
		// Clicks are owed by wall-clock time, so a throttled (minimized) window still gets the
		// configured rate. Capped at 5 seconds, matching the game's own catch-up limit.
		state.owedClicks = Math.min(state.owedClicks + (now - state.lastClickTime) / 1000 * rate, rate * 5);
		state.lastClickTime = now;
		if (state.owedClicks < 1) return;

		const clicks = Math.floor(state.owedClicks);
		const clicksBefore = Game.cookieClicks;
		// ClickCookie accepts one click per 20 ms. Several owed clicks become one click worth that many.
		Game.ClickCookie(0, clicks > 1 ? Game.computedMouseCps * clicks : 0);
		if (Game.cookieClicks === clicksBefore) return;
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
			} else if (shimmer.type === 'reindeer') {
				if (!s.clickReindeer) continue;
			} else {
				continue;
			}
			shimmer.pop();
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

	function tryBuyUpgrade(upgrade) {
		if (upgrade.bought || !canAfford(upgrade.getPrice()) || !upgrade.canBuy()) return false;
		// buy(1) skips confirmation prompts such as the one on "One mind".
		upgrade.buy(1);
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
			building.buy(amount);
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

	// Every building bundle and upgrade with a useful PP, best first. Upgrades that are never
	// auto-bought are left out here, before ranking, and listed in `filtered` for the debug dump.
	function rankCandidates(data, filtered) {
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
		for (const upgrade of Game.UpgradesInStore) {
			// Research is handled separately by its own toggle.
			if (upgrade.pool === 'tech') continue;
			const reason = upgradeFilterReason(upgrade);
			if (reason) {
				filtered.push(`${upgrade.name} (${reason})`);
				continue;
			}
			const entry = data.Upgrades[upgrade.name];
			if (!entry || !isUsefulPP(entry.pp)) continue;
			candidates.push({ kind: 'upgrade', name: upgrade.name, amount: 1, pp: entry.pp, price: upgrade.getPrice() });
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
		const filtered = [];
		const candidates = rankCandidates(data, filtered);
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
		dumpCandidates(candidates, chosen, outcome, skipped, filtered);
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
		state.buyStatus = `Bought ${label} (PP ${Beautify(candidate.pp, 1)}).`;
		return { outcome: 'bought', bought: true };
	}

	// Debug only: the top candidates and what happened to each. Logged when the decisions change.
	function dumpCandidates(candidates, chosen, outcome, skipped, filtered) {
		if (!settings().debug) return;
		const shown = candidates.slice(0, DEBUG_TOP_CANDIDATES);
		if (chosen && shown.indexOf(chosen) === -1) shown.push(chosen);
		const rows = shown.map(function (candidate) {
			let decision = 'not reached, a better item was chosen';
			if (candidate === chosen) decision = `chosen: ${outcome}`;
			else if (skipped.has(candidate)) decision = `skipped: ${skipped.get(candidate)}`;
			return {
				name: candidate.name,
				amount: candidate.amount,
				pp: Number(candidate.pp.toPrecision(4)),
				price: Beautify(candidate.price),
				decision: decision,
			};
		});
		// Prices and PP change constantly, so only a change of items or decisions triggers a new dump.
		const signature = rows.map(function (row) { return `${row.name}|${row.amount}|${row.decision}`; }).join(';') +
			'#' + filtered.join(';');
		if (signature === state.lastDumpSignature) return;
		state.lastDumpSignature = signature;
		console.log(`${LOG_PREFIX} Top auto-buy candidates:`);
		console.table(rows);
		if (filtered.length) console.log(LOG_PREFIX, 'Filtered out before ranking:', filtered.join(', '));
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
	   AUTO-ASCEND
	   ===================================================================== */

	function prestigeProgress() {
		// In "feed" mode every wrinkler, shinies included, is popped before ascending, so count their payout now.
		const summary = wrinklerSummary();
		const pending = settings().wrinklerMode === 'feed' ? summary.normalPayout + summary.shinyPayout : 0;
		// Same expressions the game uses for the Legacy button tooltip.
		const owned = Math.floor(Game.HowMuchPrestige(Game.cookiesReset));
		const afterAscending = Math.floor(Game.HowMuchPrestige(Game.cookiesReset + Game.cookiesEarned + pending));
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
		if (!s.autoAscend || state.ascendTriggered || state.ascendWarning) return;
		const progress = prestigeProgress();
		if (!isThresholdMet(progress)) return;

		// Wrinklers only pop during normal logic ticks, not during the ascend animation, and
		// reincarnating wipes them, shinies included. Pop them all first and ascend on a later
		// tick once they've paid out.
		if (s.wrinklerMode === 'feed' && popWrinklers(true)) return;

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
			if (Game.onMenu === 'prefs' && isEditingNumber() && document.getElementById('afkBakerMenu')) return;
			const result = originalUpdateMenu.apply(this, arguments);
			if (Game.onMenu === 'prefs') renderMenuSection();
			return result;
		};
	}

	function isEditingNumber() {
		const el = document.activeElement;
		return !!(el && el.dataset && el.dataset.afkNumber);
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

	function numberInput(key) {
		return `<input type="text" inputmode="numeric" data-afk-number="${key}" value="${settings()[key]}" ` +
			'style="width:90px;background:#000;color:#ccc;border:1px solid #ccc;padding:3px 6px;font-size:12px;margin:2px 4px 2px 0px;">';
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

	function statusLines() {
		const s = settings();
		const progress = prestigeProgress();
		let ascendLine = `Prestige: ${Beautify(ascendProgressValue(progress))} / ${Beautify(s.ascendThreshold)} ` +
			(s.ascendMode === 'total' ? 'total' : 'gained this run');
		if (s.wrinklerMode === 'feed') ascendLine += ' (includes wrinkler payout)';
		if (!s.autoAscend) ascendLine += ', auto-ascend off';

		const lines = [
			`Auto-buy: ${state.buyStatus}`,
			`Cookie reserve: ${Beautify(reserveAmount())} (${reserveLabel()})`,
			wrinklerLine(),
			ascendLine,
		];
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
			listing(cycleButton('reserveMode', 'Cookie reserve') + note('Off by default; Lucky = 6,000x unbuffed CpS, Lucky + Frenzy = 42,000x')) +
			listing(`<label>Auto: no reserve for the first</label> ${numberInput('autoReserveMinutes')}<label>minutes of a run, then Lucky</label>`) +
			listing(toggleButton('buyResearch', 'Buy research') + note('research upgrades advance the grandmapocalypse')) +
			listing(toggleButton('elderPledge', 'Elder Pledge') + note('pledging stops wrinklers from spawning; never pledges in Feed mode or while a shiny is on screen')) +

			heading('Auto-ascend') +
			listing(toggleButton('autoAscend', 'Auto-ascend') + cycleButton('ascendMode', 'Threshold type')) +
			listing(`<label>Threshold</label> ${numberInput('ascendThreshold')}${note('ascends only; reincarnating and heavenly upgrades are up to you')}`) +
			listing(note('if the threshold is already reached when the mod loads or you change a setting, it warns instead of ascending')) +

			heading('Other') +
			listing(toggleButton('debug', 'Debug logging') + note('extra console output, including the top auto-buy candidates')) +
			'</div>';
	}

	function renderMenuSection() {
		if (Game.onMenu !== 'prefs') return;
		const menu = document.getElementById('menu');
		if (!menu) return;

		const section = document.createElement('div');
		section.id = 'afkBakerMenu';
		section.className = 'block';
		section.style.cssText = 'padding:0px;margin:8px 4px;';
		section.innerHTML = menuHtml();
		section.addEventListener('click', onMenuClick);
		section.addEventListener('change', onMenuChange);
		section.addEventListener('keydown', onMenuKeyDown);

		const existing = document.getElementById('afkBakerMenu');
		if (existing) existing.replaceWith(section);
		// The prefs menu ends with an empty spacer div; slot in just above it.
		else if (menu.lastElementChild) menu.insertBefore(section, menu.lastElementChild);
		else menu.appendChild(section);
	}

	function onMenuClick(event) {
		const target = event.target.closest('[data-afk-toggle],[data-afk-cycle]');
		if (!target) return;
		const s = settings();
		if (target.dataset.afkToggle) {
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

	function onMenuChange(event) {
		const input = event.target;
		const key = input.dataset && input.dataset.afkNumber;
		if (!key) return;
		const s = settings();
		if (key === 'clickRate') {
			s.clickRate = clampInt(input.value, 0, MAX_CLICK_RATE, s.clickRate);
		} else if (key === 'autoReserveMinutes') {
			s.autoReserveMinutes = clampInt(input.value, 0, MAX_AUTO_RESERVE_MINUTES, s.autoReserveMinutes);
		} else if (key === 'ascendThreshold') {
			s.ascendThreshold = clampInt(input.value, 1, Number.MAX_SAFE_INTEGER, 1);
			recheckAscendWarning();
		}
		input.value = s[key];
		refreshStatusLine(Date.now(), true);
	}

	function onMenuKeyDown(event) {
		if (event.key === 'Enter' && event.target.dataset && event.target.dataset.afkNumber) event.target.blur();
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
