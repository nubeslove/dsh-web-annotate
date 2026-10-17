// 生成 README 用的界面示意图。
//
// 不是 DSH 真实运行截图：把 lib/client.js 的工具栏、画面区、批注列表样式复刻到
// HTML 后渲染。页面内容是示意用的假数据。
//
// 运行前需要能解析到 playwright：脚本默认从 DSH profile 目录解析，
// 可用 DSH_HOME / DSH_PROFILE 环境变量覆盖。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const docsDir = join(root, 'docs');

const profileHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const profileEnv = process.env.DSH_PROFILE;
const profile = !profileEnv
  ? join(profileHome, 'profiles', 'desktop')
  : isAbsolute(profileEnv)
    ? profileEnv
    : join(profileHome, 'profiles', profileEnv);

const req = createRequire(join(profile, 'package.json'));
const { chromium } = req('playwright');

const pagePath = new URL('./demo/annotate.html', import.meta.url).href;

async function main() {
  await mkdir(docsDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 760, height: 620 },
    deviceScaleFactor: 2
  });
  await page.goto(pagePath, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  await page.locator('#shot-annotate').screenshot({ path: join(docsDir, 'annotate.png') });
  console.log('wrote', join(docsDir, 'annotate.png'));

  await browser.close();
}

main().catch((err) => {
  console.error('生成截图失败:', err);
  process.exitCode = 1;
});
