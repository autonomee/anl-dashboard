const crypto = require('crypto');

const DOCUSIGN_AUTH_SERVER = 'account-d.docusign.com';
const DOCUSIGN_BASE_URL = 'https://demo.docusign.net/restapi';

function createJWT(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = Buffer.from(JSON.stringify({
    iss: process.env.DOCUSIGN_INTEGRATION_KEY,
    sub: userId || process.env.DOCUSIGN_USER_ID,
    aud: DOCUSIGN_AUTH_SERVER,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation'
  })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const signInput = `${header}.${body}`;
  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, '\n');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${signInput}.${signature}`;
}

async function getAccessToken(userId) {
  const jwt = createJWT(userId);
  const res = await fetch(`https://${DOCUSIGN_AUTH_SERVER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DocuSign auth failed: ${res.status} — ${err}`);
  }
  return (await res.json()).access_token;
}

async function getAccountInfo(accessToken) {
  const res = await fetch(`https://${DOCUSIGN_AUTH_SERVER}/oauth/userinfo`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed to get user info');
  const info = await res.json();
  const account = info.accounts?.find(a => a.is_default) || info.accounts?.[0];
  return {
    accountId: account?.account_id,
    baseUri: account?.base_uri,
    userId: info.sub
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { documentBase64, documentName, signerName, signerEmail, ccName, ccEmail, action } = req.body;

    // --- ACTION: consent URL ---
    if (action === 'consent-url') {
      const url = `https://${DOCUSIGN_AUTH_SERVER}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${process.env.DOCUSIGN_INTEGRATION_KEY}&redirect_uri=${encodeURIComponent(req.headers.origin || 'https://anl-dashboard.vercel.app')}`;
      return res.status(200).json({ url });
    }

    // --- ACTION: test connection ---
    if (action === 'test') {
      const accessToken = await getAccessToken();
      const info = await getAccountInfo(accessToken);
      return res.status(200).json({ success: true, accountId: info.accountId, userId: info.userId });
    }

    // --- ACTION: send envelope ---
    if (!documentBase64 || !signerEmail || !signerName) {
      return res.status(400).json({ error: 'Missing required fields: documentBase64, signerName, signerEmail' });
    }

    const accessToken = await getAccessToken();
    const info = await getAccountInfo(accessToken);
    const baseUri = info.baseUri || DOCUSIGN_BASE_URL;
    const accountId = info.accountId;

    if (!accountId) {
      return res.status(500).json({ error: 'Could not determine DocuSign account. Grant consent first.' });
    }

    const envelope = {
      emailSubject: `Letter of Intent — ${documentName || 'LOI'}`,
      emailBlurb: 'Please review and sign the attached Letter of Intent from American Net Lease.',
      documents: [{
        documentBase64,
        name: (documentName || 'Letter_of_Intent') + '.docx',
        fileExtension: 'docx',
        documentId: '1'
      }],
      recipients: {
        signers: [{
          email: signerEmail,
          name: signerName,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [{
              documentId: '1',
              anchorString: '{{BUYER_SIGN}}',
              anchorYOffset: '0',
              anchorXOffset: '0',
              anchorUnits: 'pixels'
            }],
            dateSignedTabs: [{
              documentId: '1',
              anchorString: '{{BUYER_DATE}}',
              anchorYOffset: '0',
              anchorXOffset: '0',
              anchorUnits: 'pixels'
            }],
            fullNameTabs: [{
              documentId: '1',
              anchorString: '{{BUYER_NAME}}',
              anchorYOffset: '0',
              anchorXOffset: '0',
              anchorUnits: 'pixels'
            }]
          }
        }],
        carbonCopies: ccEmail ? [{
          email: ccEmail,
          name: ccName || ccEmail,
          recipientId: '2',
          routingOrder: '2'
        }] : []
      },
      status: 'sent'
    };

    const envRes = await fetch(`${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envelope)
    });

    const envData = await envRes.json();
    if (!envRes.ok) {
      return res.status(envRes.status).json({
        error: envData.message || 'Failed to send envelope',
        details: envData
      });
    }

    return res.status(200).json({
      success: true,
      envelopeId: envData.envelopeId,
      status: envData.status
    });

  } catch (error) {
    console.error('DocuSign error:', error);
    return res.status(500).json({ error: error.message });
  }
};
