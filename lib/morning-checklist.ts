import { formatReportDateInTimezone } from '@/lib/report-date';

/** All scheduling decisions use Melbourne time, including daylight saving. */
export function morningChecklistWindow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', weekday: 'short', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)?.value;
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  const morning = hour === 6 && minute >= 15 && minute < 30;
  const followup = hour >= 7 && hour <= 17 && minute >= 30;
  const workDate = formatReportDateInTimezone(now);
  return {
    workDate,
    due: value('weekday') !== 'Sun' && (morning || followup),
    mode: morning ? 'morning' as const : 'followup' as const,
    slot: `${workDate}T${String(hour).padStart(2, '0')}:${morning ? '15' : '30'}`,
  };
}

export function previousWorkingDate(workDate: string): string {
  const date = new Date(`${workDate}T12:00:00Z`);
  do { date.setUTCDate(date.getUTCDate() - 1); } while (date.getUTCDay() === 0);
  return date.toISOString().slice(0, 10);
}

export type ChecklistSource = {
  creatorId: string; jobId: string; orgId: string;
  jobName: string; jobNumber: string | null; orgSlug: string;
  equipment: string[]; materials: string[]; notes: string | null;
  kind: 'plan' | 'tomorrow';
};
export type ChecklistRecipient = { id: string; org_id: string; email: string; active: boolean };
export type ChecklistEmail = { staffId: string; orgSlug: string; to: string; subject: string; text: string };

export function buildMorningChecklists(
  sources: ChecklistSource[], staff: ChecklistRecipient[], workDate: string, origin: string,
): ChecklistEmail[] {
  const groups = new Map<string, { staff: ChecklistRecipient; orgSlug: string; sections: string[] }>();
  // Stable order keeps the stored email and retry payload deterministic.
  for (const source of [...sources].sort((a, b) =>
    `${a.jobId}/${a.kind}`.localeCompare(`${b.jobId}/${b.kind}`))) {
    const recipient = staff.find(s => s.id === source.creatorId && s.org_id === source.orgId && s.active);
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) continue;
    const equipment = source.equipment.map(s => s.trim()).filter(Boolean);
    const materials = source.materials.map(s => s.trim()).filter(Boolean);
    const notes = source.notes?.trim();
    if (!equipment.length && !materials.length && !notes) continue;
    const link = `${origin}/t/${encodeURIComponent(source.orgSlug)}/jobs/${encodeURIComponent(source.jobId)}/daily-plan?workDate=${workDate}`;
    const heading = `${source.jobNumber ? `Job #${source.jobNumber} - ` : ''}${source.jobName}`;
    const section = [heading,
      ...(equipment.length ? ['Tools and equipment:', ...equipment.map(s => `- ${s}`)] : []),
      ...(materials.length ? ['Materials:', ...materials.map(s => `- ${s}`)] : []),
      ...(notes ? [source.kind === 'tomorrow' ? 'Notes for today:' : 'Plan notes:', notes] : []),
      `Open today's plan: ${link}`,
    ].join('\n');
    const group = groups.get(recipient.id) ?? { staff: recipient, orgSlug: source.orgSlug, sections: [] };
    group.sections.push(section);
    groups.set(recipient.id, group);
  }
  const dateLabel = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${workDate}T12:00:00Z`));
  return [...groups.values()].map(({ staff: recipient, orgSlug, sections }) => ({
    staffId: recipient.id, orgSlug, to: recipient.email.trim(),
    subject: `Team Connect: tools and notes for ${dateLabel}`,
    text: [`Before you leave the yard - ${dateLabel}`, ...sections,
      'Check that your tools, equipment and materials are loaded before you leave.',
    ].join('\n\n'),
  }));
}
