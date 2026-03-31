#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, findProjectRoot } = require('./lib/core.cjs');
const {
  listSessions,
  launch,
  connect,
  stop,
  cleanup,
  formatA11yNode,
} = require('./lib/browser-core.cjs');
const { initLogger, log, closeLogger } = require('./lib/logger.cjs');

const args = process.argv.slice(2);
const command = args[0];

function output(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function main() {
  try { initLogger(findProjectRoot()); } catch (_) { /* best-effort */ }

  try {
    switch (command) {
      case 'start': {
        const flags = parseFlags(args.slice(1));
        const opts = {};

        if (flags.viewport) {
          const [w, h] = flags.viewport.split('x').map(Number);
          if (w && h) {
            opts.viewportWidth = w;
            opts.viewportHeight = h;
          }
        }

        if (flags.maximized) {
          opts.maximized = true;
        }

        const session = await launch(opts);

        log('INFO', 'browser', `浏览器启动`, { sessionId: session.sessionId });
        if (flags['session-id-only']) {
          process.stdout.write(session.sessionId);
        } else {
          output({ ok: true, ...session });
        }
        break;
      }

      case 'navigate': {
        const sessionId = args[1];
        const url = args[2];
        if (!sessionId || !url) {
          output({ error: 'Usage: browser.cjs navigate <sessionId> <url> [--wait-for text] [--timeout ms]' });
          process.exit(1);
        }

        const flags = parseFlags(args.slice(3));
        const timeout = parseInt(flags.timeout) || 30000;

        const { browser, page } = await connect(sessionId);
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout });

          if (flags['wait-for']) {
            await page.waitForFunction(
              (text) => document.body?.innerText?.includes(text),
              { timeout },
              flags['wait-for']
            );
          }

          const title = await page.title();
          log('INFO', 'browser', `页面导航`, { url, title });
          output({ ok: true, url, title });
        } finally {
          browser.disconnect();
        }
        break;
      }

      case 'screenshot': {
        const sessionId = args[1];
        const outputPath = args[2];
        if (!sessionId || !outputPath) {
          output({ error: 'Usage: browser.cjs screenshot <sessionId> <outputPath> [--full-page] [--selector css]' });
          process.exit(1);
        }

        const flags = parseFlags(args.slice(3));
        const resolvedPath = path.resolve(outputPath);

        // Ensure output directory exists
        ensureDir(path.dirname(resolvedPath));

        const { browser, page } = await connect(sessionId);
        try {
          const screenshotOpts = { path: resolvedPath, type: 'png' };

          if (flags.selector) {
            const element = await page.$(flags.selector);
            if (!element) {
              output({ error: `Element not found: ${flags.selector}` });
              break;
            }
            await element.screenshot(screenshotOpts);
          } else {
            screenshotOpts.fullPage = !!flags['full-page'];
            await page.screenshot(screenshotOpts);
          }

          const viewport = page.viewport();
          log('INFO', 'browser', `截图完成`, { path: resolvedPath });
          output({
            ok: true,
            path: resolvedPath,
            width: viewport?.width || 0,
            height: viewport?.height || 0,
          });
        } finally {
          browser.disconnect();
        }
        break;
      }

      case 'eval': {
        const sessionId = args[1];
        if (!sessionId) {
          output({ error: 'Usage: browser.cjs eval <sessionId> <expression> | --stdin' });
          process.exit(1);
        }

        const flags = parseFlags(args.slice(2));
        let expression;

        if (flags.stdin || flags.stdin === true) {
          expression = fs.readFileSync('/dev/stdin', 'utf8').trim();
        } else {
          // Collect all remaining non-flag args as expression
          expression = args.slice(2).filter(a => !a.startsWith('--')).join(' ');
        }

        if (!expression) {
          output({ error: 'No expression provided' });
          process.exit(1);
        }

        const { browser, page } = await connect(sessionId);
        try {
          // Wrap in async IIFE if it looks like a function
          let result;
          if (expression.trim().startsWith('(') || expression.trim().startsWith('async')) {
            result = await page.evaluate(expression);
          } else {
            result = await page.evaluate(`(() => { return ${expression}; })()`);
          }
          output({ ok: true, result });
        } finally {
          browser.disconnect();
        }
        break;
      }

      case 'snapshot': {
        const sessionId = args[1];
        if (!sessionId) {
          output({ error: 'Usage: browser.cjs snapshot <sessionId> [--file path]' });
          process.exit(1);
        }

        const flags = parseFlags(args.slice(2));

        const { browser, page } = await connect(sessionId);
        try {
          const snapshot = await page.accessibility.snapshot();
          const formatted = formatA11yNode(snapshot);

          if (flags.file) {
            const resolvedPath = path.resolve(flags.file);
            const dir = path.dirname(resolvedPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(resolvedPath, formatted, 'utf8');
            output({ ok: true, path: resolvedPath });
          } else {
            output({ ok: true, snapshot: formatted });
          }
        } finally {
          browser.disconnect();
        }
        break;
      }

      case 'stop': {
        const sessionId = args[1];
        if (!sessionId) {
          output({ error: 'Usage: browser.cjs stop <sessionId>' });
          process.exit(1);
        }

        const result = await stop(sessionId);
        log('INFO', 'browser', `浏览器停止`, { sessionId });
        output({ ok: true, sessionId, ...result });
        break;
      }

      case 'cleanup': {
        const flags = parseFlags(args.slice(1));
        const maxAge = parseInt(flags['max-age']) || 60;
        const result = await cleanup({ maxAge });
        output({ ok: true, ...result });
        break;
      }

      case 'list': {
        const sessions = listSessions();
        output({ ok: true, sessions });
        break;
      }

      default: {
        output({
          error: 'Unknown command',
          usage: {
            start: 'browser.cjs start [--viewport WxH] [--session-id-only]',
            navigate: 'browser.cjs navigate <sid> <url> [--wait-for text] [--timeout ms]',
            screenshot: 'browser.cjs screenshot <sid> <outputPath> [--full-page] [--selector css]',
            eval: 'browser.cjs eval <sid> <expression> | --stdin',
            snapshot: 'browser.cjs snapshot <sid> [--file path]',
            stop: 'browser.cjs stop <sid>',
            cleanup: 'browser.cjs cleanup [--max-age minutes]',
            list: 'browser.cjs list',
          },
        });
        process.exit(1);
      }
    }
  } catch (err) {
    log('ERROR', 'browser', `浏览器操作失败: ${err.message}`, { command });
    closeLogger();
    output({ error: err.message });
    process.exit(1);
  } finally {
    closeLogger();
  }
}

main();
