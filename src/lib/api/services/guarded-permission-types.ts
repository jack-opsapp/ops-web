/** Shared web/iOS wire types for resolving lead responsibility atomically. */

export interface RoleAssignmentResolution {
  opportunity_id: string;
  expected_assigned_to: string;
  expected_assignment_version: number;
  new_assigned_to: string | null;
}

export interface StrandedRoleAssignment {
  opportunity_id: string;
  title: string | null;
  assigned_to: string;
  assignment_version: number;
}

export interface EligibleRoleAssignmentTarget {
  id: string;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  user_color: string | null;
  role: string | null;
}
