// Critical Date Reminders — Daily Slack notifications to #anl-transactions
// Vercel Cron Job (runs daily at 8am ET on weekdays)
// Requires: SUPABASE_URL, SUPABASE_KEY, SLACK_WEBHOOK_URL env vars

export default async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }
  if (!SLACK_WEBHOOK_URL) {
    return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' });
  }

  try {
    // Fetch all active deals
    const dealsRes = await fetch(`${SUPABASE_URL}/rest/v1/deals?status=eq.active&select=id,deal_name,tenant,city,state,stage`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!dealsRes.ok) throw new Error(`Deals fetch failed: ${dealsRes.status}`);
    const deals = await dealsRes.json();

    // Fetch all critical dates for active deals
    const dealIds = deals.map(d => d.id);
    if (dealIds.length === 0) {
      return res.status(200).json({ message: 'No active deals', sent: false });
    }

    const cdRes = await fetch(`${SUPABASE_URL}/rest/v1/deal_critical_dates?deal_id=in.(${dealIds.join(',')})&order=sort_order.asc`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!cdRes.ok) throw new Error(`Critical dates fetch failed: ${cdRes.status}`);
    const criticalDates = await cdRes.json();

    if (criticalDates.length === 0) {
      return res.status(200).json({ message: 'No critical dates to check', sent: false });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const blocks = [];
    let hasAlerts = false;

    for (const deal of deals) {
      const cds = criticalDates.filter(cd => cd.deal_id === deal.id);
      if (cds.length === 0) continue;

      const overdue = [];
      const upcoming = [];
      const unclear = [];

      for (const cd of cds) {
        if (cd.confirmed) continue; // Skip confirmed dates

        if (!cd.due_date) {
          // Date not set — flag for team to fill in
          unclear.push(cd);
        } else {
          const due = new Date(cd.due_date + 'T00:00:00');
          const diffDays = Math.ceil((due - today) / 86400000);

          if (diffDays < 0) {
            overdue.push({ ...cd, daysOverdue: Math.abs(diffDays) });
          } else if (diffDays <= 7) {
            upcoming.push({ ...cd, daysUntil: diffDays });
          }
        }
      }

      if (overdue.length === 0 && upcoming.length === 0 && unclear.length === 0) continue;
      hasAlerts = true;

      const dealLabel = deal.deal_name || `${deal.tenant} — ${deal.city}, ${deal.state}`;

      // Deal header
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${dealLabel}*`
        }
      });

      // Overdue dates
      if (overdue.length > 0) {
        const lines = overdue.map(cd =>
          `:red_circle: *${cd.milestone_label}* — ${cd.daysOverdue}d overdue (was ${cd.due_date})${cd.psa_section ? ' [' + cd.psa_section + ']' : ''}`
        ).join('\n');
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: lines }
        });
      }

      // Upcoming dates (within 7 days)
      if (upcoming.length > 0) {
        const lines = upcoming.map(cd => {
          const urgency = cd.daysUntil === 0 ? ':warning: *TODAY*' :
            cd.daysUntil <= 3 ? `:large_yellow_circle: ${cd.daysUntil}d` :
            `:large_blue_circle: ${cd.daysUntil}d`;
          return `${urgency} *${cd.milestone_label}* — due ${cd.due_date}${cd.psa_section ? ' [' + cd.psa_section + ']' : ''}`;
        }).join('\n');
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: lines }
        });
      }

      // Unclear/missing dates
      if (unclear.length > 0) {
        const lines = unclear.map(cd =>
          `:question: *${cd.milestone_label}* — date not set, please update`
        ).join('\n');
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: lines }
        });
      }

      blocks.push({ type: 'divider' });
    }

    if (!hasAlerts) {
      return res.status(200).json({ message: 'No alerts to send', sent: false });
    }

    // Build Slack message
    const slackPayload = {
      text: 'Critical Date Reminders',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📅 Critical Date Reminders'
          }
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })} | Review and confirm dates in <https://anl-dashboard.vercel.app|Mission Control>`
          }]
        },
        { type: 'divider' },
        ...blocks
      ]
    };

    // Send to Slack
    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload)
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      throw new Error(`Slack webhook failed: ${slackRes.status} ${errText}`);
    }

    return res.status(200).json({ message: 'Reminders sent', sent: true });

  } catch (err) {
    console.error('Critical date reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
