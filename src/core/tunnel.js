'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Optional "reachable from the customer's own internet": cloudflared (Cloudflare quick tunnel) makes a public https address that forwards
// to the catalog port. The program is downloaded once from Cloudflare's official GitHub release into the app's data folder; nothing is
// installed. The address changes on every start, and only what the catalog server already serves (names, posters, wish lists) goes through it.
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
// the program for a system, with the first bytes a real build starts with (Windows "MZ", Linux "\x7fELF"); other systems install cloudflared themselves
function programFor(platform, arch) {
  if (platform === 'win32') return { url: `${BASE}cloudflared-windows-amd64.exe`, magic: 'MZ' };
  if (platform === 'linux' && arch === 'x64') return { url: `${BASE}cloudflared-linux-amd64`, magic: '\x7fELF' };
  return null;
}

async function defaultDownload(url, dest, magic = 'MZ') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5_000_000 || buf.subarray(0, magic.length).toString('latin1') !== magic) throw new Error('not_a_program'); // a real build is tens of MB
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.part`, buf);
  fs.chmodSync(`${dest}.part`, 0o755);
  fs.renameSync(`${dest}.part`, dest);
}

function createTunnel({
  dir, platform = process.platform, arch = process.arch, timeoutMs = 30000,
  spawn = require('node:child_process').spawn, exists = fs.existsSync, download = defaultDownload,
}) {
  const exe = path.join(dir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  let state = { state: 'off', url: null, error: null };
  let proc = null;
  let starting = null;
  const listeners = [];
  const set = (next) => { state = { state: 'off', url: null, error: null, ...next }; for (const f of listeners) f({ ...state }); };

  async function launch(port) {
    if (!exists(exe)) {
      const program = programFor(platform, arch);
      if (!program) return { ok: false, error: 'download' };
      try { await download(program.url, exe, program.magic); } catch { return { ok: false, error: 'download' }; }
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
      const p = spawn(exe, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { windowsHide: true });
      proc = p;
      const timer = setTimeout(() => { finish({ ok: false, error: 'timeout' }); p.kill(); }, timeoutMs);
      const onData = (chunk) => {
        const m = URL_RE.exec(String(chunk));
        if (m && !done) { set({ state: 'on', url: m[0] }); finish({ ok: true, url: m[0] }); }
      };
      p.stdout?.on('data', onData);
      p.stderr?.on('data', onData);
      p.on('error', () => finish({ ok: false, error: 'no_binary' }));
      p.on('exit', () => {
        if (proc === p) proc = null;
        if (!done) finish({ ok: false, error: 'exited' });
        else if (state.state === 'on') set({}); // it died later: the address is gone
      });
    });
  }

  return {
    status: () => ({ ...state }),
    onChange: (f) => { listeners.push(f); },
    async start(port) {
      if (state.state === 'on') return { ok: true, url: state.url };
      if (starting) return starting;
      set({ state: 'starting' });
      starting = launch(port).then((r) => {
        starting = null;
        if (!r.ok) { proc?.kill(); proc = null; set({ state: 'error', error: r.error }); }
        return r;
      });
      return starting;
    },
    async stop() {
      const p = proc;
      proc = null;
      if (p) p.kill();
      set({});
    },
  };
}

module.exports = { createTunnel };
