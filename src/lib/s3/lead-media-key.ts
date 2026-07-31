/**
 * Lead photos live under the publicly readable project-media namespace even
 * before conversion. Keeping the opportunity id behind a dedicated `leads`
 * segment lets delete authorization resolve the canonical lead edit boundary.
 */
export function leadMediaFolder(
  companyId: string,
  opportunityId: string
): string {
  return `projects/${companyId}/leads/${opportunityId}`;
}
