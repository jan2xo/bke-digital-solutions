/**
 * Fail closed when an unapproved working draft was accidentally published.
 * A PUBLISHED database state is not evidence of legal or owner approval.
 *
 * Do not use this policy as a replacement for the legal review workflow:
 * commercial agreements still require separate approval and publication.
 */
export function isUnapprovedLegalReviewDraft(
  title: string,
  markdownContent: string,
): boolean {
  if (/\bREVIEW DRAFT\b/i.test(title)) return true;
  const firstSection = markdownContent.slice(0, 1200);
  return /^#\s+.*\bREVIEW DRAFT\b/im.test(firstSection)
    || /\bWorking draft for BKE Digital Solutions Staging\b/i.test(firstSection);
}
