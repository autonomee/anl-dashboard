// DD Document Review — AI reads PSA + Lease and flags red flags, concerns, and action items
// Vercel Serverless Function
// Requires ANTHROPIC_API_KEY env var

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb'
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { documents, dealName } = req.body;
  if (!documents || documents.length === 0) {
    return res.status(400).json({ error: 'At least one document is required' });
  }

  try {
    const content = [];

    // Add each document
    for (const doc of documents) {
      const isPDF = (doc.name || '').toLowerCase().endsWith('.pdf');

      if (isPDF) {
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: doc.base64
          }
        });
        content.push({
          type: 'text',
          text: `[Above document: ${doc.name} — Type: ${doc.docType}]`
        });
      } else {
        content.push({
          type: 'text',
          text: `Document: ${doc.name} (Type: ${doc.docType})\nBase64 content (first 50000 chars): ${doc.base64.substring(0, 50000)}`
        });
      }
    }

    const docTypes = documents.map(d => d.docType).join(', ');

    content.push({
      type: 'text',
      text: `You are a commercial real estate due diligence analyst reviewing documents for an NNN (triple net lease) property acquisition. The buyer is represented by a buyer's broker (American Net Lease).

Deal: ${dealName || 'Unknown'}
Documents provided: ${docTypes}

Perform a thorough due diligence review. Flag anything that a buyer, buyer's attorney, or buyer's broker should know about BEFORE closing. Be practical and specific — no generic advice.

## REVIEW CATEGORIES

### 1. RED FLAGS (Critical Issues)
Issues that could kill the deal or cause major financial harm:
- Tenant in bankruptcy or financial distress signals
- Lease expiration within 2 years of closing with no renewal options
- Environmental contamination indicators
- Title encumbrances that restrict use
- Unusual termination or kick-out clauses favoring the tenant
- Material discrepancies between PSA and lease terms
- Missing or problematic indemnification clauses
- Gaps in insurance requirements

### 2. YELLOW FLAGS (Concerns to Address)
Issues that need attorney/client discussion but aren't deal-killers:
- Roof/structural/HVAC responsibility language — who pays for what?
- CAM/NNN pass-through gaps — are ALL operating expenses passed through?
- Tenant improvement allowances or landlord obligations remaining
- Assignment/subletting provisions
- Co-tenancy or exclusivity clauses
- Rent escalation structure vs. market
- Estoppel certificate discrepancies with lease terms
- Survey issues (easements, encroachments)
- Title exceptions that need review
- Unusual notice or cure period requirements

### 3. KEY TERMS SUMMARY
Extract and summarize critical deal terms:
- Lease start/end dates and remaining term
- Renewal options (number, term, rent adjustment method)
- Current rent and escalation schedule
- Tenant's maintenance/repair responsibilities
- Landlord's remaining obligations (if any)
- Insurance requirements
- Assignment/change of ownership provisions
- Any personal guarantees

### 4. ACTION ITEMS
Specific next steps for the team:
- Questions to ask the seller
- Items for attorney review
- Documents still needed
- Deadlines to be aware of

Return ONLY valid JSON (no markdown, no code fences):
{
  "red_flags": [
    {
      "title": "Short title of the issue",
      "detail": "Specific explanation with section/page references",
      "recommendation": "What to do about it"
    }
  ],
  "yellow_flags": [
    {
      "title": "Short title",
      "detail": "Explanation with references",
      "recommendation": "Suggested action"
    }
  ],
  "key_terms": {
    "lease_start": "date or description",
    "lease_end": "date or description",
    "remaining_term": "X years Y months",
    "renewal_options": "description",
    "current_rent": "amount/period",
    "escalations": "description",
    "tenant_responsibilities": "summary",
    "landlord_obligations": "summary",
    "insurance": "summary",
    "assignment_provisions": "summary",
    "guarantees": "description or none"
  },
  "action_items": [
    {
      "task": "What needs to happen",
      "assignee": "Attorney / Buyer / Broker / Title",
      "priority": "high / medium / low"
    }
  ],
  "summary": "2-3 sentence executive summary of overall DD findings"
}`
    });

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };

    // Check if any document is a PDF
    const hasPDF = documents.some(d => (d.name || '').toLowerCase().endsWith('.pdf'));
    if (hasPDF) {
      headers['anthropic-beta'] = 'pdfs-2024-09-25';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      let detail = '';
      try { detail = JSON.parse(errText)?.error?.message || errText; } catch { detail = errText; }
      return res.status(502).json({ error: `Claude API error: ${detail}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(jsonStr);

    // Ensure all arrays exist
    if (!result.red_flags) result.red_flags = [];
    if (!result.yellow_flags) result.yellow_flags = [];
    if (!result.action_items) result.action_items = [];
    if (!result.key_terms) result.key_terms = {};

    return res.status(200).json(result);

  } catch (err) {
    console.error('DD review error:', err);
    return res.status(500).json({ error: err.message });
  }
}
