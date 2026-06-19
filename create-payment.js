// Netlify Function — Proxy sécurisé GeniusPay
// Node.js 18+ : fetch natif disponible
// Node.js < 18 : fallback vers https natif

const GENIUS_API = 'pay.genius.ci';
const GENIUS_PATH = '/api/v1/merchant/payments';

// Appel HTTPS natif Node.js (compatible toutes versions)
function geniusPayRequest(pk, sk, payload) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const body = JSON.stringify(payload);

    const options = {
      hostname: GENIUS_API,
      path:     GENIUS_PATH,
      method:   'POST',
      headers: {
        'X-API-Key':     pk,
        'X-API-Secret':  sk,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          reject(new Error('Réponse GeniusPay invalide: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', (e) => reject(new Error('Connexion GeniusPay échouée: ' + e.message)));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout GeniusPay (10s)')); });
    req.write(body);
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  const PK = process.env.GENIUS_PK;
  const SK = process.env.GENIUS_SK;

  if (!PK || !SK) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: 'Variables d\'environnement manquantes',
        detail: 'Configurez GENIUS_PK et GENIUS_SK dans Netlify → Site configuration → Environment variables'
      })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const payload = {
      amount:      body.amount || 5000,
      currency:    'XOF',
      description: body.description || 'RestoFlow AI — Abonnement mensuel',
    };

    if (body.success_url) payload.success_url = body.success_url;
    if (body.error_url)   payload.error_url   = body.error_url;
    if (body.customer)    payload.customer     = body.customer;
    if (body.metadata)    payload.metadata     = body.metadata;

    const { status, data: gpData } = await geniusPayRequest(PK, SK, payload);

    if (!gpData.success) {
      return {
        statusCode: status || 400,
        headers: CORS,
        body: JSON.stringify({
          error:   gpData.message || gpData.error || 'Erreur GeniusPay',
          details: gpData
        })
      };
    }

    const checkoutUrl = gpData.data?.checkout_url || gpData.data?.payment_url;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        success:      true,
        checkout_url: checkoutUrl,
        payment_url:  gpData.data?.payment_url,
        reference:    gpData.data?.reference,
        amount:       gpData.data?.amount,
        fees:         gpData.data?.fees
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error:   'Erreur serveur interne',
        details: err.message
      })
    };
  }
};
