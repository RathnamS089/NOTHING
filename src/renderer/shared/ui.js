// Shared render helpers for the island and the companion window.

window.NX = (() => {
  const ANC_LABEL = { anc: 'Noise cancellation', transparency: 'Transparency', off: 'Off' };
  const ANC_SHORT = { anc: 'ANC', transparency: 'Transp.', off: 'Off' };

  function dots(pct, count = 10) {
    const on = pct == null ? 0 : Math.max(1, Math.round(pct / (100 / count)));
    const low = pct != null && pct <= 20;
    return `<span class="dots${low ? ' low' : ''}">${Array.from({ length: count }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  const fmt = (pct) => (pct == null ? '—' : `${pct}`);

  // Summary level for compact displays: weakest bud, else the single reported value.
  function level(battery) {
    if (!battery) return null;
    const buds = [battery.left, battery.right].filter((v) => v != null);
    return buds.length ? Math.min(...buds) : battery.main;
  }

  // Line-art earbud. Nothing models are drawn transparent with visible internals
  // and the red/white side dots; CMF models are solid with the accent dial.
  function bud({ side = 'left', brand = 'nothing', size = 120 } = {}) {
    const flip = side === 'right' ? 'scale(-1,1) translate(-120,0)' : '';
    const nothing = brand !== 'cmf';
    const shell = nothing ? 'rgba(255,255,255,0.06)' : 'var(--bud-solid, #3a3a3a)';
    const stroke = nothing ? 'var(--bud-line, rgba(255,255,255,0.55))' : 'var(--bud-line, rgba(255,255,255,0.25))';
    const sideDot = side === 'right' ? 'var(--red)' : '#ffffff';
    const internals = nothing
      ? `<rect x="54" y="74" width="14" height="66" rx="7" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="2 3"/>
         <circle cx="61" cy="88" r="2.4" fill="${stroke}"/><circle cx="61" cy="100" r="2.4" fill="${stroke}"/><circle cx="61" cy="112" r="2.4" fill="${stroke}"/>
         <circle cx="61" cy="146" r="4" fill="${sideDot}"/>`
      : `<circle cx="54" cy="48" r="9" fill="none" stroke="var(--accent)" stroke-width="3"/>`;
    return `<svg viewBox="0 0 120 170" width="${size}" height="${Math.round(size * 1.42)}" aria-hidden="true">
      <g transform="${flip}">
        <path d="M30 40c0-20 16-32 34-32s30 12 30 30c0 14-8 24-18 28v80c0 9-6 14-14 14s-14-5-14-14V70C38 66 30 56 30 40z"
              fill="${shell}" stroke="${stroke}" stroke-width="1.5"/>
        <ellipse cx="84" cy="44" rx="13" ry="16" fill="${shell}" stroke="${stroke}" stroke-width="1.5"/>
        ${internals}
      </g>
    </svg>`;
  }

  function applyTheme(prefs) {
    const t = prefs?.theme || 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = t;
  }

  return { ANC_LABEL, ANC_SHORT, dots, fmt, level, bud, applyTheme };
})();
