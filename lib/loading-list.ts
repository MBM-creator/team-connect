export function loadingListUrl(origin: string, orgSlug: string, id: string) {
  return `${origin}/t/${encodeURIComponent(orgSlug)}/loading-lists/${encodeURIComponent(id)}`;
}

export function loadingEmailHtml(text: string, url: string) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<div style="font-family:Arial,sans-serif;line-height:1.5"><p><a href="${escape(url)}" style="display:inline-block;padding:14px 22px;background:#698f00;color:white;text-decoration:none;border-radius:6px">Mark as loaded</a></p><p>Open the list and confirm once everything is loaded. This stops reminders for this list.</p><div style="white-space:pre-wrap">${escape(text)}</div></div>`;
}

export function reminderSubject(subject: string, workDate: string) {
  return `Not marked as loaded (${workDate}): ${subject}`;
}
