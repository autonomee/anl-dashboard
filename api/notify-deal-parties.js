// Notify #anl-transactions about suggested deal party contacts
// Called from frontend after PSA scan or smart defaults populate contacts
// Requires SLACK_WEBHOOK_URL env var

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  if (!SLACK_WEBHOOK_URL) return res.status(200).json({ skipped: true, reason: 'No webhook configured' });

  const { dealName, contacts, source } = req.body;
  if (!dealName || !contacts || contacts.length === 0) {
    return res.status(200).json({ skipped: true, reason: 'No contacts to notify about' });
  }

  try {
    const contactLines = contacts.map(c =>
      `• *${c.role}*: ${c.name}${c.company ? ` (${c.company})` : ''}${c.source ? ` — _found in ${c.source}_` : ''}`
    ).join('\n');

    const sourceLabel = source === 'psa_scan' ? 'PSA Document Scan' :
                        source === 'smart_default' ? 'Smart Defaults' : 'Auto-Detection';

    const message = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🔍 Deal Party Suggestions — ${dealName}` }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Source:* ${sourceLabel}\n\nI found the following contacts that may be involved in this deal:\n\n${contactLines}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '👉 *Please review in <https://anl-dashboard.vercel.app|Mission Control>* — open the deal and check the Deal Party Contacts section. Confirm or remove any incorrect suggestions.'
          }
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '_Suggested contacts are marked with a ⚡ icon until confirmed._' }]
        }
      ]
    };

    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Slack notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
