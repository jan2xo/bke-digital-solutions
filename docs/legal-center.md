# Legal & Compliance Center

Phase 6.1A provides the management platform for legal documents; it does not provide approved legal wording.

## Administrator workflow

Open `/admin/legal` with an MFA-verified administrator session. Administrators can create one document per semantic type, edit its display title, search/filter documents, archive or restore the document, create and edit Markdown drafts, preview sanitized output, publish, archive or restore published versions, duplicate versions, compare adjacent source text, and inspect acceptance counts and recent history.

Publishing requires authentication within the recent-authentication window. The previous current version is archived and the new pointer is installed transactionally. Only unpublished drafts can be deleted. Every mutation writes an `AuditLog` action.

## Supported initial types

- Terms of Service
- Privacy Policy
- Software License Agreement (EULA)
- Subscription Terms
- Refund Policy
- Acceptable Use Policy
- Cookie Policy
- Support Policy
- Data Processing Addendum

The database and API accept future uppercase semantic type identifiers. A unique type prevents two documents from competing as the current Terms, Privacy, or checkout agreement.

## Public access

`/legal/{slug}` shows the current published version. `/legal/{slug}/versions/{number}` exposes only versions that were actually published. Drafts are never public. Historical pages are labeled and link back to the current version.

## Templates

The seed creates one version for every initial type. Every seed explicitly says it is placeholder content requiring review. Replace it before public commerce.
