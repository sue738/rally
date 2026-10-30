# lib/ui — the board's page

`lib/page.js` builds the page from this directory: `index.html`, with every
`lib/ui/css/*.css` joined into one `<style>` and every `lib/ui/js/*.js` joined
into one `<script>`, each in filename order. `vendor/` is third-party code
(xterm.js and its addons), copied as published.

The files are split by feature, but they are not modules:

- All the scripts share one top-level scope. A function or `const` in one
  file is visible in every other; top-level code runs in filename order.
- CSS is one cascade: a later file overrides an earlier one at equal
  specificity. Moving a rule to another file can change what wins.

## Rules

- A new feature gets its own file. Pick a prefix that puts it where it has to
  run (JS) or where it has to win (CSS); leave gaps between prefixes.
- Order is by the numeric prefix, `NN-name.js` / `NN-name.css`, lowercase.
  Nothing else goes in `js/` or `css/` (`node test/test.js` checks the names).
- Cut between top-level statements: every script file must parse on its own
  (`node test/test.js` checks each piece and the joined script).
- Styles that must beat earlier rules go in a later file, not in an earlier
  file with a stronger selector.

## js/

| file | what is in it |
| --- | --- |
| `00-core.js` | `$`/`esc`, view mode and theme, number and time formats, lane names, card title helpers, unsent drafts, send cancel, model labels, `canPty` / `goTerm` |
| `01-keymap.js` | the table of rebindable keys, saving choices and their rules, `kmAct` / `kmText` for every handler and hint; early because the terminal strip's tooltips use it while loading |
| `03-panel.js` | `openDetail` (the session panel: builds, wires, restores in order), the top's wiring (… menu, buttons, title rename, 残作業, 完了 / 待ち), redraw restore, panel and list width grips |
| `04-panel-html.js` | the panel's markup: title row and status line, the message box and `--model` pulldown, 残作業, 送信待ち |
| `05-panel-send.js` | the panel's message box: `panelSend`, typed into the terminal (`panelViaTerm`), the send row's flags, 送信待ち's buttons, drafts back on open |
| `06-history.js` | history cache, card signatures, subagents, links and attachments in the thread, follow-the-bottom scrolling, ↓ 最新へ, the ask box, AskUserQuestion answered in the panel |
| `07-panel-hist.js` | the panel's conversation range picker, what is drawn or re-read when the panel opens |
| `09-pr.js` | the branch / pull request row: merge and clean up |
| `12-thread.js` | `historyHtml` / `renderHistory`: drawing the conversation |
| `15-attach.js` | attachments: paste, drop, upload, chips |
| `18-compose.js` | the message box: skills picker, auto-grow, sent history, @file completion, drop on the panel |
| `21-reply.js` | echo of a send, replying to one message, the thinking indicator and spinner |
| `22-whenfree.js` | 今の作業後に送る: the send row's chip and ⌥⏎, held messages at the foot of the thread (今すぐ送る / 取り消す), typing them into the app's own terminal once idle |
| `24-newsession.js` | `openNew`: the new-session panel |
| `27-side-panels.js` | the 残作業 page (`pendCounts`, 棚卸し one or a capped batch), 定期実行 (jobs: next run, run now / pause / resume / delete), the header panel buttons |
| `30-panel-host.js` | closing the detail panel, Escape, `focusHome`, `pendLine` |
| `33-motion.js` | FLIP card motion, starting a session in a shell pane, `syncOpened` |
| `38-unread.js` | 未読: what was seen of each card (`seen`), `unreadShown`, the marks and the reply count on the cards, 未読を開く / すべて既読にする |
| `39-board.js` | lane drag and drop, `render` / `renderLanes`, the emptied wide panel (`renderDempty`) |
| `42-state.js` | transports (`post`), copy buttons, permission answers, limits, arrivals and notifications, colours, `applyState`, the notifications bar |
| `45-wtsetup.js` | worktree setup (`lib/wtsetup.js`) in the compose form |
| `48-bridge.js` | made / prompt rendering, `window.__kanban` bridge, `load`, `dispatch`, a new session followed until its card shows |
| `49-bgtasks.js` | 裏で実行中 N's list (lib/bgtasks.js): each background task with 止める, 全部止める for wait loops left looping, the automatic-stop switch |
| `51-strip.js` | the terminal strip's command panes (not a pty) |
| `54-pty.js` | real terminals in the strip (xterm.js on the app's pty) |
| `57-panel-term.js` | the panel's own terminal view, summary, fold, slash commands, permission mode |
| `60-pty-park.js` | parked terminals, pty bridge callbacks, `ptySetup`, header controls wiring |
| `63-search.js` | the filter query language and conversation search |
| `66-select.js` | keyboard selection of cards, `moveSel` |
| `69-list.js` | リスト view (docked list; the only view) and 表示, what a card shows |
| `75-keys.js` | terminal selection, the … menu, the main keydown handler |
| `78-boot.js` | first `load()` and the refresh timers |
| `81-palette.js` | the ⌘K command palette |
| `84-diff.js` | markdown rendering, diffs and review notes |
| `87-viewer.js` | the file / changes viewer |
| `90-help.js` | the shortcut sheet and ⌘ shortcuts |
| `92-keyset.js` | 設定: キーバインド — the panel where a key is chosen (click, press the new key), presets, reset |

## css/

| file | what is in it |
| --- | --- |
| `00-base.css` | tokens (colours, type scale), base elements, fonts |
| `05-board.css` | lanes and cards, session colours |
| `10-terminal.css` | the terminal strip and xterm |
| `15-panel.css` | the side panel, its meta rows, model picker |
| `20-history.css` | the conversation |
| `25-phone.css` | the narrow-window `@media` block, card kinds |
| `30-prompt.css` | message boxes, completion menu, limits |
| `32-whenfree.css` | 今の作業後に送る: held messages in the thread |
| `35-palette.css` | the ⌘K palette |
| `40-header.css` | the header status line |
| `45-viewer.css` | the viewer and review comments |
| `50-misc.css` | spinner, subject colour, help sheet, small lanes, markdown, permission prompt, copy button |
| `55-widths.css` | width breakpoints, icons, split strip, branch row |
| `60-newsession.css` | the new-session form |
| `65-cards-late.css` | stuck, 残作業, あなたの番 cards, placeholders, touch targets, 裏で実行中's list |
| `70-list.css` | リスト |
| `80-panel-term.css` | the panel's terminal, view switch, panel title row, permission mode |
| `85-opened.css` | the card whose panel is open |
| `88-keyset.css` | the key settings panel |
| `90-late.css` | later overrides: ↓ 最新へ, list + terminal, notifications bar, button sizes, attachments, IME |
