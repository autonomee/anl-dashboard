// PSA Document Scanner — Extracts critical dates using Claude AI
// Vercel Serverless Function
// Requires ANTHROPIC_API_KEY env var

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { documentBase64, documentName } = req.body;
  if (!documentBase64) return res.status(400).json({ error: 'documentBase64 is required' });

  const isPDF = (documentName || '').toLowerCase().endsWith('.pdf');

  try {
    // Build the message content
    const content = [];

    if (isPDF) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: documentBase64
        }
      });
    } else {
      // For DOCX, we send the base64 and ask Claude to parse it
      content.push({
        type: 'text',
        text: `The following is a base64-encoded DOCX file named "${documentName}". Decode and analyze its contents.`
      });
      content.push({
        type: 'text',
        text: `Base64 content (first 50000 chars): ${documentBase64.substring(0, 50000)}`
      });
    }

    content.push({
      type: 'text',
      text: `You are analyzing a Purchase and Sale Agreement (PSA) for a commercial real estate NNN (triple net lease) property transaction.

Extract the following critical date milestones from the document. For each milestone found, provide:
- milestone: the key (must be one of: effective_date, rofo, earnest_deposit, financing_contingency, inspection_period, title_commitment, buyer_title_objections, tenant_estoppel, closing_date)
- due_date: the actual date in YYYY-MM-DD format (calculate from the effective date if given as "X days after effective date")
- calculation_notes: how the date is calculated (e.g., "10 business days after Effective Date", "45 days from contract execution")
- psa_section: the section reference in the PSA (e.g., "Section 3.1", "§4.2")

The 9 milestones to look for:
1. Effective Date of Contract — when the contract becomes effective
2. ROFO — Right of First Offer deadline
3. Buyer's Earnest Deposit — when earnest money is due
4. Financing Contingency — deadline for financing approval
5. Inspection Period — property inspection deadline
6. Title Commitment — when title commitment is due
7. Buyer's Title Objections — deadline for title objection
8. Tenant Estoppel — tenant estoppel certificate deadline
9. Closing Date — scheduled closing date

Return ONLY valid JSON (no markdown, no code fences) in this format:
{
  "milestones": [
    {
      "milestone": "effective_date",
      "due_date": "2026-04-01",
      "calculation_notes": "Date of last signature",
      "psa_section": "Section 1.1"
    }
  ]
}

Only include milestones you can find or calculate from the document. If a date is described relative to another date (e.g., "10 days after Effective Date"), calculate the actual date if the reference date is known. If not, include the calculation notes without a due_date.`
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return res.status(500).json({ error: `API error: ${response.status}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from response (strip code fences if present)
    const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(jsonStr);

    return res.status(200).json(result);

  } catch (err) {
    console.error('PSA scan error:', err);
    return res.status(500).json({ error: err.message });
  }
}
