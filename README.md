# AFK Baker

A Cookie Clicker (Steam) mod that plays the game while you're away. It clicks, catches golden cookies, buys the most efficient building or upgrade according to [Cookie Monster](https://steamcommunity.com/sharedfiles/filedetails/?id=2685721341), and ascends when you reach a prestige goal.

It uses only the game's built-in mod API (`Game.registerMod`). CCSE is not needed.

## Features

Every feature can be turned on or off in **Options → AFK Baker**. Settings are saved with your game.

**Clickers**
- **Big cookie autoclicker**: set the clicks per second (default 30, 0 turns it off, maximum 50, which is the game's own limit). It keeps clicking while the window is minimized. When the game slows down in the background, the mod sends the missed clicks as one bigger click. Your cookie click count and hand-made cookies still count every one of them.
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

**Auto-buy** (checks about once a second)
- Picks the building (buying 1) or upgrade with the lowest payback period (PP) according to Cookie Monster. If it can't afford that item yet, it waits and saves up rather than buying something worse.
- **Cookie reserve**: how many cookies to keep banked. Lucky and Lucky + Frenzy are the bank sizes needed for a full Lucky payout.
  - **Auto** (default): no reserve for the first 30 minutes of a run, then the same as Lucky. You can change the number of minutes.
  - **Off**: no reserve.
  - **Lucky**: keeps 6,000× your unbuffed CpS banked.
  - **Lucky + Frenzy**: keeps 42,000× your unbuffed CpS banked.
- **Research**: buys research upgrades as soon as it can afford them, respecting the reserve.
- **Elder Pledge** (off by default): buys Elder Pledge whenever the grandmapocalypse is active, plus Sacrificial rolling pins when they're available. Pledging stops wrinklers from spawning.
  - It never pledges in Feed mode.
  - It never pledges while a shiny wrinkler is on screen, because the game's pledge pops every wrinkler, shinies included.
  - To end the grandmapocalypse automatically, switch the wrinkler mode to Pop instantly or Off, and turn this on.
- **Never buys**:
  - switches and selectors (the `toggle` pool)
  - debug upgrades
  - heavenly upgrades
  - vaulted upgrades
  - anything that costs sugar lumps
  - Chocolate egg
  - Sugar frenzy
  - Elder Covenant and Revoke Elder Covenant

  To add more upgrades, edit `NEVER_BUY_UPGRADES` at the top of `main.js`.
- Upgrades with no CpS effect (Cookie Monster gives them an infinite PP) are skipped. Research is the exception and has its own switch.
- Pauses during ascension, for a few seconds after reincarnating, and whenever Cookie Monster's data is missing or out of date.

**Auto-ascend**
- The threshold is either **prestige gained this run** or **total prestige level after ascending**. It uses the same numbers as the game's Legacy button.
- When you reach it, the mod ascends. It never reincarnates, so you choose your heavenly upgrades yourself.
- It is **off** by default. The default threshold is 1,000 prestige gained.
- **Safety guard**: auto-ascend only fires when you cross the threshold during play. If the threshold is already reached when the mod loads, when you turn auto-ascend on, or when you change the threshold, type or wrinkler mode, the mod shows a warning instead of ascending. To confirm, toggle auto-ascend off and on again.

The Options section also shows a live status line:
- what auto-buy is doing
- your current reserve
- how many wrinklers are feeding, and how many cookies they would pay out
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
