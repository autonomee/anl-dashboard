/**
 * Sync Deal Contacts to GoHighLevel
 *
 * Vercel Serverless Function
 * Called after PSA scan to sync extracted contacts to GHL with proper role tags
 *
 * Request body:
 * {
 *   "contacts": [
 *     {
 *       "id": "uuid-from-supabase",  // optional
 *       "name": "John Smith",
 *       "email": "john@law.com",
 *       "phone": "+1234567890",
 *       "company": "Smith & Associates",
 *       "role": "Seller's Attorney",
 *       "source": "PSA scan: Notices - Section 12.1"
 *     }
 *   ]
 * }
 *
 * Returns:
 * {
 *   "success": true,
 *   "results": [
 *     {
 *       "contact": "John Smith",
 *       "action": "created",
 *       "supabaseContactId": "uuid",
 *       "ghlContactId": "ghl_uuid",
 *       "tags": ["ANL Transaction", "ANL Deal - Seller's Attorney"]
 *     }
 *   ],
 *   "summary": { "created": 3, "updated": 1, "errors": 0 }
 * }
 */

// GHL Contact sync from gobot repo (copied here for Vercel deployment)
// This is a simplified version that works in Vercel edge runtime

const GHL_BASE = "https://services.leadconnectorhq.com";

const ROLE_TO_TAG = {
  "Buyer": "ANL Deal - Client",
  "Seller": "ANL Deal - Seller",
  "Seller's Broker": "ANL Deal - Listing Broker",
  "Seller's Attorney": "ANL Deal - Seller's Attorney",
  "Escrow/Title Agent": "ANL Deal - Title Agent",
  "Mortgage Broker": "ANL Deal - Mortgage Broker",
  "Lender": "ANL Deal - Lender",
  "1031 Intermediary": "ANL Deal - 1031 Intermediary",
  "Transaction Assistant": "ANL Deal - Transaction Coordinator",
  "Buyer's Attorney": "ANL Deal - Buyer's Attorney",
};

function getRoleTags(role) {
  const tag = ROLE_TO_TAG[role];
  return tag ? ["ANL Transaction", tag] : ["ANL Transaction"];
}

function contactHeaders(ghlToken) {
  return {
    Authorization: `Bearer ${ghlToken}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

async function ghlSearchContactByEmail(email, ghlToken, locationId) {
  if (!email) return null;

  try {
    const res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: "POST",
      headers: contactHeaders(ghlToken),
      body: JSON.stringify({ locationId, query: email, pageLimit: 1 }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const contacts = data.contacts || [];

    return contacts.find((c) => c.email?.toLowerCase() === email.toLowerCase()) || null;
  } catch {
    return null;
  }
}

async function ghlCreateContact(params, ghlToken, locationId) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: contactHeaders(ghlToken),
      body: JSON.stringify({
        locationId,
        ...params,
        customFields: params.source ? [{ key: "source", field_value: params.source }] : undefined,
      }),
    });

    if (!res.ok) {
      console.error(`GHL create contact error: ${res.status}`);
      return null;
    }

    return res.json();
  } catch (err) {
    console.error("GHL create contact error:", err);
    return null;
  }
}

async function ghlUpdateContact(contactId, updates, ghlToken) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: contactHeaders(ghlToken),
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      console.error(`GHL update contact error: ${res.status}`);
      return null;
    }

    return res.json();
  } catch (err) {
    console.error("GHL update contact error:", err);
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ghlToken = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!ghlToken || !locationId) {
    return res.status(500).json({ error: 'GHL_API_KEY or GHL_LOCATION_ID not configured' });
  }

  const { contacts } = req.body;

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts array is required' });
  }

  const results = [];
  const summary = { created: 0, updated: 0, errors: 0 };

  for (const contact of contacts) {
    try {
      // Parse name
      const nameParts = contact.name.trim().split(/\s+/);
      const firstName = nameParts[0] || contact.name;
      const lastName = nameParts.slice(1).join(" ") || "";

      const roleTags = getRoleTags(contact.role);

      // Check if contact exists in GHL
      let ghlContact = null;
      if (contact.email) {
        ghlContact = await ghlSearchContactByEmail(contact.email, ghlToken, locationId);
      }

      let action = "created";
      let ghlContactId = null;

      if (!ghlContact) {
        // Create new contact in GHL
        const newContact = await ghlCreateContact({
          firstName,
          lastName,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
          companyName: contact.company || undefined,
          tags: roleTags,
          source: contact.source || "Mission Control PSA Scan",
        }, ghlToken, locationId);

        if (!newContact) {
          summary.errors++;
          results.push({
            contact: contact.name,
            action: "error",
            error: "GHL API error",
            tags: roleTags,
          });
          continue;
        }

        ghlContactId = newContact.id;
        summary.created++;
      } else {
        // Update existing contact with new tags
        await ghlUpdateContact(ghlContact.id, {
          firstName,
          lastName,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
          companyName: contact.company || undefined,
          tags: roleTags,
        }, ghlToken);

        ghlContactId = ghlContact.id;
        action = "updated";
        summary.updated++;
      }

      results.push({
        contact: contact.name,
        action,
        supabaseContactId: contact.id || null,
        ghlContactId,
        tags: roleTags,
      });

      // Rate limiting: sleep 150ms between requests
      await new Promise((resolve) => setTimeout(resolve, 150));

    } catch (err) {
      console.error(`Error syncing contact ${contact.name}:`, err);
      summary.errors++;
      results.push({
        contact: contact.name,
        action: "error",
        error: err.message,
      });
    }
  }

  return res.status(200).json({
    success: summary.errors === 0,
    results,
    summary,
  });
}
