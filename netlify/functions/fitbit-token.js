exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let code, redirect_uri;
  try {
    ({ code, redirect_uri } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  if (!code || !redirect_uri) {
    return { statusCode: 400, body: 'Missing code or redirect_uri' };
  }

  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { statusCode: 500, body: 'Fitbit credentials not configured' };
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri,
  });

  const response = await fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await response.json();

  return {
    statusCode: response.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
};
