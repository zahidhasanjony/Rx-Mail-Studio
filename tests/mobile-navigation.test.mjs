import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const styles = ['styles.css', 'theme.css'].map(file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'));
const fixture = `<header class="topbar"><div class="breadcrumbs"><button class="icon-button mobile-only">Menu</button><strong>Source files</strong></div><div class="top-actions"><button class="mode-pill cloud-dot"><span class="status-dot"></span></button><span class="account-identity">ZHD<small>Admin</small></span><button class="button text top-account-action">Sign out</button></div></header><nav class="mobile-bottom"><button><svg></svg><span>Generate</span></button><button class="active"><svg></svg><span>Sources</span></button><button><svg></svg><span>Hierarchy</span></button><button><svg></svg><span>Settings</span></button></nav>`;

function preview(width, state = '') {
  const parse = new JSDOM('<!doctype html><head></head><body></body>');
  let css = '';
  for (const source of styles) {
    const element = parse.window.document.createElement('style'); element.textContent = source;
    parse.window.document.head.append(element);
    const walk = rules => { for (const rule of rules) {
      if (rule.type === 4) {
        const min = rule.conditionText.match(/min-width:\s*(\d+)px/), max = rule.conditionText.match(/max-width:\s*(\d+)px/);
        if ((!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))) walk(rule.cssRules);
      } else if (rule.type === 1) css += rule.cssText + '\n';
    }};
    walk(element.sheet.cssRules);
  }
  parse.window.close();
  // Model interaction states as classes so jsdom can resolve the same cascaded rules.
  css = css.replaceAll(':focus-visible', '.test-focus').replaceAll(':hover', '.test-hover').replaceAll(':active', '.test-pressed');
  const dom = new JSDOM(`<!doctype html><head><style>${css}</style></head><body>${fixture}</body>`);
  const active = dom.window.document.querySelector('.mobile-bottom button.active');
  if (state) active.classList.add(state);
  if (state) for (const control of dom.window.document.querySelectorAll('.topbar button')) control.classList.add(state);
  return dom;
}
function color(dom, value) {
  if (value.startsWith('var(')) return color(dom, dom.window.getComputedStyle(dom.window.document.documentElement).getPropertyValue(value.slice(4, -1)).trim());
  if (value === 'white') return [255, 255, 255];
  if (value.startsWith('#')) { const hex = value.slice(1); return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)); }
  const rgb = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  assert.ok(rgb?.length === 3, 'Expected an opaque resolved colour, got ' + value);
  return rgb;
}
function contrast(a, b) {
  const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}

test('mobile top bar is compact and header plus selected navigation remain readable through taps and focus', () => {
  for (const width of [320, 390, 740]) for (const state of ['', 'test-hover', 'test-focus', 'test-pressed']) {
    const dom = preview(width, state), w = dom.window, doc = w.document;
    try {
      assert.equal(w.getComputedStyle(doc.querySelector('.topbar')).height, '52px');
      assert.equal(w.getComputedStyle(doc.querySelector('.topbar')).flexWrap, 'nowrap');
      const background = color(dom, w.getComputedStyle(doc.querySelector('.topbar')).backgroundColor);
      for (const selector of ['.breadcrumbs strong', '.account-identity', '.account-identity small', '.top-account-action'])
        assert.ok(contrast(color(dom, w.getComputedStyle(doc.querySelector(selector)).color), background) >= 4.5, selector + ' must remain legible');
      const menuStyle = w.getComputedStyle(doc.querySelector('.breadcrumbs .icon-button'));
      const menuBackground = /transparent|rgba\([^)]*,\s*0\)/.test(menuStyle.backgroundColor) ? background : color(dom, menuStyle.backgroundColor);
      assert.ok(contrast(color(dom, menuStyle.color), menuBackground) >= 4.5, 'Menu stays visible while tapping');
      assert.notEqual(w.getComputedStyle(doc.querySelector('.cloud-dot .status-dot')).display, 'none');
      const active = doc.querySelector('.mobile-bottom button.active'), style = w.getComputedStyle(active);
      assert.ok(contrast(color(dom, style.color), color(dom, style.backgroundColor)) >= 4.5, 'Active item contrast during ' + (state || 'selection'));
      for (const child of active.querySelectorAll('svg,span')) assert.equal(w.getComputedStyle(child).color, style.color);
    } finally { w.close(); }
  }
});
test('compact-header changes stay inside the mobile breakpoint', () => {
  const dom = preview(1280);
  try {
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.topbar')).height, '73px');
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.mobile-bottom')).display, 'none');
  } finally { dom.window.close(); }
});
