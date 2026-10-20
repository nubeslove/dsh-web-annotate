// dsh-web-annotate 端到端冒烟：真起一个本地站点、真起 chromium、真取帧、真拾取元素。
//
// 与 verify.mjs 的分工：verify 只做静态与路由级断言，不启动浏览器；本脚本验证整条链路。
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>批注冒烟页</title>
<style>
  body { margin:0; font-family: system-ui, "Microsoft YaHei", sans-serif; background:#f7f8fa; color:#1c1f24; }
  h1 { margin:0; padding:28px 32px 8px; font-size:22px; }
  .card { margin:12px 32px; padding:16px 18px; background:#fff; border:1px solid #e3e6eb; border-radius:10px; }
  .card.accent { border-color:#2f7de1; }
  #field { margin:12px 32px; width:320px; padding:8px 10px; border:1px solid #ccd2da; border-radius:8px; }
  #inner { position:absolute; left:32px; top:330px; width:420px; height:150px; border:1px solid #ccd2da; border-radius:8px; }
</style></head><body>
<h1 id="title">批注冒烟页</h1>
<div class="card" id="card-a">第一张卡片</div>
<div class="card accent" id="card-b">第二张卡片（带强调边框）</div>
<input id="field" placeholder="可输入" />
<iframe id="inner" srcdoc="&lt;style&gt;body{margin:0;font-family:system-ui}.box{padding:26px;background:#eef4ff;color:#12324f}&lt;/style&gt;&lt;div class='box' id='inner-box'&gt;iframe 内部元素&lt;/div&gt;"></iframe>
</body></html>`;

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.log('  FAIL  ' + name);
    console.log('        ' + (err instanceof Error ? err.message : String(err)));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readFirstFrame(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('frames HTTP ' + res.status);
    const reader = res.body.getReader();
    let buffer = '';
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended before a frame');
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/^data: (.+)$/m);
      if (match) {
        reader.cancel().catch(() => {});
        return JSON.parse(match[1]);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('dsh-web-annotate smoke');

  // 1. 本地站点
  const site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const sitePort = site.address().port;
  console.log('  local site: http://127.0.0.1:' + sitePort);

  // 2. 插件挂在本地 http server 上
  const plugin = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);
  const routes = [];
  plugin.apply({
    inject(deps, cb) {
      cb({
        effect(fn) {
          fn();
        },
        webServer: {
          register(route) {
            routes.push(route);
            return () => {};
          }
        }
      });
    }
  });
  const handler = routes[0].handler;
  const api = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const apiPort = api.address().port;
  const base = 'http://127.0.0.1:' + apiPort + '/api/web-annotate';
  console.log('  plugin api: ' + base);

  let sessionId = '';

  try {
    await check('创建会话并打开页面', async () => {
      const res = await fetch(base + '/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:' + sitePort })
      });
      const body = await res.json();
      assert(body.ok === true, '创建失败：' + (body.error || JSON.stringify(body)));
      assert(body.data.sessionId, 'sessionId 缺失');
      assert(body.data.viewport.width === 1000, 'viewport 不符：' + JSON.stringify(body.data.viewport));
      sessionId = body.data.sessionId;
    });

    await check('SSE 收到首帧画面', async () => {
      const frame = await readFirstFrame(base + '/frames?session=' + encodeURIComponent(sessionId), 20000);
      assert(frame.type === 'frame', 'type 不符：' + frame.type);
      const bytes = Buffer.from(frame.data, 'base64');
      assert(bytes.length > 2000, '帧太小：' + bytes.length + ' bytes');
      assert(frame.metadata && frame.metadata.deviceWidth === 1000, 'metadata 不符：' + JSON.stringify(frame.metadata));
      console.log('        frame=' + bytes.length + ' bytes, device=' + frame.metadata.deviceWidth + 'x' + frame.metadata.deviceHeight);
    });

    await check('拾取元素返回标签与样式', async () => {
      const res = await fetch(base + '/pick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, x: 120, y: 100 })
      });
      const body = await res.json();
      assert(body.ok === true, '拾取失败：' + (body.error || ''));
      const info = body.data;
      assert(info && info.tag, '未返回元素');
      assert(info.selector && info.selector.length > 0, '选择器为空');
      assert(info.rect && info.rect.width > 0, 'rect 无效');
      assert(info.style && info.style.font, '样式缺少字体');
      console.log('        picked <' + info.tag + '> ' + info.selector + ' ' + info.rect.width + 'x' + info.rect.height);
      console.log('        bg=' + info.style.background + ' font=' + info.style.font);
    });

    await check('拾取到的是具体卡片而非 body', async () => {
      const res = await fetch(base + '/pick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, x: 120, y: 160, hover: false })
      });
      const body = await res.json();
      const info = body.data;
      assert(info.tag === 'div', '应命中 div，实际 ' + info.tag);
      assert(info.selector.includes('card'), '选择器应包含 card：' + info.selector);
    });

    await check('输入事件可送达页面', async () => {
      const res = await fetch(base + '/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, type: 'wheel', deltaY: 40 })
      });
      const body = await res.json();
      assert(body.ok === true, '输入失败：' + (body.error || ''));
    });

    await check('穿透 iframe 拾取内部元素', async () => {
      // iframe 位于 (32,330) 起、420x150 的区域，内部 .box 有 26px 内边距
      const res = await fetch(base + '/pick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, x: 140, y: 400, hover: false })
      });
      const body = await res.json();
      const info = body.data;
      assert(info, '未返回元素');
      assert(info.id === 'inner-box', '应穿透到 iframe 内部元素，实际 ' + info.id + ' <' + info.tag + '>');
      assert(Array.isArray(info.framePath) && info.framePath.length >= 1, '缺少穿透路径：' + JSON.stringify(info.framePath));
      console.log('        frame path=' + info.framePath.join(' > ') + ' -> #' + info.id);
    });

    await check('中文文本输入到页面', async () => {
      await fetch(base + '/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, type: 'click', x: 150, y: 222 })
      });
      const typed = await fetch(base + '/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, type: 'text', text: '中文输入测试' })
      });
      const typedBody = await typed.json();
      assert(typedBody.ok === true, '输入失败：' + (typedBody.error || ''));

      const res = await fetch(base + '/pick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, x: 150, y: 222, hover: false })
      });
      const info = (await res.json()).data;
      assert(info && info.tag === 'input', '应命中输入框，实际 ' + (info && info.tag));
      assert(info.value === '中文输入测试', '输入框内容不符：' + JSON.stringify(info.value));
      console.log('        field value=' + JSON.stringify(info.value));
    });

    await check('导出批注文件', async () => {
      const res = await fetch(base + '/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '## 网页批注\n\n1. `#card-a`\n   边距太大' })
      });
      const body = await res.json();
      assert(body.ok === true, '导出失败：' + (body.error || ''));
      assert(body.data.path.includes('web-annotate'), '导出路径不符：' + body.data.path);
      console.log('        exported to ' + body.data.path);
    });

    await check('暴露 CDP 端点供 playwright-mcp attach', async () => {
      const health = await (await fetch(base + '/health')).json();
      assert(
        health.data.cdpEndpoint === 'http://127.0.0.1:9222',
        '未暴露 CDP 端点：' + JSON.stringify(health.data.cdpEndpoint)
      );
      const res = await fetch('http://127.0.0.1:9222/json/version');
      assert(res.ok, 'CDP 端点不可访问：HTTP ' + res.status);
      const info = await res.json();
      assert(info.Browser, 'CDP 返回缺少 Browser 字段');
      console.log('        cdp endpoint alive: ' + info.Browser);
    });

    await check('刷新页面', async () => {
      const res = await fetch(base + '/reload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId })
      });
      const body = await res.json();
      assert(body.ok === true, '刷新失败：' + (body.error || ''));
      assert(body.data.url.includes('127.0.0.1:' + sitePort), '刷新后地址不符：' + body.data.url);
    });

    await check('health 能看到活跃会话', async () => {
      const res = await fetch(base + '/health');
      const body = await res.json();
      assert(body.data.sessions.length === 1, '会话数应为 1，实际 ' + body.data.sessions.length);
    });

    await check('关闭会话', async () => {
      const res = await fetch(base + '/session/' + encodeURIComponent(sessionId), { method: 'DELETE' });
      const body = await res.json();
      assert(body.ok === true, '关闭失败：' + (body.error || ''));
      sessionId = '';
      const health = await (await fetch(base + '/health')).json();
      assert(health.data.sessions.length === 0, '关闭后仍有会话');
    });
  } finally {
    if (sessionId) {
      await fetch(base + '/session/' + encodeURIComponent(sessionId), { method: 'DELETE' }).catch(() => {});
    }
    await new Promise((resolve) => api.close(resolve));
    await new Promise((resolve) => site.close(resolve));
  }

  console.log('');
  console.log('结果: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exitCode = 1;
  }
  // 插件持有的 chromium 实例在进程退出前不会自己关闭，这里直接结束进程
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
}

main().catch((err) => {
  console.error('smoke 崩溃:', err);
  process.exitCode = 1;
});
