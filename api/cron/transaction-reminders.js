// Transaction Reminders — Daily Slack notifications for pending tasks + missing DD docs
// Vercel Cron Job (runs daily at 8:15am ET on weekdays, after critical date reminders)
// Requires: SUPABASE_URL, SUPABASE_KEY, SLACK_WEBHOOK_URL env vars

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });
  if (!SLACK_WEBHOOK_URL) return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' });

  const supaHeaders = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

  try {
    // Fetch active deals
    const dealsRes = await fetch(`${SUPABASE_URL}/rest/v1/deals?status=eq.active&select=id,deal_name,tenant,city,state,stage`, {
      headers: supaHeaders
    });
    if (!dealsRes.ok) throw new Error(`Deals fetch failed: ${dealsRes.status}`);
    const deals = await dealsRes.json();
    if (deals.length === 0) return res.status(200).json({ message: 'No active deals', sent: false });

    const dealIds = deals.map(d => d.id);

    // Fetch pending subtasks for active deals
    const subtasksRes = await fetch(`${SUPABASE_URL}/rest/v1/deal_subtasks?deal_id=in.(${dealIds.join(',')})&status=eq.pending&order=sort_order.asc`, {
      headers: supaHeaders
    });
    const subtasks = subtasksRes.ok ? await subtasksRes.json() : [];

    // Fetch DD documents for active deals
    const ddDocsRes = await fetch(`${SUPABASE_URL}/rest/v1/deal_documents?deal_id=in.(${dealIds.join(',')})`, {
      headers: supaHeaders
    });
    const ddDocs = ddDocsRes.ok ? await ddDocsRes.json() : [];

    // DD doc types required for escrow_open+ stages
    const DD_STAGES = ['escrow_open', 'due_diligence', 'pre_closing', 'closing_day'];
    const REQUIRED_DD_DOCS = [
      { type: 'lease', label: 'Lease' },
      { type: 'survey', label: 'Survey' },
      { type: 'phase1', label: 'Phase 1 Environmental' },
      { type: 'estoppel', label: 'Estoppel Certificate' },
      { type: 'title_commitment', label: 'Title Commitment' }
    ];

    const blocks = [];
    let hasAlerts = false;

    for (const deal of deals) {
      const dealLabel = deal.deal_name || `${deal.tenant} — ${deal.city}, ${deal.state}`;
      const dealSubtasks = subtasks.filter(s => s.deal_id === deal.id);
      const dealDocs = ddDocs.filter(d => d.deal_id === deal.id);

      // Check for pending human tasks
      const humanPending = dealSubtasks.filter(s => s.task_type === 'human' || s.task_type === 'hybrid');

      // Check for missing DD docs (only for DD-relevant stages)
      let missingDocs = [];
      if (DD_STAGES.includes(deal.stage)) {
        const uploadedTypes = dealDocs.map(d => d.doc_type);
        missingDocs = REQUIRED_DD_DOCS.filter(rd => !uploadedTypes.includes(rd.type));
      }

      if (humanPending.length === 0 && missingDocs.length === 0) continue;
      hasAlerts = true;

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${dealLabel}*` }
      });

      // Pending human tasks
      if (humanPending.length > 0) {
        // Group by assignee
        const byAssignee = {};
        humanPending.forEach(s => {
          const a = s.assignee || 'Unassigned';
          if (!byAssignee[a]) byAssignee[a] = [];
          byAssignee[a].push(s.title);
        });

        let taskLines = '';
        for (const [assignee, tasks] of Object.entries(byAssignee)) {
          taskLines += `*${assignee}:*\n` + tasks.map(t => `  :white_circle: ${t}`).join('\n') + '\n';
        }
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: taskLines.trim() }
        });
      }

      // Missing DD docs
      if (missingDocs.length > 0) {
        const uploaded = REQUIRED_DD_DOCS.length - missingDocs.length;
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:file_folder: *DD Documents: ${uploaded}/${REQUIRED_DD_DOCS.length}*\nMissing: ${missingDocs.map(d => d.label).join(', ')}`
          }
        });
      }

      blocks.push({ type: 'divider' });
    }

    if (!hasAlerts) {
      return res.status(200).json({ message: 'No pending tasks or missing docs', sent: false });
    }

    const today = new Date();
    const slackPayload = {
      text: 'Transaction Task Reminders',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '📋 Transaction Task Reminders' }
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })} | Complete tasks in <https://anl-dashboard.vercel.app|Mission Control>`
          }]
        },
        { type: 'divider' },
        ...blocks
      ]
    };

    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload)
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      throw new Error(`Slack webhook failed: ${slackRes.status} ${errText}`);
    }

    return res.status(200).json({ message: 'Reminders sent', sent: true, dealsChecked: deals.length });
  } catch (err) {
    console.error('Transaction reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
