import assert from 'node:assert/strict';
export async function enterDevice(w) {
  for (let i = 0; i < 200; i++) {
    const button = [...w.document.querySelectorAll('button')].find(b => b.textContent.includes('Use Device Memory'));
    if (button) { button.click(); return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Expected the startup login page');
}
