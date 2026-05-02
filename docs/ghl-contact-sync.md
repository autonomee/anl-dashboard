# GoHighLevel Contact Auto-Sync

## Overview

When you upload and scan a PSA (Purchase & Sale Agreement) in Mission Control, the system now automatically:

1. **Extracts all deal party contacts** from the document (attorneys, brokers, lenders, title agents, etc.)
2. **Saves them to Mission Control** (Supabase contacts table)
3. **Syncs them to GoHighLevel** with proper role-based tags
4. **Links the records** so you can track sync status

## How It Works

### 1. PSA Upload & Scan

When you click "Scan PSA" in the deal modal:

- Claude AI reads the document (PDF or DOCX)
- Extracts critical dates (effective date, closing date, etc.)
- **NEW:** Extracts all identifiable contacts from:
  - Parties section (Buyer, Seller)
  - Notices section (attorneys with full contact details)
  - Escrow/Title provisions (title agent)
  - Broker/Commission section (listing broker, buyer's broker)
  - Signature blocks

### 2. Contact Extraction

For each contact found, the scanner extracts:

- **Name** — person or entity name
- **Company** — firm/company name (if different from name)
- **Email** — if found in document
- **Phone** — if found in document
- **Role** — must be one of:
  - Buyer
  - Seller
  - Seller's Broker
  - Seller's Attorney
  - Buyer's Attorney
  - Escrow/Title Agent
  - Mortgage Broker
  - Lender
  - 1031 Intermediary
  - Transaction Assistant
- **Source** — where in the document it was found (e.g., "Notices - Section 12.1")

### 3. Mission Control Sync

Contacts are saved to the `contacts` table in Supabase:

- **New contacts** are created if no match found by email/name
- **Existing contacts** are linked to the deal
- All contacts appear in the "Deal Parties" section as **suggestions** (yellow highlight)
- You confirm or remove each suggestion

### 4. GoHighLevel Sync

Immediately after saving to Mission Control, contacts are synced to GHL:

- **Search by email** — checks if contact already exists in GHL
- **Create or update** — creates new contact or updates existing with new tags
- **Role-based tagging** — each contact gets 2 tags:
  - "ANL Transaction" (all contacts)
  - Role-specific tag (e.g., "ANL Deal - Seller's Attorney")
- **GHL Contact ID** stored back in Supabase for future reference

### Role → GHL Tag Mapping

| Role | GHL Tags |
|------|----------|
| Buyer | `ANL Transaction`, `ANL Deal - Client` |
| Seller | `ANL Transaction`, `ANL Deal - Seller` |
| Seller's Broker | `ANL Transaction`, `ANL Deal - Listing Broker` |
| Seller's Attorney | `ANL Transaction`, `ANL Deal - Seller's Attorney` |
| Buyer's Attorney | `ANL Transaction`, `ANL Deal - Buyer's Attorney` |
| Escrow/Title Agent | `ANL Transaction`, `ANL Deal - Title Agent` |
| Mortgage Broker | `ANL Transaction`, `ANL Deal - Mortgage Broker` |
| Lender | `ANL Transaction`, `ANL Deal - Lender` |
| 1031 Intermediary | `ANL Transaction`, `ANL Deal - 1031 Intermediary` |
| Transaction Assistant | `ANL Transaction`, `ANL Deal - Transaction Coordinator` |

## Configuration

### Required Environment Variables (Vercel)

Add these to your Vercel project settings:

```
GHL_API_KEY=pit-8f6da4a0-ea6a-4cf5-bd73-d6eed11f8021
GHL_LOCATION_ID=your_location_id_here
```

**Where to find these:**

1. **GHL_API_KEY**:
   - Log into GoHighLevel
   - Settings → Integrations → API
   - Create or copy your API key

2. **GHL_LOCATION_ID**:
   - GoHighLevel URL: `https://app.gohighlevel.com/location/[THIS_IS_YOUR_LOCATION_ID]/dashboard`
   - Or: Settings → Business Info → Location ID

### Supabase Migration

Run this SQL in your Supabase SQL Editor to add the GHL tracking field:

```sql
-- Add GHL contact ID to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_ghl_contact_id ON contacts (ghl_contact_id);

-- Add columns to deal_contacts for tracking sync status
ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE deal_contacts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'Manual';
```

## Workflow

### Before (Manual Entry)

1. Upload PSA to deal
2. Manually add each contact one-by-one in "Deal Parties"
3. Separately add each contact to GHL
4. Manually tag each contact in GHL

### After (Automatic)

1. Upload PSA to deal
2. Click "Scan PSA"
3. ✅ **All contacts extracted, saved, and synced to GHL with proper tags**
4. Review suggestions, confirm or remove

## Testing

### Test PSA Scan + GHL Sync

1. Go to Mission Control → Pipeline tab
2. Open any deal
3. Upload a sample PSA (must include Notices section with attorney contact info)
4. Click "Scan PSA"
5. Wait for scan to complete
6. Check console logs for: `✅ Synced N contacts to GHL`
7. Go to GoHighLevel → Contacts
8. Search for one of the extracted attorneys
9. Verify contact exists with tags: `ANL Transaction`, `ANL Deal - Seller's Attorney`

### Expected Results

**Console Output:**
```
PSA scan result: {milestones: [...], contacts: [{name: "John Smith", role: "Seller's Attorney", ...}]}
GHL sync result: {success: true, summary: {created: 3, updated: 1, errors: 0}}
✅ Synced 4 contacts to GHL
```

**Mission Control:**
- 3-4 new contacts appear in "Deal Parties" section with yellow highlight (suggested)
- Each shows source: "PSA scan: Notices - Section 12.1"

**GoHighLevel:**
- 3-4 new contacts created (or existing contacts updated)
- Each tagged properly based on role
- Source field shows "Mission Control PSA Scan"

## Rate Limiting

GHL API allows **100 requests per 10 seconds**.

The sync function includes built-in rate limiting:
- Waits 150ms between each contact (max 6.6 req/sec)
- Well under the GHL limit
- No manual throttling needed

## Error Handling

If GHL sync fails:
- ✅ **Contacts are still saved to Mission Control**
- ❌ GHL sync skipped
- Error logged to browser console
- No blocking error shown to user

The sync is **non-blocking** — Mission Control always works even if GHL is down.

## Future Enhancements

### Phase 2 (Planned)

- **Batch sync button** — manually trigger GHL sync for all deals
- **Sync status indicator** — show which contacts are synced vs pending
- **Two-way sync** — pull GHL contact updates back to Mission Control
- **GHL contact link** — clickable link to view contact in GHL

### Phase 3 (Future)

- **Workflow automation** — trigger GHL workflows when contacts are added
- **Deal pipelines** — sync deal stages to GHL opportunities
- **Activity logging** — log all contact interactions back to GHL timeline

## Troubleshooting

### Contacts not syncing to GHL

**Check:**
1. Vercel env vars are set (`GHL_API_KEY`, `GHL_LOCATION_ID`)
2. GHL API key is valid (test in GHL Settings → API)
3. Browser console for error messages
4. Network tab shows request to `/api/sync-contacts-to-ghl`

**Debug:**
```javascript
// Open browser console, run:
fetch('/api/sync-contacts-to-ghl', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    contacts: [{
      name: 'Test Contact',
      email: 'test@example.com',
      role: "Seller's Attorney"
    }]
  })
}).then(r => r.json()).then(console.log);
```

### Duplicate contacts in GHL

**Cause:** GHL search by email didn't find existing contact (typo, different email)

**Fix:** Manually merge duplicates in GHL, or update email in Mission Control and re-sync

### Missing contact details (no email/phone)

**Cause:** PSA scan couldn't extract email/phone from document

**Fix:**
1. Manually add email/phone in Mission Control
2. Contact will still sync to GHL (without email/phone)
3. Update contact in GHL later

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Mission Control (mission-control.html)                       │
│ ┌─────────────────────┐                                      │
│ │ Deal Modal          │                                      │
│ │ Upload PSA → Scan   │                                      │
│ └──────────┬──────────┘                                      │
│            │                                                  │
│            ▼                                                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ /api/psa-scan (Vercel Function)                         │ │
│ │ Claude AI extracts:                                     │ │
│ │ - Critical dates (9 milestones)                         │ │
│ │ - Deal party contacts (all roles)                       │ │
│ └──────────┬──────────────────────────────────────────────┘ │
│            │                                                  │
│            ▼                                                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ processPSAContacts() — JavaScript                       │ │
│ │ 1. Create/link contacts in Supabase                     │ │
│ │ 2. Add to deal_contacts (unconfirmed)                   │ │
│ │ 3. Call /api/sync-contacts-to-ghl                       │ │
│ └──────────┬──────────────────────────────────────────────┘ │
└────────────┼──────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ /api/sync-contacts-to-ghl (Vercel Function)             │
│ For each contact:                                        │
│ 1. Search GHL by email                                   │
│ 2. Create or update contact                              │
│ 3. Add role-based tags                                   │
│ 4. Return sync results                                   │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ GoHighLevel Contacts API                                 │
│ https://services.leadconnectorhq.com/contacts            │
│ - POST /contacts (create)                                │
│ - PUT /contacts/:id (update)                             │
│ - POST /contacts/search (find by email)                  │
└──────────────────────────────────────────────────────────┘
```

## API Reference

### POST /api/sync-contacts-to-ghl

**Request:**
```json
{
  "contacts": [
    {
      "id": "uuid-optional",
      "name": "John Smith",
      "email": "john@law.com",
      "phone": "+1234567890",
      "company": "Smith & Associates",
      "role": "Seller's Attorney",
      "source": "PSA scan: Notices - Section 12.1"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "contact": "John Smith",
      "action": "created",
      "supabaseContactId": "uuid",
      "ghlContactId": "ghl_uuid",
      "tags": ["ANL Transaction", "ANL Deal - Seller's Attorney"]
    }
  ],
  "summary": {
    "created": 1,
    "updated": 0,
    "errors": 0
  }
}
```

**Action Types:**
- `created` — New contact created in GHL
- `updated` — Existing GHL contact updated with new tags
- `error` — Sync failed for this contact

## Security

- **GHL API key** stored in Vercel env vars (not in code)
- **Rate limiting** prevents API abuse
- **Read-only** contact sync (no destructive operations)
- **Error logging** for debugging without exposing keys

## Cost

**Free!**

- GHL API calls included in GHL subscription
- Vercel function invocations: ~10-20/month (free tier = 100k/month)
- No additional cost

## Support

Issues? Questions?

1. Check browser console for error messages
2. Verify Vercel env vars are set
3. Test GHL API key in GHL Settings
4. Review this doc's Troubleshooting section
