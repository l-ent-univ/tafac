export async function connect({ desktop = false } = {}) {
  const tabs = await (await fetch(process.env.TOUR_CDP_URL || 'http://localhost:9223/json')).json()
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(r => ws.onopen = r)
  let id = 0; const pending = new Map(); const listeners = []; const errors = []
  ws.onmessage = (m) => { const d = JSON.parse(m.data)
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.slice(0, 200))
    if (d.method) listeners.forEach((l) => l(d))
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; const timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)) }, 15000); pending.set(i, result => { clearTimeout(timer); if (result.error) reject(new Error(JSON.stringify(result.error))); else resolve(result) }); ws.send(JSON.stringify({ id: i, method, params })) })
  const evalJs = async (e) => { const result = (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result; if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result?.result?.value }
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  await send('Emulation.setDeviceMetricsOverride', { width: desktop ? 1280 : 390, height: desktop ? 800 : 797, deviceScaleFactor: desktop ? 1.5 : 2, mobile: !desktop })
  await send('Emulation.setTouchEmulationEnabled', { enabled: !desktop, maxTouchPoints: 5 })
  if (!desktop) await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
  await send('Runtime.enable'); await send('Page.enable')
  const tap = async (x, y) => { if (desktop) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); return } await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await wait(60); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
  const center = (expr) => evalJs(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const tabByText = (text) => `[...document.querySelectorAll('nav button, nav a')].find(e => e.getBoundingClientRect().width && (e.innerText.trim().startsWith(${JSON.stringify(text)}) || e.getAttribute('aria-label')?.startsWith(${JSON.stringify(text)})))`
  return { ws, send, evalJs, wait, tap, center, tabByText, listeners, errors }
}
