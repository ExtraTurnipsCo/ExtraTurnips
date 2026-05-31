exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const params = new URLSearchParams(event.body);
  const password = params.get('password');
  const isAdmin = password === process.env.ADMIN_PASSWORD;

  const submission = {
    name: params.get('name'),
    location: params.get('location'),
    date: new Date().toLocaleDateString('en-CA', { month: 'short', year: 'numeric' }),
    type: params.get('type'),
    note: params.get('note'),
    submitter: params.get('submitter'),
    taste: parseFloat(params.get('taste')),
    value: parseFloat(params.get('value')),
    experience: parseFloat(params.get('experience')),
    isAdmin: isAdmin
  };

  // Send to Netlify Forms
  return {
    statusCode: 200,
    body: JSON.stringify({
      isAdmin: isAdmin,
      submission: submission
    })
  };
};
