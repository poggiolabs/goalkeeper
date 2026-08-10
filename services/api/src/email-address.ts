/**
 * One definition of what Goalkeeper accepts as an email address.
 *
 * Deliberately permissive: full RFC 5322 validation rejects addresses that
 * real mail servers deliver to, so the useful job here is catching obvious
 * malformation, not adjudicating the spec. Ownership is proven by the
 * verification flow, or by the identity provider behind a trusted proxy.
 *
 * The `organization_invitations` check constraint carries this same pattern as
 * a SQL literal. That copy is intentional: an applied migration is a snapshot
 * and must not change when this constant does.
 */
export const emailAddressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Longest address the invitation table stores, and the RFC 5321 maximum for a
 * forward path including both local part and domain.
 */
export const maximumEmailAddressLength = 320;

export function isEmailAddress(
  value: unknown,
  maximumLength = maximumEmailAddressLength
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    emailAddressPattern.test(value)
  );
}
