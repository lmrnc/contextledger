export function ledgerClient(url, tokens) {
  return async (path, identity, body) => {
    const response = await fetch(url + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(identity && { authorization: 'Bearer ' + (tokens[identity] || identity) })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45000)
    });
    return { http: response.status, body: await response.json() };
  };
}
