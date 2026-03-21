// Stage Change Notification — Slack notification when deal moves to a new stage
// Called from frontend when saveDeal() detects a stage change
// Requires: SLACK_WEBHOOK_URL env var

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { dealName, oldStage, newStage, tasks } = req.body || {};
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  if (!SLACK_WEBHOOK_URL) return res.status(200).json({ skipped: true, reason: 'No webhook' });
  if (!dealName || !newStage) return res.status(400).json({ error: 'Missing dealName or newStage' });

  const stageLabels = {
    loi_accepted: 'LOI Accepted',
    psa_received: 'PSA Received',
    psa_signed: 'PSA Signed',
    escrow_open: 'Escrow Open',
    due_diligence: 'Due Diligence',
    pre_closing: 'Pre-Closing',
    closing_day: 'Closing Day',
    post_closing: 'Post-Closing'
  };

  const stageEmojis = {
    loi_accepted: ':handshake:',
    psa_received: ':page_facing_up:',
    psa_signed: ':black_nib:',
    escrow_open: ':bank:',
    due_diligence: ':mag:',
    pre_closing: ':bookmark_tabs:',
    closing_day: ':tada:',
    post_closing: ':white_check_mark:'
  };

  const emoji = stageEmojis[newStage] || ':arrow_right:';
  const newLabel = stageLabels[newStage] || newStage;
  const oldLabel = oldStage ? (stageLabels[oldStage] || oldStage) : 'New';

  try {
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${emoji} Deal Stage Change` }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${dealName}*\n${oldLabel} → *${newLabel}*`
        }
      }
    ];

    // List tasks for the new stage
    if (tasks && tasks.length > 0) {
      const humanTasks = tasks.filter(t => t.type === 'human' || t.type === 'hybrid');
      const botTasks = tasks.filter(t => t.type === 'bot');

      if (humanTasks.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Action Items (Team):*\n' + humanTasks.map(t =>
              `:clipboard: ${t.title} — *${t.assignee}*`
            ).join('\n')
          }
        });
      }

      if (botTasks.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Bot Will Handle:*\n' + botTasks.map(t =>
              `:robot_face: ${t.title}`
            ).join('\n')
          }
        });
      }
    }

    // Add reminder context based on stage
    const stageReminders = {
      psa_received: ':bell: *Reminders active:* Upload PSA, confirm contacts & dates',
      escrow_open: ':bell: *Reminders active:* Collect DD docs (Lease, Survey, Phase 1, Estoppel)',
      due_diligence: ':bell: *Reminders active:* DD review completion tracking',
      pre_closing: ':bell: *Reminders active:* W9, invoice, wire instructions',
      closing_day: ':bell: *Reminders active:* Lease assignment letter'
    };

    if (stageReminders[newStage]) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: stageReminders[newStage] }]
      });
    }

    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `View in <https://anl-dashboard.vercel.app|Mission Control>`
      }]
    });

    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Deal stage change: ${dealName} → ${newLabel}`, blocks })
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      console.error('Slack error:', errText);
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Stage change notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
