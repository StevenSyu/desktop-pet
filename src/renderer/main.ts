const app = document.querySelector<HTMLDivElement>('#app')!
app.textContent = `renderer ok: ${(window as unknown as { petBridge?: { ping(): string } }).petBridge?.ping() ?? 'no bridge'}`
