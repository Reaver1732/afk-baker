# AFK Baker

A Cookie Clicker (Steam) mod that plays the game while you're away. It clicks, catches golden cookies, buys the most efficient building (1, 10 or 100 at a time) or upgrade according to [Cookie Monster](https://steamcommunity.com/sharedfiles/filedetails/?id=2685721341), harvests and spends sugar lumps, and ascends when you reach a prestige goal.

It uses only the game's built-in mod API (`Game.registerMod`). CCSE is not needed.

## Features

Every feature can be turned on or off in **Options → AFK Baker**. Settings are saved with your game.

**Clickers**
- **Big cookie autoclicker**: set the clicks per second (default 30, 0 turns it off, maximum 50, which is the game's own limit). It keeps clicking while the window is minimized. When the game slows down in the background, the mod sends the missed clicks as one bigger click. Your cookie click count and hand-made cookies still count every one of them.
- **Mute big cookie click sound** (on by default): silences only the big cookie's click sound, for your own clicks and the autoclicker's. Golden cookies, buying and every other game sound play as normal, and the game's volume is not changed.
- **Golden cookies**: clicked as soon as they appear. A separate switch covers wrath cookies.
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
- **Mute auto-buy purchase sounds** (on by default): AFK Baker's own purchases and building level-ups are silent. Your manual purchases, golden cookies and every other sound play as normal, and the volume isn't changed.
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

**Auto-ascend**
- The threshold is either **prestige gained this run** or **total prestige level after ascending**. It uses the same numbers as the game's Legacy button.
- When you reach it, the mod ascends. It never reincarnates, so you choose your heavenly upgrades yourself.
- It is **off** by default. The default threshold is 1,000 prestige gained.
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
- your progress toward the ascend threshold, plus the guard warning when it's active

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

## License

[MIT](LICENSE)
