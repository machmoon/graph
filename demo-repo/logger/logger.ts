export function logRequest(req: Request) {
  console.log(JSON.stringify({ type: 'request', method: req.method, path: req.path, ts: Date.now() }));
}

export function logAuth(userId: string, action: string) {
  console.log(JSON.stringify({ type: 'auth', userId, action, ts: Date.now() }));
}

export function logEvent(event: string, data?: any) {
  console.log(JSON.stringify({ type: 'event', event, ...data, ts: Date.now() }));
}
