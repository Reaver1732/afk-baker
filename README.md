# AFK Baker

A Cookie Clicker (Steam) mod that plays the game while you're away. It clicks, catches golden cookies, buys the most efficient building (1, 10 or 100 at a time) or upgrade according to [Cookie Monster](https://steamcommunity.com/sharedfiles/filedetails/?id=2685721341), harvests and spends sugar lumps, trains Krumblor the dragon, trades on the Stock Market, casts Grimoire spells, and ascends when you reach a prestige goal.

It uses only the game's built-in mod API (`Game.registerMod`). CCSE is not needed.

## Features

Every feature can be turned on or off in **Options → AFK Baker**. Settings are saved with your game.

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
- Picks the item with the lowest payback period (PP) according to Cookie Monster: any upgrade, or 1, 10 or 100 of any building. A bundle of 10 or 100 is bought in one purchase through the game's own bulk buy. The store's Buy/Sell mode and bulk setting are left as you had them. If it can't afford the best item yet, it waits and saves up rather than buying something worse.
- While it's waiting it checks about once a second. After each purchase it buys again as soon as Cookie Monster has recalculated (about 15 purchases a second when there's a lot to buy), and it never buys twice using the same out-of-date data.
- **Mute auto-buy purchase sounds** (on by default): AFK Baker's own purchases, building level-ups, dragon training, dragon petting, stock trades, broker hires, office upgrades and spell casts are silent. Your manual purchases, golden cookies and every other sound play as normal, and the volume isn't changed.
- If the best item can't be bought at all (the purchase fails, the game refuses it, or Cookie Monster's price for it stays out of date), it skips that item for a minute and moves on to the next best.
- **Cookie reserve**: how many cookies to keep banked. Lucky and Lucky + Frenzy are the bank sizes needed for a full Lucky payout.
  - **Off** (default): no reserve. Updating from 1.2 or earlier switches the reserve to Off once. After that, your choice is kept.
  - **Auto**: no reserve for the first 30 minutes of a run, then the same as Lucky. You can change the number of minutes.
  - **Lucky**: keeps 6,000× your unbuffed CpS banked.
  - **Lucky + Frenzy**: keeps 42,000× your unbuffed CpS banked.
- **Research**: buys research upgrades as soon as it can afford them, respecting the reserve.
- **Elder Pledge** (off by default): buys Elder Pledge whenever the grandmapocalypse is active, plus Sacrificial rolling pins when they're available. Pledging stops wrinklers from spawning.
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
- **Click upgrades**: Cookie Monster gives upgrades that only boost clicking (Plastic mouse, Iron mouse and the rest, Halo gloves and so on) an infinite PP, because they don't change CpS. While the autoclicker is on, AFK Baker gives them their own PP:
  - It asks the game's `Game.mouseCps` how much each click would earn with the upgrade, and multiplies the gain by the clicks per second the autoclicker really lands. It measures the landed rate over 10-second windows, so clicks lost while the window is heavily throttled are counted.
  - PP = max(price − bank, 0) / CpS + price / click income gain, the same formula Cookie Monster uses, so they rank fairly against buildings and other upgrades.
  - Temporary click buffs such as Click frenzy are left out, so a frenzy doesn't make them look better than they are.
  - Upgrades Cookie Monster already gives a finite PP (for example cursor upgrades that also boost Cursors) keep Cookie Monster's number.
- Other upgrades with no CpS effect (infinite PP) are skipped. Research is the exception and has its own switch.
- Pauses during ascension, for a few seconds after reincarnating, and whenever Cookie Monster's data is missing or out of date.

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
  - Buildings you don't own yet are levelled too, because levels carry over through ascensions. The status line notes it, e.g. `Leveled Wizard tower to 3 (none owned yet)`.
  - **Keep at least N lumps** (default 0): the mod never spends below this.
  - Paused during a Born again run, like harvesting.
- **Priority list editor** in the Sugar lumps section:
  - **Building palette**: every building in a grid, with the game's own store icon, its name and its current level. Buildings you don't own yet are dimmed but can still be used.
  - **Drag a building from the palette into the list** to add it. Its target starts at its current level + 1, and it goes in wherever you drop it. A gold line shows where it will land.
  - **The list** has aligned columns: drag handle (≡), priority number, icon, building, current level, target level, status (done, next or waiting), and the lumps still needed for that entry, then Up, Down and Remove buttons.
  - **Drag a row by its ≡ handle** to reorder it.
  - **Edit a target level right in the row.** A valid whole number saves as you type. Anything else is corrected when you leave the field or press Enter: at least 1, at most 1000, decimals rounded down.
  - The Up, Down and Remove buttons and the Add row (a building dropdown and a target level, then Add or Enter) still work for anyone who'd rather not drag. **Reset to default** starts over.
  - Press Escape to cancel a drag. Dropping outside the list changes nothing, and dragging never clicks the big cookie or anything else in the game. The game's 5-second Options refresh waits until a drag is finished.
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
- **Auras**: two dropdowns, primary and secondary. The default is None, and the mod doesn't touch an aura slot until you pick one for it.
  - Every aura can be picked. Ones the dragon hasn't unlocked yet are greyed with the level they unlock at, and are set as soon as the dragon gets there. Your picks are kept across ascensions.
  - The secondary aura is only used once the dragon is fully trained.
  - Setting an aura costs **one of your highest-tier building** (the game's rule), so the mod only changes an aura when your pick isn't active. Slot order makes no difference in the game, so a pick that's already in either slot is left where it is, and auras are never swapped back and forth. The same aura can't be picked twice.
- **Auto-pet dragon** (off by default): needs the heavenly upgrade "Pet the dragon" and a dragon at level 8 or more.
  - Which drop you can get depends on the quarter of the hour, so finding all four takes up to about 45 minutes. Which quarter gives which drop is decided by the save's seed, and **the mod doesn't read the seed**. It pets in every quarter-hour until a drop appears, or until about 100 pets have passed without one (that quarter's drop is then almost certainly one you already have), and then waits for the next quarter. It stops for good once all four are found.
  - The game only allows petting with the dragon panel open, so the mod opens it while it pets (a few seconds when a drop comes, about ten when it doesn't), then puts back whatever you had open before: Santa's panel, the dragon's, or nothing. Training does the same.
  - Dragon fang and Dragon teddy bear have no payback period, so auto-pet buys those two itself, respecting the cookie reserve. Dragon scale and Dragon claw are left to auto-buy.

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
  - **The market may use up to N% of your bank** (default 25), so it doesn't starve auto-buy. That's counted on your bank above the cookie reserve plus what is already invested. The status line shows it, e.g. `Budget $4,200 of $18,000`, so you can see when the budget is what's holding it back.
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
- **It holds the cast while the backfire chance is raised**, which the spell's tooltip shows: a golden or wrath cookie already on screen adds 15% each to Force the Hand of Fate, and the Magic inept buff multiplies every spell's chance by 5.
- **A backfired Force the Hand of Fate** summons a wrath cookie, usually a Clot or a Ruin. The mod leaves that one cookie alone, even with "Include wrath cookies" on. Other wrath cookies are clicked as usual.
- It holds Force the Hand of Fate while **golden cookie clicking is off**, because nothing would click the summoned cookie. The status line says so.
- It doesn't cast during the ascend animation, on the ascension screen, or in a Born again run. Your max magic depends on how many Wizard towers you own, so it's low at the start of each run, and the status line says when it's too low for the spell.
- **No cheating.** The same rule as the Stock Market: the mod only uses what a player can see, which here is the magic meter, the spell's cost, the backfire chance in its tooltip, the cookies on screen and your buffs. The game decides every spell's outcome in advance from the run's seed and your lifetime spell count, which is what spell planners read. AFK Baker never reads either one, never simulates a cast, and never looks at what a summoned cookie will do before it's clicked. It learns of a backfire the way you do, from the game's own backfire announcement.

**Auto-ascend**
- The threshold is either **prestige gained this run** or **total prestige level after ascending**. It uses the same numbers as the game's Legacy button.
- When you reach it, the mod ascends. It never reincarnates, so you choose your heavenly upgrades yourself.
- With auto-trade on, all stock is sold first (see Stock Market above).
- It is **off** by default. The default threshold is 1,000 prestige gained.
- The threshold box takes plain digits (commas are fine) or scientific notation such as `1.146e15`, and is wide enough for 20 digits. Next to it, the mod shows the value in the game's own number format (for example `= 1.146 quadrillion`) so you can check you typed the right number of digits. Something that isn't a number keeps the old threshold.
- **Safety guard**: auto-ascend only fires when you cross the threshold during play. If the threshold is already reached when the mod loads, when you turn auto-ascend on, or when you change the threshold, type or wrinkler mode, the mod shows a warning instead of ascending. To confirm, toggle auto-ascend off and on again.

**Other**
- **Debug logging**: extra console output. When the auto-buy decision changes, it prints the top 5 candidates (name, amount, PP, price, and why each was chosen or skipped; click upgrades are tagged `click`). It also lists the upgrades filtered out before ranking, and any infinite-PP upgrades that are still being skipped.

The Options section also shows a live status line:
- what auto-buy is doing. When it's waiting, it shows the target, its price, the reserve and how many more cookies are needed, and says which of these it's waiting on:
  - **Waiting on the item**: the bank can't cover the item yet, e.g. `saving for 10x Grandma (1.2 trillion) + reserve (8.4 trillion), need 3.1 trillion more`.
  - **Waiting on reserve**: the item is affordable, but buying it would dip into the reserve.
  - **Waiting on Cookie Monster data**: Cookie Monster isn't loaded, or its numbers are out of date.
- your current reserve
- how many wrinklers are feeding, and how many cookies they would pay out
- sugar lumps owned, the time until the current lump is ripe, and the last harvest
- the next lump spend and how many lumps it still needs, the lumps needed to finish the whole priority list, and the last level-up, e.g. `Next: Wizard tower to level 3, 2 more lumps needed. 9 lumps to finish the list`
- the dragon's level and auras, and the next training step with its cost and what it's waiting for, e.g. `Next: sacrifice 100 Farms (rebuy cost 14 min of CpS, waiting for under 10 min)`; with auto-pet on, how many drops are found and which one it's waiting for
- the stock market: shares held and what they're worth, the game's profit figure for this run, the market budget (`Budget $4,200 of $18,000`), the strategy in use, and the last trade with the rule that triggered it, e.g. `Bought 120 CHC at $8.40 (resting $21.00; 30% of resting or less)`; with brokers or the office on, a second line shows how many brokers you have, the current fee, and what the next broker or office upgrade is waiting for
- the Grimoire: magic (current / max), the time until it's full, what the cast is waiting for, and the last cast with its result, e.g. `Cast Force the Hand of Fate: Frenzy`. The result appears once the summoned cookie has been clicked
- your progress toward the ascend threshold, plus the guard warning when it's active

## Only what you can see

Everything AFK Baker decides, it decides from information a player can see on screen: prices, meters, costs, tooltips, buffs and what is in the store, plus fixed formulas anyone can look up, such as a stock's resting value. It never reads the game's hidden state to predict an outcome. In particular, no code in the mod reads the save's seed, the lifetime spell count, a golden cookie's effect before it is clicked, or the Stock Market's hidden modes and momentum. The game's own functions use those when the mod asks the game to cast a spell or pet the dragon, exactly as they do when you click.

## Requirements

- Cookie Clicker on Steam (tested against version 2.053).
- **Cookie Monster**, the Steam Workshop version. Subscribe to it and enable it in the Mods menu. Cookie Monster downloads its code from GitHub when the game starts, so it needs an internet connection.

## Installation

1. Download this repository.
2. Copy the `afk-baker` folder into the game's local mods folder:
   ```
   <Steam library>\steamapps\common\Cookie Clicker\resources\app\mods\local\afk-baker\
   ```
   The folder must contain `info.txt` and `main.js`.
3. Start the game and open **Options → Mods** (the "Manage mods" button).
4. Enable **Cookie Monster** and **AFK Baker**. Make sure Cookie Monster is listed above AFK Baker, then restart the game when asked.
5. Open **Options** and scroll down to the **AFK Baker** section to adjust the settings.

If you use other automation mods (for example FortuneHelper or Grandma's Rolling Pin), disable them so they don't fight over the same purchases and clicks.

## Credits

Inspired by [FortuneHelper](https://steamcommunity.com/sharedfiles/filedetails/?id=2693901672) and [Grandma's Rolling Pin](https://steamcommunity.com/sharedfiles/filedetails/?id=3199859496). No code from either mod is used. AFK Baker is written from scratch against the game's own source.

The payback-period data comes from [Cookie Monster](https://github.com/CookieMonsterTeam/CookieMonster).

The Stock Market's "always buy under $5" and "sell once past the bank ceiling" rules come from [KarmicChaos's Ultimate Stock Market Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2601428565), which also explains how the market works.

## License

[MIT](LICENSE)
