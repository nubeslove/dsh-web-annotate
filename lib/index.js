// dsh-web-annotate — host 侧
// 职责：用 Playwright 在宿主里开一个真实浏览器页面，把画面经 CDP screencast 推给侧栏，
// 并把客户端的鼠标/滚轮/键盘事件转发回页面。批注拾取在页面内用 elementFromPoint 完成。
//
// 设计取舍：不用 WebSocket，改用 SSE 推帧 + POST 送事件。DSH 的 webServer 只暴露路由注册，
// 不保证能拿到 http server 的 upgrade 事件；SSE 是普通响应，稳定可控。
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const name = 'web-annotate';
export const inject = [];

const PREFIX = '/api/web-annotate';
const VIEWPORT = { width: 1000, height: 700 };
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let chromiumCtor = null;
let browserPromise = null;
const sessions = new Map();

// ---------------------------------------------------------------- 依赖解析

/**
 * 解析 playwright。插件目录没有 node_modules，因此从 DSH profile 目录解析，
 * 复用 DSH 自己安装的那一份，避免插件再带一份浏览器依赖。
 */
function loadChromium() {
  if (chromiumCtor) return chromiumCtor;
  const profileHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const profileEnv = process.env.DSH_PROFILE;
  const profile = !profileEnv
    ? join(profileHome, 'profiles', 'desktop')
    : isAbsolute(profileEnv)
      ? profileEnv
      : join(profileHome, 'profiles', profileEnv);
  const requireFromProfile = createRequire(join(profile, 'package.json'));
  chromiumCtor = requireFromProfile('playwright').chromium;
  return chromiumCtor;
}

async function ensureBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const chromium = loadChromium();
    return chromium.launch({ headless: true, args: ['--no-sandbox'] });
  })();
  try {
    return await browserPromise;
  } catch (err) {
    browserPromise = null;
    throw err;
  }
}

// ---------------------------------------------------------------- 页面内脚本

/** 在页面里执行：把坐标处的元素信息读出来（含稳定的选择器）。 */
function pickElementAt(point) {
  const x = Number(point && point.x) || 0;
  const y = Number(point && point.y) || 0;
  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
  };

  const buildSelector = (node) => {
    if (!(node instanceof Element)) return '';
    if (node.id) return '#' + cssEscape(node.id);
    const parts = [];
    let cur = node;
    let depth = 0;
    while (cur && cur instanceof Element && depth < 6) {
      let part = cur.tagName.toLowerCase();
      const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/).filter(Boolean) : [];
      if (cls.length) part += '.' + cls.slice(0, 2).map(cssEscape).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      if (cur.id) {
        parts.unshift('#' + cssEscape(cur.id));
        break;
      }
      cur = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };

  const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

  // 命中 iframe 时带回它自身的信息，宿主侧据此进入子文档继续取元素
  const isFrame = el.tagName === 'IFRAME' || el.tagName === 'FRAME';
  const frameInfo = isFrame
    ? (function () {
        const all = Array.from(document.querySelectorAll('iframe, frame'));
        return {
          index: all.indexOf(el),
          src: el.src || el.getAttribute('src') || '',
          name: el.getAttribute('name') || '',
          contentX: rect.x + el.clientLeft,
          contentY: rect.y + el.clientTop
        };
      })()
    : null;

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    className: typeof el.className === 'string' ? el.className.trim().slice(0, 160) : '',
    selector: buildSelector(el),
    text,
    rect: {
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    style: {
      color: cs.color,
      background: cs.backgroundColor,
      font: cs.fontSize + ' / ' + (cs.fontFamily || '').split(',')[0].replace(/["']/g, ''),
      weight: cs.fontWeight
    },
    value: typeof el.value === 'string' ? el.value.slice(0, 300) : null,
    frame: frameInfo
  };
}

/**
 * 递归穿透 iframe 取元素。
 * Playwright 直接控制浏览器，不经过页面同源检查，因此跨域 iframe 内部也能读。
 * @param {import('playwright').Frame} frame 当前 frame
 * @param {number} x 当前 frame 视口内的 x
 * @param {number} y 当前 frame 视口内的 y
 * @param {number} depth 已穿透层数
 * @returns 命中的最深层元素信息，附带穿透路径
 */
async function pickDeep(frame, x, y, depth) {
  const info = await frame.evaluate(pickElementAt, { x, y });
  if (!info || !info.frame || depth >= 4) return info;

  const children = typeof frame.childFrames === 'function' ? frame.childFrames() : [];
  let target = children[info.frame.index];
  if (!target && info.frame.src) {
    target = children.find((child) => {
      try {
        return child.url() === info.frame.src;
      } catch {
        return false;
      }
    });
  }
  if (!target) return info;

  const inner = await pickDeep(
    target,
    Math.round(x - info.frame.contentX),
    Math.round(y - info.frame.contentY),
    depth + 1
  ).catch(() => null);

  if (!inner) return info;
  return Object.assign({}, inner, {
    framePath: [info.frame.src || info.frame.name || 'iframe'].concat(inner.framePath || [])
  });
}

// ---------------------------------------------------------------- 会话

function touch(session) {
  session.lastActiveAt = Date.now();
}

async function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  for (const res of session.clients) {
    try {
      res.end();
    } catch {
      /* 客户端已断开 */
    }
  }
  session.clients.clear();
  clearTimeout(session.idleTimer);
  try {
    await session.cdp.send('Page.stopScreencast');
  } catch {
    /* 页面可能已关闭 */
  }
  try {
    await session.page.close();
  } catch {
    /* 页面可能已关闭 */
  }
}

function scheduleIdleCleanup(session) {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    if (Date.now() - session.lastActiveAt >= IDLE_TIMEOUT_MS && session.clients.size === 0) {
      void closeSession(session.id);
    }
  }, IDLE_TIMEOUT_MS + 1000);
  if (typeof session.idleTimer.unref === 'function') session.idleTimer.unref();
}

async function createSession(url) {
  const browser = await ensureBrowser();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

  const cdp = await page.context().newCDPSession(page);
  const session = {
    id: randomUUID(),
    page,
    cdp,
    url,
    clients: new Set(),
    lastFrame: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    idleTimer: null
  };
  sessions.set(session.id, session);

  cdp.on('Page.screencastFrame', (event) => {
    // ack 必须及时回，否则 CDP 会停止推帧
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    session.lastFrame = { data: event.data, metadata: event.metadata };
    for (const res of session.clients) {
      try {
        res.write('data: ' + JSON.stringify({ type: 'frame', data: event.data, metadata: event.metadata }) + '\n\n');
      } catch {
        session.clients.delete(res);
      }
    }
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 72,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1
  });

  scheduleIdleCleanup(session);
  return session;
}

// ---------------------------------------------------------------- HTTP

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    const CAP = 256 * 1024;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > CAP) {
        rejectBody(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolveBody({});
      try {
        resolveBody(JSON.parse(text));
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on('error', rejectBody);
  });
}

export function resolveUrl(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'url must be a string' };
  const text = raw.trim();
  if (!text) return { ok: false, error: 'url is empty' };
  if (text.length > 2048) return { ok: false, error: 'url too long' };

  let candidate = text;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return { ok: false, error: 'only http/https is allowed' };
    const isLocal = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(candidate);
    candidate = (isLocal ? 'http://' : 'https://') + candidate;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'invalid url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'only http/https is allowed' };
  }
  return { ok: true, url: parsed.toString() };
}

function makeRoutes() {
  const handler = async (req, res) => {
    const method = String(req.method ?? 'GET').toUpperCase();
    const rawUrl = String(req.url ?? '');
    const [pathname, search = ''] = rawUrl.split('?');
    const query = new URLSearchParams(search);
    const tail = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;

    try {
      if (method === 'GET' && (tail === '/' || tail === '/health')) {
        const { version } = process.versions;
        return json(res, 200, {
          ok: true,
          data: {
            status: 'ready',
            node: version,
            viewport: VIEWPORT,
            sessions: [...sessions.values()].map((s) => ({
              id: s.id,
              url: s.url,
              clients: s.clients.size,
              ageMs: Date.now() - s.createdAt
            }))
          }
        });
      }

      if (method === 'POST' && tail === '/session') {
        const body = await readJsonBody(req);
        const target = resolveUrl(body?.url);
        if (!target.ok) return json(res, 400, { ok: false, error: target.error });
        const session = await createSession(target.url);
        return json(res, 200, {
          ok: true,
          data: { sessionId: session.id, url: target.url, viewport: VIEWPORT }
        });
      }

      if (method === 'DELETE' && tail.startsWith('/session/')) {
        const id = tail.slice('/session/'.length);
        await closeSession(id);
        return json(res, 200, { ok: true, data: { sessionId: id } });
      }

      if (method === 'GET' && tail === '/frames') {
        const id = query.get('session') || '';
        const session = sessions.get(id);
        if (!session) return json(res, 404, { ok: false, error: 'unknown session' });

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        });
        res.write(': connected\n\n');
        if (session.lastFrame) {
          res.write(
            'data: ' +
              JSON.stringify({ type: 'frame', data: session.lastFrame.data, metadata: session.lastFrame.metadata }) +
              '\n\n'
          );
        }
        session.clients.add(res);
        touch(session);
        req.on('close', () => {
          session.clients.delete(res);
        });
        return;
      }

      if (method === 'POST' && tail === '/input') {
        const body = await readJsonBody(req);
        const session = sessions.get(String(body?.session || ''));
        if (!session) return json(res, 404, { ok: false, error: 'unknown session' });
        touch(session);

        const page = session.page;
        const x = Number(body.x) || 0;
        const y = Number(body.y) || 0;
        const type = String(body.type || '');

        if (type === 'move') {
          await page.mouse.move(x, y);
        } else if (type === 'click') {
          await page.mouse.click(x, y, { button: body.button === 'right' ? 'right' : 'left', clickCount: 1 });
        } else if (type === 'wheel') {
          await page.mouse.wheel(0, Number(body.deltaY) || 0);
        } else if (type === 'key') {
          const key = String(body.key || '');
          if (key) await page.keyboard.press(key);
        } else if (type === 'text') {
          const text = String(body.text || '');
          if (!text) return json(res, 400, { ok: false, error: 'text is empty' });
          if (text.length > 4000) return json(res, 400, { ok: false, error: 'text too long' });
          // insertText 绕过键盘布局，中文等任意字符都能进当前焦点元素
          await page.keyboard.insertText(text);
        } else if (type === 'scrollTo') {
          await page.evaluate((top) => window.scrollTo(0, top), Number(body.top) || 0);
        } else {
          return json(res, 400, { ok: false, error: 'unknown input type: ' + type });
        }

        return json(res, 200, { ok: true, data: { type } });
      }

      if (method === 'POST' && tail === '/pick') {
        const body = await readJsonBody(req);
        const session = sessions.get(String(body?.session || ''));
        if (!session) return json(res, 404, { ok: false, error: 'unknown session' });
        touch(session);

        const x = Number(body.x) || 0;
        const y = Number(body.y) || 0;
        // 先让页面收到真实的 hover，再读元素信息，这样 :hover 样式变化也算进去
        if (body.hover !== false) await session.page.mouse.move(x, y);
        const info = await pickDeep(session.page.mainFrame(), x, y, 0);
        return json(res, 200, { ok: true, data: info });
      }

      if (method === 'POST' && tail === '/reload') {
        const body = await readJsonBody(req);
        const session = sessions.get(String(body?.session || ''));
        if (!session) return json(res, 404, { ok: false, error: 'unknown session' });
        touch(session);
        await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
        return json(res, 200, { ok: true, data: { url: session.page.url() } });
      }

      if (method === 'POST' && tail === '/export') {
        const body = await readJsonBody(req);
        const content = String(body?.content || '');
        if (!content.trim()) return json(res, 400, { ok: false, error: 'content is empty' });
        if (content.length > 1024 * 1024) return json(res, 400, { ok: false, error: 'content too large' });

        // 只写到 DSH 配置目录下的固定子目录，不接受任意目标路径
        const home = process.env.DSH_HOME || join(homedir(), '.dsh');
        const dir = join(home, 'web-annotate');
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = join(dir, 'annotations-' + stamp + '.md');
        await writeFile(file, content.replace(/\s+$/, '') + '\n', 'utf8');
        return json(res, 200, { ok: true, data: { path: file } });
      }

      return json(res, 404, { ok: false, error: 'no route ' + method + ' ' + tail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(res, 500, { ok: false, error: message });
    }
  };

  return [{ kind: 'prefix', path: PREFIX, handler }];
}

export function apply(ctx) {
  const routes = makeRoutes();
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(() => {
      const disposers = routes.map((route) => httpCtx.webServer.register(route));
      return () => {
        for (const dispose of disposers) dispose();
        for (const id of [...sessions.keys()]) void closeSession(id);
        if (browserPromise) {
          void browserPromise.then((b) => b.close()).catch(() => {});
          browserPromise = null;
        }
      };
    }, 'web-annotate: routes');
  });
}
