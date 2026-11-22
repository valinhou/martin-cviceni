/* =====================================================================
   claude-chat.js – okno pro úpravy aplikace s Claudem.
   Zprávy jdou přes „most“ (server na PC, Tailscale Funnel) do Claude session,
   která aplikaci upraví a nasadí. Aplikace se pak sama obnoví na novou verzi.
   Adresa mostu a klíč jsou jen v tomto zařízení (localStorage), ne v kódu.
   ===================================================================== */
'use strict';
(function () {
  const CFG_KEY = 'martin_claude_most', SEEN_KEY = 'martin_claude_seen', DRAFT_KEY = 'martin_claude_draft', REOPEN_KEY = 'martin_claude_reopen';
  let cfg = null, msgs = [], stav = { stav: 'ceka' }, open = false, pollH = null, sending = false, online = null, verze = null;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function loadCfg() { try { const c = JSON.parse(ls(CFG_KEY) || 'null'); return c && c.url && c.klic ? c : null; } catch (e) { return null; } }

  /* párování odkazem: …/index.html#most=<base64 JSON {url, klic}> */
  // z textu s „most=…“ vytáhne {url, klic}; jinak null (výjimka = poškozený odkaz)
  function parseOdkaz(text) {
    const m = String(text || '').match(/most=([^&#\s]+)/); if (!m) return null;
    const c = JSON.parse(atob(decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/')));
    if (!c || !c.url || !c.klic) throw new Error('neúplný odkaz');
    return { url: String(c.url).replace(/\/+$/, ''), klic: String(c.klic) };
  }
  (function pair() {
    if (!/most=/.test(location.hash)) return;
    try {
      const c = parseOdkaz(location.hash);
      if (c) { ls(CFG_KEY, JSON.stringify(c)); setTimeout(() => toast('💬 Chat s Claudem je propojený ✅', 3500), 1200); }
    } catch (e) { setTimeout(() => toast('⚠️ Neplatný párovací odkaz'), 1200); }
    history.replaceState(null, '', location.pathname + location.search);
  })();
  cfg = loadCfg();

  async function api(path, opts) {
    const r = await fetch(cfg.url + path, Object.assign({ cache: 'no-store' }, opts || {}, { headers: Object.assign({ 'X-Most-Klic': cfg.klic, 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.chyba || ('HTTP ' + r.status));
    return j;
  }

  /* ------------------------- plovoucí tlačítko ------------------------- */
  function fab() {
    let b = document.getElementById('ccFab');
    if (!cfg) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('button'); b.id = 'ccFab'; b.className = 'ccfab'; b.title = 'Úpravy aplikace s Claudem'; b.onclick = openChat; document.body.appendChild(b); }
    const unread = msgs.length > (+ls(SEEN_KEY) || 0) && msgs.length && msgs[msgs.length - 1].od === 'claude';
    b.innerHTML = '💬' + (unread ? '<i></i>' : '') + (stav.stav === 'pracuje' ? '<em>⚙️</em>' : '');
    b.style.display = (typeof R !== 'undefined' && R && !R.finished) || open ? 'none' : '';
  }

  /* ------------------------------ chat okno ------------------------------ */
  function openChat() {
    open = true; ls(REOPEN_KEY, null);
    const root = document.getElementById('ccRoot');
    root.innerHTML = '<div class="ccwin"><div class="cctop"><div><b>💬 Úpravy aplikace</b><div class="tiny muted" id="ccSt"></div></div>' +
      '<button class="btn sm" onclick="ccClose()">Zavřít ✕</button></div>' +
      '<div class="ccmsgs" id="ccMsgs"></div>' +
      '<div class="ccin"><textarea id="ccTxt" rows="2" placeholder="Napiš, co mám v aplikaci změnit… (např. „Přidej na Dnes počítadlo vypitých sklenic“)"></textarea>' +
      '<button class="btn primary" id="ccSend" onclick="ccSend()">➤</button></div></div>';
    const t = document.getElementById('ccTxt');
    t.value = sessionStorage.getItem(DRAFT_KEY) || '';
    t.addEventListener('input', () => sessionStorage.setItem(DRAFT_KEY, t.value));
    t.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ccSend(); } });
    document.body.style.overflow = 'hidden';
    paint(true); poll(); restartPoll(); fab();
  }
  window.ccClose = function () { open = false; document.getElementById('ccRoot').innerHTML = ''; document.body.style.overflow = ''; restartPoll(); fab(); };

  function fmtCas(iso) { const d = new Date(iso), n = new Date(); const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); return d.toDateString() === n.toDateString() ? hm : d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + hm; }
  function paint(scroll) {
    if (!open) return;
    const box = document.getElementById('ccMsgs'); if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = (msgs.length ? '' : '<div class="note" style="text-align:center;margin:30px 10px;">Tady můžeš Claudovi psát, co v aplikaci upravit. On změny udělá a nasadí – aplikace se pak sama obnoví (asi do minuty).</div>') +
      msgs.map(m => '<div class="ccm ' + (m.od === 'ja' ? 'me' : 'cl') + '"><div>' + esc(m.text) + '</div><span>' + (m.od === 'ja' ? 'Ty' : 'Claude') + ' · ' + fmtCas(m.cas) + '</span></div>').join('') +
      (stav.stav === 'pracuje' ? '<div class="ccm cl work"><div>⚙️ ' + esc(stav.text || 'Pracuji…') + '<span class="ccdots"><b>.</b><b>.</b><b>.</b></span></div></div>' : '');
    if (scroll || atBottom) box.scrollTop = box.scrollHeight;
    const st = document.getElementById('ccSt');
    if (st) st.textContent = online === false ? '🔴 Most na PC neodpovídá (PC nebo Claude neběží?)' : online ? (stav.stav === 'pracuje' ? '🟠 Claude pracuje' : '🟢 Claude je připojený') : 'Připojuji…';
    ls(SEEN_KEY, String(msgs.length));
  }

  async function poll() {
    if (!cfg) return;
    try {
      const j = await api('/zpravy?od=' + msgs.length);
      online = true;
      const changed = j.zpravy.length || JSON.stringify(j.stav) !== JSON.stringify(stav);
      if (j.celkem < msgs.length) msgs = [];            // chat se na PC vymazal
      msgs = msgs.concat(j.zpravy); stav = j.stav || { stav: 'ceka' };
      if (changed) { paint(j.zpravy.length > 0); }
      if (!open && j.zpravy.some(m => m.od === 'claude')) toast('💬 Claude odpověděl', 3000);
    } catch (e) { online = false; paint(); }
    fab();
  }
  function restartPoll() { clearInterval(pollH); if (cfg) pollH = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, open ? 2500 : 20000); }

  window.ccSend = async function () {
    const t = document.getElementById('ccTxt'), text = (t.value || '').trim();
    if (!text || sending) return;
    sending = true; document.getElementById('ccSend').disabled = true;
    try { await api('/zprava', { method: 'POST', body: JSON.stringify({ text }) }); t.value = ''; sessionStorage.removeItem(DRAFT_KEY); await poll(); paint(true); }
    catch (e) { toast('⚠️ Neodesláno: ' + e.message, 3500); }
    sending = false; const b = document.getElementById('ccSend'); if (b) b.disabled = false;
  };

  /* ------------------------------ Nastavení ------------------------------ */
  window.chatNastCard = function () {
    return '<div class="card"><h3>💬 Úpravy aplikace s Claudem</h3>' +
      (cfg ? '<div class="small">✅ Propojeno · <span class="muted">' + esc(cfg.url) + '</span></div><div class="row" style="margin-top:10px;"><button class="btn sm" onclick="ccOpen()">Otevřít chat</button><button class="btn sm danger" onclick="ccUnpair()">Odpojit</button></div>'
        : '<div class="note">Vlož do prvního pole celý párovací odkaz z PC (soubor PAROVANI.txt ve složce claude-most) a dej Propojit. Nebo vyplň adresu a klíč ručně.</div>' +
          '<input id="ccUrl" placeholder="https://….ts.net" style="margin-top:10px;"><input id="ccKlic" type="password" placeholder="Klíč" autocomplete="off" style="margin-top:8px;"><button class="btn" style="margin-top:8px;" onclick="ccPair()">Propojit</button>') +
      '<div class="note" style="margin-top:8px;">Verze aplikace: ' + esc(verze || '?') + ' · nová verze se načte sama.</div></div>';
  };
  window.ccOpen = openChat;
  window.ccPair = function () {
    let url = ($('#ccUrl').value || '').trim().replace(/\/+$/, ''), klic = ($('#ccKlic').value || '').trim();
    // do pole jde vložit i celý párovací odkaz z PAROVANI.txt – adresa i klíč se vezmou z něj
    let z = null;
    try { z = parseOdkaz(url) || parseOdkaz(klic); } catch (e) { toast('⚠️ Neplatný párovací odkaz'); return; }
    if (z) { url = z.url; klic = z.klic; }
    if (!/^https:\/\//.test(url) || !klic) { toast('Vlož párovací odkaz, nebo vyplň https adresu i klíč'); return; }
    ls(CFG_KEY, JSON.stringify({ url, klic })); cfg = loadCfg(); renderNast(); poll(); restartPoll(); toast('Propojeno ✅');
  };
  window.ccUnpair = function () { if (!confirm('Odpojit chat s Claudem v tomto zařízení?')) return; ls(CFG_KEY, null); cfg = null; msgs = []; restartPoll(); fab(); renderNast(); };

  /* ------------------- automatická obnova na novou verzi ------------------- */
  async function zjistiVerzi() { try { const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); return (await r.json()).v || null; } catch (e) { return null; } }
  async function hlidejVerzi() {
    if (document.visibilityState !== 'visible') return;
    const v = await zjistiVerzi(); if (!v) return;
    if (!verze) { verze = v; return; }
    if (v !== verze) {
      if (typeof R !== 'undefined' && R && !R.finished) return;     // během tréninku nikdy neobnovuj
      if (open) ls(REOPEN_KEY, '1');
      toast('✨ Nová verze aplikace – načítám…', 2500);
      setTimeout(() => location.reload(), 1200);
    }
  }
  zjistiVerzi().then(v => { verze = v; if (document.querySelector('#v-nast.on')) renderNast(); });
  setInterval(hlidejVerzi, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { hlidejVerzi(); if (cfg) poll(); } });

  /* start */
  const root = document.createElement('div'); root.id = 'ccRoot'; document.body.appendChild(root);
  setInterval(fab, 1500);                       // schovat tlačítko během tréninku
  if (typeof renderNast === 'function') renderNast();
  if (cfg) { poll().then(() => { if (ls(REOPEN_KEY)) openChat(); }); restartPoll(); }
})();
