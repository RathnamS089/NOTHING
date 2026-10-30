const root = document.getElementById('root');
if (nx.platform === 'darwin') document.body.classList.add('mac');

const BANDS = ['63', '125', '250', '500', '1k', '2k', '4k', '8k'];
const PRESETS = {
  balanced: { label: 'Balanced', curve: [0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'More bass', curve: [5, 4, 2, 1, 0, 0, 0, 0] },
  treble: { label: 'More treble', curve: [0, 0, 0, 0, 1, 3, 4, 5] },
  voice: { label: 'Voice', curve: [-2, -1, 0, 2, 3, 3, 1, 0] },
  custom: { label: 'Custom', curve: null },
};
const GESTURES = {
  play_pause: 'Play / pause', next: 'Next track', prev: 'Previous track',
  volume_up: 'Volume up', volume_down: 'Volume down', noise_control: 'Noise control',
  voice_assistant: 'Voice assistant', none: 'No action',
};
const GLYPH = { anc: '111101111', transparency: '010111010', off: '000010000' };

let state = null;
let lastJson = '';
let gestureSide = 'left';

const set = (patch) => nx.setDevice(patch).then(update);
const glyph = (mode) => `<span class="glyph${mode === 'anc' ? ' red' : ''}">${[...GLYPH[mode]].map((b) => `<i class="${b === '1' ? 'on' : ''}"></i>`).join('')}</span>`;
const sw = (key, on) => `<button class="switch${on ? ' on' : ''}" data-toggle="${key}" role="switch" aria-checked="${on}"></button>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function miniCurve(curve) {
  // 8 columns x 5 rows; light the dot closest to each band's gain.
  const cells = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 8; c++) cells.push(`<i class="${Math.round(2 - curve[c] / 3) === r ? 'on' : ''}"></i>`);
  }
  return `<span class="mini">${cells.join('')}</span>`;
}

function bandColumn(v, i, editable) {
  const target = 6 - v; // rows: +6 at top (0) ... -6 at bottom (12)
  const dots = Array.from({ length: 13 }, (_, r) => {
    let cls = '';
    if (r === target) cls = 'on';
    else if ((r > target && r < 6) || (r < target && r > 6)) cls = 'fill';
    else if (r === 6) cls = 'mid';
    return `<i class="${cls}"></i>`;
  }).join('');
  return `<div class="band">
    <span class="val">${v > 0 ? '+' : ''}${v}</span>
    <div class="col">${dots}${editable ? `<input type="range" min="-6" max="6" step="1" value="${v}" data-band="${i}" aria-label="${BANDS[i]} Hz">` : ''}</div>
    <span class="label">${BANDS[i]}</span>
  </div>`;
}

function emptyView() {
  return `<div class="empty">
    <span class="scan">${'<i></i>'.repeat(9)}</span>
    <h1>NO BUDS</h1>
    <p>Connect your Nothing or CMF earbuds in your system's Bluetooth settings. The island appears the moment they connect.</p>
    <span class="label">Watching Bluetooth…</span>
  </div>`;
}

function deviceView() {
  const { device: d, settings: s, prefs } = state;
  const f = d.model?.features || {};
  const brand = d.model?.brand || 'nothing';
  const b = d.battery || {};
  const cells = [['Left', b.left], ['Right', b.right], ['Case', b.case]].filter(([, v]) => v != null);
  if (!cells.length) cells.push(['Battery', b.main]);
  const curve = s.eqPreset === 'custom' ? s.eqCustom : PRESETS[s.eqPreset]?.curve || PRESETS.balanced.curve;
  const g = s.gestures[gestureSide];

  const hero = `<section class="hero">
    <span class="label status">${state.demo ? 'Connected · demo' : 'Connected'}</span>
    <h1><span class="brandmark">${brand === 'cmf' ? 'CMF BY NOTHING' : 'NOTHING'}</span>${esc(d.model?.name || d.name)}</h1>
    <div class="stage">
      ${NX.bud({ side: 'left', brand, size: 120 })}${NX.bud({ side: 'right', brand, size: 120 })}
    </div>
    <div class="battery" style="--n:${cells.length}">
      ${cells.map(([k, v]) => `<div class="cell"><span class="label">${k}</span><b>${NX.fmt(v)}${v != null ? '<small>%</small>' : ''}</b>${NX.dots(v)}</div>`).join('')}
      ${b.left == null && b.right == null && b.main == null ? '<span class="note">Your OS doesn\'t report battery for these buds yet.</span>' : ''}
    </div>
  </section>`;

  const noise = f.anc ? `<section class="card" id="noise">
    <h2>Noise control <span class="label">${NX.ANC_LABEL[s.anc]}</span></h2>
    <div class="seg" style="--n:3">
      ${['anc', 'transparency', 'off'].map((m) => `<button class="${s.anc === m ? 'on' : ''}" data-anc="${m}">${glyph(m)}${NX.ANC_LABEL[m]}</button>`).join('')}
    </div>
    ${s.anc === 'anc' && f.ancLevels ? `<div class="seg small" style="--n:${f.ancLevels.length}">
      ${f.ancLevels.map((l) => `<button class="${s.ancLevel === l ? 'on' : ''}" data-level="${l}">${l}</button>`).join('')}
    </div>` : ''}
  </section>` : '';

  const eq = f.eq ? `<section class="card" id="eq">
    <h2>Equaliser <span class="label">${PRESETS[s.eqPreset]?.label || ''}</span></h2>
    <div class="presets">
      ${Object.entries(PRESETS).map(([k, p]) => `<button class="preset${s.eqPreset === k ? ' on' : ''}" data-eq="${k}">${miniCurve(p.curve || s.eqCustom)}${p.label}</button>`).join('')}
    </div>
    <div class="eqgraph">${curve.map((v, i) => bandColumn(v, i, s.eqPreset === 'custom')).join('')}</div>
    ${s.eqPreset !== 'custom' ? '<span class="label">Choose Custom to drag each band</span>' : ''}
  </section>` : '';

  const bass = f.bass ? `<section class="card" id="bass">
    <div class="rows">
      <div class="row"><div class="txt">Ultra Bass<small>Deeper low end, tuned per level</small></div>${sw('bass', s.bass.on)}</div>
      ${s.bass.on ? `<div class="row"><span class="label">Level</span><div class="levels">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="${n <= s.bass.level ? 'on' : ''}" data-bass="${n}" aria-label="Level ${n}"><i></i></button>`).join('')}
      </div></div>` : ''}
    </div>
  </section>` : '';

  const gestures = `<section class="card" id="gestures">
    <h2>Gestures</h2>
    <div class="seg small" style="--n:2">
      ${['left', 'right'].map((side) => `<button class="${gestureSide === side ? 'on' : ''}" data-side="${side}">${side} bud</button>`).join('')}
    </div>
    <div class="rows">
      ${[['double', 'Double pinch'], ['triple', 'Triple pinch'], ['hold', 'Pinch & hold']].map(([k, label]) => `
        <div class="row"><div class="txt">${label}</div>
          <select data-gesture="${k}">${Object.entries(GESTURES).map(([v, l]) => `<option value="${v}"${g[k] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        </div>`).join('')}
    </div>
  </section>`;

  const more = `<section class="card" id="settings">
    <h2>Settings</h2>
    <div class="rows">
      ${f.lowLag ? `<div class="row"><div class="txt">Low lag mode<small>Lower latency for games and video</small></div>${sw('lowLag', s.lowLag)}</div>` : ''}
      <div class="row"><div class="txt">In-ear detection<small>Pause when you take a bud out</small></div>${sw('inEar', s.inEar)}</div>
      ${f.dual ? `<div class="row"><div class="txt">Dual connection<small>Stay paired to two devices</small></div>${sw('dual', s.dual)}</div>` : ''}
    </div>
  </section>`;

  const find = `<section class="card" id="find">
    <h2>Find my earbuds</h2>
    <div class="btn-row">
      <button class="btn" data-ring="left">Ring left</button>
      <button class="btn" data-ring="right">Ring right</button>
    </div>
  </section>`;

  const island = `<section class="card" id="island">
    <h2>Island &amp; app</h2>
    <div class="rows">
      <div class="row"><div class="txt">Dynamic island<small>Show the island when buds connect</small></div>${sw('island', prefs.island.enabled)}</div>
      <div class="row"><div class="txt">Appearance</div>
        <select data-theme-select>${['system', 'dark', 'light'].map((t) => `<option value="${t}"${prefs.theme === t ? ' selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
      </div>
    </div>
  </section>`;

  const info = `<section class="card" id="info">
    <h2>Device</h2>
    <div class="rows">
      <div class="row"><span class="label">Name</span><span class="mono">${esc(d.name)}</span></div>
      <div class="row"><span class="label">Address</span><span class="mono">${esc(d.address)}</span></div>
      ${d.firmware ? `<div class="row"><span class="label">Firmware</span><span class="mono">${esc(d.firmware)}</span></div>` : ''}
    </div>
    ${state.live ? '' : '<div class="notice">Settings are saved on this computer. Sending them to the buds needs the direct earbud link (RFCOMM bridge), which isn\'t active yet.</div>'}
  </section>`;

  return `<div class="grid">${hero}<div class="panels">${noise}${eq}${bass}${gestures}${more}${find}${island}${info}</div></div>`;
}

function render() {
  const d = state?.device;
  document.documentElement.dataset.brand = d?.model?.brand || 'nothing';
  NX.applyTheme(state?.prefs);
  const top = root.scrollTop;
  root.innerHTML = d ? deviceView() : emptyView();
  root.scrollTop = top;
}

function update(s) {
  const json = JSON.stringify(s);
  if (json === lastJson) return;
  lastJson = json;
  state = s;
  render();
}

root.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || !state?.device) return;
  const s = state.settings;
  if (t.dataset.anc) set({ anc: t.dataset.anc });
  else if (t.dataset.level) set({ ancLevel: t.dataset.level });
  else if (t.dataset.eq) set({ eqPreset: t.dataset.eq });
  else if (t.dataset.bass) set({ bass: { ...s.bass, level: +t.dataset.bass } });
  else if (t.dataset.side) { gestureSide = t.dataset.side; render(); }
  else if (t.dataset.ring) {
    nx.ring(t.dataset.ring);
    t.textContent = 'Ringing…';
    setTimeout(() => (t.textContent = `Ring ${t.dataset.ring}`), 2500);
  } else if (t.dataset.toggle) {
    const k = t.dataset.toggle;
    if (k === 'island') nx.setPrefs({ island: { ...state.prefs.island, enabled: !state.prefs.island.enabled } }).then(update);
    else if (k === 'bass') set({ bass: { ...s.bass, on: !s.bass.on } });
    else set({ [k]: !s[k] });
  }
});

root.addEventListener('input', (e) => {
  // Live-preview the dragged band without a round trip; commit on `change`.
  const t = e.target;
  if (t.dataset.band == null) return;
  const v = +t.value;
  const band = t.closest('.band');
  band.querySelector('.val').textContent = `${v > 0 ? '+' : ''}${v}`;
  band.querySelectorAll('.col i').forEach((dot, r) => {
    const target = 6 - v;
    dot.className = r === target ? 'on' : (r > target && r < 6) || (r < target && r > 6) ? 'fill' : r === 6 ? 'mid' : '';
  });
});

root.addEventListener('change', (e) => {
  const t = e.target;
  const s = state?.settings;
  if (t.dataset.band != null) {
    const eqCustom = [...s.eqCustom];
    eqCustom[+t.dataset.band] = +t.value;
    set({ eqCustom });
  } else if (t.dataset.gesture) {
    set({ gestures: { ...s.gestures, [gestureSide]: { ...s.gestures[gestureSide], [t.dataset.gesture]: t.value } } });
  } else if (t.hasAttribute('data-theme-select')) {
    nx.setPrefs({ theme: t.value }).then(update);
  }
});

document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => nx.win(b.dataset.win)));

function navigate(section) {
  const el = section && document.getElementById(section.replace('#', ''));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

nx.onState(update);
nx.onNavigate(navigate);
nx.getState().then((s) => { update(s); navigate(location.hash); });
