const pill = document.getElementById('pill');
const $ = (id) => document.getElementById(id);

if (nx.platform === 'darwin') document.body.classList.add('mac');

let state = null;
let collapseTimer = null;
let hideTimer = null;
let hovering = false;
let trackTimer = null;

// Three renderings of the same song glyph, at different sizes.
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d71921';
const glyphs = {
  mini: new NXGlyph.Glyph($('cMedia'), { cols: 9, rows: 3 }),
  strip: new NXGlyph.Glyph($('eGlyph'), { cols: 11, rows: 6 }),
  big: new NXGlyph.Glyph($('tGlyph'), { cols: 16, rows: 6 }),
  stripCover: new NXGlyph.Glyph($('eCover'), { cols: 1, rows: 1, coverN: 14 }),
  bigCover: new NXGlyph.Glyph($('tCover'), { cols: 1, rows: 1, coverN: 18 }),
};

const ANC_ORDER = ['anc', 'transparency', 'off'];
// Device names come from Bluetooth and can contain anything; never inject them raw.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 3x3 dot glyphs per noise mode
const GLYPH = { anc: '111101111', transparency: '010111010', off: '000010000' };

function setMode(mode) {
  pill.className = mode + (state?.track ? ' has-media' : '') + (state?.track?.cover ? ' has-cover' : '');
}

function renderTrack() {
  const t = state?.track;
  pill.classList.toggle('has-media', !!t);
  pill.classList.toggle('has-cover', !!t?.cover);
  for (const g of Object.values(glyphs)) g.set(t, accent());
  if (!t) return;
  const src = `${t.source}${t.status === 'paused' ? ' · paused' : ''}`;
  $('eSrc').textContent = src;
  $('tSrc').textContent = src;
  $('eTitle').textContent = t.title;
  $('tTitle').textContent = t.title;
  $('eArtist').textContent = t.artist;
  $('tArtist').textContent = t.artist;
}

function glyph(mode) {
  return `<span class="anc-glyph${mode === 'anc' ? ' red' : ''}">${[...GLYPH[mode]].map((b) => `<i class="${b === '1' ? 'on' : ''}"></i>`).join('')}</span>`;
}

function render() {
  const d = state?.device;
  if (!d) return;
  const s = state.settings;
  const brand = d.model?.brand || 'nothing';
  document.documentElement.dataset.brand = brand;
  const anc = d.model?.features?.anc ? s.anc : null;

  $('cGlyph').outerHTML = `<span class="anc-glyph${anc === 'anc' ? ' red' : ''}" id="cGlyph">${anc ? [...GLYPH[anc]].map((b) => `<i class="${b === '1' ? 'on' : ''}"></i>`).join('') : ''}</span>`;
  const lvl = NX.level(d.battery);
  $('cLevel').textContent = NX.fmt(lvl);
  $('cDots').innerHTML = NX.dots(lvl, 10);

  $('eBuds').innerHTML = NX.bud({ side: 'left', brand, size: 44 }) + NX.bud({ side: 'right', brand, size: 44 });
  $('eName').textContent = `${brand === 'cmf' ? 'CMF ' : ''}${d.model?.name || d.name}`;
  $('eStatus').textContent = state.demo ? 'Connected · demo' : 'Connected';

  const chip = $('eAnc');
  chip.hidden = !anc;
  if (anc) {
    chip.innerHTML = glyph(anc) + NX.ANC_SHORT[anc];
    chip.classList.toggle('active', anc !== 'off');
  }

  const b = d.battery || {};
  const cells = [['L', b.left], ['R', b.right], ['Case', b.case]].filter(([, v]) => v != null);
  if (!cells.length) cells.push(['Battery', b.main]);
  $('eBatt').innerHTML = cells.map(([k, v]) => `
    <div class="cell">
      <div class="top"><span class="label">${k}</span><b class="dot-type">${NX.fmt(v)}${v != null ? '<small>%</small>' : ''}</b></div>
      ${NX.dots(v)}
    </div>`).join('');
  // Quick switch: other paired Nothing devices, one tap to move the audio over.
  const others = (state.paired || []).filter((p) => !p.connected).slice(0, 2);
  $('eHint').innerHTML = others.length
    ? others.map((p) => `<button class="swap" data-addr="${esc(p.address)}"${state.switching ? ' disabled' : ''}>${state.switching === p.address ? 'Switching…' : '⇄ ' + esc(p.name.replace(/^(nothing|cmf)\s+/i, ''))}</button>`).join('')
    : b.left == null && b.right == null && b.main == null ? 'Battery not reported yet' : '';
  $('gName').textContent = d.model?.name || d.name;
}

function expand(autoCollapse = true) {
  clearTimeout(collapseTimer);
  clearTimeout(hideTimer);
  setMode('expanded');
  if (autoCollapse) {
    collapseTimer = setTimeout(() => !hovering && setMode('compact'), state?.prefs?.island?.autoCollapseMs || 5000);
  }
}

pill.addEventListener('mouseenter', () => {
  hovering = true;
  nx.islandInteractive(true);
  if (pill.classList.contains('compact') || pill.classList.contains('track')) expand(false);
});

pill.addEventListener('mouseleave', () => {
  hovering = false;
  nx.islandInteractive(false);
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => pill.classList.contains('expanded') && setMode('compact'), 700);
});

$('eAnc').addEventListener('click', (e) => {
  e.stopPropagation();
  const cur = state?.settings?.anc || 'off';
  nx.setDevice({ anc: ANC_ORDER[(ANC_ORDER.indexOf(cur) + 1) % ANC_ORDER.length] });
});

$('eHint').addEventListener('click', (e) => {
  const t = e.target.closest('.swap');
  if (!t) return;
  e.stopPropagation();
  nx.switchTo(t.dataset.addr);
});

$('eOpen').addEventListener('click', (e) => {
  e.stopPropagation();
  nx.openApp();
  setMode('compact');
});

nx.onState((s) => {
  state = s;
  NX.applyTheme(s.prefs);
  render();
  renderTrack();
  // Track ended while showing it: fall back to the compact pill.
  if (!s.track && pill.classList.contains('track')) setMode('compact');
});

nx.onIsland(async (ev) => {
  state = await nx.getState();
  if (ev.type === 'track') {
    // Show the new song's glyph for a moment, unless the user is mid-interaction.
    if (hovering || pill.classList.contains('hidden') || pill.classList.contains('goodbye')) return;
    renderTrack();
    clearTimeout(collapseTimer);
    clearTimeout(trackTimer);
    setMode('track');
    trackTimer = setTimeout(() => pill.classList.contains('track') && setMode('compact'), 4500);
  } else if (ev.type === 'connected') {
    render();
    // Start from a notch-sized sliver, then bloom open.
    setMode('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => expand(true)));
  } else if (ev.type === 'disconnected') {
    clearTimeout(collapseTimer);
    $('gName').textContent = ev.device.model?.name || ev.device.name;
    setMode('goodbye');
    hideTimer = setTimeout(() => {
      setMode('hidden');
      setTimeout(() => nx.islandHidden(), 500);
    }, 2600);
  }
});

nx.getState().then((s) => { state = s; NX.applyTheme(s.prefs); render(); renderTrack(); });
