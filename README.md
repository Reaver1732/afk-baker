# AFK Baker

A Cookie Clicker (Steam) mod that plays the game while you're away. It clicks, catches golden cookies, buys the most efficient building (1, 10 or 100 at a time) or upgrade by its own payback-period calculation, harvests and spends sugar lumps, trains Krumblor the dragon, trades on the Stock Market, casts Grimoire spells, tends the garden, collects the seasons, counts where your cookies come from, and ascends when you reach a prestige goal.

It uses only the game's built-in mod API (`Game.registerMod`). CCSE is not needed.

## Features

Every feature can be turned on or off in **AFK Baker's own panel**. Open it with the small **AFK Baker** tab under the news ticker, between Stats and Legacy. Settings are saved with your game.

**The panel**
- It opens in the middle of the screen, where the game shows Options and Stats. The cookie and the store stay visible and clickable. Opening one of the game's menus closes it, and the x closes it too. The Options menu keeps one line with a button that opens the panel.
- The dot on the tab shows the state at a glance: green running, yellow paused, red when a safety check or an error stopped something.
- **What auto-buy is doing**, next to the tab, without opening the panel: `Saving for 10x Fractal engine (2h 41m)`, `Bought 1x Cursor`, `Fast buying`, `Paused`, `Paused: safety check` or `Auto-buy off`. The time is how long the missing cookies take at your unbuffed CpS. It changes at most once a second, and clicking it opens the Auto-buy tab. It sits in the strip under the news ticker, so it never covers the news, and is cut short with an ellipsis on a narrow window. It has its own switch on the Auto-buy tab (on by default).
- **Dashboard**: one row per feature with what it is doing now and what it is waiting for. Click a row to open its tab. Each settings tab shows its own rows at the top.
- **Tabs**: Clickers, Auto-buy, Sugar lumps, Dragon, Pantheon, Stock Market, Grimoire, Garden, Auto-ascend, Seasons, Stats and Other. Explanations are behind the "?" next to a setting: hover it. A sub-setting is only shown while the setting it belongs to is on.
- **Pause all** (top of the panel, on every tab): stops everything AFK Baker does without changing any setting. Resume picks up where it left off. The store ratings keep showing. A pause is not remembered when the game restarts, so a forgotten pause can't silently stop an AFK session.
- **Settings export and import** (Other tab): Copy gives every setting as one line of text. To import, paste a text and press Check import. It lists what would change and changes nothing until you press Apply. The text is checked the same way a saved game's settings are. Auto-ascend is always imported switched off, so a pasted text can't trigger an ascension.
- The panel is only redrawn when you do something, so a field you are typing in and a drag in progress are never interrupted.

**Clickers**
- **Big cookie autoclicker**: set the clicks per second (default 30, 0 turns it off, maximum 50, which is the game's own limit). It keeps clicking while the window is minimized. When the game slows down in the background, the mod sends the missed clicks as one bigger click. Your cookie click count and hand-made cookies still count every one of them.
- **Mute big cookie click sound** (on by default): silences only the big cookie's click sound, for your own clicks and the autoclicker's. Golden cookies, buying and every other game sound play as normal, and the game's volume is not changed.
- **Golden cookies**: clicked as soon as they appear. A separate switch covers wrath cookies. The one exception is the wrath cookie from a backfired Grimoire spell, which is left alone (see Grimoire below).
- **Reindeer**: clicked as soon as they appear.
- **Wrinklers**: choose one of three modes. During a run, shiny wrinklers are always left alone.
  - **Feed, pop before ascending** (default): wrinklers stay on the cookie and keep feeding.
    - Right before auto-ascend fires, the mod pops every wrinkler, waits for the cookies to land, then ascends. That includes shinies, because reincarnating would wipe them anyway.
    - The ascend threshold already counts what they'll pay out, including the ×3 for shinies. It uses the game's own payout formula, so popping them never pushes you past your target.
    - This mode never buys Elder Pledge, so the **grandmapocalypse keeps running**. That's what lets wrinklers spawn and feed. The downside is that **most golden cookies become wrath cookies**, and at the final stage all of them do.
  - **Pop instantly**: pops normal wrinklers as soon as they appear. Shinies are never popped.
  - **Off**: never touches wrinklers.
- **Fortune tickers**: click every fortune, or only the ones that unlock fortune upgrades.

**Auto-buy**
- Picks the item with the lowest payback period (PP): any upgrade, or 1, 10 or 100 of any building. A bundle of 10 or 100 is bought in one purchase through the game's own bulk buy. The store's Buy/Sell mode and bulk setting are left as you had them. If it can't afford the best item yet, it waits and saves up rather than buying something worse.
- **How PP is worked out**: PP = max(price − bank, 0) / CpS + price / CpS gain. That is the time until you can afford the item plus the time it takes to pay for itself.
  - The CpS gain comes from running the game's own CpS code on a copy of your game with the purchase made. The copy is separate from your game, so nothing in your game is changed. Because it is the game's own code, building CpS, upgrade multipliers, milk and kittens, synergies, dragon auras, Pantheon gods, Garden plants and seasons are all counted the way the game counts them.
  - Achievements a purchase would win are counted too, since they add milk: the ones for owning a number of one building, of every building, of buildings in total and of upgrades, and the ones for reaching a CpS.
  - Other mods that change CpS through the game's official mod hooks (`cps` and `cookiesPerClick`) are counted, because the game's CpS code calls those hooks. A mod that replaces the game's CpS function with its own wrapper and changes the result there can't be simulated; the safety check below notices and pauses auto-buy.
  - Both CpS numbers are unbuffed. A Frenzy would scale every item's PP alike, and a Building special lasts seconds, so neither should decide what to buy.
  - The numbers are recalculated only when something changes (a purchase, a new upgrade in the store, an achievement, a level, an aura and so on), spread over a few game ticks.
- While it's waiting it checks about once a second. After each purchase it buys again as soon as the new payback periods are worked out.
- **Fast buying**: right after an ascension, hundreds of items can pay for themselves in a fraction of a second, and which comes first hardly matters. While the best item's payback period is under 1 second, auto-buy takes everything else under 1 second that the bank can cover in the same go: the largest bundle (1, 10 or 100) of each building and each upgrade, up to 25 purchases at once, never touching the cookie reserve. Once the best payback period reaches a second, it goes back to careful one-at-a-time buying.
  - The safety check still runs: the whole batch is simulated together before it is bought, and the game's CpS afterwards is checked against that prediction. After a miss, buying drops to one item at a time so the checks can show which item it was. After two missed batches, fast buying is switched off for the rest of the run, and the Dashboard says so.
  - The status shows such tiny payback periods as `PP under 1 s`.
- **Mute auto-buy purchase sounds** (on by default): AFK Baker's own purchases, building level-ups, dragon training, dragon petting, stock trades, broker hires, office upgrades and spell casts are silent. Your manual purchases, golden cookies and every other sound play as normal, and the volume isn't changed.
- If the best item can't be bought at all (the purchase fails, or the game refuses it), it skips that item for a minute and moves on to the next best.
- **Store ratings** (the "Show ratings in the store" setting on the Auto-buy tab): every upgrade in the store gets a small square in its corner, and every building's price takes a color, by how its payback period compares with the best one. The legend is next to the setting.
  - **Best buy** (gold): the lowest payback period, which is what auto-buy buys next. While several items pay back in under a second they are all marked, since fast buying takes them together, and the rest are rated against that second.
  - **Close to best** (teal): up to 1.5 times the best. **Average** (light blue): up to 5 times. **Poor** (violet): more than 5 times.
  - **Utility: bought when cheap** (dark square with a green cross): no payback period, but useful, and bought by the no-payback setting. The tooltip shows the limit, what it costs now in minutes of CpS, and when it will be bought.
  - **No payback period** (gray): the purchase doesn't raise your income, and the no-payback setting leaves it alone or is off. The tooltip says why.
  - **Bought by the research setting** (pale square with a dot): research, while Buy research is on.
  - **Skipped by AFK Baker** (black and white stripes): never bought. Switches, vaulted upgrades, the never-buy list, research while Buy research is off, and research past your grandmapocalypse limit.
  - Hovering an upgrade or a building adds a block to the game's tooltip with the rating in words, the payback period, its rank, how long until you can afford it and, for the gray and striped ones, why. So nothing depends on telling the colors apart. A building's tooltip lists buying 1, 10 and 100.
  - A building's price shows the rating for the amount the store is set to buy. It replaces the game's green or red price color; the game still dims a building you can't afford.
  - Click upgrades use their click payback period, the same as auto-buy.
  - **Your own colors**: next to each rating in the legend is a color picker. A color you pick applies to the upgrade squares, the building prices and the count bar. "Reset to default colors" puts them all back. Price text is always outlined so it reads on the building rows: in black, or in white if you pick a dark color. Skipped keeps its stripes, and the tooltips still name every rating in words. The colors are saved with your settings and included in export and import.
  - **Rating counts**: a small bar just above the upgrades shows how many upgrades have each rating, as a mark and a number in your colors. Hover a number for the rating's name. It is only shown while the ratings are on and has its own switch (on by default). If Cookie Monster is loaded, its own bar sits above ours; they don't overlap.
  - The ratings only change when a full recalculation is in, never halfway through one, and at most once a second while fast buying is at work, so the colors don't jump with every purchase.
  - An upgrade for a building you own none of (the dragon's training can sacrifice them all) adds nothing for now; its tooltip says so.
  - The ratings only read numbers the payback calculation has already worked out. With auto-buy off or paused, the calculation keeps running for them, and nothing is bought.
  - If Cookie Monster is loaded, the ratings start switched off, because Cookie Monster draws its own colors in the store. You can turn them on anyway; the setting's tooltip says so.
- **Cookie reserve**: how many cookies to keep banked. Lucky and Lucky + Frenzy are the bank sizes needed for a full Lucky payout.
  - **Off** (default): no reserve. Updating from 1.2 or earlier switches the reserve to Off once. After that, your choice is kept.
  - **Auto**: no reserve for the first 30 minutes of a run, then the same as Lucky. You can change the number of minutes.
  - **Lucky**: keeps 6,000× your unbuffed CpS banked.
  - **Lucky + Frenzy**: keeps 42,000× your unbuffed CpS banked.
- **Research**: buys research upgrades as soon as it can afford them, respecting the reserve.
- **Stop the grandmapocalypse at** (under Buy research; default Angered, which is no limit): how far research may take the grandmapocalypse. Research is a chain, where each purchase starts the next, so holding one upgrade back holds back everything after it.

  | Setting | Research stops before | What you keep |
  |---|---|---|
  | Never start | One mind | no wrinklers, only golden cookies |
  | Awoken (One Mind) | Communal brainsweep | wrinklers, and a third of golden cookies turn into wrath cookies |
  | Displeased | Elder Pact | wrinklers twice as fast, two thirds wrath cookies |
  | Angered (no limit) | nothing | wrinklers three times as fast, all wrath cookies |

  - Wrinklers appear at every stage from Awoken on; only the speed differs.
  - The research you give up is CpS: One mind and Communal brainsweep each add 0.02 base CpS per grandma to every grandma, Elder Pact adds 0.05 per portal, and Exotic nuts and Arcane sugar add 4% and 5%. **The setting's tooltip shows what each choice costs in CpS on your save**, worked out by the payback calculator. It changes through a run, as grandmas become a smaller or larger part of your CpS.
  - Research held back is marked as skipped in the store, with the reason.
  - **If the grandmas are already past the stage you pick**, there is no way back to a stage in between, and AFK Baker buys nothing to undo it. The Dashboard lists what you can do, with prices: an Elder Pledge (calm for 30 minutes, or 60 with Sacrificial rolling pins, and it pops every wrinkler), the Elder Covenant (calm for good, at 5% less CpS), or ascending, which starts research over.
- **Elder Pledge** (off by default): buys Elder Pledge whenever the grandmapocalypse is active, plus Sacrificial rolling pins when they're available. Pledging stops wrinklers from spawning. It is held while Auto seasons collects in Halloween, which needs wrinklers.
  - It never pledges in Feed mode.
  - It never pledges while a shiny wrinkler is on screen, because the game's pledge pops every wrinkler, shinies included.
  - To end the grandmapocalypse automatically, switch the wrinkler mode to Pop instantly or Off, and turn this on.
- **Never buys** (these are removed before the best item is picked, so they never hold up auto-buy):
  - switches and selectors (the `toggle` pool)
  - debug upgrades
  - heavenly upgrades
  - vaulted upgrades
  - anything that costs sugar lumps
  - Chocolate egg
  - Sugar frenzy
  - Elder Covenant and Revoke Elder Covenant

  To add more upgrades, edit `NEVER_BUY_UPGRADES` at the top of `main.js`.
- **Click upgrades**: upgrades that only boost clicking (Plastic mouse, Iron mouse and the rest, Halo gloves and so on) don't change CpS, so their PP would be infinite. While the autoclicker is on, AFK Baker gives them their own PP:
  - It runs the game's `Game.mouseCps` on the same copy of your game to see how much each click would earn with the upgrade, and multiplies the gain by the clicks per second the autoclicker really lands. It measures the landed rate over 10-second windows, so clicks lost while the window is heavily throttled are counted.
  - PP = max(price − bank, 0) / CpS + price / click income gain, the same formula as for everything else, so they rank fairly against buildings and other upgrades.
  - Temporary buffs such as Click frenzy and Frenzy are left out, so a frenzy doesn't make them look better than they are.
  - Upgrades that raise CpS as well (for example cursor upgrades that also boost Cursors) are ranked by their CpS gain.
- **No-payback upgrades** ("Buy no-payback upgrades when they cost less than N minutes of CpS", on by default, N = 5): some upgrades help without raising CpS, so they have no payback period and the PP buyer would never take them. Golden cookie upgrades (Lucky day, Serendipity, Get lucky, Golden goose egg), reindeer upgrades, Wrinklerspawn, Sacrificial rolling pins, cheaper prices (Season savings, Toy workshop, Faberge egg), more drops (Santa's bottomless bag, Omelette), and the two unlocks (A festive hat, A crumbly egg). AFK Baker buys one once it costs less than N minutes of unbuffed CpS.
  - The usual filters apply: the never-buy list, the vault, switches, research and heavenly upgrades, anything costing sugar lumps, and the cookie reserve.
  - They never hold up the PP buyer. At most one is bought per pass, the cheapest first, and only if what auto-buy is saving for stays affordable or is further away than N minutes anyway. It never saves up for one.
  - **Upgrades priced in CpS** have their own limit (default 180 minutes), because the game sets their price as a share of your CpS and they never get cheaper by waiting: Green yeast digestives (180 minutes of CpS), Ichor syrup (120), Fern tea (60) and the dragon drops (30, or 3 with a fully trained dragon). Your upgrade discounts bring these a little lower. Fortune #102 costs a day of CpS until your CpS is very high, so it isn't bought at the default; raise the limit if you want it. Set the limit to 0 to buy none of them.
  - Left out: click upgrades while the autoclicker is off (with it on they have a click payback period and are bought by the PP buyer), and the offline-income upgrades (Fern tea, Ichor syrup, Fortune #102) unless you own Twin Gates of Transcendence. With auto-pet on, Dragon fang and Dragon teddy bear are left to auto-pet, so they are never bought twice over.
  - A CpS upgrade for a building you own none of is not a utility upgrade: it gets a payback period as soon as you own one.
  - Each of these purchases goes through the same check as any other: CpS has to stay as predicted.
- Upgrades that would lower CpS are never bought. Research has its own switch.
- Pauses during ascension and for a few seconds after reincarnating.
- **Safety checks**: before using its numbers, AFK Baker checks that its copy gives the same CpS as the game for your game as it is. If it doesn't (another mod may be changing how CpS is calculated), auto-buy pauses, says so on the Dashboard, and checks again every few seconds. After every purchase it also compares the game's new CpS with what it predicted. A miss is logged to the console with the item and noted on the Dashboard; after 3 misses in the last 10 purchases auto-buy pauses and says why, until you turn it off and on again.

**Sugar lumps** (nothing happens until sugar lumps are unlocked on your save, at a billion cookies baked in total)
- **Auto-harvest sugar lumps** (on by default): harvests the current lump as soon as it's **ripe**, never while it's only mature, because a mature harvest has a 50% chance of giving nothing. It uses the game's own ripe time, which already includes your upgrades, Pantheon and dragon aura, and the game's own harvest (`Game.clickLump`).
  - Every lump type is harvested: normal, bifurcated, golden, meaty and caramelized. A meaty lump can still give 0 to 2 lumps when ripe; that's how the game works.
  - Harvesting at ripe starts the next lump up to an hour sooner than letting the game drop it.
  - Paused during a Born again run, where the game hides sugar lumps.
- **Auto-spend sugar lumps** (off by default): spends lumps on **building levels only**, never on anything else, following a priority list you set.
  - Each entry is a building and a target level. The mod levels the first entry that isn't at its target yet and never skips ahead to a later entry, even a cheaper one, while an earlier entry is unfinished.
  - The same building can appear more than once, for example Farm to 1 early and Farm to 9 later.
  - Levels cost what the game charges: going from level L to L+1 costs L+1 lumps, so level N from 0 costs N×(N+1)/2 in total.
  - It uses the game's own level-up. If the game's "Lump confirmation" option is on, it's switched off just for the mod's own level-up and put back straight away, so your own spending still asks.
  - Buildings you don't own yet are levelled too, because levels carry over through ascensions. The Dashboard notes it, e.g. `Leveled Wizard tower to 3 (none owned yet)`.
  - **Keep at least N lumps** (default 0): the mod never spends below this.
  - Paused during a Born again run, like harvesting.
- **Priority list editor** in the Sugar lumps section:
  - **Building palette**: every building in a grid, with the game's own store icon, its name and its current level. Buildings you don't own yet are dimmed but can still be used.
  - **Drag a building from the palette into the list** to add it. Its target starts at its current level + 1, and it goes in wherever you drop it. A gold line shows where it will land.
  - **The list** has aligned columns: drag handle (≡), priority number, icon, building, current level, target level, status (done, next or waiting), and the lumps still needed for that entry, then Up, Down and Remove buttons.
  - **Drag a row by its ≡ handle** to reorder it.
  - **Edit a target level right in the row.** A valid whole number saves as you type. Anything else is corrected when you leave the field or press Enter: at least 1, at most 1000, decimals rounded down.
  - The Up, Down and Remove buttons and the Add row (a building dropdown and a target level, then Add or Enter) still work for anyone who'd rather not drag. **Reset to default** starts over.
  - Press Escape to cancel a drag. Dropping outside the list changes nothing, and dragging never clicks the big cookie or anything else in the game. The list is only redrawn when you change it, so a drag is never interrupted; its numbers are updated in place.
  - On a narrow window the palette wraps, and each list row takes two lines so nothing scrolls sideways.
  - The default list only unlocks the minigames: Farm 1 (Garden), Temple 1 (Pantheon), Wizard tower 1 (Grimoire), Bank 1 (Stock Market). Add anything else yourself.
  - The list is saved with your other settings. If the saved list is damaged, the default list is used instead.

**Krumblor the dragon**

**The dragon resets every ascension.** That's how the game works: its level, both auras, the crumbly egg and the four dragon drops all go back to nothing each time you ascend. AFK Baker retrains the dragon, sets your auras again and pets for the drops again on every run.

- **Auto-train dragon** (off by default):
  - Buys **A crumbly egg** (25 cookies) when the game offers it. The egg only appears if you own the heavenly upgrade "How to bake your dragon" and have baked 1 million cookies this run.
  - Trains level by level with the game's own training function and costs:

    | Dragon level | Cost |
    |---|---|
    | 1 to 5 | 1, 2, 4, 8 and 16 million cookies |
    | 6 to 25 | sacrifice 100 of one building each, in store order from Cursor to You |
    | 26 | sacrifice 50 of every building |
    | 27 (fully trained, second aura) | sacrifice 200 of every building |

  - **Cookie steps** are bought when affordable, respecting the cookie reserve.
  - **Sacrifice steps** are only done when they're cheap. A sacrifice refunds nothing, so the mod adds up the cost of buying any buildings you're still missing plus rebuying everything sacrificed, and only goes ahead when that total is less than **N minutes of your CpS** (default 10, using unbuffed CpS so a Frenzy doesn't trigger it).
  - If a step is cheap enough but you're short on buildings, it buys the missing ones first (respecting the reserve), then sacrifices. Afterwards, auto-buy rebuilds as usual.
  - It never trains during the ascend animation or on the ascension screen.
- **Auras**: two slots, primary and secondary, in the Dragon tab. Click a slot to open a grid of every aura with the game's own icons, much like the game's aura picker; hover one for its name and effect, and click to pick it. The default is None, and the mod doesn't touch an aura slot until you pick one for it.
  - Every aura can be picked, and picking one costs nothing: it only says which aura AFK Baker sets once the dragon allows it. Ones the dragon hasn't unlocked yet are greyed with the level they unlock at, and are set as soon as the dragon gets there. Your picks are kept across ascensions.
  - The secondary aura is only used once the dragon is fully trained.
  - Setting an aura costs **one of your highest-tier building** (the game's rule), so the mod only changes an aura when your pick isn't active. Slot order makes no difference in the game, so a pick that's already in either slot is left where it is, and auras are never swapped back and forth. The same aura can't be picked twice.
- **Auto-pet dragon** (off by default): needs the heavenly upgrade "Pet the dragon" and a dragon at level 8 or more.
  - Which drop you can get depends on the quarter of the hour, so finding all four takes up to about 45 minutes. Which quarter gives which drop is decided by the save's seed, and **the mod doesn't read the seed**. It pets in every quarter-hour until a drop appears, or until about 100 pets have passed without one (that quarter's drop is then almost certainly one you already have), and then waits for the next quarter. It stops for good once all four are found.
  - The game only allows petting with the dragon panel open, so the mod opens it while it pets (a few seconds when a drop comes, about ten when it doesn't), then puts back whatever you had open before: Santa's panel, the dragon's, or nothing. Training does the same.
  - Dragon fang and Dragon teddy bear have no payback period, so auto-pet buys those two itself, respecting the cookie reserve. Dragon scale and Dragon claw are left to auto-buy.

**Pantheon** (the Temple minigame; nothing happens until it's unlocked by giving the Temple a level)
- **Auto-Pantheon** (off by default): you pick a god for each slot (Diamond, Ruby, Jade), and each run the mod slots them once the Pantheon is available. If they are already in place, it does nothing.
  - **The Pantheon resets every ascension.** That's how the game works: every god is taken out of its slot and the worship swaps go back to 3. The mod puts your picks back each run.
  - It slots a god exactly as dragging it does in the game: one worship swap per god, and the game's own Pantheon screen shows the same thing. Swaps come back one at a time: an hour after the last with 2 left, 4 hours with 1 left, 16 hours with none. The mod never refills them with sugar lumps.
  - When swaps run short it fills Diamond first, then Ruby, then Jade, and a single swap that puts two picks in place (two of your gods the wrong way round) comes first. If you change a pick mid-run, it follows, with the swaps you have.
  - A slot with no pick is left alone, and so is whatever god is in it, even one you picked for another slot.
  - **Holobore** is never slotted while golden cookie clicking is on: the game throws it out of its slot, and takes every worship swap, as soon as a golden cookie is clicked. The picker greys it out and says why. With golden cookie clicking off, it is slotted like any other.
  - **Godzamok** can be picked. He only does something with Godzamok combos on (below); otherwise AFK Baker never sells buildings. His tooltip says which.
  - The Pantheon needs a Temple level, not Temples: it keeps working when the dragon's training sacrifices every Temple. It doesn't run in a Born again run.
- **Picking**: the Pantheon tab is a near-copy of the game's Pantheon screen, with the three slots and every god, using the game's own images and tooltips. Drag a god onto a slot, or click a god and then a slot. Drag a picked god off its slot, or use its x, to leave that slot alone. Until a Temple has a level the tab says how to unlock the Pantheon, and nothing can be picked yet.
- The Dashboard shows your picks, what is slotted now, and what it's waiting for: a worship swap (with the time), a Temple level, or a god sitting in a slot you left alone.
- **Godzamok combos** (off by default; in the Pantheon tab): with Godzamok slotted, selling buildings gives the buff Devastation, which raises click power for 10 seconds: 1% per building sold with him in the Diamond slot, 0.5% in Ruby, 0.25% in Jade. A combo sells whole building types and buys each straight back in the same game tick, so your CpS, the store and the payback numbers never see them gone.
  - **What it costs**: a sale refunds 25% of a building's price and buying back costs the full price. Measured, a combo costs 71% of the price of buying back (less with the Earth Shatterer aura, which doubles the refund). Late in a run that is next to nothing; early on it can be hours of CpS.
  - **When**: *During click buffs only* (default) makes a combo only while Click frenzy or Dragonflight is running, when a click is worth the most. *Whenever it pays* also makes one without a click buff. Late in a run that means every 10 seconds.
  - **A combo is made only when all of this holds**: the autoclicker is on; Godzamok is slotted; no Devastation is running; the extra click income expected over the 10 seconds is at least 10 times the cost; and the bank above your cookie reserve covers buying everything back in full, without counting on the refunds. The expected income uses your click rate, cookies per click, and the time your current buffs have left.
  - **One round per Devastation**, never stacked. Within a round it sells the types that give the most for their cost, several at once, while the total stays under **N% of the bank** (default 5, counted above the reserve), so combos don't eat what auto-buy is saving up.
  - **Never sold**: Wizard towers (their number sets the size of the magic meter).
  - **Grandmas are sold, but one always stays.** Selling the last Grandma would pop every wrinkler, end an Elder Pledge and stop the grandmapocalypse; with one left standing none of that happens. The first Grandma a combo sells wins the shadow achievement "Just wrong", if you don't have it yet.
  - Farms, Banks and Temples are sold: the stock market and the Pantheon depend on those buildings' levels, not their number, and the garden only looks at the number of Farms at the moment you pick a soil. With the buildings back in the same tick, nothing in the three minigames changes; the tests compare them before and after.
  - It never slots Godzamok for this (pick him in Auto-Pantheon if you want that) and never changes an aura. The dragon is not trained, and no aura is set, in the same tick as a combo.
  - **If a building count ever comes back different, combos turn themselves off** and the Dashboard says which building and why.
  - The Stats tab shows what combos cost and what the extra click power brought in.

**Stock Market** (the Bank minigame; nothing happens until it's unlocked by giving the Bank a level)

**The whole market resets every ascension.** That's how the game works: your stock (with no payout), your brokers, your office level and the profit counter are all wiped each time you ascend. AFK Baker rebuilds it on every run: it buys stock again, hires brokers again and upgrades the office again.

How the market works, in short:
- Each stock has a **resting value**: $10 for the first, $10 more for each one after, plus $1 per Bank level above 1. Prices move once a minute and wander a long way from it.
- **$1 is one second of your highest raw CpS this ascension.** Buying costs the price plus a 20% fee. Selling has no fee.
- You can hold as many of a stock as the most of that building you've owned this run, plus 10 per level of that building, plus the office bonus.
- The **bank ceiling** is $97 + $3 per Bank level ($100 at level 1). Above it, a rising stock loses momentum.

**No cheating.** Auto-trade only uses what a player can see: each stock's price, plus public facts such as the resting value and bank ceiling formulas. The game also keeps hidden state that decides where prices go next (each stock's mode, how long the mode lasts, and its momentum). AFK Baker never reads it. As [KarmicChaos's Ultimate Stock Market Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2601428565) puts it, automation that extracts "hidden data such as modes, durations, and deltas" is cheating, and legitimate automation sticks to buy and sell rules based on prices.

- **Auto-trade stocks** (off by default), with two strategies to choose from:

  | Strategy | Buys when | Sells when |
  |---|---|---|
  | **Resting value + guide rules** (default) | at 30% of resting value or less, or always under $5 | at 100% of resting value or more, or once past the bank ceiling |
  | Resting value | at 30% of resting value or less | at 100% of resting value or more |

  - The 30% and 100% figures are settings.
  - The **guide rules**, "always buy under $5" and "sell the moment a stock passes the bank ceiling", are from [KarmicChaos's Ultimate Stock Market Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2601428565). The guide makes an exception to the ceiling rule that depends on a stock's hidden mode, so the mod leaves it out.
  - **Why the default:** both strategies were run against the game's own price code from a freshly reset market (as after an ascension), 1,500 times. Stock still held when the run ends is counted as lost, because ascending wipes it. Profit is per share of warehouse space per stock, with the 20% buying fee:

    | Strategy | 12-hour run | Runs that lost money | 24-hour run | Runs that lost money |
    |---|---|---|---|---|
    | **Resting value + guide rules** | **$47** | **0%** | $114 | 0% |
    | Resting value | $42 | 0.2% | $114 | 0% |

    The guide's passive strategy (buy in the bottom 20 to 30% of a stock's own price history, sell in the top 20 to 30%) was tested too and left out. The market resets every ascension, so early in a run there isn't enough history for "cheap" to mean anything yet. Over 12-hour runs it lost money in most runs.
  - Never buys more than the warehouse holds, and only trades stocks whose building you've owned this run.
  - **Never sells at a loss**: it only sells for more than the stock cost, fee included. The game only remembers the last price you bought at, so the mod keeps its own record of what it paid (saved with your settings). Stock you bought by hand is picked up at the game's last purchase price. There's a **Sell at a loss** setting, off by default.
  - **The market may use up to N% of your bank** (default 25), so it doesn't starve auto-buy. That's counted on your bank above the cookie reserve plus what is already invested. The Dashboard shows it, e.g. `Budget $4,200 of $18,000`, so you can see when the budget is what's holding it back.
  - A stock can't be sold in the minute it was bought, or bought in the minute it was sold. That's the game's rule.
  - It never takes loans.
- **Before auto-ascend**: because ascending wipes your stock, the mod sells all of it right before an auto-ascend, the same way wrinklers are popped first, and buys nothing more once the threshold is reached. This sale ignores the no-loss rule. It can hold the ascend back by up to a minute.
  - Stock sales rarely add prestige. The game only counts a sale toward cookies baked when it lifts your bank above everything baked this run. The threshold check uses that exact rule, so the sale is counted when it matters and ignored when it doesn't.
- **Hire brokers** (off by default, needs auto-trade on): each broker costs 20 minutes of CpS and cuts the buying fee by a twentieth (20%, 19%, 18.05%...). The next broker is hired when its saving on one full fill of your warehouses at the buy threshold covers its price, and the cookies are spare after the reserve. The most you can have is your highest grandma count this run divided by 10, plus your grandma level.
- **Upgrade office** (off by default, needs auto-trade on): office upgrades add warehouse space.

  | Upgrade | Cursors sacrificed | Cursor level needed | Gives |
  |---|---|---|---|
  | 1 | 100 | 2 | +25 space per stock |
  | 2 | 200 | 4 | +50 space, +1 loan slot |
  | 3 | 350 | 8 | +75 space |
  | 4 | 500 | 10 | +100 space, +1 loan slot |
  | 5 | 700 | 12 | +50% of the building-count part of the space, +1 loan slot |

  - The Cursors are sacrificed with no refund, so the mod only upgrades when buying them back would cost less than **N minutes of CpS** (default 30, unbuffed CpS).
  - The Cursor level is a requirement only. The mod **never spends sugar lumps** for it; it waits until Cursor has the level (add Cursor to the lump priority list if you want that).
  - Brokers and the office have no game function, only buttons. The mod presses the game's own buttons, which works with the Bank panel closed, so the panel is never opened.

**Grimoire** (the Wizard tower minigame; nothing happens until it's unlocked by giving the Wizard tower a level)

- **Auto-cast spell** (off by default): casts one spell of your choice with the game's own casting function.
  - **Force the Hand of Fate** (default) summons a golden cookie, which the mod's golden cookie clicker then clicks. It costs 10 magic plus 60% of your max magic, and backfires 15% of the time.
  - **Conjure Baked Goods** gives 30 minutes of CpS, but **capped at 15% of your bank**, so it's weak when auto-buy keeps the bank low. It costs 2 magic plus 40% of your max, and backfires 15% of the time (a 15-minute Clot, and it takes cookies).
- **It casts when the magic meter is full.** Magic regenerates faster the fuller the meter is and stops at full, so casting from a full meter gives the most casts and wastes nothing. For example, with 600 Wizard towers (max magic 106), Force the Hand of Fate comes round every 26 minutes cast from full, against 49 minutes if it were cast as soon as it's affordable.
- **When to cast Force the Hand of Fate** (a setting, once magic is full). What the spell gives, a Frenzy, a Click frenzy or a building special, adds to a buff that is already running, so a cast during one is worth more.
  - **When magic is full** (default): casts at once, for the most casts.
  - **During a Frenzy or click buff**: waits at full magic until a buff that raises CpS (Frenzy, Dragon Harvest, a building special, Elder frenzy) or a click buff is running. Late in a run a Frenzy runs most of the time, so few casts are lost.
  - **Only during a click buff**: waits for a Click frenzy or a Dragonflight. **This is high-variance.** There are about a third fewer casts and a typical hour looks the same, but once in a while the spell lands a building special or a Frenzy on top of the click buff, and those rare casts are worth more than all the others together. It suits a bakery that lives on clicks; the gain shows over days, not hours.
  - Magic doesn't regenerate while it waits at full. Devastation from Godzamok combos doesn't count as a click buff here. A golden cookie on screen still holds the cast.
  - It looks only at the buffs on screen, never at what the spell will give. The numbers behind this came from running the game on a save for about 1,100 game hours: with a click-heavy setup the expected value of the casts was about twice as high during a Frenzy or click buff and about twenty times as high during a click buff only, nearly all of it from one cast in twenty.
- **It holds the cast while the backfire chance is raised**, which the spell's tooltip shows: a golden or wrath cookie already on screen adds 15% each to Force the Hand of Fate, and the Magic inept buff multiplies every spell's chance by 5.
- **A backfired Force the Hand of Fate** summons a wrath cookie, usually a Clot or a Ruin. The mod leaves that one cookie alone, even with "Include wrath cookies" on. Other wrath cookies are clicked as usual.
- It holds Force the Hand of Fate while **golden cookie clicking is off**, because nothing would click the summoned cookie. The Dashboard says so.
- It doesn't cast during the ascend animation, on the ascension screen, or in a Born again run. Your max magic depends on how many Wizard towers you own, so it's low at the start of each run, and the Dashboard says when it's too low for the spell.
- **No cheating.** The same rule as the Stock Market: the mod only uses what a player can see, which here is the magic meter, the spell's cost, the backfire chance in its tooltip, the cookies on screen and your buffs. The game decides every spell's outcome in advance from the run's seed and your lifetime spell count, which is what spell planners read. AFK Baker never reads either one, never simulates a cast, and never looks at what a summoned cookie will do before it's clicked. It learns of a backfire the way you do, from the game's own backfire announcement.

**Garden** (the Farm minigame; nothing happens until it's unlocked by giving the Farm a level)

**The plot is wiped on every ascension, and the soil goes back to dirt.** That's how the game works. Your seeds are kept. Auto-garden plants your layout again each run.

- **Auto-garden** (off by default): keeps a layout planted. You pick a plant for each tile and a soil; AFK Baker does the rest.
  - It **plants** the empty tiles and **replants** what dies of old age.
  - It **uproots** weeds, fungi and anything else that isn't in the layout. A plant other than a weed only makes way once the layout's own plant can actually be planted: a growing plant beats a bare tile.
  - Plants are **left to live out their life**: a plant's effect is 10%, 25%, 50% and then 100% as it grows, so nothing is harvested early.
  - Plants that **pay when harvested mature** (bakeberry, chocoroot, white chocoroot, queenbeet, duketater) are harvested then and replanted. A **Juicy queenbeet** is always left to mature and harvested for its sugar lump.
  - A plant **whose seed you don't have** is left to mature and then harvested, which gives you the seed for good.
  - It never freezes the garden, does nothing while you have frozen it, and never spends sugar lumps.
- **Layout** (Garden tab): the whole 6x6 grid, with the tiles outside your plot dimmed (they are used once the Farm's level opens them). Pick a plant, then click tiles. Only seeds you have can be picked.
  - **Best I have** (the default for every tile): golden clover, else thumbcorn, else baker's wheat, taking the best one whose seed is within the planting limit. This is the order for a bakery that lives on clicks and golden cookies.
  - **Presets**: Best I have, All thumbcorn, All golden clover, Half and half, Clear.
- **Soil** (default clay): clay makes plant effects 25% stronger and ticks every 15 minutes, so plants also live three times as long. It needs 100 Farms; the soil is changed as soon as the Farm count and the game's 10-minute cooldown allow.
- **Planting limit** ("Plant a seed when it costs N minutes of CpS or less", default 15): **a seed's price is a fixed number of minutes of your CpS**, so this limit decides which plants are planted at all.

  | Seed | Minutes of CpS |
  |---|---|
  | Baker's wheat | 1 |
  | Thumbcorn | 5 |
  | Cronerice, gildmillet | 15 |
  | Clover | 25 |
  | Golden clover | 125 |

  - The default of 15 covers baker's wheat, thumbcorn, cronerice and gildmillet: the cheap plants, and every seed in the chain that unlocks golden clover.
  - **Planting golden clover needs a limit of 125 or more, and that is left to you.** A field of 20 costs about 1,000 minutes of CpS an hour to keep planted (16 seconds of CpS every second). A bakery that clicks hard earns that back many times over; an idle one would spend several times its income on seeds. The "All golden clover" and "Half and half" presets say so in their tooltips, with the upkeep on your save and, once the Stats tab has an hour of income counted, what share of your average income that is.
  - Whenever the limit keeps a plant out, the Dashboard and the Garden tab name the plant, its price and your limit.
  - Seeds are priced on your CpS **as it is at that moment**, so nothing is planted while a Frenzy or another CpS buff is running.
  - A seed is only bought with cookies above the cookie reserve, and never when that would hold up what auto-buy is saving for, unless that is further away than the limit anyway (the same rule as the no-payback upgrades).
- **What to plant.** For a bakery whose income is clicks and click buffs, measured on such a save:

  | Field of 20 tiles on clay | Effect, averaged over the plants' lives | Typical income |
  |---|---|---|
  | Thumbcorn | clicks +42% | x1.42 |
  | Clover | golden cookies 19% more often | about x1.24 |
  | Golden clover | golden cookies 46% more often | about x2.4 |

  More golden cookies means more Frenzies and click buffs, and more of them on top of each other, which is why golden clover wins by so much. A golden clover field costs about 16 seconds of CpS per second to keep planted, which is why it is only for a bakery that clicks hard. Nursetulips add under one point and aren't worth a tile.
- **Seed to unlock** (default golden clover): new seeds come from mutations. An empty tile next to the right mature plants sometimes sprouts a new one, and harvesting that once mature gives you its seed for good, through every ascension.
  - Pick a seed and AFK Baker works through the **chain** from the seeds you have. For golden clover from baker's wheat that is thumbcorn, cronerice, gildmillet, golden clover.
  - For each step it plants the parents in the pattern that leaves the most empty tiles next to them, uses **wood chips** (three tries a tick) when you have 300 Farms, keeps those tiles clear, lets each new plant mature, harvests it, and moves on. Seeds that turn up on the way are kept too.
  - The Garden tab shows the chain, the current step, the chance and a rough time. Golden clover from nothing took 20 to 38 hours of play in tests; the last step is a rare roll (0.07% a try) and can take much longer.
  - **While a seed is being unlocked the garden gives next to no bonus**: wood chips cut plant effects to a quarter, and the plot is full of parents.
  - **When the seed is yours, it switches to your layout by itself.** An ascension wipes the plot; the chain carries on from the seeds already unlocked.
  - Every one of the 33 seeds can be picked. Meddleweed is waited for on a bare plot; brown mold and crumbspore come from uprooting old meddleweeds. "None" skips unlocking and just farms the layout.
  - **Every roll is the game's own.** Nothing is reloaded, retried or changed; AFK Baker plants, waits and harvests, as you would.
- The Dashboard shows how many tiles are planted and with what, the soil, the time to the next tick, the unlock step if there is one, and what planting is waiting for.
- The Stats tab books what harvests pay under "Garden harvests" and what seeds cost under "Garden planting, cost".

**Auto-ascend**
- The threshold is either **prestige gained this run** or **total prestige level after ascending**. It uses the same numbers as the game's Legacy button.
- When you reach it, the mod ascends. It never reincarnates, so you choose your heavenly upgrades yourself.
- With auto-trade on, all stock is sold first (see Stock Market above).
- It is **off** by default. The default threshold is 1,000 prestige gained.
- The threshold box takes plain digits (commas are fine) or scientific notation such as `1.146e15`, and is wide enough for 20 digits. Next to it, the mod shows the value in the game's own number format (for example `= 1.146 quadrillion`) so you can check you typed the right number of digits. Something that isn't a number keeps the old threshold.
- **Safety guard**: auto-ascend only fires when you cross the threshold during play. If the threshold is already reached when the mod loads, when you turn auto-ascend on, or when you change the threshold, type or wrinkler mode, the mod shows a warning instead of ascending. To confirm, toggle auto-ascend off and on again.

**Seasons**

**Seasonal upgrades are lost on every ascension.** That's how the game works: the heart biscuits, Christmas and spooky cookies, eggs, Santa's level and his gifts all have to be collected again each run (the heavenly upgrade Keepsakes lets each drop keep a 1 in 5 chance of staying unlocked). Auto seasons does the round for you.

- **Auto seasons** (off by default): each run it visits the seasons that still have something to collect, buys what turns up, and then stays in a home season.
  - **Order**: Valentine's Day, Christmas, Halloween, Easter. Valentine's Day comes first because it takes about a minute late in a run; Christmas second because Santa's bottomless bag makes every later drop more common.
  - **One visit per season per run.** A visit ends when everything collectable there is collected, or when the 24 hours a switch buys run out. The season is not bought a second time that run.
  - **A season the calendar gives you** (Christmas in late December, and so on) is free and doesn't run out. If it has something left, it is collected first, without a switch, and not left until it is complete.
  - **Each season can be switched off** on the Seasons tab, to skip it.
- **What it collects**
  - **Valentine's Day**: the seven heart biscuits, bought in order; each one unlocks once the one before it is bought.
  - **Christmas**: the festive hat, Santa's 14 levels with a gift each, Santa's dominion, and the seven Christmas cookies that reindeer drop. The visit lasts until the hat is bought and the cookies are found. Santa is levelled in any season, so his levels don't hold the visit. With reindeer clicking off, the cookies are left out.
  - **Halloween**: the seven spooky cookies, dropped by popped wrinklers. See below.
  - **Easter**: the 20 eggs, dropped by clicked golden and wrath cookies. This is the long one: several hours on average, and the rare eggs can outlast the 24 hours. It needs golden cookie clicking on. The **Chocolate egg is never bought**; Easter counts as complete once it has dropped.
  - **Business Day** has nothing to collect.
- **Halloween needs wrinklers.** For the visit, AFK Baker pops each wrinkler as soon as it has fed (a wrinkler that hasn't eaten rolls for nothing) and buys no Elder Pledge, whatever your wrinkler and Elder Pledge settings say. **Those settings are not changed**: they apply again the moment the visit ends, including anything you change during it. Shiny wrinklers are left alone.
  - With no pledge the grandmas stay awake, so **golden cookies come as wrath cookies for that time**: a third, two thirds or all of them, by stage.
  - It never buys research past your grandmapocalypse limit and never revokes an Elder Covenant. While the grandmas are calm, a pledge is running, or a covenant is in place, Halloween waits and the plan moves on; it comes back to Halloween if wrinklers start coming later in the run.
  - Halloween's tooltip shows how long the visit should take on your save right now, from the game's drop and spawn rules. It depends on the grandmas' stage (wrinklers come three times as fast at Angered as at Awoken) and on upgrades such as Unholy bait and Santa's bottomless bag, so it ranges from under an hour to half a day.
- **Buying**: the hat, Santa's levels, the heart biscuits and every seasonal upgrade are bought when they cost less than the no-payback limit on the Auto-buy tab (5 minutes of CpS by default). This works with auto-buy off. Every purchase, switches included, leaves the cookie reserve alone.
- **Switching** needs the heavenly upgrade Season switcher. A switch costs a billion cookies plus a minute of unbuffed CpS, and half as much again for every switch already made this run (Selebrak in the Pantheon makes it dearer still). A whole round is five or six switches, 13 to 20 minutes of CpS in all.
  - The season switchers are switches, which nothing else in AFK Baker ever buys. One function buys them, and only Auto seasons calls it.
- **Home season** (default Business Day): where to stay once nothing is left to collect. CpS is the same in every season; what differs is the extra.

  | Home season | What it gives while active |
  |---|---|
  | Business Day | golden cookies 5% more often (with Startrade); buildings shown under business names |
  | Easter, Halloween, Valentine's Day | golden cookies 2% more often (with Starspawn, Starterror, Starlove) |
  | Christmas | reindeer, each worth a minute of CpS (two with Ho ho ho-flavored frosting) |
  | None | no switch once collecting is done |

  Business Day is the default because more golden cookies help most in a setup built on clicking and golden cookies. With the autoclicker off, Christmas and its reindeer are the better home.
- **Renewing the home season**: a season lasts 24 hours, so staying means a new switch every day, each half as much again as the last: about 7 minutes of CpS for the first, 37 by the fifth, over an hour after a week. AFK Baker switches to the home season, and renews it, **while that costs less than N minutes of CpS** (default 30). Past that it lets the season run out.
- **Ascending mid-season** ends the season and the collection with it, as the game does; the next run starts the round again at the first switch's price. Auto seasons never holds an ascension back, and buys nothing once the ascend threshold is reached. In a Born again run, or without Season switcher, it only collects in a season the calendar brings.
- **Only what you can see**: it looks at what is unlocked and bought, the season and its timer, and prices. Every drop is the game's own roll, when AFK Baker clicks a reindeer or a golden cookie or pops a wrinkler as it always does.
- The **Seasons tab** shows, per season, what is collected, what is missing by name, and where it stands in the plan. The Dashboard row shows the current season and its time left, what it is collecting, and what comes next.

**Stats**
- **Count where cookies come from** (on by default): for the current run, how many cookies came from each source, as a share of everything gained:
  - buildings, split into production at your CpS without buffs and the extra under buffs such as Frenzy and building specials;
  - big cookie clicks, split into plain clicks and the extra from click buffs (Click frenzy, Dragonflight, Cursed finger, Devastation);
  - golden cookies, wrath cookies, reindeer, wrinklers popped, fortune tickers, the Grimoire, and what the game earned while it was closed;
  - **Other**: whatever is left of the game's "cookies baked" after all of that. Golden cookies and reindeer you click yourself, garden harvests, gifts and sugar blessings land here. Because Other is the remainder, the total always matches the game's.
- **Losses** are listed separately: what wrinklers wither (it comes back when they pop), what Clot cost, bank losses such as Ruin and a backfired Conjure Baked Goods, and the cost of Godzamok combos. The stock market's effect on the bank has its own line.
- **Past runs side by side**: when you ascend, the run joins the table as a column next to the current one, newest first. The last 20 runs are kept in your save and in the settings export. Importing a settings text adds its runs to yours and never removes one of your own. "Forget past runs" clears them, after a second click.
- **Each run's setup**: dragon auras, Pantheon gods by slot, the grandmas' stage (or Pledge or Covenant) and the autoclicker rate. A setup can change during a run, so the table shows the one that was active longest and says whether it changed and what share of the run it held.
- **Two numbers to compare runs by**:
  - **Growth**: how fast your all-time cookies grew, per hour of the run. `+20% an hour` means that after each hour you had baked a fifth more, over all your runs, than an hour before. This is what earns prestige, and it compares runs of very different size. Growth slows down as a game goes on, so compare runs that are close together.
  - **Income multiplier**: everything counted while the game ran, divided by what your buildings alone would have made at your CpS without buffs. `x3.00` means clicks, golden cookies, buffs and wrinklers tripled it.
- **Only visible numbers**: it reads cookies baked, CpS with and without buffs, what wrinklers wither, cookies made by clicking, and the bank before and after AFK Baker's own clicks, casts and trades. No game function is wrapped or changed. It costs about a microsecond per game tick.

**Other**
- **RedFox** (just for fun, off by default): every "wrinkler" on screen reads "nibbler", keeping capitals: Wrinkler becomes Nibbler, wrinklers become nibblers, Shiny wrinkler becomes Shiny nibbler, Wrinklerspawn becomes Nibblerspawn. It covers tooltips, the menus, the news ticker, notifications, prompts, the dragon panel and AFK Baker's own text. Only the text you see changes: the names the game and AFK Baker use inside, and your save, stay as they are, and turning it off puts the original text back at once. It only works with the game in English; in another language its tooltip says so. Named after RedFox, who calls them nibblers.
- **Sunder** (just for fun, off by default): pets Krumblor nonstop, 1 to 30 times a second (default 10). The dragon panel stays open while it's on, which covers the lower left of the big cookie, and whatever panel was open before comes back when you turn it off. Regular auto-pet stands aside meanwhile. Pet sounds follow the mute setting. Each pet sends up a heart from Krumblor, as when you pet him yourself, if particles are on in the game's options. It needs the heavenly upgrade "Pet the dragon" and a hatched dragon, and says so on the Dashboard until then. Named after Sunder, who wants Krumblor petted at all times.
- **Debug logging**: extra console output. When the auto-buy decision changes, it prints the top 5 candidates (name, amount, PP, price, and why each was chosen or skipped; click upgrades are tagged `click`). It also lists the upgrades filtered out before ranking, and any infinite-PP upgrades that are still being skipped. If Cookie Monster is installed as well, debug logging compares the two: it logs how many payback periods agree within 1% and lists the ones that differ, with the likely reason. AFK Baker never uses Cookie Monster's numbers for its decisions.

The Dashboard shows, for each feature:
- what auto-buy is doing. When it's waiting, it shows the target and its price, and in the waiting column how many more cookies are needed:
  - **Saving for** an item: the bank can't cover the item yet, e.g. `Saving for 10x Grandma (1.2 trillion) + reserve (8.4 trillion)`, waiting for `3.1 trillion more cookies`.
  - **Affordable, but the reserve has to stay banked**: buying it would dip into the reserve.
  - **Working out payback periods**: it is recalculating after something changed. This takes a moment.
  - **Paused** (red dot): a safety check failed. The row says which one and what to do.
- your current reserve
- how many wrinklers are feeding, and how many cookies they would pay out
- sugar lumps owned, the last harvest, the next lump spend, the lumps needed to finish the whole priority list and the last level-up; in the waiting column, how many lumps are still needed and when the current lump is ripe
- the dragon's level and auras and the next training step; in the waiting column its cost and what it's waiting for, e.g. `rebuy cost 14 min of CpS, waiting for under 10 min`; with auto-pet on, a second row shows how many drops are found and which one it's waiting for
- the stock market: shares held and what they're worth, the game's profit figure for this run, the market budget (`Budget $4,200 of $18,000`), the strategy in use, and the last trade with the rule that triggered it, e.g. `Bought 120 CHC at $8.40 (resting $21.00; 30% of resting or less)`; with brokers or the office on, a second row shows how many brokers you have, the current fee, and what the next broker or office upgrade is waiting for
- the Grimoire: magic (current / max), the spell, what the cast is waiting for, and the last cast with its result, e.g. `Cast Force the Hand of Fate: Frenzy`. The result appears once the summoned cookie has been clicked
- your progress toward the ascend threshold, plus the guard warning (red dot) when it's active
- with a grandmapocalypse limit set, where research stops and the grandmas' stage now, or your options once they are past it
- with auto-garden on, the tiles planted, the soil, the next tick, the seed being unlocked, and what planting is waiting for
- with Auto seasons on, the current season and its time left, what is being collected, what comes next, and any season that is waiting with the reason
- with Godzamok combos on, the running Devastation or what the next combo is waiting for, and the last combo with its cost

## Only what you can see

Everything AFK Baker decides, it decides from information a player can see on screen: prices, meters, costs, tooltips, buffs and what is in the store, plus fixed formulas anyone can look up, such as a stock's resting value. It never reads the game's hidden state to predict an outcome. In particular, no code in the mod reads the save's seed, the lifetime spell count, a golden cookie's effect before it is clicked, or the Stock Market's hidden modes and momentum. The game's own functions use those when the mod asks the game to cast a spell or pet the dragon, exactly as they do when you click.

Other mods can replace a few of AFK Baker's decisions, and add their own tab and Dashboard row to its panel, through its extension hooks (`Game.mods['afk baker'].ext`, version 2, documented in `main.js`); AFK Baker itself always works as described here.

## Requirements

- Cookie Clicker on Steam (tested against version 2.053).
- No other mods. Cookie Monster is no longer needed. You can keep it for its display features; AFK Baker works with or without it.

## Installation

1. Download this repository.
2. Copy the `afk-baker` folder into the game's local mods folder:
   ```
   <Steam library>\steamapps\common\Cookie Clicker\resources\app\mods\local\afk-baker\
   ```
   The folder must contain `info.txt` and `main.js`.
3. Start the game and open **Options → Mods** (the "Manage mods" button).
4. Enable **AFK Baker**, then restart the game when asked.
5. Click the **AFK Baker** tab under the news ticker to open the panel and adjust the settings.

If you use other automation mods (for example FortuneHelper or Grandma's Rolling Pin), disable them so they don't fight over the same purchases and clicks.

## Credits

Inspired by [FortuneHelper](https://steamcommunity.com/sharedfiles/filedetails/?id=2693901672) and [Grandma's Rolling Pin](https://steamcommunity.com/sharedfiles/filedetails/?id=3199859496). No code from either mod is used. AFK Baker is written from scratch against the game's own source.

The payback period formula is the one [Cookie Monster](https://github.com/CookieMonsterTeam/CookieMonster) made standard, and AFK Baker relied on Cookie Monster's numbers until version 2.0. No Cookie Monster code is used: the CpS gains come from the game's own code.

The Stock Market's "always buy under $5" and "sell once past the bank ceiling" rules come from [KarmicChaos's Ultimate Stock Market Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2601428565), which also explains how the market works.

## License

[MIT](LICENSE)
