// dsh-web-annotate 自检脚本（静态 + 路由级）
// 真正起浏览器的端到端冒烟在 scripts/smoke.mjs。
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

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

async function main() {
  console.log('dsh-web-annotate verify');

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  await check('package.json 基本字段', () => {
    assert(pkg.name === 'dsh-web-annotate', 'name 不符');
    assert(pkg.type === 'module', 'type 必须是 module');
    assert(pkg.main === './lib/index.js', 'main 指向错误');
    assert(pkg.exports['./client'].default === './lib/client.js', 'client 导出缺失');
    assert(pkg.author && pkg.author.email, '缺少作者邮箱');
  });

  await check('dsh 元数据声明 bundle 与 client', () => {
    assert(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'bundle.patch 缺失');
    assert(pkg.dsh.client && pkg.dsh.client.platform === 'web', 'client.platform 必须是 web');
    assert(Array.isArray(pkg.dsh.client.inject), 'client.inject 必须是数组');
  });

  await check('cordis.patch.yml 结构', async () => {
    const text = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
    assert(/insert:/.test(text), '缺少 insert 段');
    assert(/id:\s*web-annotate/.test(text), '缺少条目 id');
    assert(/dsh-web-annotate/.test(text), '缺少插件名');
  });

  const clientSource = await readFile(join(root, 'lib', 'client.js'), 'utf8');
  const captured = { definition: null, exports: null };

  await check('客户端模块可被加载器注册', async () => {
    globalThis.window = {
      __ModuleLoader__: {
        load(definition) {
          captured.definition = definition;
        }
      }
    };
    await import(pathToFileURL(join(root, 'lib', 'client.js')).href);
    assert(captured.definition !== null, '未调用 __ModuleLoader__.load');
    assert(captured.definition.id === 'dsh-web-annotate', '模块 id 不符');
    assert(typeof captured.definition.factory === 'function', 'factory 缺失');
  });

  await check('客户端 factory 导出 apply 与 inject', () => {
    const fakeReact = {
      createElement: () => null,
      useState: (v) => [v, () => {}],
      useEffect: () => {},
      useRef: (v) => ({ current: v }),
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn
    };
    const fakeRequire = (name) => {
      if (name === 'react') return fakeReact;
      throw new Error('unexpected require: ' + name);
    };
    captured.exports = captured.definition.factory(fakeRequire);
    assert(typeof captured.exports.apply === 'function', 'apply 未导出');
    assert(Array.isArray(captured.exports.inject), 'inject 必须是数组');
    assert(captured.exports.inject.includes('sidebarRightTabs'), 'inject 缺少 sidebarRightTabs');
  });

  await check('客户端具备批注交互要素', () => {
    assert(clientSource.includes('sidebar.right.pane.tab'), '缺少正文插槽');
    assert(clientSource.includes('dsh-resource://annotate/'), '缺少资源地址前缀');
    assert(clientSource.includes('EventSource'), '缺少帧订阅');
    assert(clientSource.includes('/pick'), '缺少元素拾取');
    assert(clientSource.includes('builtDigest'), '缺少批注汇总');
  });

  await check('客户端具备回填与框选能力', () => {
    assert(clientSource.includes('InputBridge'), '缺少输入框桥');
    assert(clientSource.includes('conversation.input.left'), '桥未挂到输入框插槽');
    assert(clientSource.includes('setDraft'), '缺少回填调用');
    assert(clientSource.includes('wa-marquee'), '缺少框选样式');
    assert(clientSource.includes('finishRegion'), '缺少框选处理');
    assert(clientSource.includes('onStageKeyDown'), '缺少按键转发');
    assert(clientSource.includes('event.ctrlKey') && clientSource.includes('event.shiftKey'), '缺少 Ctrl+Shift+. 快捷键');
    assert(clientSource.includes('Period'), '快捷键未覆盖句点键码');
    assert(clientSource.includes('notesStorageKey'), '缺少批注持久化键');
    assert(clientSource.includes('localStorage'), '缺少 localStorage 持久化');
  });

  const plugin = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);

  await check('宿主导出 name / apply / resolveUrl', () => {
    assert(plugin.name === 'web-annotate', 'name 不符');
    assert(typeof plugin.apply === 'function', 'apply 缺失');
    assert(typeof plugin.resolveUrl === 'function', 'resolveUrl 未导出');
  });

  await check('URL 补全：localhost 走 http', () => {
    const out = plugin.resolveUrl('localhost:5173');
    assert(out.ok === true, '应判定为合法');
    assert(out.url === 'http://localhost:5173/', '实际 ' + out.url);
  });

  await check('URL 补全：裸域名走 https', () => {
    const out = plugin.resolveUrl('example.com/a');
    assert(out.ok === true && out.url === 'https://example.com/a', '实际 ' + (out.url || out.error));
  });

  await check('拒绝非 http 协议与空值', () => {
    assert(plugin.resolveUrl('ftp://x.y').ok === false, 'ftp 应被拒绝');
    assert(plugin.resolveUrl('file:///c:/x').ok === false, 'file 应被拒绝');
    assert(plugin.resolveUrl('').ok === false, '空串应被拒绝');
    assert(plugin.resolveUrl('https://a.b/' + 'x'.repeat(3000)).ok === false, '超长地址应被拒绝');
  });

  const routes = [];
  plugin.apply({
    inject(deps, cb) {
      assert(deps.includes('webServer'), '应声明 webServer 依赖');
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

  await check('注册了 /api/web-annotate 前缀路由', () => {
    assert(routes.length === 1, '路由数量应为 1，实际 ' + routes.length);
    assert(routes[0].path === '/api/web-annotate', '路径不符：' + routes[0].path);
    assert(routes[0].kind === 'prefix', '类型应为 prefix');
  });

  const handler = routes[0].handler;

  function call(method, url, body) {
    return new Promise((resolveCall, rejectCall) => {
      const req = {
        method,
        url,
        on(event, cb) {
          if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
          if (event === 'end') cb();
        }
      };
      const res = {
        writeHead() {},
        write() {},
        end(text) {
          resolveCall(JSON.parse(text || '{}'));
        }
      };
      Promise.resolve(handler(req, res)).catch(rejectCall);
    });
  }

  await check('GET /health 返回 ready', async () => {
    const body = await call('GET', '/api/web-annotate/health');
    assert(body.ok === true, 'ok 应为 true');
    assert(body.data.status === 'ready', 'status 应为 ready');
    assert(body.data.viewport && body.data.viewport.width > 0, 'viewport 缺失');
  });

  await check('创建会话缺少 url 时被拒绝', async () => {
    const body = await call('POST', '/api/web-annotate/session', {});
    assert(body.ok === false, 'ok 应为 false');
    assert(/url/.test(body.error), '错误信息不符：' + body.error);
  });

  await check('创建会话遇到非 http 协议被拒绝', async () => {
    const body = await call('POST', '/api/web-annotate/session', { url: 'file:///c:/x.html' });
    assert(body.ok === false, 'ok 应为 false');
    assert(/only http/.test(body.error), '错误信息不符：' + body.error);
  });

  await check('未知会话的输入与拾取返回 404', async () => {
    const a = await call('POST', '/api/web-annotate/input', { session: 'nope', type: 'move', x: 1, y: 1 });
    assert(/unknown session/.test(a.error), 'input 错误信息不符：' + a.error);
    const b = await call('POST', '/api/web-annotate/pick', { session: 'nope', x: 1, y: 1 });
    assert(/unknown session/.test(b.error), 'pick 错误信息不符：' + b.error);
  });

  await check('非法路由返回 404', async () => {
    const body = await call('GET', '/api/web-annotate/nope');
    assert(/no route/.test(body.error), '错误信息不符：' + body.error);
  });

  console.log('');
  console.log('结果: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify 崩溃:', err);
  process.exitCode = 1;
});
