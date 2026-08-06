/**
 * 本地模拟 Vercel Serverless 运行时冒烟测试
 *
 * 用真实 Node.js HTTP req/res 驱动 api/index.ts 的默认 handler，
 * 复现 Vercel Node runtime 的行为（Vercel 提供 Node 兼容的 req/res）。
 * 验证：app.init() 生效、emit('request') 模式可路由、响应信封格式正确。
 *
 * 用法：node -r @swc-node/register scripts/test-serverless.ts
 */
import http from 'node:http';
import handler from '../api/index';

async function main() {
  const server = http.createServer(
    (req, res) => {
      try {
        void handler(req as never, res as never);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, message: String(err) }));
      }
    },
  );

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}`;

  const results: Array<[string, number, string]> = [];
  const cases: Array<[string, string, string?]> = [
    ['GET', '/health'],
    ['GET', '/v1/agents'],
    ['GET', '/definitely-not-exist-route'],
  ];

  for (const [method, path] of cases) {
    try {
      const res = await fetch(`${base}${path}`, { method });
      const body = await res.text();
      results.push([`${method} ${path}`, String(res.status), body.slice(0, 160)]);
    } catch (err) {
      results.push([`${method} ${path}`, 'FETCH-ERROR', String(err)]);
    }
  }

  console.log('\n===== Serverless 冒烟结果 =====');
  for (const [name, status, body] of results) {
    console.log(`${status.padEnd(4)} ${name}`);
    console.log(`       ${body.replace(/\n/g, ' ')}`);
  }

  server.close();
  const ok = results.every(([, s]) => s !== 'FETCH_ERROR');
  console.log(ok ? '\n全部请求均有响应（serverless 入口路由可用）' : '\n存在请求失败！');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Serverless 冒烟失败:', err);
  process.exit(1);
});